// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { operatorHierarchy } from "./hierarchy";
import type { OperatorEvent } from "../domain";

const { Root, Scope, useBubble } = operatorHierarchy;
afterEach(cleanup);

it("requires a Root when mounting a component scope", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(() => render(<Scope name="orphan"><span>字幕</span></Scope>))
      .toThrow("A component must be mounted under Root");
  } finally {
    consoleError.mockRestore();
  }
});

it("starts at the component's own scope and stops before Root when its parent handles the event", () => {
  const visited: string[] = [];
  const event: OperatorEvent = { type: "caption.save.requested", captionId: "one" };
  const root = vi.fn(() => { visited.push("Root"); return true; });
  const sibling = vi.fn(() => true);
  render(
    <Root handle={root}>
      <Scope name="list" handle={() => { visited.push("list"); return true; }}>
        <Scope name="row:one" handle={() => { visited.push("row:one"); return false; }}>
          {emit => <button onClick={() => emit(event)}>反映</button>}
        </Scope>
        <Scope name="row:two" handle={sibling}><span>別の字幕</span></Scope>
      </Scope>
    </Root>,
  );
  fireEvent.click(screen.getByRole("button", { name: "反映" }));
  expect(visited).toEqual(["row:one", "list"]);
  expect(root).not.toHaveBeenCalled();
  expect(sibling).not.toHaveBeenCalled();
});

it("keeps the DOM and routes both emitters and descendants through the updated parent", () => {
  const first = vi.fn(() => true);
  const second = vi.fn(() => true);
  function Descendant() {
    const emit = useBubble();
    return <button onClick={() => emit({ type: "test.requested" })}>テスト字幕</button>;
  }
  function Screen({ handle }: { handle: (event: OperatorEvent) => boolean }) {
    return (
      <Root handle={handle}>
        <Scope name="toolbar">
          {emit => <>
            <button onClick={() => emit({ type: "visibility.toggle.requested" })}>表示切替</button>
            <Descendant />
          </>}
        </Scope>
      </Root>
    );
  }
  const { rerender } = render(<Screen handle={first} />);
  const toggle = screen.getByRole("button", { name: "表示切替" });
  fireEvent.click(toggle);
  expect(first).toHaveBeenCalledWith({ type: "visibility.toggle.requested" });
  rerender(<Screen handle={second} />);
  expect(screen.getByRole("button", { name: "表示切替" })).toBe(toggle);
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "テスト字幕" }));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second.mock.calls).toEqual([
    [{ type: "visibility.toggle.requested" }], [{ type: "test.requested" }],
  ]);
});
