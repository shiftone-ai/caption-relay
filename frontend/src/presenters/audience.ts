import { defaultDisplay, displayFonts } from "../display";
import type { DisplaySettings } from "../domain";
import type { CSSProperties } from "react";
import type { AudienceSnapshot } from "../machines/audience";

export interface AudienceParameters {
  text: string;
  texts: string[];
  screenStyle: CSSProperties;
  captionStyle: CSSProperties;
  aspect: DisplaySettings["aspect"];
  position: DisplaySettings["position"];
  fullscreenAvailable: boolean;
  fullscreenDisabled: boolean;
  fullscreenLabel: string;
  fullscreenIcon: "maximize" | "minimize";
  fullscreenError: string;
}

export function presentAudience(snapshot: AudienceSnapshot): AudienceParameters {
  const { context } = snapshot;
  const display = { ...defaultDisplay, ...context.display };
  const texts = context.visible ? context.captions.slice(-display.history_count).map(caption => caption.text) : [];
  return {
    text: context.visible ? (context.captions.at(-1)?.text ?? "字幕を待っています") : "",
    texts: context.visible && !texts.length ? ["字幕を待っています"] : texts,
    screenStyle: { background: display.background, color: display.foreground },
    captionStyle: { fontFamily: displayFonts[display.font], fontSize: display.font_size, fontWeight: display.font_weight,
      lineHeight: display.line_height, padding: display.padding, textAlign: display.align },
    aspect: display.aspect, position: display.position,
    fullscreenAvailable: context.fullscreen.available,
    fullscreenDisabled: !snapshot.can({ type: "display.fullscreen.requested" }),
    fullscreenLabel: context.fullscreenActive ? "全画面を解除" : "全画面",
    fullscreenIcon: context.fullscreenActive ? "minimize" : "maximize",
    fullscreenError: context.fullscreenError,
  };
}
