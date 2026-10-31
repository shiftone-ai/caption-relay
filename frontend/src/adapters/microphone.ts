import { OperationError, type MicrophoneAdapter, type MicrophoneSession, type TranscriptionStatus, type RoomBinding } from "../domain";

export function createMicrophoneAdapter(room?: RoomBinding): MicrophoneAdapter {
  return {
    available: Boolean(typeof navigator.mediaDevices?.getUserMedia === "function" && typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined"),
    async devices(requestPermission = false) {
      let stream: MediaStream | undefined;
      try {
        if (requestPermission) stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const devices = await navigator.mediaDevices?.enumerateDevices() ?? [];
        return devices.filter(device => device.kind === "audioinput" && device.deviceId)
          .map((device, index) => ({ id: device.deviceId, label: device.label || `マイク ${index + 1}` }));
      } catch {
        throw new OperationError("マイクを確認できませんでした。マイクの使用許可と機器を確認してください。");
      } finally { stream?.getTracks().forEach(track => track.stop()); }
    },
    async start({ deviceId, recognizer }, signal, status): Promise<MicrophoneSession> {
      let stream: MediaStream | null = null;
      let context: AudioContext | null = null;
      let node: AudioWorkletNode | null = null;
      let source: MediaStreamAudioSourceNode | null = null;
      let muted: GainNode | null = null;
      let socket: WebSocket | null = null;
      let closing = false;
      let released = false;
      let flushed: (() => void) | null = null;
      let completed: (() => void) | null = null;
      let failure: string | null = null;
      let stopped = false;
      const release = () => {
        if (released) return;
        released = true;
        stream?.getTracks().forEach(track => track.stop());
        node?.disconnect(); source?.disconnect(); muted?.disconnect();
        void context?.close().catch(() => {});
        if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
        signal.removeEventListener("abort", abort);
        completed?.();
      };
      const abort = () => { closing = true; release(); };
      signal.addEventListener("abort", abort, { once: true });
      const fail = (message: string) => {
        failure = message;
        status({ state: "failed", message, sent_seconds: 0, estimated_yen: 0 });
        release();
      };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }, video: false });
        if (signal.aborted) { stream.getTracks().forEach(track => track.stop()); throw new OperationError("マイクの開始を中止しました。"); }
        context = new AudioContext({ latencyHint: "interactive" });
        await context.audioWorklet.addModule(new URL("./microphone-worklet.js", import.meta.url));
        await context.resume();
        if (signal.aborted || released) throw new OperationError("マイクの開始を中止しました。");
        const url = new URL("/api/source/audio", window.location.href);
        if (room) {
          url.searchParams.set("room_id", room.roomId);
          url.searchParams.set("generation", String(room.generation));
        }
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(url);
        const connection = socket;
        const audioContext = context;
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => { reject(new OperationError("認識の準備が時間内に終わりませんでした。")); release(); }, 15000);
          const finish = (error?: Error) => { window.clearTimeout(timer); error ? reject(error) : resolve(); };
          connection.onopen = () => connection.send(JSON.stringify({ type: "start", recognizer, sample_rate: audioContext.sampleRate, channels: 1, format: "pcm16" }));
          connection.onmessage = event => {
            try {
              const packet = JSON.parse(event.data as string) as { type?: string; status?: TranscriptionStatus };
              if (packet.type !== "status" || !packet.status) throw new Error();
              status(packet.status);
              if (packet.status.state === "live") finish();
              if (packet.status.state === "failed") { failure = packet.status.message; finish(new OperationError(packet.status.message)); release(); }
              if (packet.status.state === "stopped") { stopped = true; completed?.(); release(); }
            } catch { finish(new OperationError("認識の状態を確認できませんでした。")); fail("認識の状態を確認できませんでした。"); }
          };
          connection.onerror = () => { finish(new OperationError("音声認識へ接続できませんでした。")); fail("音声認識へ接続できませんでした。"); };
          connection.onclose = () => {
            finish(new OperationError("音声認識の接続が終了しました。"));
            if (!closing && !released) fail("接続が切れました。音声の一部が欠けた可能性があります。字幕を確認してから再開してください。");
            if (closing && !stopped && !failure) failure = "確定前に接続が終了しました。未確定の字幕を確認してください。";
            release();
          };
        });
        if (signal.aborted || released) throw new OperationError("マイクの開始を中止しました。");
        node = new AudioWorkletNode(context, "caption-relay-microphone", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        node.port.onmessage = event => {
          if (event.data instanceof ArrayBuffer) {
            if (connection.readyState !== WebSocket.OPEN || connection.bufferedAmount > audioContext.sampleRate * 4) {
              fail("音声の送信が追いつかないため停止しました。接続を確認してから再開してください。");
              return;
            }
            connection.send(event.data);
          } else if (event.data?.type === "flushed") flushed?.();
        };
        source = context.createMediaStreamSource(stream);
        muted = context.createGain(); muted.gain.value = 0;
        source.connect(node); node.connect(muted); muted.connect(context.destination);
        stream.getAudioTracks().forEach(track => track.addEventListener("ended", () => { if (!closing) fail("マイクが外れたため認識を停止しました。"); }, { once: true }));
        const label = stream.getAudioTracks()[0]?.label || "既定のマイク";
        return { label, async stop() {
          if (failure) throw new OperationError(failure);
          if (closing || released) return;
          closing = true;
          stream?.getTracks().forEach(track => track.stop());
          try {
            await new Promise<void>((resolve, reject) => {
              const timer = window.setTimeout(() => reject(new OperationError("最後の音声を取得できませんでした。未確定の字幕を確認してください。")), 1000);
              flushed = () => { window.clearTimeout(timer); resolve(); };
              node?.port.postMessage({ type: "flush" });
            });
            if (connection.readyState === WebSocket.OPEN) {
              await new Promise<void>((resolve, reject) => {
                const timer = window.setTimeout(() => reject(new OperationError("字幕の確定が時間内に終わりませんでした。未確定の字幕を確認してください。")), 10000);
                completed = () => { window.clearTimeout(timer); resolve(); };
                connection.send(JSON.stringify({ type: "stop" }));
              });
            }
            if (failure) throw new OperationError(failure);
            if (!stopped) throw new OperationError("字幕の確定を確認できませんでした。未確定の字幕を確認してください。");
          } finally { release(); }
        } };
      } catch (error) {
        release();
        if (error instanceof OperationError) throw error;
        if (error instanceof DOMException && error.name === "NotAllowedError") throw new OperationError("マイクの使用が許可されませんでした。ブラウザの権限を確認してください。");
        throw new OperationError("マイクを準備できませんでした。機器とブラウザの対応を確認してください。");
      }
    },
  };
}
