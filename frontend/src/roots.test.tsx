// @vitest-environment jsdom
import { defaultAi } from "./ai";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AudienceRoot, OperatorRoot } from "./roots";
import type { Caption, OperatorApi, Snapshot } from "./domain";

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
  await user.click(screen.getByRole("button", { name: "反映" }));
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
  await user.click(screen.getByRole("button", { name: "反映" }));
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain("入力");
  expect(api.save).not.toHaveBeenCalled();
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
