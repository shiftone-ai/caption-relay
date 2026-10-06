import type { ViewEvent } from "../domain";

/** Browser keys reach the Root even when hover leaves focus outside the workspace. */
export function observeOperatorKeys(
  target: Pick<Document, "addEventListener" | "removeEventListener">,
  handle: (event: ViewEvent) => boolean,
): () => void {
  const notify = (event: KeyboardEvent) => {
    if (handle({ type: "settings.keypressed", key: event.key, isComposing: event.isComposing,
      defaultPrevented: event.defaultPrevented })) event.preventDefault();
  };
  target.addEventListener("keydown", notify);
  return () => target.removeEventListener("keydown", notify);
}
