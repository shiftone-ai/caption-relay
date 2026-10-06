// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { viewHierarchy } from "./hierarchy";
import type { ViewEvent } from "../domain";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import type { ComponentProps } from "react";

const { Root, Scope, useBubble } = viewHierarchy;
afterEach(cleanup);

it("requires Root for shared controls and rejects nested roots", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(() => render(<Button intent={{ type: "test.requested" }}>テスト</Button>)).toThrow("under Root");
    expect(() => render(<Textarea change={text => ({ type: "caption.draft.changed", captionId: "one", text })}
      keypress={key => ({ type: "caption.editor.keypressed", captionId: "one", ...key })} />)).toThrow("under Root");
    expect(() => render(<Root handle={() => true}><Root handle={() => true}><span /></Root></Root>)).toThrow("Root must not be nested");
  } finally { consoleError.mockRestore(); }
});

it("starts a shared button at its own node and traverses its owning component's parents", () => {
  let path: string[] = [];
  const root = vi.fn(() => true);
  function Probe(props: ComponentProps<"button">) {
    let node: ReturnType<typeof viewHierarchy.useNode> | null = viewHierarchy.useNode();
    path = [];
    while (node) { path.push(node.name); node = node.parent; }
    return <button {...props}>保存</button>;
  }
  render(<Root handle={root}><Scope name="screen"><Scope name="list"><Scope name="row:one">
    <Button asChild intent={{ type: "caption.save.requested", captionId: "one" }}><Probe /></Button>
  </Scope></Scope></Scope></Root>);
  expect(path).toEqual(["button", "row:one", "list", "screen", "Root"]);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(root).toHaveBeenCalledWith({ type: "caption.save.requested", captionId: "one" });
});

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
  const event: ViewEvent = { type: "caption.save.requested", captionId: "one" };
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
  function Screen({ handle }: { handle: (event: ViewEvent) => boolean }) {
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
