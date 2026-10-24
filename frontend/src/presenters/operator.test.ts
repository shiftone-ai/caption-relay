import { defaultAi } from "../ai";
import { defaultDisplay } from "../display";
import { defaultConnection } from "../connection";
import { createActor, waitFor } from "xstate";
import { afterEach, expect, it, vi } from "vitest";
import { operatorMachine } from "../machines/operator";
import { presentOperator } from "./operator";
import { CaptionConflict, type Caption, type OperatorApi, type OperatorEvent, type Snapshot } from "../domain";

const caption: Caption = { id: "one", utterance_id: "one", received_at: "2026-10-06T01:02:03Z", source_revision: 1, original: "原文", text: "字幕", revision: 1, human_edited: false, published: true, publish_eligible: true, source_final: true, ai_status: "off" };
const actors: ReturnType<typeof createActor<typeof operatorMachine>>[] = [];
afterEach(() => { actors.splice(0).forEach(actor => actor.stop()); });

function start() {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn().mockReturnValue(new Promise<Caption>(() => {})),
    setVisible: vi.fn().mockReturnValue(new Promise<boolean>(() => {})),
    setPublicationMode: vi.fn().mockResolvedValue({ auto_publish: true }), setDisplay: vi.fn().mockImplementation(settings => Promise.resolve(settings)),
    setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn().mockImplementation(settings => Promise.resolve({ ...defaultAi, settings })),
    sendTest: vi.fn().mockReturnValue(new Promise<void>(() => {})),
  };
  const actor = createActor(operatorMachine, { input: { api } });
  actors.push(actor);
  return { actor: actor.start(), api };
}

it("shows recognition failure after reloading instead of replacing it with the local stopped message", async () => {
  const { actor, api } = start();
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  vi.mocked(api.load).mockResolvedValueOnce({ visible: true, captions: [caption], connection: {
    ...defaultConnection, input_source: "microphone", transcription: {
      state: "failed", message: "音声の一部が欠けたため停止しました。", sent_seconds: 12, estimated_yen: 1,
    },
  } });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(presentOperator(actor.getSnapshot()).connection.microphoneStatus).toBe("音声の一部が欠けたため停止しました。");
});

it("shows the current native caption without claiming local publication in client mode", async () => {
  const { actor, api } = start();
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  const native = { ...caption, id: "native", utterance_id: "native", text: "純正側の受信文", published: false, publish_eligible: false };
  vi.mocked(api.load).mockResolvedValueOnce({ visible: true, captions: [caption, native], connection: {
    ...defaultConnection, mode: "client", state: "live", editable_caption_ids: ["native"],
  } });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  const view = presentOperator(actor.getSnapshot());
  expect(view.monitor.liveText).toBe("純正側の受信文");
  expect(view.monitor.liveLabel).toBe("UDトークで表示");
  expect(view.toolbar.localOutput).toBe(false);
  expect(view.rows[1]).toMatchObject({ publicationState: "native", saveLabel: "保存してUDトークへ反映" });
});

it("disables commands during initial loading and permits them during background loading", async () => {
  const { actor, api } = start();
  expect(presentOperator(actor.getSnapshot()).toolbar).toMatchObject({ testDisabled: true, toggleDisabled: true });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  vi.mocked(api.load).mockReturnValueOnce(new Promise<Snapshot>(() => {}));
  actor.send({ type: "refresh.requested" });
  const parameters = presentOperator(actor.getSnapshot());
  expect(parameters.toolbar).toMatchObject({ testDisabled: false, toggleDisabled: false });
  expect(parameters.rows[0]).toMatchObject({ disabled: false, readOnly: false });
});

it.each([
  { type: "caption.save.requested", captionId: "one" },
  { type: "visibility.toggle.requested" },
  { type: "test.requested" },
] satisfies OperatorEvent[])("disables commands while $type is in progress", async event => {
  const { actor } = start();
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  actor.send(event);
  const parameters = presentOperator(actor.getSnapshot());
  expect(parameters.toolbar).toMatchObject({ testDisabled: true, toggleDisabled: true });
  expect(parameters.rows[0]).toMatchObject({ disabled: true, readOnly: event.type === "caption.save.requested" });
});

it("allows an empty draft to request validation without making a save request", async () => {
  const { actor, api } = start();
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  actor.send({ type: "caption.draft.changed", captionId: "one", text: "　 " });
  expect(presentOperator(actor.getSnapshot()).rows[0].disabled).toBe(false);
  actor.send({ type: "caption.save.requested", captionId: "one" });
  expect(api.save).not.toHaveBeenCalled();
  expect(presentOperator(actor.getSnapshot()).rows[0]).toMatchObject({ message: "字幕を入力してください。", invalid: true });
});

it("shows saved text on a dirty closed row while retaining the draft only in the inspector", async () => {
  const { actor } = start();
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  actor.send({ type: "caption.draft.changed", captionId: "one", text: "未保存の修正" });
  let parameters = presentOperator(actor.getSnapshot());
  expect(parameters.editor).toMatchObject({ text: "字幕", draftText: "未保存の修正" });
  expect(parameters.hasUnsavedChanges).toBe(true);
  actor.send({ type: "caption.edit.closed" });
  parameters = presentOperator(actor.getSnapshot());
  expect(parameters.editor).toBeNull();
  expect(parameters.rows[0]).toMatchObject({ text: "字幕", dirty: true, source: "unsaved" });
  expect(parameters.rows[0].state).toContain("一覧には変更前の字幕");
  expect(parameters.rows[0].contentDescription).not.toContain("原文：");
  expect(parameters.rows[0].contentDescription).toContain("字幕：字幕");
  expect(parameters.rows[0].contentDescription).not.toContain("未保存の訂正");
});

it("distinguishes the published version from the saved candidate and presents three latest arrivals", async () => {
  const { actor, api } = start();
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  const captions = [caption, ...[2, 3, 4].map(number => ({ ...caption, id: String(number), utterance_id: String(number), original: `入力${number}`, text: `候補${number}`, public_text: `公開文${number}` }))];
  vi.mocked(api.load).mockResolvedValueOnce({ visible: true, captions });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  const parameters = presentOperator(actor.getSnapshot());
  expect(parameters.recentCaptions.map(row => row.id)).toEqual(["2", "3", "4"]);
  expect(parameters.monitor.liveText).toBe("公開文4");
  expect(parameters.rows[3].publication).toContain("公開文「公開文4」と一覧の字幕は異なります");
  expect(parameters.rows[3]).toMatchObject({ current: true, editing: false, publicationState: "updating" });
  expect(parameters.unreadCount).toBe(3);
  expect(parameters.rows[1].firstUnread).toBe(true);
  expect(parameters.latestLabel).toBe("最新へ · 新着 3 件");
});

it("marks every caption in the saved audience range as visible and updates after changing the range", async () => {
  const { actor, api } = start();
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  const captions = Array.from({ length: 5 }, (_, index) => ({ ...caption, id: String(index), utterance_id: String(index), text: `字幕${index}` }));
  vi.mocked(api.load).mockResolvedValueOnce({ visible: true, captions, display: { ...defaultDisplay, display_mode: "recent", history_count: 3 } });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(presentOperator(actor.getSnapshot()).rows.map(row => row.publicationState)).toEqual(["published", "published", "live", "live", "live"]);
  expect(presentOperator(actor.getSnapshot()).rows[0].publication).toContain("表示範囲外");
  actor.send({ type: "display.field.changed", field: "history_count", value: "1" });
  actor.send({ type: "display.save.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(presentOperator(actor.getSnapshot()).rows.map(row => row.publicationState)).toEqual(["published", "published", "published", "published", "live"]);
});

it.each([
  { visible: true, publish_eligible: true, source_final: true, ai_status: "off", expected: "保存して公開" },
  { visible: false, publish_eligible: true, source_final: true, ai_status: "off", expected: "保存" },
  { visible: true, publish_eligible: false, source_final: true, ai_status: "off", expected: "保存" },
  { visible: true, publish_eligible: true, source_final: false, expected: "保存" },
])("names the publication consequence of saving: $expected", async ({ visible, publish_eligible, source_final, expected }) => {
  const { actor, api } = start();
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  vi.mocked(api.load).mockResolvedValueOnce({ visible, captions: [{ ...caption, publish_eligible, source_final }] });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(presentOperator(actor.getSnapshot()).rows[0].saveLabel).toBe(expected);
});

it("keeps failed/conflicted saves beside the editor without a success message", async () => {
  const { actor, api } = start();
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  actor.send({ type: "caption.draft.changed", captionId: "one", text: "修正中" });
  vi.mocked(api.save).mockRejectedValueOnce(new Error("offline"));
  actor.send({ type: "caption.save.requested", captionId: "one" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(presentOperator(actor.getSnapshot()).editor).toMatchObject({ draftText: "修正中", saveSuccess: "" });
  expect(presentOperator(actor.getSnapshot()).editor?.message).toContain("保持");
  vi.mocked(api.save).mockRejectedValueOnce(new CaptionConflict({ ...caption, text: "更新済み。", revision: 3 }));
  actor.send({ type: "caption.save.requested", captionId: "one" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  const editor = presentOperator(actor.getSnapshot()).editor;
  expect(editor).toMatchObject({ draftText: "修正中", text: "更新済み。", saveSuccess: "", saveLabel: "再保存して公開" });
  expect(editor?.message).not.toContain("。。");
});

it("keeps the received caption editable while AI runs and preserves a draft when its result arrives", async () => {
  const { actor, api } = start();
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  vi.mocked(api.load).mockResolvedValueOnce({ visible: true, captions: [{ ...caption, ai_status: "running" }] });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(presentOperator(actor.getSnapshot()).rows[0]).toMatchObject({ text: "字幕", source: "processing", aiPending: true, editDisabled: false });
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  actor.send({ type: "caption.draft.changed", captionId: "one", text: "入力中の訂正" });
  vi.mocked(api.load).mockResolvedValueOnce({ visible: true, captions: [{ ...caption, text: "AIの訂正", formatted_text: "AIの訂正", ai_status: "succeeded", revision: 2 }] });
  actor.send({ type: "refresh.requested" });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  expect(presentOperator(actor.getSnapshot()).editor).toMatchObject({ text: "AIの訂正", draftText: "入力中の訂正", aiPending: false, source: "unsaved", readOnly: false });
});
