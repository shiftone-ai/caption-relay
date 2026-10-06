import { useEffect, useRef } from "react";
import { ArrowDown, AudioLines, Check, Clock3, Eye, EyeOff, FileText, LoaderCircle, Pencil, PencilLine, Sparkles, Undo2, UserRoundPen } from "lucide-react";
import { Button } from "../../components/ui/button";
import { viewHierarchy } from "../../events/hierarchy";
import type { OperatorParameters, RowParameters } from "../../presenters/operator";

const { Scope } = viewHierarchy;
const sourceIcons = { saving: LoaderCircle, unsaved: PencilLine, human: UserRoundPen, ai: Sparkles, original: FileText };
const publicationIcons = { hidden: EyeOff, updating: Clock3, live: Eye, published: Check, receiving: AudioLines, waiting: Clock3 };

export function CaptionRowView({ row }: { row: RowParameters }) {
  const descriptionId = "caption-" + row.id + "-description";
  const sourceId = "caption-" + row.id + "-source";
  const publicationId = "caption-" + row.id + "-publication";
  const SourceIcon = sourceIcons[row.source];
  const PublicationIcon = publicationIcons[row.publicationState];
  return (
    <Scope name={"caption-row:" + row.id}>
      {emit => <>
        {row.firstUnread && <div className="caption-unread-boundary" role="separator" aria-label="ここから新着の字幕">ここから新着</div>}
        <article className="caption-row" data-caption-id={row.id} data-editing={row.editing} data-dirty={row.dirty}
          data-current={row.current} data-first-unread={row.firstUnread} aria-label={"字幕 " + row.number} aria-describedby={descriptionId}>
          <span id={descriptionId} className="sr-only">{row.contentDescription}</span>
          <div className="caption-number">{row.number}</div>
          <div className="caption-original"><span className="caption-mobile-label">原文</span>{row.original}</div>
          <div className="caption-text">
            <span className="caption-mobile-label">保存済みの表示文</span>
            <button className="caption-edit-text" disabled={row.editDisabled} aria-label={"字幕 " + row.number + " を編集"}
              aria-describedby={descriptionId} aria-expanded={row.editing}
              onClick={() => emit({ type: "caption.edit.requested", captionId: row.id })}>{row.text}</button>
          </div>
          <div className="caption-state">
            <span tabIndex={0} role="img" aria-label={row.state} aria-describedby={sourceId} title={row.state}
              className={"caption-state-icon" + (row.dirty ? " caption-unsaved" : "")}>
              <SourceIcon size={16} aria-hidden="true" /><span id={sourceId} className="caption-state-tooltip">{row.state}</span>
            </span>
            <span tabIndex={0} role="img" aria-label={row.publication} aria-describedby={publicationId} title={row.publication}
              className={"caption-state-icon" + (row.current ? " caption-live" : "")}>
              <PublicationIcon size={16} aria-hidden="true" /><span id={publicationId} className="caption-state-tooltip">{row.publication}</span>
            </span>
          </div>
          <Button variant="ghost" className="operator-icon-button caption-edit-icon" disabled={row.editDisabled}
            aria-label={"字幕 " + row.number + " の編集欄を開く"} aria-describedby={descriptionId} aria-expanded={row.editing}
            intent={{ type: "caption.edit.requested", captionId: row.id }}><Pencil size={16} /></Button>
        </article>
      </>}
    </Scope>
  );
}

export function CaptionListView({ parameters }: { parameters: OperatorParameters }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const notify = useRef<ReturnType<typeof viewHierarchy.useBubble> | null>(null);
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
          <div className="caption-columns" aria-hidden="true"><span>#</span><span>原文</span><span>保存済みの表示文</span><span>状態</span><span /></div>
          <div ref={viewport} className="caption-viewport" onScroll={event => {
            const node = event.currentTarget;
            emit({ type: "timeline.scrolled", scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop });
          }}>
            <div ref={content} className="caption-history-content">
              {parameters.rows.map(row => <CaptionRowView row={row} key={row.id} />)}
              {!parameters.rows.length && <div className="caption-empty"><h2>{parameters.loading ? "字幕を読み込んでいます" : "字幕を待っています"}</h2><p>入力を受信すると、原文と保存済みの表示文がここに並びます。「準備」から「テスト字幕を送る」を選ぶか、入力 API から字幕を送って表示を確認できます。</p></div>}
            </div>
          </div>
          <footer className="caption-list-footer"><span>{parameters.rows.length} 件<span className="caption-follow-state"> · {parameters.followLabel}</span></span>
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
