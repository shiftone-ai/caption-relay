import { createActor, waitFor } from "xstate";
import { expect, it, vi } from "vitest";
import { audienceMachine } from "./audience";
import { presentAudience } from "../presenters/audience";
import type { AudienceEvent, FullscreenAdapter } from "../domain";
import { defaultDisplay } from "../display";

function fullscreen(): FullscreenAdapter {
  return { available: true, isActive: () => false, subscribe: vi.fn(() => vi.fn()), setActive: vi.fn().mockResolvedValue(undefined) };
}

it("declines operator events without changing the audience or invoking its adapter", () => {
  const adapter = fullscreen();
  const actor = createActor(audienceMachine, { input: { api: { subscribe: () => () => {} }, fullscreen: adapter } }).start();
  try {
    const before = actor.getSnapshot().context;
    for (const event of [{ type: "test.requested" } as const, { type: "disclosure.toggled", id: "preparation" } as const]) {
      expect(actor.getSnapshot().can(event)).toBe(false);
      actor.send(event);
    }
    expect(actor.getSnapshot().context).toBe(before);
    expect(adapter.setActive).not.toHaveBeenCalled();
  } finally { actor.stop(); }
});

it("keeps the last public caption during reconnect and closes the stream on stop", () => {
  let emit!: (event: AudienceEvent) => void;
  const close = vi.fn();
  const actor = createActor(audienceMachine, {
    input: { api: { subscribe(callback) { emit = callback; return close; } }, fullscreen: fullscreen() },
  }).start();
  emit({ type: "stream.snapshot", snapshot: { visible: true, captions: [{ id: "one", text: "公開文", revision: 1 }] } });
  emit({ type: "stream.failed" });
  expect(actor.getSnapshot().matches({ connection: "reconnecting" })).toBe(true);
  expect(presentAudience(actor.getSnapshot()).text).toBe("公開文");
  emit({ type: "stream.snapshot", snapshot: { visible: false, captions: [] } });
  expect(presentAudience(actor.getSnapshot()).text).toBe("");
  emit({ type: "stream.snapshot", snapshot: { visible: true, captions: [{ id: "two", text: "再接続後", revision: 2 }] } });
  expect(presentAudience(actor.getSnapshot()).text).toBe("再接続後");
  actor.stop();
  expect(close).toHaveBeenCalledTimes(1);
});

it("applies shared display settings and shows only the selected number of public utterances", () => {
  let emit!: (event: AudienceEvent) => void;
  const actor = createActor(audienceMachine, { input: { api: { subscribe(callback) { emit = callback; return () => {}; } }, fullscreen: fullscreen() } }).start();
  emit({ type: "stream.snapshot", snapshot: {
    visible: true, display: { ...defaultDisplay, display_mode: "recent", font_size: 48, history_count: 2, background: "#ffffff" },
    captions: [{ id: "1", revision: 1, text: "古い文" }, { id: "2", revision: 2, text: "前の文" }, { id: "3", revision: 3, text: "最新の文" }],
  } });
  expect(presentAudience(actor.getSnapshot()).texts).toEqual(["前の文", "最新の文"]);
  expect(presentAudience(actor.getSnapshot()).captionStyle).toMatchObject({ fontSize: 48 });
  expect(presentAudience(actor.getSnapshot()).screenStyle).toMatchObject({ background: "#ffffff" });
  actor.stop();
});

it("arbitrates fullscreen independently of the stream, blocks duplicates and observes Escape", async () => {
  const adapter = fullscreen();
  let emit!: (event: AudienceEvent) => void;
  let changed!: Parameters<FullscreenAdapter["subscribe"]>[0];
  let resolve!: () => void;
  const unsubscribe = vi.fn();
  adapter.subscribe = callback => { changed = callback; return unsubscribe; };
  vi.mocked(adapter.setActive).mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
  const actor = createActor(audienceMachine, { input: { api: { subscribe(callback) { emit = callback; return () => {}; } }, fullscreen: adapter } }).start();
  try {
    actor.send({ type: "display.fullscreen.requested" });
    actor.send({ type: "display.fullscreen.requested" });
    expect(adapter.setActive).toHaveBeenCalledTimes(1);
    expect(presentAudience(actor.getSnapshot()).fullscreenDisabled).toBe(true);
    emit({ type: "stream.failed" });
    emit({ type: "stream.snapshot", snapshot: { visible: true, captions: [{ id: "1", revision: 1, text: "受信は継続" }] } });
    expect(actor.getSnapshot().matches({ fullscreen: "changing", connection: "live" })).toBe(true);
    adapter.isActive = () => true;
    changed({ type: "display.fullscreen.changed", active: true });
    resolve();
    await waitFor(actor, state => state.matches({ fullscreen: "idle" }));
    expect(presentAudience(actor.getSnapshot()).fullscreenLabel).toBe("全画面を解除");
    adapter.isActive = () => false;
    changed({ type: "display.fullscreen.changed", active: false });
    expect(presentAudience(actor.getSnapshot()).fullscreenLabel).toBe("全画面");
    actor.send({ type: "display.fullscreen.requested" });
    await waitFor(actor, state => state.matches({ fullscreen: "idle" }));
    expect(adapter.setActive).toHaveBeenLastCalledWith(true);
  } finally { actor.stop(); }
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it("exposes a fullscreen error, permits retry and declines unavailable fullscreen", async () => {
  const adapter = fullscreen();
  vi.mocked(adapter.setActive).mockRejectedValueOnce(new Error("denied"));
  const actor = createActor(audienceMachine, { input: { api: { subscribe: () => () => {} }, fullscreen: adapter } }).start();
  try {
    actor.send({ type: "display.fullscreen.requested" });
    await waitFor(actor, state => state.matches({ fullscreen: "failed" }));
    expect(presentAudience(actor.getSnapshot())).toMatchObject({ fullscreenDisabled: false, fullscreenError: expect.stringContaining("切り替えられません") });
    actor.send({ type: "display.fullscreen.requested" });
    await waitFor(actor, state => state.matches({ fullscreen: "idle" }));
    expect(presentAudience(actor.getSnapshot()).fullscreenError).toBe("");
    adapter.available = false;
    expect(actor.getSnapshot().can({ type: "display.fullscreen.requested" })).toBe(false);
    actor.send({ type: "display.fullscreen.requested" });
    expect(adapter.setActive).toHaveBeenCalledTimes(2);
  } finally { actor.stop(); }
});
