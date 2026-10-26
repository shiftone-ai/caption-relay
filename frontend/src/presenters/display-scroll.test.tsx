// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { defaultDisplay } from "../display";
import { viewHierarchy } from "../events/hierarchy";
import { CaptionDisplayView } from "../views/caption-display";
import { presentCaptionDisplay, presentDisplayPreview } from "./display";

afterEach(cleanup);

it("exposes public caption additions and corrections as a log without making previews live", () => {
  const draw = (text: string) => <viewHierarchy.Root handle={() => false}>
    <CaptionDisplayView captionId="caption" parameters={presentCaptionDisplay(defaultDisplay, [{ id: "one", text }])} />
    <CaptionDisplayView parameters={presentDisplayPreview(defaultDisplay, [{ id: "one", text }]).display} />
  </viewHierarchy.Root>;
  const { rerender } = render(draw("公開字幕"));
  const log = screen.getByRole("log", { name: "字幕" });
  expect(screen.getAllByRole("log")).toHaveLength(1);
  expect(log.getAttribute("aria-relevant")).toBe("additions text");
  const paragraph = within(log).getByText("公開字幕");
  rerender(draw("訂正した公開字幕"));
  expect(within(log).getByText("訂正した公開字幕")).toBe(paragraph);
});

it("retains a manually inspected preview position through identical polling projections", () => {
  const draw = (texts: string[], latestCaptionId = "one") => <viewHierarchy.Root handle={() => false}>
    <CaptionDisplayView parameters={presentDisplayPreview({ ...defaultDisplay, history_count: 3 }, texts.map((text, index) => ({ text, id: latestCaptionId + index }))).display} />
  </viewHierarchy.Root>;
  const { container, rerender } = render(draw(["短い字幕"]));
  const preview = container.querySelector<HTMLDivElement>(".caption-display-captions")!;
  Object.defineProperty(preview, "scrollHeight", { configurable: true, value: 1000 });
  preview.scrollTop = 150;
  rerender(draw(["短い字幕"]));
  expect(preview.scrollTop).toBe(150);
  rerender(draw(Array(3).fill("新しい長文の字幕。".repeat(12))));
  expect(preview.scrollTop).toBe(1000);
  preview.scrollTop = 150;
  rerender(draw(Array(3).fill("新しい長文の字幕。".repeat(12)), "two"));
  expect(preview.scrollTop).toBe(1000);
});
