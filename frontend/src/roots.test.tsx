// @vitest-environment jsdom
import { defaultAi } from "./ai";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AudienceRoot, OperatorRoot } from "./roots";
import type { AiRouting, AudienceEvent, Caption, OperatorApi, Snapshot } from "./domain";
import { defaultDisplay } from "./display";
import { defaultConnection } from "./connection";
import { viewHierarchy } from "./events/hierarchy";
import type { AiParameters, ToolbarParameters } from "./presenters/operator";
import { AiSettingsView } from "./views/operator/ai-settings";
import { ToolbarView } from "./views/operator/toolbar";

afterEach(cleanup);
const caption: Caption = { id: "one", utterance_id: "one", received_at: "2026-10-06T01:02:03Z", source_revision: 1, original: "原文", text: "字幕", revision: 1, human_edited: false, published: true, publish_eligible: true, source_final: true, ai_status: "off" };

it("edits a dictionary through Root and restores focus when the panel closes", async () => {
  let resolveLoad!: (value: Snapshot) => void;
  const initialLoad = new Promise<Snapshot>(resolve => { resolveLoad = resolve; });
  const api: OperatorApi = {
    load: vi.fn().mockReturnValue(initialLoad),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setDisplay: vi.fn(), setAi: vi.fn(), setConnection: vi.fn(),
    setDictionary: vi.fn().mockImplementation(update => Promise.resolve({ revision: update.base_revision + 1, entries: update.entries })),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  const trigger = await screen.findByRole("button", { name: "単語辞書" });
  expect((trigger as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { resolveLoad({ visible: true, captions: [] }); });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  await user.click(trigger);
  const add = screen.getByRole("button", { name: "単語を追加" });
  await waitFor(() => expect(document.activeElement).toBe(add));
  await user.click(add);
  expect(document.activeElement).toBe(screen.getByLabelText("1件目の表記"));
  await user.type(screen.getByLabelText("1件目の表記"), "Caption Relay");
  fireEvent.change(screen.getByLabelText("1件目の読み"), { target: { value: "きゃぷしょんりれー" } });
  fireEvent.change(screen.getByLabelText("1件目の誤認識されやすい表記"), { target: { value: "キャプションリレー" } });
  await user.click(screen.getByLabelText("1件目を有効にする"));
  await user.click(screen.getByRole("button", { name: "辞書を保存" }));
  await screen.findByText("辞書を保存しました。");
  expect(api.setDictionary).toHaveBeenCalledWith({ base_revision: 0, entries: [{ term: "Caption Relay", reading: "きゃぷしょんりれー", variants: ["キャプションリレー"], enabled: false }] }, expect.any(AbortSignal));
  await user.click(screen.getByRole("button", { name: "1件目を削除" }));
  expect(screen.queryByLabelText("1件目の表記")).toBeNull();
  expect(document.activeElement).toBe(add);
  await user.click(screen.getByRole("button", { name: "単語辞書を閉じる" }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
}, 20000);

it("accepts eighty supplementary characters in dictionary fields and retains an oversized draft", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [] }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setDisplay: vi.fn(), setAi: vi.fn(), setConnection: vi.fn(),
    setDictionary: vi.fn().mockImplementation(update => Promise.resolve({ revision: update.base_revision + 1, entries: update.entries })),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "単語辞書" }));
  await user.click(screen.getByRole("button", { name: "単語を追加" }));
  const term = screen.getByRole<HTMLInputElement>("textbox", { name: "1件目の表記" });
  const text = "𠮷".repeat(80);
  await user.click(term);
  await user.paste(text);
  expect(term.value).toBe(text);
  await user.click(screen.getByRole("button", { name: "辞書を保存" }));
  await screen.findByText("辞書を保存しました。");
  expect(api.setDictionary).toHaveBeenLastCalledWith(expect.objectContaining({ entries: [expect.objectContaining({ term: text })] }), expect.any(AbortSignal));
  await user.type(term, "𠮷");
  await user.click(screen.getByRole("button", { name: "辞書を保存" }));
  expect(term.value).toBe(text + "𠮷");
  expect(api.setDictionary).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert").textContent).toContain("80文字以内");
  expect(term.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(term.getAttribute("aria-describedby")!)?.textContent).toContain("80文字以内");
  expect(document.activeElement).toBe(term);
});

it("focuses an editable word when the dictionary is full and restores its trigger", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [], dictionary: { revision: 1,
      entries: Array.from({ length: 100 }, (_, index) => ({ term: `単語${index}`, reading: "", variants: [], enabled: true })) } }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setDisplay: vi.fn(), setAi: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  const trigger = await screen.findByRole("button", { name: "単語辞書" });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  await user.click(trigger);
  expect((screen.getByRole("button", { name: "単語を追加" }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.activeElement).toBe(screen.getByLabelText("1件目の表記"));
  await user.keyboard("{Escape}");
  expect(document.activeElement).toBe(trigger);
});

it("focuses the dictionary field with an error and its neighbour after deleting an entry", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [] }), save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "単語辞書" }));
  const add = screen.getByRole("button", { name: "単語を追加" });
  await user.click(add);
  await user.type(screen.getByLabelText("1件目の表記"), "写真");
  await user.click(add);
  const term = screen.getByRole<HTMLInputElement>("textbox", { name: "2件目の表記" });
  expect(document.activeElement).toBe(term);
  await user.type(term, "布");
  const reading = screen.getByLabelText("2件目の読み");
  fireEvent.change(reading, { target: { value: "あ".repeat(81) } });
  await user.click(screen.getByRole("button", { name: "辞書を保存" }));
  expect(document.activeElement).toBe(reading);
  expect(reading.getAttribute("aria-invalid")).toBe("true");
  expect(term.getAttribute("aria-invalid")).not.toBe("true");
  await user.clear(reading);
  const variants = screen.getByRole("textbox", { name: "2件目の誤認識されやすい表記" });
  fireEvent.change(variants, { target: { value: "ぬの\nぬの" } });
  await user.click(screen.getByRole("button", { name: "辞書を保存" }));
  expect(document.activeElement).toBe(variants);
  expect(variants.getAttribute("aria-invalid")).toBe("true");
  expect(reading.getAttribute("aria-invalid")).not.toBe("true");
  await user.click(screen.getByRole("button", { name: "1件目を削除" }));
  const remaining = screen.getByRole<HTMLInputElement>("textbox", { name: "1件目の表記" });
  expect(remaining.value).toBe("布");
  expect(document.activeElement).toBe(remaining);
});

it("changes the inspector width with clicks and preserves the editor draft", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }), save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "編集：字幕" }));
  const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "表示文" });
  await user.type(input, "の下書き");
  const width = screen.getByRole("separator", { name: "右ペインの幅" });
  expect(width.getAttribute("aria-valuenow")).toBe("384");
  await user.click(screen.getByRole("button", { name: "右ペインを広げる" }));
  expect(width.getAttribute("aria-valuenow")).toBe("408");
  await user.click(screen.getByRole("button", { name: "右ペインを狭める" }));
  expect(width.getAttribute("aria-valuenow")).toBe("384");
  expect(input.value).toBe("字幕の下書き");
});

it("applies microphone input without starting recognition and explains a missing key", async () => {
  let connection = defaultConnection;
  const api: OperatorApi = {
    load: vi.fn().mockImplementation(() => Promise.resolve({ visible: true, captions: [], connection })),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setDisplay: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
    setConnection: vi.fn().mockImplementation(settings => {
      connection = { ...defaultConnection, ...settings, recognizers: [{ id: "openai", label: "OpenAI", available: false, message: "このリポジトリ用のOpenAIキーが設定されていません。" }] };
      return Promise.resolve(connection);
    }),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "字幕入力の接続設定" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "字幕の入力元" }), "microphone");
  await user.click(screen.getByRole("button", { name: "接続を適用" }));
  await waitFor(() => expect(api.setConnection).toHaveBeenCalledWith(expect.objectContaining({ input_source: "microphone", recognizer: "openai" }), expect.any(AbortSignal)));
  expect((screen.getByRole("button", { name: "認識を開始" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("このリポジトリ用のOpenAIキーが設定されていません。")).toBeTruthy();
}, 20000);

it("applies the explicit Zoom speaker format and retains it when settings reopen", async () => {
  let connection = { ...defaultConnection };
  const api: OperatorApi = {
    load: vi.fn().mockImplementation(() => Promise.resolve({ visible: true, captions: [caption], connection })),
    save: vi.fn(), setVisible: vi.fn(), setPublicationMode: vi.fn(), setDisplay: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(), sendTest: vi.fn(),
    setConnection: vi.fn().mockImplementation(settings => {
      connection = { ...connection, zoom_text_format: settings.zoom_text_format };
      return Promise.resolve(connection);
    }),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "字幕入力の接続設定" }));
  expect((screen.getByRole("combobox", { name: "送られる字幕" }) as HTMLSelectElement).value).toBe("plain");
  await user.selectOptions(screen.getByRole("combobox", { name: "送られる字幕" }), "speaker");
  await user.click(screen.getByRole("button", { name: "接続設定を閉じる" }));
  await user.click(screen.getByRole("button", { name: "字幕入力の接続設定" }));
  expect((screen.getByRole("combobox", { name: "送られる字幕" }) as HTMLSelectElement).value).toBe("speaker");
  await user.click(screen.getByRole("button", { name: "接続を適用" }));
  await waitFor(() => expect(api.setConnection).toHaveBeenCalledWith(
    { mode: "host", editor_url: null, zoom_text_format: "speaker", input_source: "udtalk", recognizer: "openai" }, expect.any(AbortSignal),
  ));
  await waitFor(() => expect(screen.getByRole("button", { name: "接続を適用" }).hasAttribute("disabled")).toBe(true));
  await user.click(screen.getByRole("button", { name: "接続設定を閉じる" }));
  await user.click(screen.getByRole("button", { name: "字幕入力の接続設定" }));
  expect((screen.getByRole("combobox", { name: "送られる字幕" }) as HTMLSelectElement).value).toBe("speaker");
});

it("bubbles UI events to the actor and preserves the focused input across polling", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn().mockResolvedValue({ ...caption, revision: 2 }),
    setVisible: vi.fn().mockResolvedValue(false), setPublicationMode: vi.fn().mockResolvedValue({ auto_publish: true }), setDisplay: vi.fn().mockImplementation(settings => Promise.resolve(settings)),
    setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn().mockImplementation(settings => Promise.resolve({ ...defaultAi, settings })),
    sendTest: vi.fn().mockResolvedValue(undefined),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "編集：字幕" }));
  const history = screen.getByRole("region", { name: "字幕一覧" });
  const editor = screen.getByRole("complementary", { name: "字幕の訂正" });
  expect(within(history).queryByText("原文", { exact: true })).toBeNull();
  expect(within(history).getAllByText("字幕", { exact: true })).toHaveLength(1);
  expect(within(editor).getByRole("region", { name: "訂正する字幕の原文" }).textContent).toBe("原文原文");
  expect(history.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const input = screen.getByRole("textbox");
  await user.clear(input);
  await user.type(input, "修正中");
  (input as HTMLTextAreaElement).setSelectionRange(1, 2);
  let resolve!: (value: Snapshot) => void;
  vi.mocked(api.load).mockReturnValueOnce(new Promise(value => { resolve = value; }));
  // A test-input request triggers the same real refresh state used by polling.
  await user.click(screen.getByText("準備", { selector: "summary span" }));
  await user.click(screen.getByRole("button", { name: "テスト字幕を送る" }));
  await waitFor(() => expect(api.load).toHaveBeenCalledTimes(2));
  input.focus();
  await act(async () => { resolve({ visible: true, captions: [{ ...caption, revision: 3, text: "上流の更新" }] }); });
  expect(screen.getByRole("textbox")).toBe(input);
  expect((input as HTMLTextAreaElement).value).toBe("修正中");
  expect(document.activeElement).toBe(input);
  expect((input as HTMLTextAreaElement).selectionStart).toBe(1);
  expect((input as HTMLTextAreaElement).selectionEnd).toBe(2);
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, isComposing: true });
  expect(api.save).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ text: "修正中", baseRevision: 1 }), expect.any(AbortSignal)));
});


it("keeps only the selected editor open and retains drafts when switching rows", async () => {
  const other = { ...caption, id: "two", utterance_id: "two", text: "別の字幕" };
  let resolve!: (value: Caption) => void;
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption, other] }),
    save: vi.fn().mockReturnValue(new Promise<Caption>(value => { resolve = value; })),
    setVisible: vi.fn().mockResolvedValue(false),
    setPublicationMode: vi.fn().mockResolvedValue({ auto_publish: true }),
    setDisplay: vi.fn().mockImplementation(settings => Promise.resolve(settings)),
    setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn().mockImplementation(settings => Promise.resolve({ ...defaultAi, settings })),
    sendTest: vi.fn().mockResolvedValue(undefined),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "編集：別の字幕" }));
  const second = screen.getByRole<HTMLTextAreaElement>("textbox");
  await user.clear(second);
  await user.type(second, "二行目の修正");
  expect(api.save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存して公開" }));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith(
    expect.objectContaining({ captionId: "two", text: "二行目の修正", baseRevision: 1 }), expect.any(AbortSignal),
  ));
  expect(second.readOnly).toBe(true);
  await user.click(screen.getByRole("button", { name: "編集：字幕" }));
  const first = screen.getByRole<HTMLTextAreaElement>("textbox");
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(first.readOnly).toBe(false);
  await user.clear(first);
  await user.type(first, "一行目の下書き");
  fireEvent.keyDown(first, { key: "Enter", metaKey: true });
  expect(api.save).toHaveBeenCalledTimes(1);
  await act(async () => { resolve({ ...other, text: "二行目の修正", revision: 2, human_edited: true }); });
  expect(first.value).toBe("一行目の下書き");
  await user.click(screen.getByRole("button", { name: "編集：二行目の修正" }));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("二行目の修正");
  await user.click(screen.getByRole("button", { name: "編集：字幕" }));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("一行目の下書き");
  await user.click(screen.getByRole("button", { name: "変更を破棄" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "編集：字幕" }));
  await user.click(screen.getByRole("button", { name: "編集：字幕" }));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("字幕");
});

it("keeps status explanations available to pointer and keyboard and dismisses Escape through the Root", async () => {
  let resolve!: (snapshot: Snapshot) => void;
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValueOnce({ visible: true, captions: [caption] })
      .mockReturnValue(new Promise<Snapshot>(done => { resolve = done; })),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  const row = await screen.findByRole("article", { name: "字幕：字幕" });
  const source = within(row).getByRole("img", { name: "原文採用" });
  const publication = within(row).getByRole("img", { name: "観客に表示中" });
  expect(source.hasAttribute("title")).toBe(false);
  expect(screen.queryByRole("tooltip")).toBeNull();
  await user.hover(source);
  const explanation = screen.getByRole("tooltip");
  expect(explanation.textContent).toBe("原文採用");
  expect(source.getAttribute("aria-describedby")).toBe(explanation.id);
  await user.hover(explanation);
  expect(screen.getByRole("tooltip")).toBe(explanation);
  act(() => source.focus());
  await user.unhover(source);
  await user.hover(publication);
  expect(screen.getByRole("tooltip")).toBe(explanation);
  fireEvent.keyDown(source, { key: "Escape", isComposing: true });
  expect(screen.getByRole("tooltip")).toBe(explanation);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(document.activeElement).toBe(source);
  expect(source.hasAttribute("aria-describedby")).toBe(false);
  await waitFor(() => expect(api.load).toHaveBeenCalledTimes(2), { timeout: 3000 });
  await act(async () => { resolve({ visible: true, captions: [{ ...caption, source_revision: 2 }] }); });
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(document.activeElement).toBe(source);
  act(() => source.blur());
  expect(screen.getByRole("tooltip").textContent).toBe("観客に表示中");
  await user.unhover(publication);
  await user.hover(source);
  expect(screen.getByRole("tooltip").textContent).toBe("原文採用");
});

it("dismisses a hovered explanation with Escape before closing the focused caption editor", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  const trigger = await screen.findByRole("button", { name: "編集：字幕" });
  await user.click(trigger);
  const input = screen.getByRole<HTMLTextAreaElement>("textbox");
  await user.type(input, "訂正中");
  const source = within(screen.getByRole("article", { name: "字幕：字幕" })).getByRole("img", { name: /未保存の下書き/ });
  await user.hover(source);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  expect(document.activeElement).toBe(input);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(screen.getByRole("textbox")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("字幕訂正中");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(api.save).not.toHaveBeenCalled();
});

it("dismisses a hovered explanation before closing the focused settings panel", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "編集：字幕" });
  const trigger = screen.getByRole("button", { name: "表示設定" });
  await user.click(trigger);
  const displayMode = screen.getByRole("combobox", { name: "表示方式" });
  await user.hover(screen.getByRole("img", { name: "原文採用" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(screen.getByRole("complementary", { name: "観客画面の表示設定" })).toBeTruthy();
  expect(document.activeElement).toBe(displayMode);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("complementary", { name: "観客画面の表示設定" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("measures status explanations through the Root and repositions them after scrolling or resizing", async () => {
  const viewport = document.documentElement;
  const originalWidth = Object.getOwnPropertyDescriptor(viewport, "clientWidth");
  const originalHeight = Object.getOwnPropertyDescriptor(viewport, "clientHeight");
  Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 320 });
  Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 300 });
  let triggerTop = 260;
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("caption-state-icon")) return new DOMRect(290, triggerTop, 22, 22);
    if (this.classList.contains("caption-state-tooltip")) return new DOMRect(0, 0, 280, 90);
    return new DOMRect();
  });
  try {
    const api: OperatorApi = {
      load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
      save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
      setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
    };
    const { container } = render(<OperatorRoot api={api} />);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "編集：字幕" });
    const source = screen.getByRole("img", { name: "原文採用" });
    await user.hover(source);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.getAttribute("data-positioned")).toBe("true");
    expect(tooltip.style.top).toBe("162px");
    expect(tooltip.style.left).toBe("32px");
    expect(tooltip.style.maxWidth).toBe("min(var(--caption-tooltip-max-width), 304px)");
    const bridge = source.querySelector<HTMLElement>(".caption-state-bridge")!;
    expect(bridge.style.top).toBe("252px");
    expect(bridge.style.height).toBe("8px");
    expect(bridge.getAttribute("aria-hidden")).toBe("true");
    triggerTop = 120;
    fireEvent.scroll(container.querySelector(".caption-viewport")!);
    expect(tooltip.style.top).toBe("150px");
    triggerTop = 80;
    fireEvent.scroll(window);
    expect(tooltip.style.top).toBe("110px");
    triggerTop = 120;
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 200 });
    fireEvent(window, new Event("resize"));
    expect(tooltip.style.top).toBe("22px");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  } finally {
    bounds.mockRestore();
    if (originalWidth) Object.defineProperty(viewport, "clientWidth", originalWidth);
    else Reflect.deleteProperty(viewport, "clientWidth");
    if (originalHeight) Object.defineProperty(viewport, "clientHeight", originalHeight);
    else Reflect.deleteProperty(viewport, "clientHeight");
  }
});

it("handles Escape from the toolbar and removes the Root keyboard subscription on unmount", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  const user = userEvent.setup();
  const firstRoot = render(<OperatorRoot api={api} />);
  await screen.findByRole("button", { name: "編集：字幕" });
  await user.click(screen.getByRole("button", { name: "表示設定" }));
  firstRoot.unmount();
  const unhandled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.dispatchEvent(unhandled);
  expect(unhandled.defaultPrevented).toBe(false);
  render(<OperatorRoot api={api} />);
  await screen.findByRole("button", { name: "編集：字幕" });
  const trigger = screen.getByRole("button", { name: "AI設定" });
  await user.click(trigger);
  act(() => trigger.focus());
  await user.hover(screen.getByRole("img", { name: "原文採用" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(screen.getByRole("complementary", { name: "字幕修正のAI設定" })).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("complementary", { name: "字幕修正のAI設定" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("shows blank-caption validation beside the input and requires explicit saving", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "編集：字幕" }));
  const input = screen.getByRole("textbox");
  await user.clear(input);
  await user.click(screen.getByRole("button", { name: "保存して公開" }));
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const description = input.getAttribute("aria-describedby")?.split(/\s+/)
    .map(id => document.getElementById(id)?.textContent).join(" ");
  expect(description).toContain("入力");
  expect(api.save).not.toHaveBeenCalled();
});

it("focuses the opened setting, switches panels and returns to its toolbar control", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "編集：字幕" });
  const aiTrigger = screen.getByRole("button", { name: "AI設定" });
  const displayTrigger = screen.getByRole("button", { name: "表示設定" });
  await user.click(aiTrigger);
  expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "モデル" }));
  const aiPanel = screen.getByRole("complementary", { name: "字幕修正のAI設定" });
  expect(aiPanel.getAttribute("aria-describedby")).toBe("ai-settings-description");
  expect(screen.getByText("AIはオフです。原文を受け取り、手動で訂正できます。")).toBeTruthy();
  await user.click(displayTrigger);
  expect(screen.queryByRole("complementary", { name: "字幕修正のAI設定" })).toBeNull();
  const displayMode = screen.getByRole("combobox", { name: "表示方式" });
  expect(document.activeElement).toBe(displayMode);
  fireEvent.keyDown(displayMode, { key: "Escape", isComposing: true });
  expect(screen.getByRole("complementary", { name: "観客画面の表示設定" })).toBeTruthy();
  fireEvent.keyDown(displayMode, { key: "Escape" });
  expect(screen.queryByRole("complementary", { name: "観客画面の表示設定" })).toBeNull();
  expect(document.activeElement).toBe(displayTrigger);
  await user.click(aiTrigger);
  await user.click(screen.getByRole("button", { name: "AI設定を閉じる" }));
  expect(document.activeElement).toBe(aiTrigger);
});

it("does not reset setting focus after a background refresh", async () => {
  let resolve!: (snapshot: Snapshot) => void;
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValueOnce({ visible: true, captions: [caption] })
      .mockReturnValue(new Promise<Snapshot>(done => { resolve = done; })),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "編集：字幕" });
  await user.click(screen.getByRole("button", { name: "AI設定" }));
  const firstField = screen.getByRole<HTMLSelectElement>("combobox", { name: "モデル" });
  await user.tab();
  const focusedField = document.activeElement;
  expect(focusedField).not.toBe(firstField);
  expect(focusedField?.tagName).toBe("SUMMARY");
  await waitFor(() => expect(api.load).toHaveBeenCalledTimes(2), { timeout: 3000 });
  await act(async () => { resolve({ visible: true, captions: [{ ...caption, text: "背景で受信した文" }] }); });
  expect(document.activeElement).toBe(focusedField);
});

it("renders independent Mediator disclosures and retains their state across panel switches", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setDisplay: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(), setConnection: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "編集：字幕" });
  const preparation = screen.getByText("準備", { selector: "summary span" }).closest("details")!;
  await user.click(screen.getByText("準備", { selector: "summary span" }));
  expect(preparation.open).toBe(true);
  await user.click(screen.getByRole("button", { name: "表示設定" }));
  const speaker = screen.getByText("発話者", { selector: "summary" }).closest("details")!;
  const layout = screen.getByText("配置と余白", { selector: "summary" }).closest("details")!;
  expect(speaker.open).toBe(true);
  await user.click(within(speaker).getByText("発話者", { selector: "summary" }));
  await user.click(within(layout).getByText("配置と余白", { selector: "summary" }));
  expect(speaker.open).toBe(false);
  expect(layout.open).toBe(true);
  expect(preparation.open).toBe(true);
  await user.click(screen.getByRole("button", { name: "AI設定" }));
  await user.click(screen.getByText("料金と速度の比較", { selector: "summary" }));
  expect(screen.getByText("料金と速度の比較", { selector: "summary" }).closest("details")!.open).toBe(true);
  await user.click(screen.getByRole("button", { name: "表示設定" }));
  expect(screen.getByText("発話者", { selector: "summary" }).closest("details")!.open).toBe(false);
  expect(screen.getByText("配置と余白", { selector: "summary" }).closest("details")!.open).toBe(true);
  await user.click(screen.getByRole("button", { name: "AI設定" }));
  expect(screen.getByText("料金と速度の比較", { selector: "summary" }).closest("details")!.open).toBe(true);
});

it("returns from settings to the draft editor and focuses it through both return and row selection", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "編集：字幕" }));
  await user.type(screen.getByRole("textbox"), "未保存の修正");
  for (const returnByRow of [false, true]) {
    await user.click(screen.getByRole("button", { name: "表示設定" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "文字サイズ" }), "96");
    await user.click(screen.getByRole("button", { name: returnByRow ? "編集：字幕" : "編集中の字幕へ" }));
    const input = screen.getByRole<HTMLTextAreaElement>("textbox");
    expect(screen.queryByRole("complementary", { name: "観客画面の表示設定" })).toBeNull();
    expect(input.value).toBe("字幕未保存の修正");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "編集中の字幕へ" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "表示設定" }));
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "文字サイズ" }).value).toBe("96");
    await user.click(screen.getByRole("button", { name: "表示設定を閉じる" }));
  }
  expect(api.save).not.toHaveBeenCalled();
  expect(api.setDisplay).not.toHaveBeenCalled();
});

it("keeps the monitor and correction draft available while viewing latest input or settings", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, autoPublish: false, captions: [caption] }),
    save: vi.fn().mockImplementation(request => Promise.resolve({ ...caption, text: request.text, revision: 2, human_edited: true })),
    setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "編集：字幕" }));
  const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "表示文" });
  const monitor = screen.getByRole("region", { name: "直近の入力と観客への表示" });
  await user.clear(input);
  await user.type(input, "確認した訂正文");
  expect(api.save).not.toHaveBeenCalled();
  expect(within(monitor).queryByText("確認した訂正文")).toBeNull();
  const historyViewport = screen.getByRole("region", { name: "字幕一覧" }).querySelector<HTMLDivElement>(".caption-viewport")!;
  Object.defineProperties(historyViewport, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 400 } });
  fireEvent.scroll(historyViewport);
  await user.click(screen.getByRole("button", { name: "最新へ" }));
  expect(screen.getByRole("textbox")).toBe(input);
  expect(screen.getByRole("region", { name: "直近の入力と観客への表示" })).toBe(monitor);
  await user.click(screen.getByRole("button", { name: "AI設定" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("complementary", { name: "字幕の訂正" })).toBeNull();
  expect(screen.getByRole("region", { name: "直近の入力と観客への表示" })).toBe(monitor);
  expect(within(screen.getByRole("complementary", { name: "字幕修正のAI設定" })).queryByText("確認した訂正文")).toBeNull();
  await user.click(screen.getByRole("button", { name: "AI設定を閉じる" }));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("確認した訂正文");
  expect(api.save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存して公開" }));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith(
    expect.objectContaining({ captionId: "one", text: "確認した訂正文", baseRevision: 1 }), expect.any(AbortSignal),
  ));
});

it("reveals test sending in preparation and explains its publication consequence", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [] }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn().mockResolvedValue(undefined),
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  const preparation = screen.getByText("準備", { selector: "summary span" }).closest("details")!;
  await waitFor(() => expect(preparation.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false));
  expect(preparation.open).toBe(false);
  expect(api.sendTest).not.toHaveBeenCalled();
  await user.click(within(preparation).getByText("準備", { selector: "summary span" }));
  expect(preparation.open).toBe(true);
  expect(preparation.textContent).toContain("観客");
  await user.click(within(preparation).getByRole("button", { name: "テスト字幕を送る" }));
  await waitFor(() => expect(api.sendTest).toHaveBeenCalledWith(expect.any(AbortSignal)));
});

it("protects dirty human drafts from page exit and releases the guard after discard, save and unmount", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn().mockImplementation(request => Promise.resolve({ ...caption, text: request.text, revision: 2, human_edited: true })),
    setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
  };
  const { unmount } = render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  const attemptExit = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  await user.click(await screen.findByRole("button", { name: "編集：字幕" }));
  await user.type(screen.getByRole("textbox"), "未保存");
  expect(attemptExit()).toBe(true);
  expect(api.save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "変更を破棄" }));
  expect(attemptExit()).toBe(false);
  await user.click(screen.getByRole("button", { name: "編集：字幕" }));
  await user.type(screen.getByRole("textbox"), "保存する修正");
  expect(attemptExit()).toBe(true);
  await user.click(screen.getByRole("button", { name: "保存して公開" }));
  await waitFor(() => expect(attemptExit()).toBe(false));
  expect(api.save).toHaveBeenCalledTimes(1);
  await user.type(screen.getByRole("textbox"), "次の下書き");
  expect(attemptExit()).toBe(true);
  unmount();
  expect(attemptExit()).toBe(false);
});

it("routes fullscreen controls through the audience Mediator and releases both subscriptions", async () => {
  const closeStream = vi.fn();
  const closeFullscreen = vi.fn();
  let active = false;
  let resolve!: () => void;
  const fullscreen = {
    available: true, isActive: () => active,
    subscribe: vi.fn(() => closeFullscreen),
    setActive: vi.fn((next: boolean) => new Promise<void>(done => { resolve = () => { active = next; done(); }; })),
  };
  const { unmount } = render(<AudienceRoot api={{ subscribe: () => closeStream }} fullscreen={fullscreen} />);
  const enter = screen.getByRole<HTMLButtonElement>("button", { name: "全画面" });
  fireEvent.click(enter);
  expect(enter.disabled).toBe(true);
  fireEvent.click(enter);
  expect(fullscreen.setActive).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  const exit = screen.getByRole("button", { name: "全画面を解除" });
  fireEvent.click(exit);
  expect(fullscreen.setActive).toHaveBeenLastCalledWith(false);
  await act(async () => resolve());
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "全画面" }).disabled).toBe(false);
  unmount();
  expect(closeStream).toHaveBeenCalledTimes(1);
  expect(closeFullscreen).toHaveBeenCalledTimes(1);
});

const ai: AiParameters = {
  backgroundInvalid: false,
  error: "",
  background: "",
  helpDisclosure: { id: "ai-help", open: false }, comparisonDisclosure: { id: "ai-comparison", open: false },
  connectionWarning: true, showModelSettings: true,
  connectionDescription: "選択したAIのAPIキーが未設定です。", model: "gemini-3.5-flash-lite", saveDisabled: false, saveHint: "未保存", disabled: false,
  models: [
    { id: "gemini-3.5-flash-lite", provider: "Gemini", label: "Gemini 3.5 Flash-Lite", variant: "3.5 Flash-Lite", inputPrice: "$0.30", outputPrice: "$2.50", sampleCost: "$0.31", latency: "未計測", pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing", checkedOn: "2026-10-24" },
    { id: "claude-haiku-5-5", provider: "Claude", label: "Claude Haiku 5.5", variant: "Haiku 5.5", inputPrice: "$0.10", outputPrice: "$0.50", sampleCost: "$0.07", latency: "250 ms · 1 件", pricingUrl: "https://platform.claude.com/docs/en/about-claude/pricing", checkedOn: "2026-10-24" },
  ],
};

it("switches between scroll and recent output and saves the relevant display settings", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(),
    setDisplay: vi.fn().mockImplementation(settings => Promise.resolve(settings)),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "表示設定" }));
  expect(screen.queryByRole("combobox", { name: "表示件数" })).toBeNull();
  await user.selectOptions(screen.getByRole("combobox", { name: "表示方式" }), "recent");
  const size = screen.getByRole("combobox", { name: "文字サイズ" });
  const count = screen.getByRole("combobox", { name: "表示件数" });
  const spacing = screen.getByRole("combobox", { name: "行間" });
  expect(size.closest("details")).toBeNull();
  expect(count.closest("details")).toBeNull();
  expect(spacing.closest("details")).toBeNull();
  await user.selectOptions(size, "40");
  await user.selectOptions(count, "3");
  await user.selectOptions(spacing, "2");
  await user.selectOptions(screen.getByRole("combobox", { name: "名前の表示" }), "inline");
  await user.click(screen.getByRole("button", { name: "表示設定を反映" }));
  await waitFor(() => expect(api.setDisplay).toHaveBeenCalledWith(expect.objectContaining({ font_size: 40, display_mode: "recent", history_count: 3, line_height: 2, speaker_display: "inline" }), expect.any(AbortSignal)));
  await user.click(screen.getByRole("button", { name: "表示設定を閉じる" }));
  await user.click(screen.getByRole("button", { name: "表示設定" }));
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "文字サイズ" }).value).toBe("40");
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "表示件数" }).value).toBe("3");
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "行間" }).value).toBe("2");
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "名前の表示" }).value).toBe("inline");
  await user.selectOptions(screen.getByRole("combobox", { name: "表示方式" }), "scroll");
  expect(screen.queryByRole("combobox", { name: "表示件数" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "表示設定を反映" }));
  await waitFor(() => expect(api.setDisplay).toHaveBeenLastCalledWith(expect.objectContaining({ display_mode: "scroll", history_count: 3 }), expect.any(AbortSignal)));
});

it("lets the audience read retained history during incoming captions and resume following the latest", async () => {
  let emit!: (event: AudienceEvent) => void;
  const { container } = render(<AudienceRoot api={{ subscribe(callback) { emit = callback; return () => {}; } }} />);
  const viewport = container.querySelector<HTMLDivElement>(".caption-display-captions")!;
  Object.defineProperties(viewport, { scrollHeight: { configurable: true, value: 1200 }, clientHeight: { configurable: true, value: 200 } });
  const publish = async (count: number) => act(async () => emit({ type: "stream.snapshot", snapshot: { visible: true, display: defaultDisplay,
    captions: Array.from({ length: count }, (_, index) => ({ id: String(index), text: "発話" + index, revision: 1 })) } }));
  await publish(12);
  expect(viewport.querySelectorAll("p")).toHaveLength(12);
  expect(viewport.tabIndex).toBe(0);
  viewport.scrollTop = 200;
  fireEvent.scroll(viewport);
  expect(screen.getByRole("button", { name: "最新へ" })).toBeTruthy();
  await publish(13);
  expect(viewport.querySelectorAll("p")).toHaveLength(13);
  expect(viewport.scrollTop).toBe(200);
  await userEvent.setup().click(screen.getByRole("button", { name: "最新へ" }));
  expect(viewport.scrollTop).toBe(1200);
  expect(viewport).toBe(document.activeElement);
  expect(screen.queryByRole("button", { name: "最新へ" })).toBeNull();
  viewport.scrollTop = 200;
  fireEvent.scroll(viewport);
  viewport.scrollTop = 1000;
  fireEvent.scroll(viewport);
  expect(screen.queryByRole("button", { name: "最新へ" })).toBeNull();
  await publish(14);
  expect(viewport.scrollTop).toBe(1200);
});

it("follows successive audience snapshots, including a new utterance with identical text", async () => {
  let emit!: (event: AudienceEvent) => void;
  const { container } = render(<AudienceRoot api={{ subscribe(callback) { emit = callback; return () => {}; } }} />);
  const captions = container.querySelector<HTMLDivElement>(".caption-display-captions")!;
  Object.defineProperty(captions, "scrollHeight", { configurable: true, value: 1000 });
  const snapshot = (ids: string[], text = "同じ字幕", line_height = 1.5) => ({
    type: "stream.snapshot" as const,
    snapshot: { visible: true, display: { ...defaultDisplay, display_mode: "recent" as const, history_count: 3, line_height },
      captions: ids.map(id => ({ id, revision: 1, text: text === "同じ字幕" ? text : `${text}${id}` })) },
  });
  for (let count = 1; count <= 5; count++) {
    captions.scrollTop = 150;
    await act(async () => emit(snapshot(Array.from({ length: count }, (_, index) => String(index + 1)), "字幕")));
    expect(Array.from(captions.querySelectorAll("p"), paragraph => paragraph.textContent)).toEqual(
      Array.from({ length: count }, (_, index) => `字幕${index + 1}`).slice(-3),
    );
    expect(captions.scrollTop).toBe(1000);
  }
  await act(async () => emit(snapshot(["a", "b", "c"])));
  captions.scrollTop = 150;
  await act(async () => emit(snapshot(["a", "b", "c"])));
  expect(captions.scrollTop).toBe(150);
  await act(async () => emit(snapshot(["b", "c", "d"])));
  expect(captions.scrollTop).toBe(1000);
  captions.scrollTop = 150;
  await act(async () => emit(snapshot(["b", "c", "d"], "同じ字幕", 2)));
  expect(captions.style.lineHeight).toBe("2");
  expect(captions.scrollTop).toBe(1000);
});

it("selects a model directly and saves background after toggling AI off", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption], ai: { ...defaultAi,
      models: ai.models.map(model => ({ id: model.id, label: model.label, provider: model.provider === "Gemini" ? "gemini" : "claude",
        input_usd_per_million: 1, output_usd_per_million: 1, pricing_url: model.pricingUrl, pricing_checked_on: model.checkedOn,
        configured: false, latency_samples: 0 })),
    } }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn(), setDisplay: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "AI設定" }));
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.getAllByRole("combobox")).toHaveLength(2); // publication and model
  const model = screen.getByRole("combobox", { name: "モデル" });
  expect((model as HTMLSelectElement).value).toBe("off");
  await user.selectOptions(model, "claude-haiku-5-5");
  await user.type(screen.getByRole("textbox", { name: "トークの背景" }), "写真と布の展示");
  await user.selectOptions(model, "off");
  expect(screen.queryByRole("textbox", { name: "トークの背景" })).toBeNull();
  await user.selectOptions(model, "claude-haiku-5-5");
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "トークの背景" }).value).toBe("写真と布の展示");
  expect(api.setAi).not.toHaveBeenCalled();
  vi.mocked(api.setAi).mockImplementation(settings => Promise.resolve({ ...defaultAi, settings }));
  await user.click(screen.getByRole("button", { name: "AI設定を保存" }));
  await waitFor(() => expect(api.setAi).toHaveBeenCalledWith(expect.objectContaining({ strategy: "manual", preferred_model: "claude-haiku-5-5", candidates: ["claude-haiku-5-5"], background: "写真と布の展示" }), expect.any(AbortSignal)));
});

it("saves supplementary Unicode background and retains an oversized AI-off draft", async () => {
  let routing: AiRouting = { ...defaultAi, settings: { ...defaultAi.settings, strategy: "manual", preferred_model: "gemini-3.5-flash-lite" }, selected_model: "gemini-3.5-flash-lite",
    models: ai.models.map(model => ({ id: model.id, label: model.label, provider: model.provider === "Gemini" ? "gemini" : "claude",
      input_usd_per_million: 1, output_usd_per_million: 1, pricing_url: model.pricingUrl, pricing_checked_on: model.checkedOn, configured: false, latency_samples: 0 })),
  };
  const api: OperatorApi = {
    load: vi.fn().mockImplementation(() => Promise.resolve({ visible: true, captions: [], ai: routing })),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setDisplay: vi.fn(), setConnection: vi.fn(), setDictionary: vi.fn(),
    setAi: vi.fn().mockImplementation(settings => {
      routing = { ...routing, settings, selected_model: settings.strategy === "off" ? null : settings.preferred_model };
      return Promise.resolve(routing);
    }),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "AI設定" }));
  const background = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "トークの背景" });
  const text = "𠮷".repeat(4000);
  await user.click(background); await user.paste(text);
  expect(Array.from(background.value)).toHaveLength(4000);
  await user.click(screen.getByRole("button", { name: "AI設定を保存" }));
  await waitFor(() => expect(api.setAi).toHaveBeenCalledWith(expect.objectContaining({ background: text }), expect.any(AbortSignal)));
  fireEvent.change(background, { target: { value: text + "𠮷" } });
  await user.selectOptions(screen.getByRole("combobox", { name: "モデル" }), "off");
  expect(screen.getByRole("textbox", { name: "トークの背景" })).toBe(background);
  await user.click(screen.getByRole("button", { name: "AI設定を保存" }));
  expect(api.setAi).toHaveBeenCalledTimes(1);
  expect(Array.from(background.value)).toHaveLength(4001);
  expect(screen.getByRole("alert").textContent).toContain("4,000文字以内");
  expect(background.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(background.getAttribute("aria-describedby")!)?.textContent).toContain("4,000文字以内");
  await user.clear(background);
  expect(screen.getByRole("textbox", { name: "トークの背景" })).toBe(background);
  await user.type(background, "短い背景");
  expect(document.activeElement).toBe(background);
  await user.click(screen.getByRole("button", { name: "AI設定を保存" }));
  await waitFor(() => expect(api.setAi).toHaveBeenLastCalledWith(expect.objectContaining({ background: "短い背景", strategy: "off" }), expect.any(AbortSignal)));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "トークの背景" })).toBeNull());
});

const toolbar: ToolbarParameters & { preparationHint: string } = {
  audienceHref: "/view/demo",
  helpDisclosure: { id: "publication-help", open: false }, preparationDisclosure: { id: "preparation", open: false },
  visibilityIcon: "hide",
  testDisabled: false, toggleDisabled: false, toggleLabel: "字幕を隠す", mode: "auto", modeDisabled: false,
  settingsOpen: false, aiSettingsOpen: false, dictionarySettingsOpen: false, dictionarySettingsDisabled: false, connectionSettingsOpen: false, localOutput: true, aiTitle: "AI設定", preparationHint: "自動公開中のため、テスト字幕は観客画面にも表示されます。",
};

it("emits a direct model selection and waits for explicit save", async () => {
  const handle = vi.fn(() => true);
  render(<viewHierarchy.Root handle={handle}><AiSettingsView parameters={ai} /></viewHierarchy.Root>);
  const user = userEvent.setup();
  const panel = screen.getByRole("complementary", { name: "字幕修正のAI設定" });
  expect(panel.getAttribute("aria-describedby")).toBe("ai-settings-description");
  const model = screen.getByRole<HTMLSelectElement>("combobox", { name: "モデル" });
  expect(model.value).toBe("gemini-3.5-flash-lite");
  await user.selectOptions(model, "claude-haiku-5-5");
  expect(handle).toHaveBeenLastCalledWith({ type: "ai.model.selected", modelId: "claude-haiku-5-5" });
  expect(handle).not.toHaveBeenCalledWith({ type: "ai.save.requested" });
  await user.click(screen.getByRole("button", { name: "AI設定を保存" }));
  expect(handle).toHaveBeenLastCalledWith({ type: "ai.save.requested" });
});

it("waits for parameters before revealing the optional price comparison", async () => {
  const handle = vi.fn(() => true);
  const { rerender } = render(<viewHierarchy.Root handle={handle}><AiSettingsView parameters={ai} /></viewHierarchy.Root>);
  const user = userEvent.setup();
  expect(screen.queryByRole("checkbox")).toBeNull();
  const details = screen.getByText("料金と速度の比較", { selector: "summary" }).closest("details")!;
  expect(details.open).toBe(false);
  await user.click(within(details).getByText("料金と速度の比較", { selector: "summary" }));
  expect(handle).toHaveBeenLastCalledWith({ type: "disclosure.toggled", id: "ai-comparison" });
  expect(details.open).toBe(false);
  rerender(<viewHierarchy.Root handle={handle}><AiSettingsView parameters={{ ...ai, comparisonDisclosure: { ...ai.comparisonDisclosure, open: true } }} /></viewHierarchy.Root>);
  expect(details.open).toBe(true);
  expect(within(details).getByRole("table")).toBeTruthy();
  expect(details.textContent).toContain("入力200・出力100トークン");
});

it("keeps toolbar disclosures passive and focusable while delegating their toggle", async () => {
  const handle = vi.fn(() => true);
  const { rerender } = render(<viewHierarchy.Root handle={handle}><ToolbarView parameters={toolbar} /></viewHierarchy.Root>);
  const user = userEvent.setup();
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "新着の公開" }).value).toBe("auto");
  const help = screen.getByLabelText("公開方法の説明");
  help.focus();
  expect(document.activeElement).toBe(help);
  await user.click(help);
  expect(handle).toHaveBeenLastCalledWith({ type: "disclosure.toggled", id: "publication-help" });
  expect(help.closest("details")!.open).toBe(false);
  expect(help.closest("details")!.textContent).toContain("編集した文は保存するまで観客に送られません");
  const preparation = screen.getByText("準備", { selector: "summary span" }).closest("details")!;
  expect(preparation.open).toBe(false);
  await user.click(within(preparation).getByText("準備", { selector: "summary span" }));
  expect(handle).toHaveBeenLastCalledWith({ type: "disclosure.toggled", id: "preparation" });
  expect(preparation.open).toBe(false);
  rerender(<viewHierarchy.Root handle={handle}><ToolbarView parameters={{ ...toolbar, preparationDisclosure: { ...toolbar.preparationDisclosure, open: true } }} /></viewHierarchy.Root>);
  expect(preparation.open).toBe(true);
  expect(within(preparation).getByText(toolbar.preparationHint)).toBeTruthy();
  await user.click(within(preparation).getByRole("button", { name: "テスト字幕を送る" }));
  expect(handle).toHaveBeenLastCalledWith({ type: "test.requested" });
});
