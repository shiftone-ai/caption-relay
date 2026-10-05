import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { operatorHierarchy } from "../../events/hierarchy";
import type { RowParameters } from "../../presenters/operator";

const { Scope } = operatorHierarchy;

export function CaptionRowView({ row }: { row: RowParameters }) {
  const inputId = `caption-${row.id}`;
  const messageId = `${inputId}-message`;
  return (
    <Scope name={`caption-row:${row.id}`}>
      {emit => (
        <article className="grid gap-4 border-t border-neutral-300 py-4 md:grid-cols-2">
          <div className="leading-7">
            <small className="mb-1.5 block text-neutral-600">原文</small>
            <div>{row.original}</div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-neutral-600" htmlFor={inputId}>表示文（編集可）</label>
            <Textarea
              id={inputId} className="min-h-24 bg-white text-base"
              value={row.text} readOnly={row.readOnly}
              aria-describedby={row.message ? messageId : undefined}
              onFocus={event => emit({ type: "caption.draft.changed", captionId: row.id, text: event.currentTarget.value })}
              onChange={event => emit({ type: "caption.draft.changed", captionId: row.id, text: event.currentTarget.value })}
              onKeyDown={event => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  emit({ type: "caption.save.requested", captionId: row.id });
                }
              }}
            />
            <Button className="mt-2" size="lg" disabled={row.disabled}
              onClick={() => emit({ type: "caption.save.requested", captionId: row.id })}>{row.saveLabel}</Button>
            {row.message && <p id={messageId} role="status" className="mt-2 text-sm leading-6 text-red-800">{row.message}</p>}
          </div>
        </article>
      )}
    </Scope>
  );
}

export function CaptionListView({ rows }: { rows: RowParameters[] }) {
  return (
    <Scope name="caption-list">
      <section className="mt-8">
        <h2 className="mb-4 text-xl font-semibold">字幕</h2>
        {rows.map(row => <CaptionRowView row={row} key={row.id} />)}
      </section>
    </Scope>
  );
}
