import { describe, expect, it } from "vitest";
import { EventNode } from "./chain";

describe("event chain", () => {
  it("visits the emitting component, its parent and Root in order", () => {
    const visited: string[] = [];
    const root = EventNode.root<string>(() => { visited.push("Root"); return true; });
    const parent = root.child("list", () => { visited.push("list"); return false; });
    const row = parent.child("row", () => { visited.push("row"); return false; });
    expect(row.bubble("save")).toBe(true);
    expect(visited).toEqual(["row", "list", "Root"]);
  });

  it("stops when an ancestor consumes the event", () => {
    const visited: string[] = [];
    const root = EventNode.root<string>(() => { visited.push("Root"); return true; });
    const row = root.child("list", () => { visited.push("list"); return true; }).child("row");
    expect(row.bubble("save")).toBe(true);
    expect(visited).toEqual(["list"]);
  });

  it("returns false when the entire chain declines an event", () => {
    expect(EventNode.root(() => false).child("row").bubble("unknown")).toBe(false);
  });
});
