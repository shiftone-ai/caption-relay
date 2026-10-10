import { createActor, waitFor } from "xstate";
import { expect, it, vi } from "vitest";
import { operatorMachine } from "./operator";
import { defaultConnection } from "../connection";
import type { OperatorApi } from "../domain";

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
