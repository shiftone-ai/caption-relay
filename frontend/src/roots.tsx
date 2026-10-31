import { useCallback, useEffect, useMemo, useRef } from "react";
import { useActorRef, useSelector } from "@xstate/react";
import { operatorApi, audienceApi, createOperatorApi } from "./api";
import { operatorMachine } from "./machines/operator";
import { audienceMachine } from "./machines/audience";
import { viewHierarchy } from "./events/hierarchy";
import { presentOperator } from "./presenters/operator";
import { presentAudience } from "./presenters/audience";
import { OperatorView } from "./views/operator";
import { AudienceView } from "./views/audience";
import { createFullscreenAdapter } from "./adapters/fullscreen";
import { protectUnsavedChanges } from "./adapters/unsaved-changes";
import { observeOperatorKeys } from "./adapters/operator-keyboard";
import { createMicrophoneAdapter } from "./adapters/microphone";
import { roomsApi, navigate, roomUrl } from "./adapters/rooms";
import { homeMachine } from "./machines/home";
import { roomMachine } from "./machines/room";
import { presentHome } from "./presenters/home";
import { presentRoom, type RoomParameters } from "./presenters/room";
import { HomeView } from "./views/home";
import { RoomActionsView } from "./views/room";
import { DesktopSettingsView } from "./views/desktop-settings";
import { desktopSettingsMachine } from "./machines/desktop-settings";
import { presentDesktopSettings } from "./presenters/desktop-settings";
import { credentialsApi } from "./adapters/desktop";
import type { MicrophoneAdapter } from "./domain";
import type { AudienceApi, FullscreenAdapter, OperatorApi, RoomBinding, RoomsApi, ViewEvent } from "./domain";

interface RoomControls {
  parameters: RoomParameters;
  handle: (event: ViewEvent) => boolean;
  onUnsavedChange: (unsaved: boolean) => void;
}

export function DesktopSettingsRoot() {
  const actor = useActorRef(desktopSettingsMachine, { input: { api: credentialsApi } });
  const parameters = useSelector(actor, presentDesktopSettings);
  const handle = useCallback((event: ViewEvent) => {
    if (!actor.getSnapshot().can(event)) return false;
    actor.send(event);
    return true;
  }, [actor]);
  return <viewHierarchy.Root handle={handle}><DesktopSettingsView parameters={parameters} /></viewHierarchy.Root>;
}

export function OperatorRoot({ api = operatorApi, microphone, room, controls }: { api?: OperatorApi; microphone?: MicrophoneAdapter; room?: RoomBinding; controls?: RoomControls }) {
  const input = useMemo(() => microphone ?? createMicrophoneAdapter(), [microphone]);
  const actor = useActorRef(operatorMachine, { input: { api, microphone: input } });
  const parameters = useSelector(actor, snapshot => presentOperator(snapshot, room?.roomId));
  useEffect(() => { actor.send({ type: "operator.binding.changed", api, microphone: input }); }, [actor, api, input]);
  useEffect(() => parameters.hasUnsavedChanges ? protectUnsavedChanges(window) : undefined, [parameters.hasUnsavedChanges]);
  const onUnsavedChange = controls?.onUnsavedChange;
  useEffect(() => { onUnsavedChange?.(parameters.hasUnsavedChanges); }, [onUnsavedChange, parameters.hasUnsavedChanges]);
  const roomHandle = controls?.handle;
  const handle = useCallback((event: ViewEvent) => {
    if (roomHandle?.(event)) return true;
    if (!actor.getSnapshot().can(event)) return false;
    actor.send(event);
    return true;
  }, [actor, roomHandle]);
  useEffect(() => observeOperatorKeys(document, handle), [handle]);
  return <viewHierarchy.Root handle={handle}>{controls ? <div className="room-screen"><RoomActionsView parameters={controls.parameters} /><OperatorView parameters={parameters} /></div> : <OperatorView parameters={parameters} />}</viewHierarchy.Root>;
}

export function HomeRoot({ api = roomsApi, go = navigate }: { api?: RoomsApi; go?: (path: string) => void }) {
  const actor = useActorRef(homeMachine, { input: { api } });
  const parameters = useSelector(actor, presentHome);
  useEffect(() => { if (parameters.destination) go(roomUrl(parameters.destination)); }, [go, parameters.destination]);
  const handle = useCallback((event: ViewEvent) => {
    if (!actor.getSnapshot().can(event)) return false;
    actor.send(event);
    return true;
  }, [actor]);
  return <viewHierarchy.Root handle={handle}><HomeView parameters={parameters} /></viewHierarchy.Root>;
}

export function RoomRoot({ id, api = roomsApi, go = navigate, operator = createOperatorApi, microphone = createMicrophoneAdapter }: {
  id: string; api?: RoomsApi; go?: (path: string) => void;
  operator?: (room: RoomBinding) => OperatorApi; microphone?: (room: RoomBinding) => MicrophoneAdapter;
}) {
  const actor = useActorRef(roomMachine, { input: { api, id } });
  const parameters = useSelector(actor, presentRoom);
  const generation = parameters.room?.generation;
  const binding = useMemo(() => ({ roomId: id, generation: generation ?? 0 }), [id, generation]);
  const operatorAdapter = useMemo(() => operator(binding), [operator, binding]);
  const microphoneAdapter = useMemo(() => microphone(binding), [microphone, binding]);
  const handle = useCallback((event: ViewEvent) => {
    if (!actor.getSnapshot().can(event)) return false;
    actor.send(event);
    return true;
  }, [actor]);
  const onUnsavedChange = useCallback((unsaved: boolean) => actor.send({ type: "room.unsaved.changed", unsaved }), [actor]);
  useEffect(() => { if (parameters.destination) go("/"); }, [go, parameters.destination]);
  if (parameters.showOperator) return <OperatorRoot key={id} api={operatorAdapter} microphone={microphoneAdapter} room={binding}
    controls={{ parameters, handle, onUnsavedChange }} />;
  return <viewHierarchy.Root handle={handle}><div className="room-screen"><RoomActionsView parameters={parameters} /></div></viewHierarchy.Root>;
}

export function AudienceRoot({ api = audienceApi, fullscreen }: { api?: AudienceApi; fullscreen?: FullscreenAdapter }) {
  const screen = useRef<HTMLElement>(null);
  const adapter = useMemo(() => fullscreen ?? createFullscreenAdapter(() => screen.current, document), [fullscreen]);
  const actor = useActorRef(audienceMachine, { input: { api, fullscreen: adapter } });
  const parameters = useSelector(actor, presentAudience);
  const handle = useCallback((event: ViewEvent) => {
    if (!actor.getSnapshot().can(event)) return false;
    actor.send(event);
    return true;
  }, [actor]);
  return <viewHierarchy.Root handle={handle}><AudienceView parameters={parameters} screenRef={screen} /></viewHierarchy.Root>;
}
