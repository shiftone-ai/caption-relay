import type { ReactNode } from "react";
import type { ViewEvent } from "../../domain";
import { viewHierarchy } from "../../events/hierarchy";

export function Form({ intent, className, children }: { intent: ViewEvent; className?: string; children: ReactNode }) {
  return <viewHierarchy.Scope name="form">
    {emit => <form className={className} onSubmit={event => { event.preventDefault(); emit(intent); }}>{children}</form>}
  </viewHierarchy.Scope>;
}
