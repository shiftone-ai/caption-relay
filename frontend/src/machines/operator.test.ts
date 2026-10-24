import { defaultAi } from "../ai";
import { createActor, waitFor } from "xstate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { operatorMachine } from "./operator";
import { CaptionConflict, OperationError, type Caption, type OperatorApi, type Snapshot } from "../domain";
import { defaultConnection } from "../connection";
import { presentOperator } from "../presenters/operator";

const caption: Caption = { id: "one", utterance_id: "one", received_at: "2026-10-06T01:02:03Z", source_revision: 1, original: "原文", text: "字幕", revision: 1, human_edited: false, published: true, publish_eligible: true, source_final: true, ai_status: "off" };

it("keeps subtitle and connection drafts when an editor link is rejected", async () => {
  const adapter = api();
  vi.mocked(adapter.setConnection).mockRejectedValue(new OperationError("編集用リンクの期限が切れています。"));
  const actor = createActor(operatorMachine, { input: { api: adapter } }).start();
  try {
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    actor.send({ type: "caption.edit.requested", captionId: "one" });
    actor.send({ type: "caption.draft.changed", captionId: "one", text: "未保存の訂正" });
    actor.send({ type: "connection.settings.toggled" });
    actor.send({ type: "connection.mode.selected", mode: "client" });
    expect(actor.getSnapshot().can({ type: "connection.save.requested" })).toBe(false);
    actor.send({ type: "connection.url.changed", url: "expired-test-link" });
    actor.send({ type: "connection.save.requested" });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    expect(actor.getSnapshot().context.connection.mode).toBe("host");
    expect(actor.getSnapshot().context.drafts.get("one")?.text).toBe("未保存の訂正");
    expect(actor.getSnapshot().context.connectionDraft?.editor_url).toBe("expired-test-link");
    expect(actor.getSnapshot().context.error).toBe("編集用リンクの期限が切れています。");
  } finally { actor.stop(); }
});

it("restricts client saves to the current talk and retains local drafts through mode changes", async () => {
  const adapter = api();
  const editorCaption = { ...caption, id: "editor-speech", utterance_id: "editor-speech" };
  const connection = { ...defaultConnection, mode: "client" as const, state: "live" as const, editable_caption_ids: [editorCaption.id] };
  vi.mocked(adapter.setConnection).mockResolvedValue(connection);
  const actor = createActor(operatorMachine, { input: { api: adapter } }).start();
  try {
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    actor.send({ type: "caption.draft.changed", captionId: "one", text: "保持する下書き" });
    vi.mocked(adapter.load).mockResolvedValue({ visible: true, captions: [caption, editorCaption], connection });
    actor.send({ type: "connection.mode.selected", mode: "client" });
    actor.send({ type: "connection.url.changed", url: "valid-test-link" });
    actor.send({ type: "connection.save.requested" });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    expect(actor.getSnapshot().context.connectionDraft).toBeNull();
    expect(actor.getSnapshot().context.drafts.get("one")?.text).toBe("保持する下書き");
    expect(actor.getSnapshot().can({ type: "caption.save.requested", captionId: "one" })).toBe(false);
    expect(actor.getSnapshot().can({ type: "caption.save.requested", captionId: editorCaption.id })).toBe(true);
    expect(actor.getSnapshot().can({ type: "test.requested" })).toBe(false);
    expect(actor.getSnapshot().can({ type: "visibility.toggle.requested" })).toBe(false);
    expect(actor.getSnapshot().can({ type: "publication.mode.requested", mode: "auto" })).toBe(false);
    expect(actor.getSnapshot().can({ type: "display.settings.toggled" })).toBe(false);
    expect(actor.getSnapshot().can({ type: "display.save.requested" })).toBe(false);
    actor.send({ type: "display.settings.toggled" });
    expect(actor.getSnapshot().context.settingsPanel).toBeNull();
  } finally { actor.stop(); }
});

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
    setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn().mockImplementation(settings => Promise.resolve({ ...defaultAi, settings })),
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

it("retains dictionary drafts through refresh and panel changes and saves a bounded payload", async () => {
  const adapter = api();
  const pending = deferred<Awaited<ReturnType<OperatorApi["setDictionary"]>>>();
  vi.mocked(adapter.setDictionary).mockReturnValue(pending.promise);
  const actor = await start(adapter);
  actor.send({ type: "dictionary.settings.toggled" });
  actor.send({ type: "dictionary.word.added" });
  actor.send({ type: "dictionary.word.changed", index: 0, field: "term", value: " Caption Relay " });
  actor.send({ type: "dictionary.word.changed", index: 0, field: "reading", value: "きゃぷしょんりれー" });
  actor.send({ type: "dictionary.word.changed", index: 0, field: "variantsText", value: "キャプションリレー\n\nキャプション リレー\n" });
  actor.send({ type: "dictionary.word.enabled", index: 0, enabled: false });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  actor.send({ type: "ai.settings.toggled" });
  actor.send({ type: "dictionary.settings.toggled" });
  expect(presentOperator(actor.getSnapshot()).hasUnsavedChanges).toBe(true);
  expect(presentOperator(actor.getSnapshot()).dictionary.entries[0].variantsText).toContain("\n\n");
  actor.send({ type: "dictionary.save.requested" });
  await waitFor(actor, state => state.matches({ ready: "settingDictionary" }));
  expect(adapter.setDictionary).toHaveBeenCalledWith({ base_revision: 0, entries: [{
    term: "Caption Relay", reading: "きゃぷしょんりれー", variants: ["キャプションリレー", "キャプション リレー"], enabled: false,
  }] }, expect.any(AbortSignal));
  expect(actor.getSnapshot().can({ type: "dictionary.word.added" })).toBe(false);
  expect(presentOperator(actor.getSnapshot()).dictionary.disabled).toBe(true);
  pending.resolve({ revision: 1, entries: [{ term: "Caption Relay", reading: "きゃぷしょんりれー", variants: ["キャプションリレー"], enabled: false }] });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.dictionaryDraft).toBeNull();
  expect(presentOperator(actor.getSnapshot()).hasUnsavedChanges).toBe(false);
});

it("rejects blank and duplicate dictionary terms before sending a request", async () => {
  const adapter = api();
  const actor = await start(adapter);
  actor.send({ type: "dictionary.word.added" });
  actor.send({ type: "dictionary.save.requested" });
  expect(actor.getSnapshot().context.dictionaryError).toContain("表記を入力");
  actor.send({ type: "dictionary.word.changed", index: 0, field: "term", value: "ABC" });
  actor.send({ type: "dictionary.word.added" });
  actor.send({ type: "dictionary.word.changed", index: 1, field: "term", value: "ＡＢＣ" });
  actor.send({ type: "dictionary.save.requested" });
  expect(actor.getSnapshot().context.dictionaryError).toContain("登録済み");
  for (const [first, second] of [["Straße", "STRASSE"], ["ΟΣ", "ος"], ["Ꭰ", "ꭰ"]]) {
    actor.send({ type: "dictionary.word.changed", index: 0, field: "term", value: first });
    actor.send({ type: "dictionary.word.changed", index: 1, field: "term", value: second });
    actor.send({ type: "dictionary.save.requested" });
    expect(actor.getSnapshot().context.dictionaryError).toContain("登録済み");
  }
  expect(adapter.setDictionary).not.toHaveBeenCalled();
  expect(actor.getSnapshot().can({ type: "dictionary.word.removed", index: -1 })).toBe(false);
  expect(actor.getSnapshot().can({ type: "dictionary.word.changed", index: 2, field: "term", value: "unknown" })).toBe(false);
});

it("keeps a conflicting dictionary draft until the operator explicitly reloads the saved dictionary", async () => {
  const adapter = api();
  vi.mocked(adapter.setDictionary).mockRejectedValue(new OperationError("別の画面で辞書が更新されました。"));
  const actor = await start(adapter);
  actor.send({ type: "dictionary.word.added" });
  actor.send({ type: "dictionary.word.changed", index: 0, field: "term", value: "保持する表記" });
  actor.send({ type: "dictionary.save.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  vi.mocked(adapter.load).mockResolvedValue({ visible: true, captions: [], dictionary: { revision: 2, entries: [{ term: "別画面の表記", reading: "", variants: [], enabled: true }] } });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.dictionaryDraft?.baseRevision).toBe(0);
  expect(presentOperator(actor.getSnapshot()).dictionary.entries[0].term).toBe("保持する表記");
  expect(presentOperator(actor.getSnapshot()).dictionary.error).toContain("別の画面");
  actor.send({ type: "dictionary.draft.discarded" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(presentOperator(actor.getSnapshot()).dictionary.entries[0].term).toBe("別画面の表記");
  expect(presentOperator(actor.getSnapshot()).dictionary.error).toBe("");
});

it("keeps microphone recognition running while editing and stops it before input changes", async () => {
  const adapter = api();
  const connection = { ...defaultConnection, input_source: "microphone" as const,
    recognizers: [{ id: "openai" as const, label: "OpenAI", available: true, message: "" }] };
  vi.mocked(adapter.load).mockResolvedValue({ visible: true, captions: [caption], connection });
  const stop = vi.fn().mockResolvedValue(undefined);
  const microphone = { available: true, devices: vi.fn().mockResolvedValue([]),
    start: vi.fn().mockResolvedValue({ label: "試験マイク", stop }) };
  const actor = createActor(operatorMachine, { input: { api: adapter, microphone } }).start();
  try {
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    expect(actor.getSnapshot().can({ type: "microphone.start.requested" })).toBe(true);
    actor.send({ type: "microphone.start.requested" });
    await waitFor(actor, state => state.context.microphoneState === "live");
    actor.send({ type: "caption.edit.requested", captionId: "one" });
    actor.send({ type: "caption.draft.changed", captionId: "one", text: "認識中の訂正" });
    expect(actor.getSnapshot().context.drafts.get("one")?.text).toBe("認識中の訂正");
    expect(actor.getSnapshot().can({ type: "microphone.start.requested" })).toBe(false);
    actor.send({ type: "connection.input.selected", source: "udtalk" });
    vi.mocked(adapter.setConnection).mockResolvedValue(defaultConnection);
    actor.send({ type: "connection.save.requested" });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    expect(stop).toHaveBeenCalledOnce();
  } finally { actor.stop(); }
}, 20000);

it("keeps the working microphone when an editor connection is rejected", async () => {
  const adapter = api();
  const connection = { ...defaultConnection, input_source: "microphone" as const,
    recognizers: [{ id: "openai" as const, label: "OpenAI", available: true, message: "" }] };
  vi.mocked(adapter.load).mockResolvedValue({ visible: true, captions: [caption], connection });
  vi.mocked(adapter.setConnection).mockRejectedValue(new OperationError("編集用リンクの期限が切れています。"));
  const stop = vi.fn().mockResolvedValue(undefined);
  const microphone = { available: true, devices: vi.fn().mockResolvedValue([]), start: vi.fn().mockResolvedValue({ label: "試験マイク", stop }) };
  const actor = createActor(operatorMachine, { input: { api: adapter, microphone } }).start();
  try {
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    actor.send({ type: "microphone.start.requested" });
    await waitFor(actor, state => state.context.microphoneState === "live");
    actor.send({ type: "connection.mode.selected", mode: "client" });
    actor.send({ type: "connection.url.changed", url: "invalid-test-link" });
    actor.send({ type: "connection.save.requested" });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    expect(actor.getSnapshot().context.error).toContain("期限");
    expect(actor.getSnapshot().context.microphoneState).toBe("live");
    expect(stop).not.toHaveBeenCalled();
    actor.send({ type: "connection.mode.selected", mode: "host" });
    actor.send({ type: "connection.input.selected", source: "microphone" });
    vi.mocked(adapter.setConnection).mockResolvedValue(connection);
    actor.send({ type: "connection.save.requested" });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
    expect(actor.getSnapshot().context.microphoneState).toBe("live");
    expect(stop).not.toHaveBeenCalled();
  } finally { actor.stop(); }
}, 20000);

it("owns independent disclosure states through refreshes and ignores other screens and unknown captions", async () => {
  const actor = await start();
  expect(actor.getSnapshot().can({ type: "display.latest.requested" })).toBe(false);
  expect(actor.getSnapshot().can({ type: "display.fullscreen.requested" })).toBe(false);
  expect(actor.getSnapshot().can({ type: "disclosure.toggled", id: "caption-saved:missing" })).toBe(false);
  actor.send({ type: "disclosure.toggled", id: "preparation" });
  actor.send({ type: "disclosure.toggled", id: "caption-saved:one" });
  actor.send({ type: "disclosure.toggled", id: "display-speaker" });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.openedDisclosures).toEqual(new Set(["display-appearance", "preparation", "caption-saved:one"]));
  actor.send({ type: "disclosure.toggled", id: "preparation" });
  expect(actor.getSnapshot().context.openedDisclosures.has("preparation")).toBe(false);
  expect(actor.getSnapshot().context.openedDisclosures.has("caption-saved:one")).toBe(true);
});

it("arbitrates a single settings panel and focus destination for close versus editor return", async () => {
  const actor = await start();
  actor.send({ type: "display.settings.toggled" });
  const opened = actor.getSnapshot().context;
  expect(opened.settingsPanel).toBe("display");
  expect(opened.settingsFocusTarget).toEqual({ panel: "display", destination: "field" });
  actor.send({ type: "ai.settings.toggled" });
  expect(actor.getSnapshot().context.settingsPanel).toBe("ai");
  expect(actor.getSnapshot().context.settingsFocusRequest).toBe(opened.settingsFocusRequest + 1);
  actor.send({ type: "settings.keypressed", key: "Escape", isComposing: false, defaultPrevented: false });
  expect(actor.getSnapshot().context.settingsPanel).toBeNull();
  expect(actor.getSnapshot().context.settingsFocusTarget).toEqual({ panel: "ai", destination: "trigger" });
  actor.send({ type: "connection.settings.toggled" });
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  expect(actor.getSnapshot().context.settingsPanel).toBeNull();
  expect(actor.getSnapshot().context.settingsFocusTarget).toBeNull();
  expect(actor.getSnapshot().context.activeCaptionId).toBe("one");
});

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
  actor.send({ type: "ai.preferred.selected", modelId: "claude-haiku-5-5" });
  actor.send({ type: "display.settings.toggled" });
  expect(actor.getSnapshot().context.settingsPanel).toBe("display");
  expect(adapter.setAi).not.toHaveBeenCalled();
  actor.send({ type: "ai.save.requested" });
  actor.send({ type: "ai.save.requested" });
  actor.send({ type: "ai.strategy.selected", value: "cost" });
  expect(adapter.setAi).toHaveBeenCalledTimes(1);
  pending.reject(new Error("offline"));
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.aiDraft).toMatchObject({ strategy: "manual", preferred_model: "claude-haiku-5-5" });
  actor.send({ type: "ai.save.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().context.ai.settings.preferred_model).toBe("claude-haiku-5-5");
  expect(actor.getSnapshot().context.aiDraft).toBeNull();
});

it("owns AI candidate invariants even when UI restrictions are bypassed", async () => {
  const actor = await start();
  actor.send({ type: "ai.candidate.changed", modelId: "claude-haiku-5-5", included: false });
  actor.send({ type: "ai.preferred.selected", modelId: "claude-haiku-5-5" });
  actor.send({ type: "ai.candidate.changed", modelId: "claude-haiku-5-5", included: false });
  actor.send({ type: "ai.candidate.changed", modelId: "claude-haiku-5-5", included: true });
  actor.send({ type: "ai.preferred.selected", modelId: "unknown-model" });
  actor.send({ type: "ai.strategy.selected", value: "invalid" });
  expect(actor.getSnapshot().context.aiDraft).toMatchObject({ preferred_model: "claude-haiku-5-5", strategy: "off" });
  expect(actor.getSnapshot().context.aiDraft?.candidates.filter(id => id === "claude-haiku-5-5")).toHaveLength(1);
  actor.send({ type: "ai.candidate.changed", modelId: "gpt-6-luna", included: false });
  actor.send({ type: "ai.preferred.selected", modelId: "gpt-6-luna" });
  actor.send({ type: "ai.candidate.changed", modelId: "gpt-6-luna", included: false });
  expect(actor.getSnapshot().context.aiDraft?.preferred_model).toBe("gpt-6-luna");
  expect(actor.getSnapshot().context.aiDraft?.candidates.filter(id => id === "gpt-6-luna")).toHaveLength(1);
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
  expect(actor.getSnapshot().can({ type: "settings.keypressed", key: "Escape", isComposing: false, defaultPrevented: false })).toBe(false);
  actor.send({ type: "display.settings.toggled" });
  expect(actor.getSnapshot().can({ type: "settings.keypressed", key: "Tab", isComposing: false, defaultPrevented: false })).toBe(false);
  actor.send({ type: "settings.keypressed", key: "Escape", isComposing: true, defaultPrevented: false });
  expect(actor.getSnapshot().context.settingsPanel).toBe("display");
  expect(actor.getSnapshot().can({ type: "settings.keypressed", key: "Escape", isComposing: false, defaultPrevented: true })).toBe(false);
  actor.send({ type: "settings.keypressed", key: "Escape", isComposing: false, defaultPrevented: true });
  expect(actor.getSnapshot().context.settingsPanel).toBe("display");
  actor.send({ type: "settings.keypressed", key: "Escape", isComposing: false, defaultPrevented: false });
  expect(actor.getSnapshot().context.settingsPanel).toBeNull();
});

it("dismisses a status explanation before an editor Escape and rejects its consumed workspace event", async () => {
  const actor = await start();
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  actor.send({ type: "caption.draft.changed", captionId: "one", text: "入力中" });
  actor.send({ type: "caption.status.interaction.changed", captionId: "one", kind: "source", interaction: "pointer", active: true });
  const focusRequest = actor.getSnapshot().context.historyFocusRequest;
  const escape = { type: "caption.editor.keypressed" as const, captionId: "one", key: "Escape", ctrlKey: false, metaKey: false, isComposing: false };
  expect(actor.getSnapshot().can(escape)).toBe(true);
  actor.send(escape);
  expect(actor.getSnapshot().context).toMatchObject({ activeCaptionId: "one", historyFocusRequest: focusRequest,
    statusTooltip: { dismissed: { captionId: "one", kind: "source" } } });
  const bubbled = { type: "settings.keypressed" as const, key: "Escape", isComposing: false, defaultPrevented: true };
  expect(actor.getSnapshot().can(bubbled)).toBe(false);
  actor.send(bubbled);
  expect(actor.getSnapshot().context.activeCaptionId).toBe("one");
  actor.send(escape);
  expect(actor.getSnapshot().context.activeCaptionId).toBeNull();
  expect(actor.getSnapshot().context.drafts.get("one")?.text).toBe("入力中");
});

it("selects the editor from an open settings panel while preserving its settings draft", async () => {
  const actor = await start();
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  actor.send({ type: "display.settings.toggled" });
  actor.send({ type: "display.field.changed", field: "font_size", value: "48" });
  const before = actor.getSnapshot().context.editorFocusRequest;
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  expect(actor.getSnapshot().context).toMatchObject({ activeCaptionId: "one", settingsPanel: null, settingsFocusTarget: null });
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

it("keeps a focused status explanation open across pointer movement and dismisses it until interaction ends", async () => {
  const actor = await start();
  const source = { captionId: "one", kind: "source" as const };
  const publication = { captionId: "one", kind: "publication" as const };
  actor.send({ type: "caption.status.interaction.changed", ...source, interaction: "focus", active: true });
  actor.send({ type: "caption.status.interaction.changed", ...publication, interaction: "pointer", active: true });
  actor.send({ type: "caption.status.interaction.changed", ...source, interaction: "pointer", active: false });
  expect(actor.getSnapshot().context.statusTooltip).toMatchObject({ focus: source, pointer: publication, dismissed: null });
  actor.send({ type: "settings.keypressed", key: "Escape", isComposing: true, defaultPrevented: false });
  expect(actor.getSnapshot().context.statusTooltip.dismissed).toBeNull();
  actor.send({ type: "settings.keypressed", key: "Escape", isComposing: false, defaultPrevented: false });
  expect(actor.getSnapshot().context.statusTooltip.dismissed).toEqual(source);
  actor.send({ type: "caption.status.interaction.changed", ...source, interaction: "pointer", active: true });
  actor.send({ type: "caption.status.interaction.changed", ...source, interaction: "focus", active: false });
  expect(actor.getSnapshot().context.statusTooltip.dismissed).toEqual(source);
  actor.send({ type: "caption.status.interaction.changed", ...source, interaction: "pointer", active: false });
  expect(actor.getSnapshot().context.statusTooltip).toMatchObject({ focus: null, pointer: null, dismissed: null });
  actor.send({ type: "caption.status.interaction.changed", ...source, interaction: "focus", active: true });
  expect(actor.getSnapshot().context.statusTooltip.dismissed).toBeNull();
  expect(actor.getSnapshot().can({ type: "caption.status.interaction.changed", captionId: "missing", kind: "source", interaction: "pointer", active: true })).toBe(false);
});

it("places status explanations inside the screen and ignores unchanged, stale, or dismissed measurements", async () => {
  const actor = await start();
  const geometry = { triggerTop: 260, triggerBottom: 282, triggerLeft: 290, triggerRight: 312,
    tooltipWidth: 280, tooltipHeight: 90, viewportWidth: 320, viewportHeight: 300 };
  const measurement = { type: "caption.status.measured" as const, captionId: "one", kind: "source" as const, geometry };
  expect(actor.getSnapshot().can(measurement)).toBe(false);
  actor.send({ type: "caption.status.interaction.changed", captionId: "one", kind: "source", interaction: "pointer", active: true });
  actor.send(measurement);
  const position = actor.getSnapshot().context.statusTooltip.measurement!.position;
  expect(position.top + geometry.tooltipHeight).toBeLessThan(geometry.triggerTop);
  expect(position.left).toBeGreaterThanOrEqual(8);
  expect(position.left + Math.min(geometry.tooltipWidth, position.maxWidth)).toBeLessThanOrEqual(geometry.viewportWidth - 8);
  expect(position.bridge.top + position.bridge.height).toBe(geometry.triggerTop);
  expect(actor.getSnapshot().can(measurement)).toBe(false);
  expect(actor.getSnapshot().can({ ...measurement, kind: "publication" })).toBe(false);
  actor.send({ ...measurement, geometry: { ...geometry, tooltipHeight: 800, viewportHeight: 180 } });
  const constrained = actor.getSnapshot().context.statusTooltip.measurement!.position;
  expect(constrained.top).toBeGreaterThanOrEqual(8);
  expect(constrained.top + constrained.maxHeight).toBeLessThanOrEqual(172);
  actor.send({ type: "settings.keypressed", key: "Escape", isComposing: false, defaultPrevented: false });
  expect(actor.getSnapshot().can(measurement)).toBe(false);
});

it("uses current caption data after save, conflict, refresh, and removal", async () => {
  const adapter = api();
  const actor = await start(adapter);
  actor.send({ type: "caption.save.requested", captionId: "one" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  expect(actor.getSnapshot().context.drafts.get("one")).toMatchObject({ text: "修正", baseRevision: 2 });
  vi.mocked(adapter.save).mockRejectedValueOnce(new CaptionConflict({ ...caption, text: "他の修正", revision: 4 }));
  actor.send({ type: "caption.save.requested", captionId: "one" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  actor.send({ type: "caption.draft.discarded", captionId: "one" });
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  expect(actor.getSnapshot().context.drafts.get("one")).toMatchObject({ text: "他の修正", baseRevision: 4 });
  actor.send({ type: "caption.draft.discarded", captionId: "one" });
  const newest = { ...caption, id: "two", utterance_id: "two", text: "新着", revision: 7 };
  vi.mocked(adapter.load).mockResolvedValueOnce({ visible: true, captions: [newest] });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(actor.getSnapshot().can({ type: "caption.edit.requested", captionId: "one" })).toBe(false);
  expect(actor.getSnapshot().can({ type: "caption.draft.changed", captionId: "one", text: "古い字幕" })).toBe(false);
  actor.send({ type: "caption.edit.requested", captionId: "two" });
  expect(actor.getSnapshot().context.drafts.get("two")).toMatchObject({ text: "新着", baseRevision: 7 });
});
