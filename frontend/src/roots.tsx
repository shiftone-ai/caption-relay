import { useCallback, useMemo, useRef } from "react";
import { useActorRef, useSelector } from "@xstate/react";
import { operatorApi, audienceApi } from "./api";
import { operatorMachine } from "./machines/operator";
import { audienceMachine } from "./machines/audience";
import { viewHierarchy } from "./events/hierarchy";
import { presentOperator } from "./presenters/operator";
import { presentAudience } from "./presenters/audience";
import { OperatorView } from "./views/operator";
import { AudienceView } from "./views/audience";
import { createFullscreenAdapter } from "./adapters/fullscreen";
import type { AudienceApi, FullscreenAdapter, OperatorApi, ViewEvent } from "./domain";

export function OperatorRoot({ api = operatorApi }: { api?: OperatorApi }) {
  const actor = useActorRef(operatorMachine, { input: { api } });
  const parameters = useSelector(actor, presentOperator);
  const handle = useCallback((event: ViewEvent) => {
    if (event.type === "display.fullscreen.requested" || !actor.getSnapshot().can(event)) return false;
    actor.send(event);
    return true;
  }, [actor]);
  return <viewHierarchy.Root handle={handle}><OperatorView parameters={parameters} /></viewHierarchy.Root>;
}

export function AudienceRoot({ api = audienceApi, fullscreen }: { api?: AudienceApi; fullscreen?: FullscreenAdapter }) {
  const screen = useRef<HTMLElement>(null);
  const adapter = useMemo(() => fullscreen ?? createFullscreenAdapter(() => screen.current, document), [fullscreen]);
  const actor = useActorRef(audienceMachine, { input: { api, fullscreen: adapter } });
  const parameters = useSelector(actor, presentAudience);
  const handle = useCallback((event: ViewEvent) => {
    if (event.type !== "display.fullscreen.requested" || !actor.getSnapshot().can(event)) return false;
    actor.send(event);
    return true;
  }, [actor]);
  return <viewHierarchy.Root handle={handle}><AudienceView parameters={parameters} screenRef={screen} /></viewHierarchy.Root>;
}
