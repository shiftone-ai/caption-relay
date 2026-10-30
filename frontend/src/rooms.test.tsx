// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { HomeRoot, RoomRoot } from "./roots";
import { StrictMode } from "react";
import { roomsApi } from "./adapters/rooms";
import { createOperatorApi } from "./api";
import { defaultAiSettings } from "./ai";
import { OperationError, RoomStateError, type Caption, type OperatorApi, type RoomDetails, type RoomsApi } from "./domain";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const room: RoomDetails = { deletable: true, id: "room-one", name: "作品のトーク", generation: 0, last_used_at: null, caption_count: 0,
  mode: "host", input_source: "udtalk", recognizer: "openai", background: "展示の背景", ai: { ...defaultAiSettings, background: "展示の背景" },
  connection: { mode: "host", input_source: "udtalk", recognizer: "openai", zoom_text_format: "plain" } };
const rooms = (): RoomsApi => ({
  catalog: vi.fn().mockResolvedValue({ active_room_id: null, rooms: [room] }), details: vi.fn().mockResolvedValue(room),
  save: vi.fn().mockResolvedValue(room), connect: vi.fn().mockResolvedValue(room), leave: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue({ active_room_id: null, rooms: [] }),
  reset: vi.fn().mockResolvedValue({ ...room, generation: 1 }),
});
const caption: Caption = { id: "one", utterance_id: "one", received_at: "2026-10-06T01:02:03Z", source_revision: 1,
  original: "原文", text: "字幕", revision: 1, human_edited: false, published: true, publication_epoch: 0, publish_eligible: true, source_final: true, ai_status: "off" };
const operator = (): OperatorApi => ({
  load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }), save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
  setPublicationMode: vi.fn(), setDisplay: vi.fn(), setAi: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(),
});
const microphone = () => ({ available: false, devices: async () => [], start: vi.fn() });

it("loads the home after StrictMode cancels its first request", async () => {
  const fetch = vi.fn((_path: string, { signal }: RequestInit) => new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
    const timer = setTimeout(() => resolve(new Response(JSON.stringify({ active_room_id: null, rooms: [room] }))), 0);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("aborted", "AbortError")); }, { once: true });
  }));
  vi.stubGlobal("fetch", fetch);
  render(<StrictMode><HomeRoot api={roomsApi} go={vi.fn()} /></StrictMode>);
  await screen.findByRole("heading", { name: room.name });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("registers a room from the form once and connects before navigating", async () => {
  const api = rooms();
  const go = vi.fn();
  let complete!: (room: RoomDetails) => void;
  vi.mocked(api.save).mockReturnValue(new Promise(resolve => { complete = resolve; }));
  render(<HomeRoot api={api} go={go} />);
  const user = userEvent.setup();
  await screen.findByText(room.name);
  await user.click(screen.getByRole("button", { name: "新しいルームに接続" }));
  await user.type(screen.getByLabelText("ルーム名"), "新しい展示");
  await user.selectOptions(screen.getByLabelText("配信先"), "host");
  fireEvent.change(screen.getByLabelText("トークの背景"), { target: { value: "登壇者と作品" } });
  await user.keyboard("{Control>}{Enter}{/Control}");
  fireEvent.submit(screen.getByLabelText("ルーム名").closest("form")!);
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ name: "新しい展示", ai: expect.objectContaining({ background: "登壇者と作品" }),
    connection: expect.objectContaining({ mode: "host", editor_url: null }) }), null, expect.any(AbortSignal));
  expect(go).not.toHaveBeenCalled();
  await act(async () => complete(room));
  await waitFor(() => expect(go).toHaveBeenCalledWith("/rooms/room-one"));
  expect(api.connect).toHaveBeenCalledWith(room.id, expect.any(AbortSignal));
});

it("saves supplementary Unicode at the room limits and retains oversized form input", async () => {
  const api = rooms();
  render(<HomeRoot api={api} go={vi.fn()} />);
  const user = userEvent.setup();
  await screen.findByText(room.name);
  await user.click(screen.getByRole("button", { name: "新しいルームに接続" }));
  await user.selectOptions(screen.getByLabelText("配信先"), "host");
  const name = screen.getByRole<HTMLInputElement>("textbox", { name: "ルーム名" });
  const background = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "トークの背景" });
  const nameText = "𠮷".repeat(120);
  const backgroundText = "𠮷".repeat(4000);
  await user.click(name); await user.paste(nameText);
  expect(Array.from(name.value)).toHaveLength(120);
  await user.click(background); await user.paste(backgroundText);
  expect(Array.from(background.value)).toHaveLength(4000);
  fireEvent.change(name, { target: { value: nameText + "𠮷" } });
  expect(screen.getByRole("alert").textContent).toContain("120文字以内");
  expect(name.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(name.getAttribute("aria-describedby")!)?.textContent).toContain("120文字以内");
  fireEvent.submit(name.closest("form")!);
  expect(api.save).not.toHaveBeenCalled();
  expect(Array.from(name.value)).toHaveLength(121);
  fireEvent.change(name, { target: { value: nameText } });
  fireEvent.change(background, { target: { value: backgroundText + "𠮷" } });
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(screen.getByRole("alert").textContent).toContain("4,000文字以内");
  expect(background.getAttribute("aria-invalid")).toBe("true");
  expect(name.getAttribute("aria-invalid")).not.toBe("true");
  expect(api.save).not.toHaveBeenCalled();
  expect(Array.from(background.value)).toHaveLength(4001);
  fireEvent.change(background, { target: { value: backgroundText } });
  await user.click(screen.getByRole("button", { name: "登録して接続" }));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ name: nameText, ai: expect.objectContaining({ background: backgroundText }) }), null, expect.any(AbortSignal)));
});

it("returns focus to the opener when cancelling a new or existing room form", async () => {
  render(<HomeRoot api={rooms()} go={vi.fn()} />);
  const user = userEvent.setup();
  const create = await screen.findByRole("button", { name: "新しいルームに接続" });
  await user.click(create);
  await user.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(document.activeElement).toBe(create);
  const edit = screen.getByRole("button", { name: room.name + "の接続設定" });
  await user.click(edit);
  await screen.findByLabelText("ルーム名");
  await user.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(document.activeElement).toBe(edit);
});

it("clears validation when replacing an invalid draft with a saved room form", async () => {
  render(<HomeRoot api={rooms()} go={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "新しいルームに接続" }));
  fireEvent.change(screen.getByLabelText("ルーム名"), { target: { value: "あ".repeat(121) } });
  await user.click(screen.getByRole("button", { name: room.name + "の接続設定" }));
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>("textbox", { name: "ルーム名" }).value).toBe(room.name));
  expect(screen.getByLabelText("ルーム名").getAttribute("aria-invalid")).not.toBe("true");
  expect(screen.getByLabelText("ルーム名").getAttribute("aria-describedby")).toBeNull();
});

it("retains a rejected link for correction and can reconnect from the room list", async () => {
  const api = rooms();
  vi.mocked(api.save).mockRejectedValue(new OperationError("編集用の参加リンクを確認してください。"));
  const go = vi.fn();
  render(<HomeRoot api={api} go={go} />);
  const user = userEvent.setup();
  await screen.findByText(room.name);
  await user.click(screen.getByRole("button", { name: "新しいルームに接続" }));
  await user.type(screen.getByLabelText("ルーム名"), "接続テスト");
  fireEvent.change(screen.getByLabelText("編集用の参加リンク"), { target: { value: "invalid-link" } });
  await user.click(screen.getByRole("button", { name: "登録して接続" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("編集用の参加リンク") as HTMLTextAreaElement).value).toBe("invalid-link");
  await user.click(screen.getByRole("button", { name: "キャンセル" }));
  await user.click(screen.getByRole("button", { name: room.name + "に接続" }));
  await waitFor(() => expect(go).toHaveBeenCalledWith("/rooms/room-one"));
});

it("edits stored room settings without requiring the private link again", async () => {
  const api = rooms();
  vi.mocked(api.details).mockResolvedValue({ ...room, mode: "client", connection: { ...room.connection, mode: "client", editor_url: null } });
  render(<HomeRoot api={api} go={vi.fn()} />);
  const user = userEvent.setup();
  await screen.findByText(room.name);
  await user.click(screen.getByRole("button", { name: room.name + "の接続設定" }));
  const background = await screen.findByLabelText("トークの背景");
  expect((background as HTMLTextAreaElement).value).toBe("展示の背景");
  await user.click(screen.getByRole("button", { name: "保存して接続" }));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ connection: expect.objectContaining({ mode: "client", editor_url: null }) }), room.id, expect.any(AbortSignal)));
});

it("keeps a newly saved room in the list when its first connection fails", async () => {
  const api = rooms();
  vi.mocked(api.catalog).mockResolvedValue({ active_room_id: null, rooms: [] });
  vi.mocked(api.connect).mockRejectedValueOnce(new OperationError("接続を確認してください。"));
  const go = vi.fn();
  render(<HomeRoot api={api} go={go} />);
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "新しいルームに接続" }).disabled).toBe(false));
  await user.click(screen.getByRole("button", { name: "新しいルームに接続" }));
  await user.type(screen.getByLabelText("ルーム名"), room.name);
  await user.selectOptions(screen.getByLabelText("配信先"), "host");
  await user.click(screen.getByRole("button", { name: "登録して接続" }));
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: room.name + "に接続" }));
  await waitFor(() => expect(go).toHaveBeenCalledWith("/rooms/room-one"));
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.connect).toHaveBeenCalledTimes(2);
});

it("cancels reset without losing a draft and discards it only after a successful reset", async () => {
  const api = rooms();
  const first = operator();
  const next = operator();
  vi.mocked(next.load).mockResolvedValue({ visible: true, captions: [] });
  const factory = vi.fn(binding => binding.generation === 0 ? first : next);
  render(<RoomRoot id={room.id} api={api} operator={factory} microphone={microphone} go={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "編集：字幕" }));
  const editor = screen.getByRole("textbox", { name: "表示文" });
  fireEvent.change(editor, { target: { value: "未保存の訂正" } });
  await user.click(screen.getByRole("button", { name: "字幕をリセット" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "キャンセル" }));
  expect((editor as HTMLTextAreaElement).value).toBe("未保存の訂正");
  expect(api.reset).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "字幕をリセット" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "字幕をリセット" }));
  await waitFor(() => expect(next.load).toHaveBeenCalled());
  expect(api.reset).toHaveBeenCalledWith({ roomId: room.id, generation: 0 }, expect.any(AbortSignal));
  expect(screen.queryByRole("textbox", { name: "表示文" })).toBeNull();
  expect(first.save).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "観客画面" }).getAttribute("href")).toBe("/view/demo?room_id=room-one");
});

it("keeps unsaved work after a reset failure and confirms leaving before removing the page guard", async () => {
  const api = rooms();
  vi.mocked(api.reset).mockRejectedValue(new OperationError("保存先を確認してください。"));
  const op = operator();
  const go = vi.fn(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  render(<RoomRoot id={room.id} api={api} operator={() => op} microphone={microphone} go={go} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "編集：字幕" }));
  const editor = screen.getByRole("textbox", { name: "表示文" });
  fireEvent.change(editor, { target: { value: "残す訂正" } });
  await user.click(screen.getByRole("button", { name: "字幕をリセット" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "字幕をリセット" }));
  await screen.findByText("保存先を確認してください。");
  expect((editor as HTMLTextAreaElement).value).toBe("残す訂正");
  await user.click(screen.getByRole("button", { name: "ホームへ戻る" }));
  expect(api.leave).not.toHaveBeenCalled();
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "キャンセル" }));
  expect(go).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "ホームへ戻る" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "破棄して戻る" }));
  await waitFor(() => expect(go).toHaveBeenCalledWith("/"));
  expect(api.leave).toHaveBeenCalledWith({ roomId: room.id, generation: 0 }, expect.any(AbortSignal));
});

it("keeps an unsaved dictionary across a caption reset and saves with the new room binding", async () => {
  const api = rooms();
  const first = operator();
  const next = operator();
  vi.mocked(next.load).mockResolvedValue({ visible: true, captions: [] });
  vi.mocked(next.setDictionary).mockResolvedValue({ revision: 1, entries: [{ term: "残しておく単語", enabled: true, reading: "", variants: [] }] });
  const factory = (binding: { generation: number }) => binding.generation === 0 ? first : next;
  render(<RoomRoot id={room.id} api={api} operator={factory} microphone={microphone} go={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "単語辞書" }));
  await user.click(screen.getByRole("button", { name: "単語を追加" }));
  fireEvent.change(screen.getByLabelText("1件目の表記"), { target: { value: "残しておく単語" } });
  await user.click(screen.getByRole("button", { name: "字幕をリセット" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "字幕をリセット" }));
  await waitFor(() => expect(next.load).toHaveBeenCalled());
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "1件目の表記" }).value).toBe("残しておく単語");
  await user.click(screen.getByRole("button", { name: "ホームへ戻る" }));
  expect(screen.getByRole("dialog").textContent).toContain("未保存の変更");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "キャンセル" }));
  await user.click(screen.getByRole("button", { name: "辞書を保存" }));
  await waitFor(() => expect(next.setDictionary).toHaveBeenCalledWith(expect.objectContaining({ entries: [expect.objectContaining({ term: "残しておく単語" })] }), expect.any(AbortSignal)));
  expect(first.setDictionary).not.toHaveBeenCalled();
});

it("binds every operator read and write to the room and reset generation", async () => {
  const fetch = vi.fn().mockImplementation((path: string) => Promise.resolve(new Response(JSON.stringify({
    "/api/session": { visible: true }, "/api/events": [], "/api/ai": {}, "/api/connection": {}, "/api/dictionary": {},
  }[path] ?? caption), { status: 200, headers: { "content-type": "application/json" } })));
  vi.stubGlobal("fetch", fetch);
  const api = createOperatorApi({ roomId: room.id, generation: 7 });
  const signal = new AbortController().signal;
  await api.load(signal);
  await api.save({ captionId: caption.id, text: "訂正", baseRevision: 1 }, signal);
  expect(fetch).toHaveBeenCalledTimes(6);
  for (const [, options] of fetch.mock.calls) {
    expect(options.headers.get("X-Caption-Relay-Room")).toBe(room.id);
    expect(options.headers.get("X-Caption-Relay-Generation")).toBe("7");
  }
  expect(fetch.mock.calls.at(-1)?.[1].headers.get("content-type")).toBe("application/json");
});


it("reloads a reset room without connecting again and warns before discarding caption edits", async () => {
  const api = rooms();
  vi.mocked(api.details).mockResolvedValue({ ...room, generation: 1 });
  const first = operator(), next = operator();
  const factory = vi.fn(binding => binding.generation === 0 ? first : next);
  render(<RoomRoot id={room.id} api={api} operator={factory} microphone={microphone} go={vi.fn()} />);
  await screen.findByRole("button", { name: "編集：字幕" });
  await userEvent.click(screen.getByRole("button", { name: "編集：字幕" }));
  await userEvent.type(screen.getByRole("textbox", { name: "表示文" }), "未保存");
  vi.mocked(first.load).mockRejectedValue(new RoomStateError("room_reset", "字幕がリセットされました。「字幕を読み直す」を押してください。"));
  await screen.findByRole("button", { name: "字幕を読み直す" }, { timeout: 3000 });
  expect(screen.queryByText("観客に表示中", { exact: true })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "字幕を読み直す" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(/未保存の訂正/)).toBeTruthy();
  await userEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));
  expect(api.details).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "字幕を読み直す" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "読み直す" }));
  await waitFor(() => expect(next.load).toHaveBeenCalled());
  expect(api.connect).toHaveBeenCalledTimes(1);
  expect(api.details).toHaveBeenCalledWith(room.id, expect.any(AbortSignal));
});


it("confirms deletion and removes the selected inactive room from the home", async () => {
  const api = rooms();
  vi.mocked(api.catalog).mockResolvedValue({ active_room_id: null, rooms: [{ ...room, deletable: true }] });
  render(<HomeRoot api={api} go={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: room.name + "を削除" }));
  expect(api.delete).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "キャンセル" }));
  expect(screen.getByRole("heading", { name: room.name })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: room.name + "を削除" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ルームを削除" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: room.name })).toBeNull());
  expect(api.delete).toHaveBeenCalledWith({ roomId: room.id, generation: 0 }, expect.any(AbortSignal));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "新しいルームに接続" }));
});
