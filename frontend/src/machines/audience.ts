import { assign, fromCallback, fromPromise, setup, type SnapshotFrom } from "xstate";
import type { AudienceApi, AudienceEvent, ViewEvent, FullscreenAdapter, PublicSnapshot } from "../domain";
import { defaultDisplay } from "../display";

interface AudienceContext extends PublicSnapshot {
  api: AudienceApi;
  fullscreen: FullscreenAdapter;
  fullscreenActive: boolean;
  fullscreenRequested: boolean;
  fullscreenError: string;
  followLatest: boolean;
  latestRequest: number;
}

const fullscreenRequest = {
  guard: "fullscreenAvailable", target: "changing", actions: "prepareFullscreen",
} as const;

export const audienceMachine = setup({
  types: {
    context: {} as AudienceContext,
    input: {} as { api: AudienceApi; fullscreen: FullscreenAdapter },
    events: {} as AudienceEvent | ViewEvent,
  },
  actors: {
    stream: fromCallback<AudienceEvent, AudienceApi>(({ input, sendBack }) => {
      try { return input.subscribe(sendBack); }
      catch { sendBack({ type: "stream.failed" }); }
    }),
    fullscreenChanges: fromCallback<AudienceEvent, FullscreenAdapter>(({ input, sendBack }) => input.subscribe(sendBack)),
    changeFullscreen: fromPromise(async ({ input }: { input: { adapter: FullscreenAdapter; active: boolean } }) => {
      await input.adapter.setActive(input.active);
      return input.adapter.isActive();
    }),
  },
  guards: { fullscreenAvailable: ({ context }) => context.fullscreen.available },
  actions: {
    prepareFullscreen: assign(({ context }) => ({ fullscreenRequested: !context.fullscreenActive, fullscreenError: "" })),
    receiveSnapshot: assign(({ context, event }) => {
      if (event.type !== "stream.snapshot") return {};
      const reset = context.visible !== event.snapshot.visible || (context.display?.display_mode ?? defaultDisplay.display_mode) !== (event.snapshot.display?.display_mode ?? defaultDisplay.display_mode);
      return { ...event.snapshot, followLatest: reset ? true : context.followLatest };
    }),
    observeScroll: assign(({ context, event }) => event.type === "display.scrolled" ? {
      followLatest: (context.display?.display_mode ?? defaultDisplay.display_mode) !== "scroll" || event.scrollHeight - event.clientHeight - event.scrollTop <= 24,
    } : {}),
  },
}).createMachine({
  id: "audience",
  type: "parallel",
  context: ({ input }) => ({
    api: input.api, fullscreen: input.fullscreen, visible: true, captions: [],
    fullscreenActive: input.fullscreen.isActive(), fullscreenRequested: false, fullscreenError: "", followLatest: true, latestRequest: 0,
  }),
  invoke: [
    { src: "stream", input: ({ context }) => context.api },
    { src: "fullscreenChanges", input: ({ context }) => context.fullscreen },
  ],
  on: {
    "display.fullscreen.changed": { actions: assign(({ event }) => ({ fullscreenActive: event.active })) },
    "display.scrolled": { actions: "observeScroll" },
    "display.latest.requested": { actions: assign(({ context }) => ({ followLatest: true, latestRequest: context.latestRequest + 1 })) },
  },
  states: {
    connection: {
      initial: "connecting",
      on: {
        "stream.opened": { target: ".live" },
        "stream.failed": { target: ".reconnecting" },
        "stream.snapshot": { target: ".live", actions: "receiveSnapshot" },
      },
      states: { connecting: {}, live: {}, reconnecting: {} },
    },
    fullscreen: {
      initial: "idle",
      states: {
        idle: { on: { "display.fullscreen.requested": fullscreenRequest } },
        changing: {
          invoke: {
            src: "changeFullscreen", input: ({ context }) => ({ adapter: context.fullscreen, active: context.fullscreenRequested }),
            onDone: { target: "idle", actions: assign(({ event }) => ({ fullscreenActive: event.output })) },
            onError: { target: "failed", actions: assign({ fullscreenError: "全画面に切り替えられませんでした。もう一度お試しください。" }) },
          },
        },
        failed: { on: { "display.fullscreen.requested": fullscreenRequest } },
      },
    },
  },
});

export type AudienceSnapshot = SnapshotFrom<typeof audienceMachine>;
