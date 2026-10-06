import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { viewHierarchy } from "../../events/hierarchy";
import type { RowParameters } from "../../presenters/operator";

const { Scope } = viewHierarchy;

export function CaptionEditorView({ row }: { row: RowParameters }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const inputId = "caption-" + row.id + "-editor";
  const titleId = inputId + "-title";
  const messageId = inputId + "-message";
  const hintId = inputId + "-hint";
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, [row.focusVersion]);
  return (
    <Scope name={"caption-editor:" + row.id}>
      <aside className="caption-editor" aria-labelledby={titleId}>
        <header className="caption-editor-header">
          <div className="caption-editor-title"><h2 id={titleId}>字幕 {row.number} の訂正</h2>
            <time className="caption-received-time" dateTime={row.receivedAt} title={row.timeDescription} aria-label={row.timeDescription}>{row.timeLabel}</time>
          </div>
          <Button variant="ghost" className="operator-icon-button" aria-label={"字幕 " + row.number + " の編集を閉じる"}
            intent={{ type: "caption.edit.closed" }}><X size={16} /></Button>
        </header>
        <div className="caption-editor-scroll">
          <details className="caption-editor-reference"><summary>原文と保存済みの文</summary>
            <dl><div><dt>原文</dt><dd>{row.original}</dd></div><div><dt>保存済みの表示文</dt><dd>{row.text}</dd></div></dl>
          </details>
          <label htmlFor={inputId}>字幕 {row.number} の表示文</label>
          <Textarea ref={input} id={inputId} className="caption-editor-input" value={row.draftText} readOnly={row.readOnly}
            aria-invalid={row.invalid} aria-describedby={hintId + (row.message ? " " + messageId : "")}
            change={text => ({ type: "caption.draft.changed", captionId: row.id, text })}
            keypress={key => ({ type: "caption.editor.keypressed", captionId: row.id, ...key })} />
          {row.formattedText && <details className="caption-ai-reference"><summary>AI修正結果を確認</summary><p>{row.formattedText}</p></details>}
        </div>
        <footer className="caption-editor-footer">
          {row.message && <p id={messageId} role="status" className="operator-error">{row.message}</p>}
          <p className="caption-save-success" role="status" aria-live="polite">{row.saveSuccess}</p>
          <div className="caption-editor-actions">
            <Button className="operator-button" disabled={row.disabled} intent={{ type: "caption.save.requested", captionId: row.id }}>{row.saveLabel}</Button>
            <Button variant="ghost" className="operator-button" disabled={row.discardDisabled} intent={{ type: "caption.draft.discarded", captionId: row.id }}>変更を破棄</Button>
          </div>
          <p id={hintId} className="caption-hint">Ctrl / ⌘ + Enter で保存 · Esc で閉じる</p>
          <p className="caption-save-consequence">{row.saveConsequence}</p>
        </footer>
      </aside>
    </Scope>
  );
}
