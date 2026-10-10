import type { ReactNode } from "react";
import { viewHierarchy } from "../../events/hierarchy";
import type { DisclosureParameters } from "../../presenters/disclosure";

export function Disclosure({ parameters, summary, summaryLabel, summaryTitle, className, children }: {
  parameters: DisclosureParameters;
  summary: ReactNode;
  summaryLabel?: string;
  summaryTitle?: string;
  className?: string;
  children: ReactNode;
}) {
  return <viewHierarchy.Scope name={"disclosure:" + parameters.id}>
    {emit => <details className={className} open={parameters.open}>
      <summary aria-label={summaryLabel} title={summaryTitle} onClick={event => {
        // Cancel the browser's local toggle: only the Mediator changes open.
        event.preventDefault();
        emit({ type: "disclosure.toggled", id: parameters.id });
      }}>{summary}</summary>
      {children}
    </details>}
  </viewHierarchy.Scope>;
}
