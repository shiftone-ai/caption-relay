import { createActor } from "xstate";
import { expect, it, vi } from "vitest";
import { audienceMachine } from "./audience";
import { presentAudience } from "../presenters/audience";
import type { AudienceEvent } from "../domain";

it("keeps the last public caption during reconnect and closes the stream on stop", () => {
  let emit!: (event: AudienceEvent) => void;
  const close = vi.fn();
  const actor = createActor(audienceMachine, {
    input: { api: { subscribe(callback) { emit = callback; return close; } } },
  }).start();
  emit({ type: "stream.snapshot", snapshot: { visible: true, captions: [{ id: "one", text: "公開文", revision: 1 }] } });
  emit({ type: "stream.failed" });
  expect(actor.getSnapshot().matches("reconnecting")).toBe(true);
  expect(presentAudience(actor.getSnapshot()).text).toBe("公開文");
  emit({ type: "stream.snapshot", snapshot: { visible: false, captions: [] } });
  expect(presentAudience(actor.getSnapshot()).text).toBe("");
  emit({ type: "stream.snapshot", snapshot: { visible: true, captions: [{ id: "two", text: "再接続後", revision: 2 }] } });
  expect(presentAudience(actor.getSnapshot()).text).toBe("再接続後");
  actor.stop();
  expect(close).toHaveBeenCalledTimes(1);
});
