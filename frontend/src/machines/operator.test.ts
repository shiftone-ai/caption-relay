import { defaultAi } from "../ai";
import { createActor, waitFor } from "xstate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { operatorMachine } from "./operator";
import { CaptionConflict, type Caption, type OperatorApi, type Snapshot } from "../domain";

const caption: Caption = { id: "one", utterance_id: "one", received_at: "2026-10-06T01:02:03Z", source_revision: 1, original: "原文", text: "字幕", revision: 1, human_edited: false, published: true, publish_eligible: true, source_final: true };

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
    setPublicationMode: vi.fn().mockResolvedValue({ auto_publish: true }), setDisplay: vi.fn().mockImplementation(settings => Promise.resolve(settings)),
    setAi: vi.fn().mockImplementation(settings => Promise.resolve({ ...defaultAi, settings })),
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

it("pins the revision when editing opens and preserves a draft when the editor closes", async () => {
  const adapter = api();
  const actor = await start(adapter);
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  expect(actor.getSnapshot().context.followLatest).toBe(false);
  vi.mocked(adapter.load).mockResolvedValueOnce({ visible: true, captions: [{ ...caption, text: "AIの更新", revision: 3 }] });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  actor.send({ type: "caption.draft.changed", captionId: "one", text: "入力中" });
  actor.send({ type: "caption.edit.closed" });
  expect(actor.getSnapshot().context.drafts.get("one")).toMatchObject({ text: "入力中", baseRevision: 1 });
  expect(adapter.save).not.toHaveBeenCalled();
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  actor.send({ type: "caption.draft.discarded", captionId: "one" });
  expect(actor.getSnapshot().context.drafts.has("one")).toBe(false);
});

it("keeps unsent display settings on failure and blocks changes while a save is pending", async () => {
  const adapter = api();
  const pending = deferred<Awaited<ReturnType<OperatorApi["setDisplay"]>>>();
  vi.mocked(adapter.setDisplay).mockReturnValueOnce(pending.promise);
  const actor = await start(adapter);
  actor.send({ type: "display.field.changed", field: "font_size", value: "48" });
  actor.send({ type: "display.save.requested" });
  expect(actor.getSnapshot().can({ type: "display.field.changed", field: "font_size", value: "32" })).toBe(false);
  pending.reject(new Error("offline"));
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.displayDraft?.font_size).toBe(48);
  actor.send({ type: "display.save.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.display.font_size).toBe(48);
  expect(actor.getSnapshot().context.displayDraft).toBeNull();
});

it("requires explicit AI settings save, keeps failed drafts and blocks duplicate operations", async () => {
  const adapter = api();
  const pending = deferred<Awaited<ReturnType<OperatorApi["setAi"]>>>();
  vi.mocked(adapter.setAi).mockReturnValueOnce(pending.promise);
  const actor = await start(adapter);
  actor.send({ type: "ai.settings.toggled" });
  actor.send({ type: "ai.strategy.selected", value: "manual" });
  actor.send({ type: "ai.preferred.selected", modelId: "claude-haiku-4-5" });
  actor.send({ type: "display.settings.toggled" });
  expect(actor.getSnapshot().context.aiSettingsOpen).toBe(false);
  expect(actor.getSnapshot().context.settingsOpen).toBe(true);
  expect(adapter.setAi).not.toHaveBeenCalled();
  actor.send({ type: "ai.save.requested" });
  actor.send({ type: "ai.save.requested" });
  actor.send({ type: "ai.strategy.selected", value: "cost" });
  expect(adapter.setAi).toHaveBeenCalledTimes(1);
  pending.reject(new Error("offline"));
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.aiDraft).toMatchObject({ strategy: "manual", preferred_model: "claude-haiku-4-5" });
  actor.send({ type: "ai.save.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.ai.settings.preferred_model).toBe("claude-haiku-4-5");
  expect(actor.getSnapshot().context.aiDraft).toBeNull();
});

it("owns AI candidate invariants even when UI restrictions are bypassed", async () => {
  const actor = await start();
  actor.send({ type: "ai.candidate.changed", modelId: "claude-haiku-4-5", included: false });
  actor.send({ type: "ai.preferred.selected", modelId: "claude-haiku-4-5" });
  actor.send({ type: "ai.candidate.changed", modelId: "claude-haiku-4-5", included: false });
  actor.send({ type: "ai.candidate.changed", modelId: "claude-haiku-4-5", included: true });
  actor.send({ type: "ai.preferred.selected", modelId: "unknown-model" });
  actor.send({ type: "ai.strategy.selected", value: "invalid" });
  expect(actor.getSnapshot().context.aiDraft).toMatchObject({ preferred_model: "claude-haiku-4-5", strategy: "off" });
  expect(actor.getSnapshot().context.aiDraft?.candidates.filter(id => id === "claude-haiku-4-5")).toHaveLength(1);
});

it("interprets display fields and palettes without publishing until saved", async () => {
  const adapter = api();
  const actor = await start(adapter);
  actor.send({ type: "display.palette.selected", value: "light" });
  actor.send({ type: "display.field.changed", field: "font_size", value: "48" });
  actor.send({ type: "display.field.changed", field: "font_size", value: "NaN" });
  actor.send({ type: "display.field.changed", field: "background", value: "invalid" });
  expect(actor.getSnapshot().context.displayDraft).toMatchObject({ background: "#ffffff", foreground: "#171717", font_size: 48 });
  expect(adapter.setDisplay).not.toHaveBeenCalled();
  actor.send({ type: "display.save.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(adapter.setDisplay).toHaveBeenCalledWith(expect.objectContaining({ background: "#ffffff", font_size: 48 }), expect.any(AbortSignal));
});

it("interprets scroll measurements and editor keys in the Mediator", async () => {
  const adapter = api();
  const actor = await start(adapter);
  actor.send({ type: "timeline.scrolled", scrollHeight: 1000, clientHeight: 500, scrollTop: 492 });
  expect(actor.getSnapshot().context.followLatest).toBe(false);
  actor.send({ type: "timeline.scrolled", scrollHeight: 1000, clientHeight: 500, scrollTop: 493 });
  expect(actor.getSnapshot().context.followLatest).toBe(true);
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  actor.send({ type: "caption.editor.keypressed", captionId: "one", key: "Escape", ctrlKey: false, metaKey: false, isComposing: true });
  expect(actor.getSnapshot().context.activeCaptionId).toBe("one");
  actor.send({ type: "caption.editor.keypressed", captionId: "one", key: "Escape", ctrlKey: false, metaKey: false, isComposing: false });
  expect(actor.getSnapshot().context.activeCaptionId).toBeNull();
  actor.send({ type: "caption.editor.keypressed", captionId: "one", key: "Enter", ctrlKey: true, metaKey: false, isComposing: false });
  expect(adapter.save).not.toHaveBeenCalled();
});

it("counts new IDs while browsing, ignores revisions, and acknowledges latest without closing the editor", async () => {
  const adapter = api();
  const actor = await start(adapter);
  expect(actor.getSnapshot().context.unreadIds).toEqual([]);
  actor.send({ type: "caption.edit.requested", captionId: caption.id });
  actor.send({ type: "caption.draft.changed", captionId: caption.id, text: "訂正中" });
  const newer = { ...caption, id: "two", utterance_id: "two", text: "次の発話" };
  vi.mocked(adapter.load).mockResolvedValueOnce({ visible: true, captions: [{ ...caption, source_revision: 2 }, newer] });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.unreadIds).toEqual(["two"]);
  vi.mocked(adapter.load).mockResolvedValueOnce({ visible: true, captions: [caption, { ...newer, text: "次の発話の更新", source_revision: 2 }] });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.unreadIds).toEqual(["two"]);
  actor.send({ type: "timeline.latest.requested" });
  expect(actor.getSnapshot().context).toMatchObject({ activeCaptionId: "one", followLatest: true, unreadIds: [], scrollTarget: "latest" });
  expect(actor.getSnapshot().context.drafts.get("one")?.text).toBe("訂正中");
  actor.send({ type: "timeline.editing.requested" });
  expect(actor.getSnapshot().context).toMatchObject({ activeCaptionId: "one", followLatest: false, scrollTarget: "caption" });
});

it("acknowledges arrivals when reaching the bottom and reflows only while following", async () => {
  const adapter = api();
  const actor = await start(adapter);
  actor.send({ type: "timeline.scrolled", scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
  const second = { ...caption, id: "two", utterance_id: "two" };
  vi.mocked(adapter.load).mockResolvedValueOnce({ visible: true, captions: [caption, second] });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  const before = actor.getSnapshot().context.latestRequest;
  actor.send({ type: "timeline.resized", scrollHeight: 1200, clientHeight: 300, scrollTop: 100 });
  expect(actor.getSnapshot().context.latestRequest).toBe(before);
  actor.send({ type: "timeline.scrolled", scrollHeight: 1200, clientHeight: 300, scrollTop: 900 });
  expect(actor.getSnapshot().context.unreadIds).toEqual([]);
  actor.send({ type: "timeline.resized", scrollHeight: 1500, clientHeight: 300, scrollTop: 900 });
  expect(actor.getSnapshot().context.latestRequest).toBe(before + 1);
  expect(actor.getSnapshot().context.scrollTarget).toBe("latest");
});

it("reports a successful save locally and preserves the result across polling until editing resumes", async () => {
  const adapter = api();
  const actor = await start(adapter);
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  actor.send({ type: "caption.draft.changed", captionId: "one", text: "修正" });
  actor.send({ type: "caption.save.requested", captionId: "one" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.saveStatus).toEqual({ captionId: "one", message: "保存して公開しました。" });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.saveStatus?.message).toBe("保存して公開しました。");
  actor.send({ type: "caption.draft.changed", captionId: "one", text: "次の修正" });
  expect(actor.getSnapshot().context.saveStatus).toBeNull();
});

it("retains the public version when an interim candidate is saved and does not announce publication", async () => {
  const adapter = api();
  vi.mocked(adapter.load).mockResolvedValue({ visible: true, captions: [{ ...caption, source_final: false, public_text: "公開済み" }] });
  vi.mocked(adapter.save).mockResolvedValue({ ...caption, text: "途中の修正", source_final: false, public_text: "公開済み" });
  const actor = await start(adapter);
  actor.send({ type: "caption.save.requested", captionId: "one" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.saveStatus?.message).toBe("保存しました。観客の表示は変わりません。");
  expect(actor.getSnapshot().context.captions[0].public_text).toBe("公開済み");
});

it("uses guarded settings Escape without accepting other keys or IME Escape", async () => {
  const actor = await start();
  expect(actor.getSnapshot().can({ type: "settings.keypressed", key: "Escape", isComposing: false })).toBe(false);
  actor.send({ type: "display.settings.toggled" });
  expect(actor.getSnapshot().can({ type: "settings.keypressed", key: "Tab", isComposing: false })).toBe(false);
  actor.send({ type: "settings.keypressed", key: "Escape", isComposing: true });
  expect(actor.getSnapshot().context.settingsOpen).toBe(true);
  actor.send({ type: "settings.keypressed", key: "Escape", isComposing: false });
  expect(actor.getSnapshot().context.settingsOpen).toBe(false);
});

it("selects the editor from an open settings panel while preserving its settings draft", async () => {
  const actor = await start();
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  actor.send({ type: "display.settings.toggled" });
  actor.send({ type: "display.field.changed", field: "font_size", value: "48" });
  const before = actor.getSnapshot().context.editorFocusRequest;
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  expect(actor.getSnapshot().context).toMatchObject({ activeCaptionId: "one", settingsOpen: false, aiSettingsOpen: false });
  expect(actor.getSnapshot().context.displayDraft?.font_size).toBe(48);
  expect(actor.getSnapshot().context.editorFocusRequest).toBe(before + 1);
});

it("keeps editing paused at the end of history until latest is explicitly requested", async () => {
  const actor = await start();
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  actor.send({ type: "timeline.scrolled", scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
  expect(actor.getSnapshot().context.followLatest).toBe(false);
  actor.send({ type: "timeline.latest.requested" });
  actor.send({ type: "timeline.scrolled", scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
  expect(actor.getSnapshot().context.followLatest).toBe(true);
});
