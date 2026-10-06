import { useEffect, useRef } from "react";
import { viewHierarchy } from "../events/hierarchy";
import type { CaptionDisplayParameters } from "../presenters/display";

export function CaptionDisplayView({ parameters, captionId }: { parameters: CaptionDisplayParameters; captionId?: string }) {
  const captions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = captions.current;
    if (!element) return;
    const scrollToLatest = () => { element.scrollTop = element.scrollHeight; };
    scrollToLatest();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(scrollToLatest);
    observer.observe(element);
    return () => observer.disconnect();
  }, [parameters.texts, parameters.captionStyle, parameters.frameStyle]);
  return <viewHierarchy.Scope name="caption-display">
    <div className="caption-display" style={parameters.screenStyle}>
      <div className="caption-display-frame" data-aspect={parameters.aspect} data-position={parameters.position} style={parameters.frameStyle}>
        <div ref={captions} id={captionId} className="caption-display-captions" style={parameters.captionStyle}>
          {parameters.texts.map((text, index) => <p key={index} style={parameters.paragraphStyle}>{text}</p>)}
        </div>
      </div>
    </div>
  </viewHierarchy.Scope>;
}
