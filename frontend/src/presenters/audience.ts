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
  latestVisible: boolean;
}

export function presentAudience(snapshot: AudienceSnapshot): AudienceParameters {
  const { context } = snapshot;
  const display = { ...defaultDisplay, ...context.display };
  const content = presentCaptionDisplay(display, context.visible ? context.captions.length ? context.captions : [{text: "字幕を待っています"}] : []);
  return {
    ...content, followLatest: context.followLatest, focusVersion: context.latestRequest,
    scrollVersion: content.scrollVersion + ":" + context.latestRequest,
    latestVisible: display.display_mode === "scroll" && context.visible && !context.followLatest,
    text: context.visible ? (context.captions.at(-1)?.text ?? "字幕を待っています") : "",
    fullscreenAvailable: context.fullscreen.available,
    fullscreenDisabled: !snapshot.can({ type: "display.fullscreen.requested" }),
    fullscreenLabel: context.fullscreenActive ? "全画面を解除" : "全画面",
    fullscreenIcon: context.fullscreenActive ? "minimize" : "maximize",
    fullscreenError: context.fullscreenError,
  };
}
