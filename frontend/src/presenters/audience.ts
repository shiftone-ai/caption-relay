import { defaultDisplay } from "../display";
import type { AudienceSnapshot } from "../machines/audience";
import { presentCaptionDisplay, type CaptionDisplayParameters } from "./display";

export interface AudienceParameters extends CaptionDisplayParameters {
  text: string;
  fullscreenAvailable: boolean;
  fullscreenDisabled: boolean;
  fullscreenLabel: string;
  fullscreenIcon: "maximize" | "minimize";
  fullscreenError: string;
}

export function presentAudience(snapshot: AudienceSnapshot): AudienceParameters {
  const { context } = snapshot;
  const display = { ...defaultDisplay, ...context.display };
  const texts = context.visible ? context.captions.map(caption => caption.text) : [];
  return {
    ...presentCaptionDisplay(display, context.visible && !texts.length ? ["字幕を待っています"] : texts),
    text: context.visible ? (context.captions.at(-1)?.text ?? "字幕を待っています") : "",
    fullscreenAvailable: context.fullscreen.available,
    fullscreenDisabled: !snapshot.can({ type: "display.fullscreen.requested" }),
    fullscreenLabel: context.fullscreenActive ? "全画面を解除" : "全画面",
    fullscreenIcon: context.fullscreenActive ? "minimize" : "maximize",
    fullscreenError: context.fullscreenError,
  };
}
