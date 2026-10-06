import { AudioLines } from "lucide-react";
import { viewHierarchy } from "../../events/hierarchy";
import type { CaptionMonitorParameters } from "../../presenters/operator";

const { Scope } = viewHierarchy;

export function CaptionMonitorView({ parameters }: { parameters: CaptionMonitorParameters }) {
  return (
    <Scope name="caption-monitor">
      <section className="caption-monitor" aria-label="直近の入力と観客への表示">
        <section className="caption-monitor-recent" aria-label="直近3件の入力">
          <h2>直近の入力</h2>
          <ul className="caption-monitor-rows">
            {parameters.recentCaptions.map(caption => <li className="caption-monitor-row" key={caption.id}>
              <time className="caption-received-time" dateTime={caption.receivedAt} title={caption.timeDescription} aria-label={caption.timeDescription}>{caption.timeLabel}</time>
              <p className="caption-monitor-text">{caption.original}</p>
              {caption.receiving && <span role="img" aria-label="発話の確定待ち" title="発話の確定待ち"><AudioLines size={16} aria-hidden="true" /></span>}
            </li>)}
          </ul>
          {!parameters.recentCaptions.length && <p className="caption-monitor-empty">入力を待っています</p>}
        </section>
        <section className="caption-monitor-public" aria-label="観客への表示">
          <h2>{parameters.liveLabel}</h2><p>{parameters.liveText}</p>
        </section>
      </section>
    </Scope>
  );
}
