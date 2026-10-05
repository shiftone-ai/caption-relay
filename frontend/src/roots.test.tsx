// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { OperatorRoot } from "./roots";
import type { Caption, OperatorApi, Snapshot } from "./domain";

afterEach(cleanup);
const caption: Caption = { id: "one", utterance_id: "one", source_revision: 1, original: "原文", text: "字幕", revision: 1, human_edited: false, published: true, publish_eligible: true };

it("bubbles UI events to the actor and preserves the focused input across polling", async () => {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn().mockResolvedValue({ ...caption, revision: 2 }),
    setVisible: vi.fn().mockResolvedValue(false), sendTest: vi.fn().mockResolvedValue(undefined),
  };
  render(<OperatorRoot api={api} />);
  const input = await screen.findByRole("textbox");
  const user = userEvent.setup();
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
