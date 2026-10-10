import { useEffect, useRef } from "react";
import { viewHierarchy } from "../events/hierarchy";
import type { CaptionDisplayParameters } from "../presenters/display";

export function CaptionDisplayView({ parameters, captionId }: { parameters: CaptionDisplayParameters; captionId?: string }) {
  const captions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (parameters.focusVersion > 0) captions.current?.focus({ preventScroll: true });
  }, [parameters.focusVersion]);
  useEffect(() => {
    const element = captions.current;
    if (!element || !parameters.followLatest) return;
    const scrollToLatest = () => { element.scrollTop = element.scrollHeight; };
    scrollToLatest();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(scrollToLatest);
    observer.observe(element);
    return () => observer.disconnect();
  }, [parameters.scrollVersion, parameters.followLatest]);
  return <viewHierarchy.Scope name="caption-display">
    {emit =>
    <div className="caption-display" style={parameters.screenStyle}>
      <div className="caption-display-frame" data-aspect={parameters.aspect} data-position={parameters.position} style={parameters.frameStyle}>
        <div ref={captions} id={captionId} className="caption-display-captions" style={parameters.captionStyle}
          tabIndex={parameters.keyboardScrollable ? 0 : undefined} aria-label={parameters.keyboardScrollable ? "字幕" : undefined}
          onScroll={event => emit({ type: "display.scrolled", scrollHeight: event.currentTarget.scrollHeight,
            clientHeight: event.currentTarget.clientHeight, scrollTop: event.currentTarget.scrollTop })}>
          {parameters.utterances.map(caption => <p key={caption.id} style={parameters.paragraphStyle}>
            {caption.speakerLabel && <span className="caption-speaker" style={parameters.speakerStyle}>{caption.speakerLabel}</span>}{caption.text}
          </p>)}
        </div>
      </div>
    </div>
    }
  </viewHierarchy.Scope>;
}
