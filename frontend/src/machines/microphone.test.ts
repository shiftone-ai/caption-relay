import { createActor, waitFor } from "xstate";
import { expect, it, vi } from "vitest";
import { operatorMachine } from "./operator";
import { defaultConnection } from "../connection";
import type { MicrophoneAdapter, MicrophoneSession, OperatorApi } from "../domain";

it("keeps start disabled through duplicate stops until the microphone actually closes", async () => {
  let finish!: () => void;
  const closing = new Promise<void>(resolve => { finish = resolve; });
  const stop = vi.fn(() => closing);
  const connection = { ...defaultConnection, input_source: "microphone" as const,
    recognizers: [{ id: "openai" as const, label: "OpenAI", available: true, message: "" }] };
  const api = { load: vi.fn().mockResolvedValue({ visible: true, captions: [], connection }) } as unknown as OperatorApi;
  const microphone = { available: true, devices: vi.fn().mockResolvedValue([]),
    start: vi.fn().mockResolvedValue({ label: "試験マイク", stop }) };
  const actor = createActor(operatorMachine, { input: { api, microphone } }).start();
  try {
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    actor.send({ type: "microphone.start.requested" });
    await waitFor(actor, state => state.context.microphoneState === "live");
    actor.send({ type: "microphone.stop.requested" });
    actor.send({ type: "microphone.stop.requested" });
    expect(actor.getSnapshot().can({ type: "microphone.start.requested" })).toBe(false);
    expect(actor.getSnapshot().context.microphoneMessage).toContain("停止");
    finish();
    await waitFor(actor, state => state.context.microphoneState === "stopped");
    expect(stop).toHaveBeenCalledOnce();
    expect(actor.getSnapshot().can({ type: "microphone.start.requested" })).toBe(true);
  } finally { finish(); actor.stop(); }
}, 20000);

it("aborts a replacement start when stopping after an asynchronous recognition failure", async () => {
  let report!: Parameters<MicrophoneAdapter["start"]>[2];
  let replacementSignal!: AbortSignal;
  let finish!: (session: MicrophoneSession) => void;
  const oldStop = vi.fn().mockResolvedValue(undefined);
  const replacementStop = vi.fn().mockResolvedValue(undefined);
  const start = vi.fn<MicrophoneAdapter["start"]>()
    .mockImplementationOnce(async (_, __, status) => { report = status; return { label: "試験マイク", stop: oldStop }; })
    .mockImplementationOnce((_, signal) => {
      replacementSignal = signal;
      return new Promise(resolve => { finish = resolve; });
    });
  const connection = { ...defaultConnection, input_source: "microphone" as const,
    recognizers: [{ id: "openai" as const, label: "OpenAI", available: true, message: "" }] };
  const api = { load: vi.fn().mockResolvedValue({ visible: true, captions: [], connection }) } as unknown as OperatorApi;
  const microphone = { available: true, devices: vi.fn().mockResolvedValue([]), start };
  const actor = createActor(operatorMachine, { input: { api, microphone } }).start();
  try {
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    actor.send({ type: "microphone.start.requested" });
    await waitFor(actor, state => state.context.microphoneState === "live");
    report({ state: "failed", message: "接続が切れました。", sent_seconds: 0, estimated_yen: 0 });
    actor.send({ type: "microphone.start.requested" });
    expect(start).toHaveBeenCalledTimes(2);
    actor.send({ type: "microphone.stop.requested" });
    expect(replacementSignal.aborted).toBe(true);
    expect(oldStop).not.toHaveBeenCalled();
    finish({ label: "試験マイク", stop: replacementStop });
    await vi.waitFor(() => expect(replacementStop).toHaveBeenCalledOnce());
    expect(actor.getSnapshot().context.microphoneState).toBe("stopped");
  } finally { finish?.({ label: "試験マイク", stop: replacementStop }); actor.stop(); }
}, 20000);
