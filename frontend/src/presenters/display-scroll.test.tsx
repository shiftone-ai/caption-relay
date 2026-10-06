// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { defaultDisplay } from "../display";
import { viewHierarchy } from "../events/hierarchy";
import { CaptionDisplayView } from "../views/caption-display";
import { presentDisplayPreview } from "./display";

afterEach(cleanup);

it("retains a manually inspected preview position through identical polling projections", () => {
  const draw = (texts: string[]) => <viewHierarchy.Root handle={() => false}>
    <CaptionDisplayView parameters={presentDisplayPreview({ ...defaultDisplay, history_count: 3 }, texts).display} />
  </viewHierarchy.Root>;
  const { container, rerender } = render(draw(["短い字幕"]));
  const preview = container.querySelector<HTMLDivElement>(".caption-display-captions")!;
  Object.defineProperty(preview, "scrollHeight", { configurable: true, value: 1000 });
  preview.scrollTop = 150;
  rerender(draw(["短い字幕"]));
  expect(preview.scrollTop).toBe(150);
  rerender(draw(Array(3).fill("新しい長文の字幕。".repeat(12))));
  expect(preview.scrollTop).toBe(1000);
});
