import { fromCallback } from "xstate";
import { OperationError, type MicrophoneAdapter, type MicrophoneSession, type ViewEvent } from "../domain";

type Command = { type: "start"; deviceId: string } | { type: "stop" };

// This actor bridges browser lifetimes; the operator Mediator decides when commands are allowed.
export const microphoneActor = fromCallback<Command, { adapter?: MicrophoneAdapter }>(({ input, receive, sendBack }) => {
  let controller: AbortController | null = null;
  let session: MicrophoneSession | null = null;
  let generation = 0;
  let stopping = false;
  const emit = (event: ViewEvent) => sendBack(event);
  const list = () => input.adapter?.devices().then(devices => emit({ type: "microphone.devices.changed", devices })).catch(() => {});
  void list();
  receive(command => {
    if (command.type === "start") {
      if (stopping) return;
      const current = ++generation;
      controller = new AbortController();
      const signal = controller.signal;
      void input.adapter?.start(command.deviceId, signal, status => {
        if (current === generation) emit({ type: "microphone.state.changed", state: status.state, message: status.message });
      }).then(async result => {
        if (current !== generation) { await result.stop(); return; }
        session = result;
        emit({ type: "microphone.state.changed", state: "live", message: "マイクの音声を認識しています。", label: result.label });
        void list();
      }).catch(error => {
        if (current === generation) emit({ type: "microphone.state.changed", state: "failed", message: error instanceof OperationError
          ? error.message : "マイクの認識を開始できませんでした。権限と接続を確認してください。" });
      });
    } else {
      if (stopping) return;
      const operation = ++generation;
      const current = session;
      session = null;
      if (current) {
        stopping = true;
        emit({ type: "microphone.state.changed", state: "preparing", message: "認識を停止し、最後の字幕を確認しています。" });
        void current.stop().then(() => {
          stopping = false;
          if (operation === generation) emit({ type: "microphone.state.changed", state: "stopped", message: "マイクの認識を停止しました。" });
        }).catch(() => {
          stopping = false;
          if (operation === generation) emit({ type: "microphone.state.changed", state: "failed", message: "未確定の字幕を確認してから再開してください。" });
        }).finally(() => { stopping = false; });
      } else {
        controller?.abort();
        emit({ type: "microphone.state.changed", state: "stopped", message: "マイクの認識を停止しました。" });
      }
    }
  });
  return () => { ++generation; controller?.abort(); void session?.stop().catch(() => {}); };
});
