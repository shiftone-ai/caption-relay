import { createActor } from "xstate";
import { expect, it } from "vitest";
import { defaultDisplay } from "../display";
import type { AudienceEvent } from "../domain";
import { audienceMachine } from "../machines/audience";
import { presentAudience } from "./audience";

it("keeps waiting and hidden audience screens separate from preview samples", () => {
  let emit!: (event: AudienceEvent) => void;
  const actor = createActor(audienceMachine, {
    input: {
      api: { subscribe(callback) { emit = callback; return () => {}; } },
      fullscreen: { available: false, isActive: () => false, subscribe: () => () => {}, setActive: async () => {} },
    },
  }).start();
  try {
    expect(presentAudience(actor.getSnapshot()).texts).toEqual(["字幕を待っています"]);
    emit({ type: "stream.snapshot", snapshot: {
      visible: true, display: { ...defaultDisplay, history_count: 3 }, captions: [{ id: "one", text: "短い公開字幕", revision: 1 }],
    } });
    expect(presentAudience(actor.getSnapshot()).texts).toEqual(["短い公開字幕"]);
    emit({ type: "stream.snapshot", snapshot: { visible: false, captions: [{ id: "one", text: "短い公開字幕", revision: 1 }] } });
    expect(presentAudience(actor.getSnapshot()).texts).toEqual([]);
    expect(presentAudience(actor.getSnapshot()).text).toBe("");
  } finally { actor.stop(); }
});
