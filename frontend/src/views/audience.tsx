import { useEffect, useRef, type Ref } from "react";
import { Maximize, Minimize } from "lucide-react";
import { Button } from "../components/ui/button";
import { viewHierarchy } from "../events/hierarchy";
import type { AudienceParameters } from "../presenters/audience";

const fullscreenIcons = { maximize: Maximize, minimize: Minimize };

export function AudienceView({ parameters, screenRef }: { parameters: AudienceParameters; screenRef: Ref<HTMLElement> }) {
  const captions = useRef<HTMLDivElement>(null);
  const FullscreenIcon = fullscreenIcons[parameters.fullscreenIcon];
  useEffect(() => { if (captions.current) captions.current.scrollTop = captions.current.scrollHeight; }, [parameters.texts]);
  return <viewHierarchy.Scope name="audience-screen">
    <main ref={screenRef} className="audience-screen" style={parameters.screenStyle}>
      <div className="audience-frame" data-aspect={parameters.aspect} data-position={parameters.position}>
        <div ref={captions} id="caption" className="audience-captions" style={parameters.captionStyle}>
          {parameters.texts.map((text, index) => <p key={index}>{text}</p>)}
        </div>
      </div>
      {parameters.fullscreenAvailable && <Button variant="ghost" className="audience-fullscreen" aria-label={parameters.fullscreenLabel} title={parameters.fullscreenLabel}
        disabled={parameters.fullscreenDisabled} intent={{ type: "display.fullscreen.requested" }}><FullscreenIcon size={24} /></Button>}
      {parameters.fullscreenError && <p className="audience-error" role="status">{parameters.fullscreenError}</p>}
    </main>
  </viewHierarchy.Scope>;
}
