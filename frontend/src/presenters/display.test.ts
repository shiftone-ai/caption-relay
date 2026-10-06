import { expect, it } from "vitest";
import { defaultDisplay } from "../display";
import { presentCaptionDisplay, presentDisplayPreview } from "./display";

const savedTexts = Array.from({ length: 12 }, (_, index) => `${index + 1}件目の字幕。` + "長い日本語の説明が画面の幅に合わせて折り返されます。".repeat(4));

function drawnPixels(value: number | string | undefined, width: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.endsWith("cqw")) return Number.parseFloat(value) * width / 100;
  throw new Error("Expected a dimension expressed in pixels or container width");
}

function fittedDimension(value: number | string | undefined, width: number, height: number, axis: "width" | "height"): number {
  if (value === "100%") return axis === "width" ? width : height;
  const terms = String(value).match(/[\d.]+cq[wh]/g);
  if (!terms || terms.length !== 2) throw new Error("Expected a frame fitted to its container");
  return Math.min(...terms.map(term => Number.parseFloat(term) / 100 * (term.endsWith("cqw") ? width : height)));
}

it("scales typography, padding and utterance spacing together against the reference viewport", () => {
  for (const font_size of [24, 96]) {
    for (const padding of [0, 96]) {
      for (const line_height of [1.25, 2]) {
        const settings = { ...defaultDisplay, font_size, padding, line_height };
        const actual = presentCaptionDisplay(settings, savedTexts);
        const preview = presentDisplayPreview(settings, savedTexts).display;
        for (const field of ["fontSize", "padding", "gap"] as const) {
          expect(drawnPixels(preview.captionStyle[field], 1280)).toBeCloseTo(drawnPixels(actual.captionStyle[field], 1280));
          expect(drawnPixels(preview.captionStyle[field], 256)).toBeCloseTo(drawnPixels(actual.captionStyle[field], 1280) / 5);
        }
        const actualLineHeight = drawnPixels(actual.captionStyle.fontSize, 1280) * Number(actual.captionStyle.lineHeight);
        const previewLineHeight = drawnPixels(preview.captionStyle.fontSize, 256) * Number(preview.captionStyle.lineHeight);
        expect(previewLineHeight).toBeCloseTo(actualLineHeight / 5);
        const actualTextWidth = 1280 - padding * 2;
        const previewTextWidth = 256 - drawnPixels(preview.captionStyle.padding, 256) * 2;
        expect(previewTextWidth / drawnPixels(preview.captionStyle.fontSize, 256))
          .toBeCloseTo(actualTextWidth / font_size);
      }
    }
  }
});

it("changes the number of characters and lines that fit when typography settings change", () => {
  const small = presentDisplayPreview({ ...defaultDisplay, font_size: 24, padding: 0, line_height: 1.25 }, savedTexts).display;
  const large = presentDisplayPreview({ ...defaultDisplay, font_size: 96, padding: 96, line_height: 2 }, savedTexts).display;
  const charactersPerLine = (parameters: typeof small) =>
    (256 - drawnPixels(parameters.captionStyle.padding, 256) * 2) / drawnPixels(parameters.captionStyle.fontSize, 256);
  const linesInFrame = (parameters: typeof small) =>
    (160 - drawnPixels(parameters.captionStyle.padding, 256) * 2) /
    (drawnPixels(parameters.captionStyle.fontSize, 256) * Number(parameters.captionStyle.lineHeight));
  expect(charactersPerLine(small)).toBeGreaterThan(charactersPerLine(large) * 4);
  expect(linesInFrame(small)).toBeGreaterThan(linesInFrame(large) * 6);
});

it("uses the same color, typeface, weight and alignment in audience output and preview", () => {
  for (const font of ["sans", "serif", "mono"] as const) {
    const settings = { ...defaultDisplay, font, background: "#ffffff", foreground: "#171717", font_weight: "normal" as const, align: "center" as const };
    const actual = presentCaptionDisplay(settings, savedTexts);
    const preview = presentDisplayPreview(settings, savedTexts).display;
    expect(preview.screenStyle).toEqual(actual.screenStyle);
    expect(preview.screenStyle).toMatchObject({ background: "#ffffff", color: "#171717" });
    expect(preview.captionStyle.fontFamily).toBe(actual.captionStyle.fontFamily);
    expect(preview.captionStyle.fontWeight).toBe("normal");
    expect(preview.captionStyle.textAlign).toBe("center");
  }
  expect(new Set(["sans", "serif", "mono"].map(font => presentCaptionDisplay({ ...defaultDisplay, font: font as "sans" | "serif" | "mono" }, []).captionStyle.fontFamily)).size).toBe(3);
});

it("fits 16:9 inside either landscape or portrait containers and scales the clipping boundary", () => {
  for (const [width, height] of [[1280, 800], [800, 1280]]) {
    const settings = { ...defaultDisplay, aspect: "16:9" as const };
    const actual = presentCaptionDisplay(settings, savedTexts);
    const preview = presentDisplayPreview(settings, savedTexts).display;
    const frameWidth = fittedDimension(actual.frameStyle.width, width, height, "width");
    const frameHeight = fittedDimension(actual.frameStyle.height, width, height, "height");
    expect(frameWidth).toBeLessThanOrEqual(width);
    expect(frameHeight).toBeLessThan(height);
    expect(frameWidth / frameHeight).toBeCloseTo(16 / 9);
    expect(fittedDimension(preview.frameStyle.width, width / 5, height / 5, "width")).toBeCloseTo(frameWidth / 5);
    expect(fittedDimension(preview.frameStyle.height, width / 5, height / 5, "height")).toBeCloseTo(frameHeight / 5);
    const window = presentCaptionDisplay({ ...settings, aspect: "window" }, savedTexts);
    expect(fittedDimension(window.frameStyle.width, width, height, "width")).toBe(width);
    expect(fittedDimension(window.frameStyle.height, width, height, "height")).toBe(height);
  }
});

it("puts captions at the selected vertical position without changing text projection", () => {
  const positions = ["top", "center", "bottom"] as const;
  const displays = positions.map(position => presentDisplayPreview({ ...defaultDisplay, position }, savedTexts).display);
  expect(new Set(displays.map(display => display.frameStyle.justifyContent)).size).toBe(3);
  for (let index = 0; index < positions.length; index++) {
    expect(displays[index].frameStyle.justifyContent).toBe(presentCaptionDisplay({ ...defaultDisplay, position: positions[index] }, savedTexts).frameStyle.justifyContent);
    expect(displays[index].texts).toEqual([savedTexts.at(-1)]);
  }
});

it("slices the last 1, 3 or 10 saved utterances in the same order in audience output and preview", () => {
  for (const history_count of [1, 3, 10]) {
    const settings = { ...defaultDisplay, history_count };
    const preview = presentDisplayPreview(settings, savedTexts);
    expect(preview.display.texts).toEqual(savedTexts.slice(-history_count));
    expect(preview.display.texts).toEqual(presentCaptionDisplay(settings, savedTexts).texts);
    expect(preview.sourceLabel).toContain("保存済み");
  }
});

it("provides clearly labelled long Japanese samples when saved history cannot demonstrate the settings", () => {
  for (const history_count of [1, 3, 10]) {
    const preview = presentDisplayPreview({ ...defaultDisplay, history_count }, ["短い字幕"]);
    expect(preview.display.texts).toHaveLength(history_count);
    expect(preview.display.texts.every(text => text.length >= 60)).toBe(true);
    expect(preview.sourceLabel).toContain("表示例");
    expect(preview.sourceLabel).toContain("配信されません");
    expect(preview.viewportLabel).toContain("1280 × 800");
    expect(preview.scaleLabel).toContain("縮小");
  }
  expect(presentDisplayPreview({ ...defaultDisplay, history_count: 10 }, savedTexts.slice(-2)).sourceLabel).toContain("表示例");
});
