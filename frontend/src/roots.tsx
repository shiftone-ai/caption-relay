import { useCallback } from "react";
import { useActorRef, useSelector } from "@xstate/react";
import { operatorApi, audienceApi } from "./api";
import { operatorMachine } from "./machines/operator";
import { audienceMachine } from "./machines/audience";
import { operatorHierarchy, audienceHierarchy } from "./events/hierarchy";
import { presentOperator } from "./presenters/operator";
import { presentAudience } from "./presenters/audience";
import { OperatorView } from "./views/operator";
import { AudienceView } from "./views/audience";
import type { AudienceEvent, OperatorApi, OperatorEvent } from "./domain";

export function OperatorRoot({ api = operatorApi }: { api?: OperatorApi }) {
  const actor = useActorRef(operatorMachine, { input: { api } });
  const parameters = useSelector(actor, presentOperator);
  const handle = useCallback((event: OperatorEvent) => { actor.send(event); return true; }, [actor]);
  return <operatorHierarchy.Root handle={handle}><OperatorView parameters={parameters} /></operatorHierarchy.Root>;
}

export function AudienceRoot() {
  const actor = useActorRef(audienceMachine, { input: { api: audienceApi } });
  const parameters = useSelector(actor, presentAudience);
  const handle = useCallback((event: AudienceEvent) => { actor.send(event); return true; }, [actor]);
  return <audienceHierarchy.Root handle={handle}><AudienceView {...parameters} /></audienceHierarchy.Root>;
}
