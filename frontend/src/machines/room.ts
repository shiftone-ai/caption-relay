import { assign, fromPromise, setup, type SnapshotFrom } from "xstate";
import { OperationError, type RoomBinding, type RoomDetails, type RoomsApi, type ViewEvent } from "../domain";

interface Context { api: RoomsApi; id: string; room: RoomDetails | null; unsaved: boolean; message: string; destination: boolean }
const binding = (context: Context): RoomBinding => ({ roomId: context.id, generation: context.room?.generation ?? 0 });
const message = (error: unknown) => error instanceof OperationError ? error.message : "ルームの状態を確認できませんでした。もう一度お試しください。";

export const roomMachine = setup({
  types: {} as { context: Context; events: ViewEvent; input: { api: RoomsApi; id: string } },
  actors: {
    connect: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) => input.api.connect(input.id, signal)),
    reset: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) => input.api.reset(binding(input), signal)),
    leave: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) => input.api.leave(binding(input), signal)),
  },
  guards: { unsaved: ({ context }) => context.unsaved },
}).createMachine({
  id: "room", initial: "connecting", context: ({ input }) => ({ api: input.api, id: input.id, room: null, unsaved: false, message: "", destination: false }),
  on: { "room.unsaved.changed": { actions: assign(({ event }) => ({ unsaved: event.unsaved })) } },
  states: {
    connecting: { invoke: { src: "connect", input: ({ context }) => context,
      onDone: { target: "ready", actions: assign(({ event }) => ({ room: event.output, message: "" })) },
      onError: { target: "failed", actions: assign(({ event }) => ({ message: message(event.error) })) } } },
    failed: { on: { "room.retry.requested": "connecting", "room.home.requested": "departed" } },
    ready: { on: {
      "room.home.requested": [{ guard: "unsaved", target: "confirmLeave" }, { target: "leaving" }],
      "room.reset.requested": "confirmReset",
    } },
    confirmReset: { on: { "room.confirm.cancelled": "ready", "room.confirm.accepted": "resetting" } },
    confirmLeave: { on: { "room.confirm.cancelled": "ready", "room.confirm.accepted": "leaving" } },
    resetting: { invoke: { src: "reset", input: ({ context }) => context,
      onDone: { target: "ready", actions: assign(({ event }) => ({ room: event.output, unsaved: false, message: "字幕をリセットしました。" })) },
      onError: { target: "ready", actions: assign(({ event }) => ({ message: message(event.error) })) } } },
    leaving: { invoke: { src: "leave", input: ({ context }) => context,
      onDone: "departed", onError: { target: "ready", actions: assign(({ event }) => ({ message: message(event.error) })) } } },
    departed: { type: "final", entry: assign({ destination: true }) },
  },
});
export type RoomSnapshot = SnapshotFrom<typeof roomMachine>;
