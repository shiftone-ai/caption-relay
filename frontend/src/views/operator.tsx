import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { operatorHierarchy } from "../events/hierarchy";
import type { OperatorParameters, RowParameters } from "../presenters/operator";

const { Scope, useBubble } = operatorHierarchy;

function ToolbarView({ disabled, toggleLabel }: Pick<OperatorParameters, "disabled" | "toggleLabel">) {
  const emit = useBubble();
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button variant="outline" size="lg" onClick={() => emit({ type: "test.requested" })} disabled={disabled}>
        テスト字幕を送る
      </Button>
      <Button variant="outline" size="lg" onClick={() => emit({ type: "visibility.toggle.requested" })} disabled={disabled}>
        {toggleLabel}
      </Button>
      <a className="underline underline-offset-4" href="/view/demo" target="_blank" rel="noopener noreferrer">観客画面 ↗</a>
    </div>
  );
}

function CaptionRowView({ row }: { row: RowParameters }) {
  const emit = useBubble();
  const inputId = `caption-${row.id}`;
  const messageId = `${inputId}-message`;
  return (
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
  );
}

export function OperatorView({ parameters }: { parameters: OperatorParameters }) {
  return (
    <Scope name="operator-screen">
      <main className="mx-auto max-w-[1100px] px-[18px] py-8 md:px-8">
        <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Caption Relay</h1>
            <p className="mt-2 text-neutral-600">UDトーク等 → 整形 → 手修正 → 字幕</p>
          </div>
          <Scope name="toolbar"><ToolbarView disabled={parameters.disabled} toggleLabel={parameters.toggleLabel} /></Scope>
        </header>
        {parameters.message && <p role="status" className="mt-4 text-red-800">{parameters.message}</p>}
        <section className="mt-8">
          <h2 className="mb-4 text-xl font-semibold">字幕</h2>
          <Scope name="caption-list">
            {parameters.rows.map(row => (
              <Scope name={`caption-row:${row.id}`} key={row.id}><CaptionRowView row={row} /></Scope>
            ))}
          </Scope>
        </section>
      </main>
    </Scope>
  );
}
