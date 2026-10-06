// @vitest-environment jsdom
import { defaultAi } from "./ai";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AudienceRoot, OperatorRoot } from "./roots";
import type { Caption, OperatorApi, Snapshot } from "./domain";
import { viewHierarchy } from "./events/hierarchy";
import type { AiParameters, ToolbarParameters } from "./presenters/operator";
import { AiSettingsView } from "./views/operator/ai-settings";
import { ToolbarView } from "./views/operator/toolbar";

afterEach(cleanup);
const caption: Caption = { id: "one", utterance_id: "one", source_revision: 1, original: "原文", text: "字幕", revision: 1, human_edited: false, published: true, publish_eligible: true, source_final: true };

it("bubbles UI events to the actor and preserves the focused input across polling", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn().mockResolvedValue({ ...caption, revision: 2 }),
    setVisible: vi.fn().mockResolvedValue(false), setPublicationMode: vi.fn().mockResolvedValue({ auto_publish: true }), setDisplay: vi.fn().mockImplementation(settings => Promise.resolve(settings)),
    setAi: vi.fn().mockImplementation(settings => Promise.resolve({ ...defaultAi, settings })),
    sendTest: vi.fn().mockResolvedValue(undefined),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "字幕 1 を編集" }));
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
    setAi: vi.fn().mockImplementation(settings => Promise.resolve({ ...defaultAi, settings })),
    sendTest: vi.fn().mockResolvedValue(undefined),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "字幕 2 を編集" }));
  const second = screen.getByRole<HTMLTextAreaElement>("textbox");
  await user.clear(second);
  await user.type(second, "二行目の修正");
  expect(api.save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存して公開" }));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith(
    expect.objectContaining({ captionId: "two", text: "二行目の修正", baseRevision: 1 }), expect.any(AbortSignal),
  ));
  expect(second.readOnly).toBe(true);
  await user.click(screen.getByRole("button", { name: "字幕 1 を編集" }));
  const first = screen.getByRole<HTMLTextAreaElement>("textbox");
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(first.readOnly).toBe(false);
  await user.clear(first);
  await user.type(first, "一行目の下書き");
  fireEvent.keyDown(first, { key: "Enter", metaKey: true });
  expect(api.save).toHaveBeenCalledTimes(1);
  await act(async () => { resolve({ ...other, text: "二行目の修正", revision: 2, human_edited: true }); });
  expect(first.value).toBe("一行目の下書き");
  await user.click(screen.getByRole("button", { name: "字幕 2 を編集" }));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("二行目の修正");
  await user.click(screen.getByRole("button", { name: "字幕 1 を編集" }));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("一行目の下書き");
  await user.click(screen.getByRole("button", { name: "変更を破棄" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  await user.click(screen.getByRole("button", { name: "字幕 1 を編集" }));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("字幕");
});

it("shows blank-caption validation beside the input and requires explicit saving", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn(), setVisible: vi.fn(), sendTest: vi.fn(),
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "字幕 1 を編集" }));
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
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "字幕 1 を編集" });
  const aiTrigger = screen.getByRole("button", { name: "AI設定" });
  const displayTrigger = screen.getByRole("button", { name: "表示設定" });
  await user.click(aiTrigger);
  expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "AIの選び方" }));
  const aiPanel = screen.getByRole("complementary", { name: "字幕修正のAI設定" });
  expect(aiPanel.getAttribute("aria-describedby")).toBe("ai-settings-description");
  expect(screen.getByText("接続前の設定です。AIへの送信はまだ行いません。")).toBeTruthy();
  await user.click(displayTrigger);
  expect(screen.queryByRole("complementary", { name: "字幕修正のAI設定" })).toBeNull();
  const palette = screen.getByRole("combobox", { name: "配色" });
  expect(document.activeElement).toBe(palette);
  fireEvent.keyDown(palette, { key: "Escape", isComposing: true });
  expect(screen.getByRole("complementary", { name: "観客画面の表示設定" })).toBeTruthy();
  fireEvent.keyDown(palette, { key: "Escape" });
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
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "字幕 1 を編集" });
  await user.click(screen.getByRole("button", { name: "AI設定" }));
  const firstField = screen.getByRole<HTMLSelectElement>("combobox", { name: "AIの選び方" });
  await user.tab();
  const focusedField = document.activeElement;
  expect(focusedField).not.toBe(firstField);
  expect(focusedField?.tagName).toBe("SELECT");
  await waitFor(() => expect(api.load).toHaveBeenCalledTimes(2), { timeout: 3000 });
  await act(async () => { resolve({ visible: true, captions: [{ ...caption, text: "背景で受信した文" }] }); });
  expect(document.activeElement).toBe(focusedField);
});

it("keeps the monitor and correction draft available while viewing latest input or settings", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, autoPublish: false, captions: [caption] }),
    save: vi.fn().mockImplementation(request => Promise.resolve({ ...caption, text: request.text, revision: 2, human_edited: true })),
    setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setDisplay: vi.fn(), setAi: vi.fn(),
  };
  render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "字幕 1 を編集" }));
  const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "字幕 1 の表示文" });
  const monitor = screen.getByRole("region", { name: "直近の入力と観客への表示" });
  await user.clear(input);
  await user.type(input, "確認した訂正文");
  expect(api.save).not.toHaveBeenCalled();
  expect(within(monitor).queryByText("確認した訂正文")).toBeNull();
  await user.click(screen.getByRole("button", { name: "最新へ" }));
  expect(screen.getByRole("textbox")).toBe(input);
  expect(screen.getByRole("region", { name: "直近の入力と観客への表示" })).toBe(monitor);
  await user.click(screen.getByRole("button", { name: "AI設定" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("complementary", { name: "字幕 1 の訂正" })).toBeNull();
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
    setPublicationMode: vi.fn(), setDisplay: vi.fn(), setAi: vi.fn(),
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
    setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setDisplay: vi.fn(), setAi: vi.fn(),
  };
  const { unmount } = render(<OperatorRoot api={api} />);
  const user = userEvent.setup();
  const attemptExit = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  await user.click(await screen.findByRole("button", { name: "字幕 1 を編集" }));
  await user.type(screen.getByRole("textbox"), "未保存");
  expect(attemptExit()).toBe(true);
  expect(api.save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "変更を破棄" }));
  expect(attemptExit()).toBe(false);
  await user.click(screen.getByRole("button", { name: "字幕 1 を編集" }));
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

const ai: AiParameters & { preferredLabel: string; preferredHint: string; selectionHeading: string; strategyHint: string } = {
  strategy: "speed", preferredModel: "gemini-3.1-flash-lite", saveDisabled: false, saveHint: "未保存の設定があります", disabled: false,
  selectedLabel: "Claude Haiku 4.5", selectionHeading: "保存済みの設定による選択先", selectionNote: "保存した設定で応答時間を比較した結果です。",
  preferredLabel: "比較できないときのAI", preferredHint: "全候補が未計測の場合や同じ条件の場合に使います。候補からは外せません。",
  strategyHint: "未計測の候補は速度比較から除き、全候補が未計測なら下のAIを使います。",
  strategies: [{ value: "manual", label: "AIを指定" }, { value: "cost", label: "費用を優先" }, { value: "speed", label: "実測の速度を優先" }],
  models: [
    { id: "gemini-3.1-flash-lite", provider: "Gemini", label: "Gemini 3.1 Flash-Lite", variant: "3.1 Flash-Lite", inputPrice: "$0.25", outputPrice: "$1.50", sampleCost: "$0.20", latency: "未計測", selected: true, disabled: true, pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing", checkedOn: "2026-10-05" },
    { id: "claude-haiku-4-5", provider: "Claude", label: "Claude Haiku 4.5", variant: "Haiku 4.5", inputPrice: "$1.00", outputPrice: "$5.00", sampleCost: "$0.70", latency: "250 ms · 1 件", selected: true, disabled: false, pricingUrl: "https://platform.claude.com/docs/en/about-claude/pricing", checkedOn: "2026-10-05" },
  ],
};

const toolbar: ToolbarParameters & { preparationHint: string } = {
  testDisabled: false, toggleDisabled: false, toggleLabel: "字幕を隠す", mode: "auto", modeDisabled: false,
  settingsOpen: false, aiSettingsOpen: false, aiTitle: "AI設定", preparationHint: "自動公開中のため、テスト字幕は観客画面にも表示されます。",
};

it("distinguishes the saved AI route from the draft fallback choice and exposes its explanation", async () => {
  const handle = vi.fn(() => true);
  render(<viewHierarchy.Root handle={handle}><AiSettingsView parameters={ai} /></viewHierarchy.Root>);
  const user = userEvent.setup();
  const panel = screen.getByRole("complementary", { name: "字幕修正のAI設定" });
  expect(panel.getAttribute("aria-describedby")).toBe("ai-settings-description");
  expect(screen.getByText("保存済みの設定による選択先").nextElementSibling?.textContent).toBe("Claude Haiku 4.5");
  const preferred = screen.getByRole<HTMLSelectElement>("combobox", { name: "比較できないときのAI" });
  expect(preferred.value).toBe("gemini-3.1-flash-lite");
  expect(screen.getByText(ai.preferredHint)).toBeTruthy();
  expect(preferred.getAttribute("aria-describedby")).toBe("ai-preferred-hint");
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "AIの選び方" }).getAttribute("aria-describedby")).toBe("ai-strategy-hint");
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Geminiを候補に含める" }).disabled).toBe(true);
  await user.selectOptions(preferred, "claude-haiku-4-5");
  expect(handle).toHaveBeenLastCalledWith({ type: "ai.preferred.selected", modelId: "claude-haiku-4-5" });
  expect(handle).not.toHaveBeenCalledWith({ type: "ai.save.requested" });
  await user.click(screen.getByRole("button", { name: "AI設定を保存" }));
  expect(handle).toHaveBeenLastCalledWith({ type: "ai.save.requested" });
});

it("keeps AI candidate controls visible and reveals detailed price assumptions on request", async () => {
  render(<viewHierarchy.Root handle={() => true}><AiSettingsView parameters={ai} /></viewHierarchy.Root>);
  const user = userEvent.setup();
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  const details = screen.getByText("料金と速度の比較", { selector: "summary" }).closest("details")!;
  expect(details.open).toBe(false);
  await user.click(within(details).getByText("料金と速度の比較", { selector: "summary" }));
  expect(details.open).toBe(true);
  expect(within(details).getByRole("table")).toBeTruthy();
  expect(details.textContent).toContain("入力200・出力100トークン");
});

it("keeps preparation and publication help focusable and reveals their native disclosures", async () => {
  const handle = vi.fn(() => true);
  render(<viewHierarchy.Root handle={handle}><ToolbarView parameters={toolbar} /></viewHierarchy.Root>);
  const user = userEvent.setup();
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "新着の公開" }).value).toBe("auto");
  const help = screen.getByLabelText("公開方法の説明");
  help.focus();
  expect(document.activeElement).toBe(help);
  await user.click(help);
  expect(help.closest("details")!.open).toBe(true);
  expect(help.closest("details")!.textContent).toContain("編集した文は保存するまで観客に送られません");
  const preparation = screen.getByText("準備", { selector: "summary span" }).closest("details")!;
  expect(preparation.open).toBe(false);
  await user.click(within(preparation).getByText("準備", { selector: "summary span" }));
  expect(preparation.open).toBe(true);
  expect(within(preparation).getByText(toolbar.preparationHint)).toBeTruthy();
  await user.click(within(preparation).getByRole("button", { name: "テスト字幕を送る" }));
  expect(handle).toHaveBeenLastCalledWith({ type: "test.requested" });
});
