import { useEffect, useRef } from "react";
import { LoaderCircle, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { Disclosure } from "../../components/ui/disclosure";
import { viewHierarchy } from "../../events/hierarchy";
import type { RowParameters } from "../../presenters/operator";

const { Scope } = viewHierarchy;

export function CaptionEditorView({ row }: { row: RowParameters }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const inputId = "caption-" + row.id + "-editor";
  const titleId = inputId + "-title";
  const timeId = inputId + "-time";
  const messageId = inputId + "-message";
  const hintId = inputId + "-hint";
  useEffect(() => { input.current?.focus(); }, [row.focusVersion]);
  return (
    <Scope name={"caption-editor:" + row.id}>
      {emit => <>
      <aside className="caption-editor" aria-labelledby={titleId} aria-describedby={timeId}>
        <header className="caption-editor-header">
          <div className="caption-editor-title"><h2 id={titleId}>字幕の訂正</h2>
            <time id={timeId} className="caption-received-time" dateTime={row.receivedAt} title={row.timeDescription} aria-label={row.timeDescription}>{row.timeLabel}</time>
          </div>
          <Button variant="ghost" className="operator-icon-button" aria-label="編集を閉じる"
            intent={{ type: "caption.edit.closed" }}><X size={16} /></Button>
        </header>
        <div className="caption-editor-scroll operator-panel-scroll">
          <section className="caption-editor-reference" aria-label="訂正する字幕の原文"><h3>原文</h3><p tabIndex={0}>{row.original}</p></section>
          {row.aiPending && <p className="caption-ai-progress" role="status"><LoaderCircle size={14} className="caption-ai-spinner" aria-hidden="true" />{row.aiProgressLabel}</p>}
          <label htmlFor={inputId}>表示文</label>
          <Textarea ref={input} id={inputId} className="caption-editor-input" value={row.draftText} readOnly={row.readOnly}
            aria-invalid={row.invalid} aria-describedby={hintId + (row.message ? " " + messageId : "")}
            change={text => ({ type: "caption.draft.changed", captionId: row.id, text })}
            keypress={key => ({ type: "caption.editor.keypressed", captionId: row.id, ...key })} />
          {row.dirty && <Disclosure parameters={row.savedDisclosure} className="caption-saved-reference" summary="変更前の字幕"><p>{row.text}</p></Disclosure>}
          {row.historyOptions.length > 0 && <div className="caption-edit-history">
            <label htmlFor={inputId + "-history"}>訂正履歴</label>
            <select id={inputId + "-history"} value="" disabled={row.readOnly}
              onChange={event => emit({ type: "caption.history.selected", captionId: row.id, revision: event.currentTarget.value })}>
              <option value="" disabled>以前の文を選ぶ</option>
              {row.historyOptions.map(edit => <option key={edit.revision} value={edit.revision}>{edit.label}</option>)}
            </select>
          </div>}
          {row.message && <p id={messageId} role="status" className="operator-error">{row.message}</p>}
        </div>
        <footer className="caption-editor-footer">
          <p className="caption-save-success" role="status" aria-live="polite">{row.saveSuccess}</p>
          <div className="caption-editor-actions">
            <Button className="operator-button" disabled={row.disabled} intent={{ type: "caption.save.requested", captionId: row.id }}>{row.saveLabel}</Button>
            {row.republishVisible && <Button variant="outline" className="operator-button" disabled={row.republishDisabled}
              intent={{ type: "caption.save.requested", captionId: row.id, republish: true }}>保存して再公開</Button>}
            <Button variant="ghost" className="operator-button" disabled={row.discardDisabled} intent={{ type: "caption.draft.discarded", captionId: row.id }}>変更を破棄</Button>
          </div>
          <p id={hintId} className="sr-only">Ctrl / ⌘ + Enter で保存 · Esc で閉じる</p>
          <p className={row.saveConsequenceVisible ? "caption-save-consequence" : "sr-only"}>{row.saveConsequence}</p>
        </footer>
      </aside>
      </>}
    </Scope>
  );
}
