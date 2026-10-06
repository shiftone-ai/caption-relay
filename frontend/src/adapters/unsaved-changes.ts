/** Browser-owned confirmation protects unsaved edits during reload/navigation. */
export function protectUnsavedChanges(target: Pick<Window, "addEventListener" | "removeEventListener">): () => void {
  const warn = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  target.addEventListener("beforeunload", warn);
  return () => target.removeEventListener("beforeunload", warn);
}
