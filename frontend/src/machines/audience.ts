import { assign, fromCallback, setup, type SnapshotFrom } from "xstate";
import type { AudienceApi, AudienceEvent, PublicSnapshot } from "../domain";

export const audienceMachine = setup({
  types: {
    context: {} as PublicSnapshot & { api: AudienceApi },
    input: {} as { api: AudienceApi },
    events: {} as AudienceEvent,
  },
  actors: {
    stream: fromCallback<AudienceEvent, AudienceApi>(({ input, sendBack }) => {
      try {
        return input.subscribe(sendBack);
      } catch {
        sendBack({ type: "stream.failed" });
      }
    }),
  },
}).createMachine({
  id: "audience",
  initial: "connecting",
  context: ({ input }) => ({ api: input.api, visible: true, captions: [] }),
  invoke: { src: "stream", input: ({ context }) => context.api },
  on: {
    "stream.opened": { target: ".live" },
    "stream.failed": { target: ".reconnecting" },
    "stream.snapshot": {
      target: ".live", actions: assign(({ event }) => event.snapshot),
    },
  },
  states: { connecting: {}, live: {}, reconnecting: {} },
});

export type AudienceSnapshot = SnapshotFrom<typeof audienceMachine>;
