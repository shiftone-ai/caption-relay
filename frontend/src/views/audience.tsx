import type { Ref } from "react";
import { Maximize, Minimize } from "lucide-react";
import { Button } from "../components/ui/button";
import { viewHierarchy } from "../events/hierarchy";
import type { AudienceParameters } from "../presenters/audience";
import { CaptionDisplayView } from "./caption-display";

const fullscreenIcons = { maximize: Maximize, minimize: Minimize };

export function AudienceView({ parameters, screenRef }: { parameters: AudienceParameters; screenRef: Ref<HTMLElement> }) {
  const FullscreenIcon = fullscreenIcons[parameters.fullscreenIcon];
  return <viewHierarchy.Scope name="audience-screen">
    <main ref={screenRef} className="audience-screen" style={parameters.screenStyle}>
      <CaptionDisplayView parameters={parameters} captionId="caption" />
      {parameters.fullscreenAvailable && <Button variant="ghost" className="audience-fullscreen" aria-label={parameters.fullscreenLabel} title={parameters.fullscreenLabel}
        disabled={parameters.fullscreenDisabled} intent={{ type: "display.fullscreen.requested" }}><FullscreenIcon size={24} /></Button>}
      {parameters.fullscreenError && <p className="audience-error" role="status">{parameters.fullscreenError}</p>}
    </main>
  </viewHierarchy.Scope>;
}
