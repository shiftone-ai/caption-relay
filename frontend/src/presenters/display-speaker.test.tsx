// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { defaultDisplay } from "../display";
import { viewHierarchy } from "../events/hierarchy";
import { CaptionDisplayView } from "../views/caption-display";
import { presentCaptionDisplay, presentDisplayPreview } from "./display";

afterEach(cleanup);

const captions = [{ id: "one", text: "発話の本文", speaker: "山田" }, { id: "two", text: "名前なしの本文" }];

it.each(["hidden", "inline", "above"] as const)("renders %s speaker labels in audience and preview without empty name space", speaker_display => {
  const settings = { ...defaultDisplay, history_count: 3, speaker_display };
  const actual = presentCaptionDisplay(settings, captions);
  const preview = presentDisplayPreview(settings, captions).display;
  expect(preview.utterances).toEqual(actual.utterances);
  const { container } = render(<viewHierarchy.Root handle={() => false}><CaptionDisplayView parameters={actual} /></viewHierarchy.Root>);
  const labels = container.querySelectorAll<HTMLSpanElement>(".caption-speaker");
  expect(labels).toHaveLength(speaker_display === "hidden" ? 0 : 1);
  expect(container.querySelectorAll("p")[1].textContent).toBe("名前なしの本文");
  if (speaker_display !== "hidden") {
    expect(labels[0].textContent).toBe(speaker_display === "inline" ? "山田：" : "山田");
    expect(labels[0].style.display).toBe(speaker_display === "above" ? "block" : "");
  }
});

it("renders received names as text and follows a name-only correction", () => {
  const draw = (speaker: string) => <viewHierarchy.Root handle={() => false}>
    <CaptionDisplayView parameters={presentCaptionDisplay(defaultDisplay, [{ id: "one", text: "同じ本文", speaker }])} />
  </viewHierarchy.Root>;
  const { container, rerender } = render(draw("<img src=x onerror=alert(1)>"));
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".caption-speaker")?.textContent).toBe("<img src=x onerror=alert(1)>");
  const display = container.querySelector<HTMLDivElement>(".caption-display-captions")!;
  Object.defineProperty(display, "scrollHeight", { configurable: true, value: 1000 });
  display.scrollTop = 100;
  rerender(draw("山田太郎"));
  expect(container.querySelector(".caption-speaker")?.textContent).toBe("山田太郎");
  expect(display.scrollTop).toBe(1000);
});
