import { afterEach, expect, it, vi } from "vitest";
import { createMicrophoneAdapter } from "./microphone";

afterEach(() => { vi.unstubAllGlobals(); });

it("lists microphones after permission without starting recognition and releases capture", async () => {
  const stop = vi.fn();
  let permitted = false;
  const enumerateDevices = vi.fn(async () => permitted ? [
    { kind: "audioinput", deviceId: "blackhole", label: "BlackHole 2ch" },
  ] : []);
  const getUserMedia = vi.fn(async () => {
    permitted = true;
    return { getTracks: () => [{ stop }] };
  });
  vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices, getUserMedia } });
  const adapter = createMicrophoneAdapter();
  expect(await adapter.devices()).toEqual([]);
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(await adapter.devices(true)).toEqual([{ id: "blackhole", label: "BlackHole 2ch" }]);
  expect(stop).toHaveBeenCalledOnce();
});

it("releases permission capture when device enumeration fails", async () => {
  const stop = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    enumerateDevices: vi.fn().mockRejectedValue(new Error("device query failed")),
  } });
  await expect(createMicrophoneAdapter().devices(true)).rejects.toThrow();
  expect(stop).toHaveBeenCalledOnce();
});

function browserHarness() {
  const stop = vi.fn();
  const track = { stop, label: "試験マイク", addEventListener: vi.fn() };
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] }) } });
  const close = vi.fn().mockResolvedValue(undefined);
  const link = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  vi.stubGlobal("AudioContext", class {
    sampleRate = 48000; destination = {}; audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    resume = vi.fn().mockResolvedValue(undefined); close = close;
    createMediaStreamSource = link; createGain = () => ({ ...link(), gain: { value: 1 } });
  });
  vi.stubGlobal("AudioWorkletNode", class {
    connect = vi.fn(); disconnect = vi.fn();
    port = { onmessage: (_: { data: unknown }) => {}, postMessage: () => queueMicrotask(() => this.port.onmessage({ data: { type: "flushed" } })) };
  });
  vi.stubGlobal("window", { location: { href: "https://example.invalid/" }, setTimeout, clearTimeout });
  let serverStop!: () => void;
  vi.stubGlobal("WebSocket", class {
    static OPEN = 1; static CLOSING = 2; readyState = 1; bufferedAmount = 0;
    onopen = () => {}; onmessage = (_: { data: string }) => {}; onerror = () => {}; onclose = () => {};
    constructor() { serverStop = () => this.onmessage({ data: JSON.stringify({ type: "status", status: { state: "stopped", message: "停止しました。", sent_seconds: 0, estimated_yen: 0 } }) }); queueMicrotask(() => this.onopen()); }
    send(data: string) {
      const state = JSON.parse(data).type === "start" ? "live" : "failed";
      queueMicrotask(() => this.onmessage({ data: JSON.stringify({ type: "status", status: { state, message: "確定できませんでした。", sent_seconds: 0, estimated_yen: 0 } }) }));
    }
    close() { this.readyState = 3; queueMicrotask(() => this.onclose()); }
  });
  return { stop, close, serverStop: () => serverStop() };
}

it("rejects a failed finalization instead of reporting a successful stop and releases the microphone", async () => {
  const { stop, close } = browserHarness();
  const states: string[] = [];
  const session = await createMicrophoneAdapter().start({ deviceId: "", recognizer: "apple" }, new AbortController().signal, state => states.push(state.state));
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
    audio: { channelCount: 1, echoCancellation: false }, video: false,
  });
  await expect(session.stop()).rejects.toThrow("確定できませんでした。");
  expect(states).toEqual(["live", "failed"]);
  expect(stop).toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});


it("releases capture after an accepted server-side input change without reporting a disconnection", async () => {
  const { stop, close, serverStop } = browserHarness();
  const states: string[] = [];
  const session = await createMicrophoneAdapter().start({ deviceId: "", recognizer: "apple" }, new AbortController().signal, state => states.push(state.state));
  serverStop();
  await Promise.resolve();
  expect(stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(states).toEqual(["live", "stopped"]);
  await expect(session.stop()).resolves.toBeUndefined();
});
