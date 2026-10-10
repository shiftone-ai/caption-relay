import * as React from "react"
import { cn } from "cn"
import { viewHierarchy } from "../../events/hierarchy"
import type { ViewEvent } from "../../domain"

export interface EditorKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}

function Textarea({ className, change, keypress, ...props }: Omit<React.ComponentProps<"textarea">, `on${string}`> & {
  change: (value: string) => ViewEvent;
  keypress: (key: EditorKey) => ViewEvent;
}) {
  return (
    <viewHierarchy.Scope name="textarea">
      {emit => <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
      onChange={event => { emit(change(event.currentTarget.value)) }}
      onKeyDown={event => {
        const handled = emit(keypress({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, isComposing: event.nativeEvent.isComposing }));
        if (handled) event.preventDefault();
      }}
    />}
    </viewHierarchy.Scope>
  )
}

export { Textarea }
