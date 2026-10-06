// @vitest-environment jsdom
import { useSelector } from "@xstate/react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createActor, waitFor } from "xstate";
import { afterEach, expect, it, vi } from "vitest";
import { defaultAi } from "../ai";
import type { Caption, OperatorApi } from "../domain";
import { viewHierarchy } from "../events/hierarchy";
import { operatorMachine } from "../machines/operator";
import { CaptionListView } from "../views/operator/captions";
import { CaptionEditorView } from "../views/operator/editor";
import { CaptionMonitorView } from "../views/operator/monitor";
import { presentOperator } from "./operator";

const caption: Caption = { id: "one", utterance_id: "one", received_at: "2026-10-06T01:02:03Z", source_revision: 1, original: "原文", text: "保存済み", revision: 1, human_edited: false, published: true, publish_eligible: true, source_final: true };
const actors: ReturnType<typeof createActor<typeof operatorMachine>>[] = [];
afterEach(() => { cleanup(); actors.splice(0).forEach(actor => actor.stop()); vi.unstubAllGlobals(); });

async function start(captions = [caption]) {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions }),
    save: vi.fn().mockResolvedValue({ ...caption, text: "訂正済み", revision: 2, human_edited: true }),
    setVisible: vi.fn().mockResolvedValue(false), sendTest: vi.fn().mockResolvedValue(undefined),
    setPublicationMode: vi.fn().mockResolvedValue({ auto_publish: true }),
    setDisplay: vi.fn().mockImplementation(settings => Promise.resolve(settings)),
    setAi: vi.fn().mockImplementation(settings => Promise.resolve({ ...defaultAi, settings })),
  };
  const actor = createActor(operatorMachine, { input: { api } }).start();
  actors.push(actor);
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  return { actor, api };
}

function TimelineTestRoot({ actor }: { actor: ReturnType<typeof createActor<typeof operatorMachine>> }) {
  const snapshot = useSelector(actor, state => state);
  const parameters = presentOperator(snapshot);
  return <viewHierarchy.Root handle={event => {
    if (event.type === "display.fullscreen.requested") return false;
    if (!actor.getSnapshot().can(event)) return false;
    actor.send(event);
    return true;
  }}>
    <CaptionMonitorView parameters={parameters.monitor} />
    <CaptionListView parameters={parameters} />
    {parameters.editor && <CaptionEditorView row={parameters.editor} />}
  </viewHierarchy.Root>;
}

it("keeps a separate focused editor and saved history through arrivals, latest, return, and close", async () => {
  const { actor, api } = await start();
  render(<TimelineTestRoot actor={actor} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "編集：保存済み" }));
  const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "表示文" });
  expect(input.closest(".caption-row")).toBeNull();
  await user.clear(input);
  await user.type(input, "未保存の訂正");
  input.setSelectionRange(1, 3);
  const other = { ...caption, id: "two", utterance_id: "two", original: "次の入力", text: "次の候補", public_text: "次の公開文" };
  vi.mocked(api.load).mockResolvedValueOnce({ visible: true, captions: [caption, other] });
  await act(async () => {
    actor.send({ type: "refresh.requested" });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
  });
  expect(screen.getByRole("textbox")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(1);
  expect(input.selectionEnd).toBe(3);
  expect(screen.getByRole("separator", { name: "ここから新着の字幕" })).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "直近3件の入力" })).getByText("次の入力")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "観客への表示" })).getByText("次の公開文")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "最新へ · 新着 1 件" }));
  expect(screen.getByRole("textbox")).toBe(input);
  expect(input.value).toBe("未保存の訂正");
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(1);
  expect(screen.queryByRole("separator")).toBeNull();
  await user.click(screen.getByRole("button", { name: "訂正位置へ" }));
  expect(document.activeElement).toBe(input);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("textbox")).toBeNull();
  const row = screen.getByRole("article", { name: "保存済みの表示文：保存済み" });
  expect(row.getAttribute("data-dirty")).toBe("true");
  expect(within(row).getByRole("button", { name: "編集：保存済み" }).textContent).toBe("保存済み");
  expect(within(row).queryByText("未保存の訂正")).toBeNull();
  expect(row.getAttribute("aria-describedby")).toBe("caption-one-time");
  expect(within(row).getByRole("img", { name: /この行は保存済み/ }).tabIndex).toBe(0);
  await user.click(within(row).getByRole("button", { name: "編集：保存済み" }));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("未保存の訂正");
});

it("observes viewport and row reflow, follows after resize, and leaves browsing position alone", async () => {
  const observed: Element[] = [];
  const disconnect = vi.fn();
  let resize!: ResizeObserverCallback;
  let observer!: ResizeObserver;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback; observer = this as unknown as ResizeObserver; }
    observe(element: Element) { observed.push(element); }
    disconnect = disconnect;
  });
  const { actor } = await start();
  const { container, unmount } = render(<TimelineTestRoot actor={actor} />);
  const viewport = container.querySelector<HTMLDivElement>(".caption-viewport")!;
  expect(observed).toEqual([viewport, container.querySelector(".caption-history-content")]);
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 1000 });
  Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 400 });
  act(() => resize([], observer));
  expect(viewport.scrollTop).toBe(1000);
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 1600 });
  act(() => resize([], observer));
  expect(viewport.scrollTop).toBe(1600);
  await userEvent.setup().click(screen.getByRole("button", { name: "編集：保存済み" }));
  viewport.scrollTop = 200;
  const input = screen.getByRole("textbox");
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 2000 });
  act(() => resize([], observer));
  expect(viewport.scrollTop).toBe(200);
  expect(document.activeElement).toBe(input);
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it("announces save success once while ordinary refreshes keep the same editor status text", async () => {
  const { actor, api } = await start();
  const { container } = render(<TimelineTestRoot actor={actor} />);
  const receivedTime = container.querySelector<HTMLTimeElement>(".caption-row time")!;
  expect(receivedTime.dateTime).toBe(caption.received_at);
  expect(receivedTime.textContent).toMatch(/^\d{2}:\d{2}$/);
  expect(receivedTime.title).toMatch(/^受信時刻：2026\/10\/\d{2} .*03/);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "編集：保存済み" }));
  const editorTime = container.querySelector<HTMLTimeElement>(".caption-editor time")!;
  expect(editorTime.dateTime).toBe(receivedTime.dateTime);
  expect(editorTime.textContent).toBe(receivedTime.textContent);
  await user.click(screen.getByRole("button", { name: "保存して公開" }));
  const success = await screen.findByText("保存して公開しました。");
  expect(success.getAttribute("role")).toBe("status");
  vi.mocked(api.load).mockResolvedValueOnce({ visible: true, captions: [{ ...caption, text: "訂正済み", revision: 2 }] });
  await act(async () => {
    actor.send({ type: "refresh.requested" });
    await waitFor(actor, state => state.matches({ ready: "idle" }));
  });
  expect(screen.getByText("保存して公開しました。")).toBe(success);
  expect(container.querySelector(".caption-row time")).toBe(receivedTime);
  expect(editorTime.dateTime).toBe(caption.received_at);
  await user.type(screen.getByRole("textbox"), "続き");
  expect(success.textContent).toBe("");
});
