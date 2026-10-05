import { createActor, waitFor } from "xstate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { operatorMachine } from "./operator";
import { CaptionConflict, type Caption, type OperatorApi, type Snapshot } from "../domain";

const caption: Caption = { id: "one", utterance_id: "one", source_revision: 1, original: "原文", text: "字幕", revision: 1, human_edited: false, published: true, publish_eligible: true };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function api(): OperatorApi {
  return {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn().mockResolvedValue({ ...caption, text: "修正", revision: 2, human_edited: true }),
    setVisible: vi.fn().mockResolvedValue(false),
    sendTest: vi.fn().mockResolvedValue(undefined),
  };
}

const actors: ReturnType<typeof createActor<typeof operatorMachine>>[] = [];
afterEach(() => { actors.splice(0).forEach(actor => actor.stop()); });

async function start(adapter = api()) {
  const actor = createActor(operatorMachine, { input: { api: adapter } }).start();
  actors.push(actor);
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  return actor;
}

describe("operator Mediator", () => {
  it("keeps the draft and its starting revision across a background update", async () => {
    const adapter = api();
    const actor = await start(adapter);
    actor.send({ type: "caption.draft.changed", captionId: caption.id, text: "修正中" });
    vi.mocked(adapter.load).mockResolvedValueOnce({ visible: true, captions: [{ ...caption, text: "更新", revision: 2 }] });
    actor.send({ type: "refresh.requested" });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    expect(actor.getSnapshot().context.drafts.get(caption.id)).toMatchObject({ text: "修正中", baseRevision: 1 });
    actor.send({ type: "caption.save.requested", captionId: caption.id });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    expect(adapter.save).toHaveBeenCalledWith(expect.objectContaining({ text: "修正中", baseRevision: 1 }), expect.any(AbortSignal));
  });

  it("retains input on a failed save and permits an explicit retry", async () => {
    const adapter = api();
    vi.mocked(adapter.save).mockRejectedValueOnce(new Error("offline"));
    const actor = await start(adapter);
    actor.send({ type: "caption.draft.changed", captionId: caption.id, text: "修正中" });
    actor.send({ type: "caption.save.requested", captionId: caption.id });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    expect(actor.getSnapshot().context.drafts.get(caption.id)?.text).toBe("修正中");
    expect(actor.getSnapshot().context.error).toContain("保持");
    actor.send({ type: "caption.save.requested", captionId: caption.id });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    expect(adapter.save).toHaveBeenCalledTimes(2);
    expect(actor.getSnapshot().context.drafts.size).toBe(0);
  });

  it("shows the latest caption on conflict without automatically overwriting it", async () => {
    const adapter = api();
    vi.mocked(adapter.save).mockRejectedValueOnce(new CaptionConflict({ ...caption, text: "他の修正", revision: 3 }));
    const actor = await start(adapter);
    actor.send({ type: "caption.draft.changed", captionId: caption.id, text: "自分の修正" });
    actor.send({ type: "caption.save.requested", captionId: caption.id });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    const draft = actor.getSnapshot().context.drafts.get(caption.id);
    expect(draft).toMatchObject({ text: "自分の修正", baseRevision: 3 });
    expect(draft?.conflict).toContain("他の修正");
    expect(adapter.save).toHaveBeenCalledTimes(1);
    actor.send({ type: "caption.save.requested", captionId: caption.id });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    expect(adapter.save).toHaveBeenLastCalledWith(expect.objectContaining({ text: "自分の修正", baseRevision: 3 }), expect.any(AbortSignal));
  });

  it("blocks duplicate operations and freezes the caption being saved", async () => {
    const adapter = api();
    const pending = deferred<Caption>();
    vi.mocked(adapter.save).mockReturnValue(pending.promise);
    const actor = await start(adapter);
    actor.send({ type: "caption.save.requested", captionId: caption.id });
    actor.send({ type: "caption.save.requested", captionId: caption.id });
    actor.send({ type: "test.requested" });
    actor.send({ type: "visibility.toggle.requested" });
    actor.send({ type: "caption.draft.changed", captionId: caption.id, text: "後からの入力" });
    expect(adapter.save).toHaveBeenCalledTimes(1);
    expect(adapter.sendTest).not.toHaveBeenCalled();
    expect(adapter.setVisible).not.toHaveBeenCalled();
    expect(actor.getSnapshot().context.drafts.size).toBe(0);
    pending.resolve({ ...caption, revision: 2 });
  });

  it("cancels an old snapshot when saving starts and ignores its late result", async () => {
    const adapter = api();
    const stale = deferred<Snapshot>();
    const actor = await start(adapter);
    vi.mocked(adapter.load).mockReturnValueOnce(stale.promise);
    actor.send({ type: "refresh.requested" });
    const signal = vi.mocked(adapter.load).mock.calls[1][0];
    actor.send({ type: "caption.save.requested", captionId: caption.id });
    expect(signal.aborted).toBe(true);
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    stale.resolve({ visible: true, captions: [caption] });
    await Promise.resolve();
    expect(actor.getSnapshot().context.captions[0].revision).toBe(2);
  });

  it("keeps server visibility when a toggle fails", async () => {
    const adapter = api();
    vi.mocked(adapter.load).mockResolvedValue({ visible: false, captions: [caption] });
    vi.mocked(adapter.setVisible).mockRejectedValue(new Error("offline"));
    const actor = await start(adapter);
    actor.send({ type: "visibility.toggle.requested" });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    expect(adapter.setVisible).toHaveBeenCalledWith(true, expect.any(AbortSignal));
    expect(actor.getSnapshot().context.visible).toBe(false);
  });

  it("rejects blank captions before making a request", async () => {
    const adapter = api();
    const actor = await start(adapter);
    actor.send({ type: "caption.draft.changed", captionId: caption.id, text: "　 " });
    actor.send({ type: "caption.save.requested", captionId: caption.id });
    expect(adapter.save).not.toHaveBeenCalled();
    expect(actor.getSnapshot().context.error).toContain("入力");
  });

  it("aborts the active request when Root unmounts", () => {
    const adapter = api();
    vi.mocked(adapter.load).mockReturnValue(new Promise(() => {}));
    const actor = createActor(operatorMachine, { input: { api: adapter } }).start();
    const signal = vi.mocked(adapter.load).mock.calls[0][0];
    actor.stop();
    expect(signal.aborted).toBe(true);
  });
});
