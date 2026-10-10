import { memo, useEffect, useRef } from "react";
import { ArrowDown, Cable, Eye, EyeOff, FileText, LoaderCircle, Pencil, PencilLine, Sparkles, Undo2, UserRoundPen } from "lucide-react";
import { Button } from "../../components/ui/button";
import { viewHierarchy } from "../../events/hierarchy";
import type { OperatorParameters, RowParameters } from "../../presenters/operator";

const { Scope } = viewHierarchy;
const sourceIcons = { saving: LoaderCircle, unsaved: PencilLine, human: UserRoundPen, ai: Sparkles, original: FileText };
const publicationIcons = { hidden: EyeOff, updating: Eye, live: Eye, published: EyeOff, receiving: EyeOff, waiting: EyeOff, native: Cable };

function CaptionRowContent({ row }: { row: RowParameters }) {
  const sourceTrigger = useRef<HTMLSpanElement>(null);
  const publicationTrigger = useRef<HTMLSpanElement>(null);
  const sourceTooltip = useRef<HTMLSpanElement>(null);
  const publicationTooltip = useRef<HTMLSpanElement>(null);
  const notify = useRef<ReturnType<typeof viewHierarchy.useBubble> | null>(null);
  const descriptionId = "caption-" + row.id + "-description";
  const timeId = "caption-" + row.id + "-time";
  const sourceId = "caption-" + row.id + "-source";
  const publicationId = "caption-" + row.id + "-publication";
  const SourceIcon = sourceIcons[row.source];
  const PublicationIcon = publicationIcons[row.publicationState];
  const tooltipPosition = row.statusTooltipPosition;
  const tooltipStyle = tooltipPosition ? { top: tooltipPosition.top, left: tooltipPosition.left,
    maxWidth: "min(var(--caption-tooltip-max-width), " + tooltipPosition.maxWidth + "px)", maxHeight: tooltipPosition.maxHeight } : undefined;
  useEffect(() => {
    const trigger = row.sourceStatusOpen ? sourceTrigger.current : row.publicationStatusOpen ? publicationTrigger.current : null;
    const tooltip = row.sourceStatusOpen ? sourceTooltip.current : publicationTooltip.current;
    if (!trigger || !tooltip) return;
    const measure = () => {
      const bounds = trigger.getBoundingClientRect();
      const tooltipBounds = tooltip.getBoundingClientRect();
      const viewport = trigger.ownerDocument.documentElement;
      notify.current?.({ type: "caption.status.measured", captionId: row.id, kind: row.sourceStatusOpen ? "source" : "publication",
        geometry: { triggerTop: bounds.top, triggerBottom: bounds.bottom, triggerLeft: bounds.left, triggerRight: bounds.right,
          tooltipWidth: tooltipBounds.width, tooltipHeight: Math.max(tooltipBounds.height, tooltip.scrollHeight + tooltip.offsetHeight - tooltip.clientHeight),
          viewportWidth: viewport.clientWidth, viewportHeight: viewport.clientHeight } });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(trigger);
    observer?.observe(tooltip);
    const host = trigger.ownerDocument.defaultView;
    host?.addEventListener("resize", measure);
    host?.addEventListener("scroll", measure, true);
    return () => { observer?.disconnect(); host?.removeEventListener("resize", measure); host?.removeEventListener("scroll", measure, true); };
  }, [row.sourceStatusOpen, row.publicationStatusOpen, row.state, row.publication]);
  return (
    <Scope name={"caption-row:" + row.id}>
      {emit => { notify.current = emit; return <>
        {row.firstUnread && <div className="caption-unread-boundary" role="separator" aria-label="ここから新着の字幕">ここから新着</div>}
        <article className="caption-row" data-caption-id={row.id} data-editing={row.editing} data-dirty={row.dirty}
          data-current={row.current} data-first-unread={row.firstUnread} aria-labelledby={descriptionId} aria-describedby={timeId}>
          <span id={descriptionId} className="sr-only">{row.contentDescription}</span>
          <time id={timeId} className="caption-received-time" dateTime={row.receivedAt} title={row.timeDescription} aria-label={row.timeDescription}>{row.timeLabel}</time>
          <div className="caption-text">
            {row.speaker && <span className="caption-row-speaker">{row.speaker}</span>}
            <button className="caption-edit-text" disabled={row.editDisabled} aria-label={"編集：" + row.text}
              aria-describedby={timeId} aria-expanded={row.editing}
              onClick={() => emit({ type: "caption.edit.requested", captionId: row.id })}>{row.text}</button>
          </div>
          <div className="caption-state">
            <span ref={sourceTrigger} tabIndex={0} role="img" aria-label={row.state} aria-describedby={row.sourceStatusOpen ? sourceId : undefined}
              className={"caption-state-icon" + (row.dirty ? " caption-unsaved" : "")} data-open={row.sourceStatusOpen}
              onPointerEnter={() => emit({ type: "caption.status.interaction.changed", captionId: row.id, kind: "source", interaction: "pointer", active: true })}
              onPointerLeave={() => emit({ type: "caption.status.interaction.changed", captionId: row.id, kind: "source", interaction: "pointer", active: false })}
              onFocus={() => emit({ type: "caption.status.interaction.changed", captionId: row.id, kind: "source", interaction: "focus", active: true })}
              onBlur={() => emit({ type: "caption.status.interaction.changed", captionId: row.id, kind: "source", interaction: "focus", active: false })}>
              <SourceIcon size={16} aria-hidden="true" />
              <span className="caption-state-bridge" aria-hidden="true" data-open={row.sourceStatusOpen && tooltipPosition !== null} style={tooltipPosition?.bridge} />
              <span ref={sourceTooltip} id={sourceId} role="tooltip" aria-hidden={!row.sourceStatusOpen} data-open={row.sourceStatusOpen}
                data-positioned={tooltipPosition !== null} style={tooltipStyle} className="caption-state-tooltip">{row.state}</span>
            </span>
            <span ref={publicationTrigger} tabIndex={0} role="img" aria-label={row.publication} aria-describedby={row.publicationStatusOpen ? publicationId : undefined}
              className={"caption-state-icon" + (row.current ? " caption-live" : "")} data-open={row.publicationStatusOpen}
              onPointerEnter={() => emit({ type: "caption.status.interaction.changed", captionId: row.id, kind: "publication", interaction: "pointer", active: true })}
              onPointerLeave={() => emit({ type: "caption.status.interaction.changed", captionId: row.id, kind: "publication", interaction: "pointer", active: false })}
              onFocus={() => emit({ type: "caption.status.interaction.changed", captionId: row.id, kind: "publication", interaction: "focus", active: true })}
              onBlur={() => emit({ type: "caption.status.interaction.changed", captionId: row.id, kind: "publication", interaction: "focus", active: false })}>
              <PublicationIcon size={16} aria-hidden="true" />
              <span className="caption-state-bridge" aria-hidden="true" data-open={row.publicationStatusOpen && tooltipPosition !== null} style={tooltipPosition?.bridge} />
              <span ref={publicationTooltip} id={publicationId} role="tooltip" aria-hidden={!row.publicationStatusOpen} data-open={row.publicationStatusOpen}
                data-positioned={tooltipPosition !== null} style={tooltipStyle} className="caption-state-tooltip">{row.publication}</span>
            </span>
          </div>
          <Button variant="ghost" className="operator-icon-button caption-edit-icon" disabled={row.editDisabled}
            aria-label="編集欄を開く" aria-describedby={timeId + " " + descriptionId} aria-expanded={row.editing}
            intent={{ type: "caption.edit.requested", captionId: row.id }}><Pencil size={16} /></Button>
        </article>
      </>; }}
    </Scope>
  );
}

export const CaptionRowView = memo(CaptionRowContent);

export function CaptionListView({ parameters }: { parameters: OperatorParameters }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const notify = useRef<ReturnType<typeof viewHierarchy.useBubble> | null>(null);
  useEffect(() => {
    const row = Array.from(viewport.current?.querySelectorAll<HTMLElement>("[data-caption-id]") ?? [])
      .find(caption => caption.dataset.captionId === parameters.historyFocusCaptionId);
    row?.querySelector<HTMLButtonElement>(".caption-edit-text")?.focus({ preventScroll: true });
    row?.scrollIntoView?.({ block: "nearest" });
  }, [parameters.historyFocusVersion]);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    if (parameters.scrollTarget === "latest") node.scrollTop = node.scrollHeight;
    else Array.from(node.querySelectorAll<HTMLElement>("[data-caption-id]"))
      .find(row => row.dataset.captionId === parameters.scrollCaptionId)?.scrollIntoView?.({ block: "nearest" });
  }, [parameters.scrollVersion]);
  useEffect(() => {
    const node = viewport.current;
    const history = content.current;
    if (!node || !history || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      notify.current?.({ type: "timeline.resized", scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop });
    });
    observer.observe(node);
    observer.observe(history);
    return () => observer.disconnect();
  }, []);
  return (
    <Scope name="caption-list">
      {emit => {
        notify.current = emit;
        return <section className="caption-list" aria-label="字幕一覧">
          <header className="caption-list-heading"><h2>字幕一覧</h2></header>
          <div ref={viewport} className="caption-viewport" onScroll={event => {
            const node = event.currentTarget;
            emit({ type: "timeline.scrolled", scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop });
          }}>
            <div ref={content} className="caption-history-content">
              {parameters.rows.map(row => <CaptionRowView row={row} key={row.id} />)}
              {!parameters.rows.length && <div className="caption-empty"><h2>{parameters.loading ? "字幕を読み込んでいます" : "字幕を待っています"}</h2></div>}
            </div>
          </div>
          <footer className="caption-list-footer"><span>{parameters.rows.length} 件<span className="caption-follow-state"> · {parameters.followLabel}</span></span>
            <p className="sr-only caption-unread-announcement" role="status" aria-live="polite" aria-atomic="true">{parameters.unreadAnnouncement}</p>
            <div className="caption-history-actions">
              {parameters.editor && <Button variant="ghost" className="operator-button" disabled={parameters.returnToEditorDisabled}
                intent={{ type: "timeline.editing.requested" }}><Undo2 size={16} />訂正位置へ</Button>}
              <Button variant="ghost" className="operator-button" intent={{ type: "timeline.latest.requested" }}><ArrowDown size={16} />{parameters.latestLabel}</Button>
            </div>
          </footer>
        </section>;
      }}
    </Scope>
  );
}
