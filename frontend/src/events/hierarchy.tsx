import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { EventNode, type EventHandler } from "./chain";
import type { AudienceEvent, OperatorEvent } from "../domain";

function createHierarchy<Event>() {
  const Context = createContext<EventNode<Event> | null>(null);

  function useParent() {
    const node = useContext(Context);
    if (!node) throw new Error("A component must be mounted under Root");
    return node;
  }

  function Root({ handle, children }: { handle: EventHandler<Event>; children: ReactNode }) {
    const node = useMemo(() => EventNode.root(handle), [handle]);
    return <Context.Provider value={node}>{children}</Context.Provider>;
  }

  function Scope({ name, handle, children }: {
    name: string;
    handle?: EventHandler<Event>;
    children: ReactNode | ((emit: (event: Event) => boolean) => ReactNode);
  }) {
    const parent = useParent();
    const node = useMemo(() => parent.child(name, handle), [parent, name, handle]);
    const emit = useCallback((event: Event) => node.bubble(event), [node]);
    return <Context.Provider value={node}>{typeof children === "function" ? children(emit) : children}</Context.Provider>;
  }

  function useBubble() {
    const node = useParent();
    return useCallback((event: Event) => node.bubble(event), [node]);
  }

  return { Root, Scope, useBubble };
}

export const operatorHierarchy = createHierarchy<OperatorEvent>();
export const audienceHierarchy = createHierarchy<AudienceEvent>();
