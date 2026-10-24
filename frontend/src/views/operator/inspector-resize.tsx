import { useEffect, useRef } from "react";
import { viewHierarchy } from "../../events/hierarchy";
import type { OperatorParameters } from "../../presenters/operator";

export function InspectorResizeView({ parameters }: { parameters: OperatorParameters["inspector"] }) {
  const handle = useRef<HTMLDivElement>(null);
  const notify = useRef<ReturnType<typeof viewHierarchy.useBubble> | null>(null);
  useEffect(() => {
    const node = handle.current;
    const workspace = node?.closest(".operator-workspace");
    if (!node || !workspace) return;
    const measure = () => notify.current?.({ type: "inspector.measured", workspaceWidth: workspace.getBoundingClientRect().width });
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const bounds = workspace.getBoundingClientRect();
      node.setPointerCapture(event.pointerId);
      notify.current?.({ type: "inspector.resize.started", pointerId: event.pointerId, clientX: event.clientX, right: bounds.right, workspaceWidth: bounds.width });
      event.preventDefault();
    };
    const move = (event: PointerEvent) => notify.current?.({ type: "inspector.resize.moved", pointerId: event.pointerId, clientX: event.clientX });
    const up = (event: PointerEvent) => notify.current?.({ type: "inspector.resize.ended", pointerId: event.pointerId, clientX: event.clientX });
    const cancel = (event: PointerEvent) => notify.current?.({ type: "inspector.resize.cancelled", pointerId: event.pointerId });
    const key = (event: KeyboardEvent) => {
      if (notify.current?.({ type: "inspector.resize.keypressed", key: event.key, shiftKey: event.shiftKey })) event.preventDefault();
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(workspace);
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
    node.addEventListener("lostpointercapture", cancel);
    node.addEventListener("keydown", key);
    return () => {
      observer?.disconnect();
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
      node.removeEventListener("lostpointercapture", cancel);
      node.removeEventListener("keydown", key);
    };
  }, []);
  return <viewHierarchy.Scope name="inspector-resize">
    {emit => { notify.current = emit; return <div ref={handle} className="inspector-resize-handle" role="separator" tabIndex={0}
      aria-label="右ペインの幅" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={parameters.maximum}
      aria-valuenow={Math.round(parameters.width)} aria-valuetext={Math.round(parameters.width) + "ピクセル"} />; }}
  </viewHierarchy.Scope>;
}
