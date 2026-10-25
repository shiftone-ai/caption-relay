import { useEffect, useRef } from "react";
import { viewHierarchy } from "../../events/hierarchy";
import type { ConfirmationParameters } from "../../presenters/room";
import { Button } from "./button";

export function ConfirmationDialog({ parameters }: { parameters: ConfirmationParameters }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (parameters.open && !element.open) {
      element.showModal();
      element.querySelector<HTMLButtonElement>("[data-confirm-cancel]")?.focus();
    } else if (!parameters.open && element.open) element.close();
  }, [parameters.open]);
  return <viewHierarchy.Scope name="confirmation-dialog">
    {emit => <dialog ref={dialog} className="room-confirmation" aria-labelledby="room-confirmation-title" aria-describedby="room-confirmation-body"
      onCancel={event => { event.preventDefault(); emit(parameters.cancel); }}>
      <h2 id="room-confirmation-title">{parameters.title}</h2>
      <p id="room-confirmation-body">{parameters.body}</p>
      <div className="room-confirmation-actions">
        <Button variant="outline" data-confirm-cancel intent={parameters.cancel}>キャンセル</Button>
        <Button variant="destructive" intent={parameters.confirm}>{parameters.confirmLabel}</Button>
      </div>
    </dialog>}
  </viewHierarchy.Scope>;
}
