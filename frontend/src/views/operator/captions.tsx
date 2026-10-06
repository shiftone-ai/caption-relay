import { useEffect, useRef } from "react";
import { ArrowDown, AudioLines, Check, Clock3, Eye, EyeOff, FileText, LoaderCircle, Pencil, PencilLine, Sparkles, UserRoundPen, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { viewHierarchy } from "../../events/hierarchy";
import type { OperatorParameters, RowParameters } from "../../presenters/operator";

const { Scope } = viewHierarchy;
const sourceIcons = { saving: LoaderCircle, unsaved: PencilLine, human: UserRoundPen, ai: Sparkles, original: FileText };
const publicationIcons = { hidden: EyeOff, updating: Clock3, live: Eye, published: Check, receiving: AudioLines, waiting: Clock3 };

export function CaptionRowView({ row }: { row: RowParameters }) {
  const inputId = "caption-" + row.id;
  const messageId = inputId + "-message";
  const input = useRef<HTMLTextAreaElement>(null);
  const SourceIcon = sourceIcons[row.source];
  const PublicationIcon = publicationIcons[row.publicationState];
  useEffect(() => {
    if (row.editing) {
      input.current?.focus({ preventScroll: true });
      input.current?.closest("article")?.scrollIntoView?.({ block: "nearest" });
    }
  }, [row.editing]);
  return (
    <Scope name={"caption-row:" + row.id}>
      {emit => (
        <article className="caption-row" data-editing={row.editing} data-current={row.current} aria-label={"字幕 " + row.number}>
          <div className="caption-number">{row.number}</div>
          <div className="caption-original"><span className="caption-mobile-label">原文</span>{row.original}</div>
          <div className="caption-text">
            <span className="caption-mobile-label">表示文</span>
            {row.editing ? <>
              <label className="sr-only" htmlFor={inputId}>字幕 {row.number} の表示文</label>
              <Textarea ref={input} id={inputId} value={row.text} readOnly={row.readOnly} aria-invalid={row.invalid}
                aria-describedby={row.message ? messageId : inputId + "-hint"}
                change={text => ({ type: "caption.draft.changed", captionId: row.id, text })}
                keypress={key => ({ type: "caption.editor.keypressed", captionId: row.id, ...key })} />
              {row.formattedText && <details className="caption-ai-reference"><summary>AI修正結果を確認</summary><p>{row.formattedText}</p></details>}
              <div className="caption-editor-actions">
                <Button className="operator-button" disabled={row.disabled} intent={{ type: "caption.save.requested", captionId: row.id }}>{row.saveLabel}</Button>
                <Button variant="ghost" className="operator-button" disabled={row.discardDisabled} intent={{ type: "caption.draft.discarded", captionId: row.id }}>変更を破棄</Button>
                <span id={inputId + "-hint"} className="caption-hint">Ctrl / ⌘ + Enter</span>
              </div>
              {row.message && <p id={messageId} role="status" className="operator-error">{row.message}</p>}
            </> : <button className="caption-edit-text" disabled={row.editDisabled} aria-label={"字幕 " + row.number + " を編集"}
              onClick={() => emit({ type: "caption.edit.requested", captionId: row.id })}>{row.text}</button>}
          </div>
          <div className="caption-state">
            <span role="img" aria-label={row.state} title={row.state} className={row.dirty ? "caption-unsaved" : ""}><SourceIcon size={16} aria-hidden="true" /></span>
            <span role="img" aria-label={row.publication} title={row.publication} className={row.current ? "caption-live" : ""}><PublicationIcon size={16} aria-hidden="true" /></span>
          </div>
          <Button variant="ghost" className="operator-icon-button caption-edit-icon" disabled={row.editDisabled}
            aria-label={row.editing ? "字幕 " + row.number + " の編集を閉じる" : "字幕 " + row.number + " の編集欄を開く"}
            intent={{ type: "caption.edit.requested", captionId: row.id }}>
            {row.editing ? <X size={16} /> : <Pencil size={16} />}
          </Button>
        </article>
      )}
    </Scope>
  );
}

export function CaptionListView({ parameters }: { parameters: OperatorParameters }) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (viewport.current && parameters.scrollToLatest) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [parameters.scrollToLatest, parameters.scrollVersion]);
  return (
    <Scope name="caption-list">
      {emit => <section className="caption-list" aria-label="字幕一覧">
        <div className="caption-columns" aria-hidden="true"><span>#</span><span>原文</span><span>表示文 · 編集可</span><span>状態</span><span /></div>
        <div ref={viewport} className="caption-viewport" onScroll={event => {
          const node = event.currentTarget;
          emit({ type: "timeline.scrolled", scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop });
        }}>
          {parameters.rows.map(row => <CaptionRowView row={row} key={row.id} />)}
          {!parameters.rows.length && <div className="caption-empty"><h2>{parameters.loading ? "字幕を読み込んでいます" : "字幕を待っています"}</h2><p>入力を受信すると、原文と表示文がここに並びます。「テスト字幕を送る」で表示を確認できます。</p></div>}
        </div>
        <footer className="caption-list-footer"><span>{parameters.rows.length} 件<span className="caption-follow-state"> · {parameters.followLabel}</span></span>
          <Button variant="ghost" className="operator-button" intent={{ type: "timeline.latest.requested" }}><ArrowDown size={16} />最新へ</Button>
        </footer>
      </section>}
    </Scope>
  );
}
