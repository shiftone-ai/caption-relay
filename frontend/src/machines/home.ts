import { formLimits } from "../generated/form-limits";
import { assign, fromPromise, setup, type SnapshotFrom } from "xstate";
import { backgroundValidation, defaultAiSettings } from "../ai";
import { OperationError, type AiSettings, type HomeEvent, type RoomCatalog, type RoomDetails, type RoomsApi, type ViewEvent } from "../domain";

interface Form {
  name: string;
  mode: "host" | "client";
  inputSource: "udtalk" | "microphone";
  editorUrl: string;
  ai: AiSettings;
  storedLink: boolean;
  connectionSettings: RoomDetails["connection"];
}
interface Context {
  api: RoomsApi;
  catalog: RoomCatalog;
  form: Form;
  formOpen: boolean;
  editingRoomId: string | null;
  requestedRoomId: string;
  destination: string | null;
  message: string;
  notice: string;
  invalidField: "name" | "background" | null;
  focusVersion: number;
  focusReturnRoomId: string | null;
}

const emptyForm = (): Form => ({ name: "", mode: "client", inputSource: "udtalk", editorUrl: "", ai: { ...defaultAiSettings }, storedLink: false,
  connectionSettings: { mode: "client", input_source: "udtalk", recognizer: "openai", zoom_text_format: "plain" } });
const message = (error: unknown) => error instanceof OperationError ? error.message : "ルームの接続を確認できませんでした。もう一度お試しください。";
const knownRoom = (context: Context, event: HomeEvent) => "roomId" in event && context.catalog.rooms.some(room => room.id === event.roomId);

const roomFormValidation = (form: Form) => {
  if (Array.from(form.name.trim()).length > formLimits.roomName) return { field: "name" as const, message: `ルーム名は${formLimits.roomName}文字以内で入力してください。` };
  const background = backgroundValidation(form.ai.background);
  return background ? { field: "background" as const, message: background } : null;
};
const canSubmitRoom = (context: Context) => context.formOpen && Boolean(context.form.name.trim())
  && !roomFormValidation(context.form) && (context.form.mode === "host" || Boolean(context.form.editorUrl.trim()) || context.form.storedLink);

export const homeMachine = setup({
  types: {} as { context: Context; events: ViewEvent; input: { api: RoomsApi } },
  actors: {
    delete: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) => {
      const room = input.catalog.rooms.find(room => room.id === input.requestedRoomId)!;
      return input.api.delete({ roomId: room.id, generation: room.generation }, signal);
    }),
    catalog: fromPromise(({ input, signal }: { input: RoomsApi; signal: AbortSignal }) => input.catalog(signal)),
    details: fromPromise(({ input, signal }: { input: { api: RoomsApi; id: string }; signal: AbortSignal }) => input.api.details(input.id, signal)),
    connect: fromPromise(({ input, signal }: { input: { api: RoomsApi; id: string }; signal: AbortSignal }) => input.api.connect(input.id, signal)),
    save: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) => input.api.save({ name: input.form.name.trim(), ai: input.form.ai,
      connection: { ...input.form.connectionSettings, mode: input.form.mode, input_source: input.form.mode === "client" ? "udtalk" : input.form.inputSource,
        editor_url: input.form.mode === "client" ? input.form.editorUrl.trim() || null : null } }, input.editingRoomId, signal)),
  },
  guards: {
    canDelete: ({ context, event }) => event.type === "home.delete.requested" && !context.formOpen && context.catalog.rooms.some(room => room.id === event.roomId && room.deletable),
    knownRoom: ({ context, event }) => knownRoom(context, event as HomeEvent),
    validForm: ({ context }) => canSubmitRoom(context),
    submitKey: ({ context, event }) => event.type === "home.form.keypressed" && event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing
      && canSubmitRoom(context),
  },
  actions: {
    newForm: assign(({ context }) => ({ form: emptyForm(), formOpen: true, editingRoomId: null, message: "", notice: "", invalidField: null, focusVersion: context.focusVersion + 1 })),
    changeForm: assign(({ context, event }) => {
      if (event.type !== "home.form.changed" || !context.formOpen) return {};
      const form = { ...context.form };
      if (event.field === "name") form.name = event.value;
      if (event.field === "background") form.ai = { ...form.ai, background: event.value };
      if (event.field === "editorUrl") form.editorUrl = event.value;
      if (event.field === "mode" && (event.value === "host" || event.value === "client")) form.mode = event.value;
      if (event.field === "inputSource" && (event.value === "udtalk" || event.value === "microphone")) form.inputSource = event.value;
      const issue = roomFormValidation(form);
      return { form, message: issue?.message ?? "", invalidField: issue?.field ?? null };
    }),
    requestRoom: assign(({ event }) => "roomId" in event ? { requestedRoomId: event.roomId, message: "", notice: "" } : {}),
  },
}).createMachine({
  id: "home", initial: "loading",
  context: ({ input }) => ({ api: input.api, catalog: { active_room_id: null, rooms: [] }, form: emptyForm(), formOpen: false,
    editingRoomId: null, requestedRoomId: "", destination: null, message: "", notice: "", invalidField: null, focusVersion: 0, focusReturnRoomId: null }),
  states: {
    loading: { invoke: { src: "catalog", input: ({ context }) => context.api,
      onDone: { target: "ready", actions: assign(({ event }) => ({ catalog: event.output, message: "" })) },
      onError: { target: "failed", actions: assign(({ event }) => ({ message: message(event.error) })) } } },
    failed: { on: { "home.retry.requested": "loading" } },
    ready: { on: {
      "home.delete.requested": { guard: "canDelete", target: "confirmDelete", actions: "requestRoom" },
      "home.new.requested": { actions: "newForm" },
      "home.form.changed": { actions: "changeForm" },
      "home.form.cancelled": { actions: assign(({ context }) => ({ formOpen: false, message: "", invalidField: null, editingRoomId: null,
        focusReturnRoomId: context.editingRoomId, focusVersion: context.focusVersion + 1 })) },
      "home.save.requested": { guard: "validForm", target: "saving" },
      "home.form.keypressed": { guard: "submitKey", target: "saving" },
      "home.connect.requested": { guard: "knownRoom", target: "connecting", actions: "requestRoom" },
      "home.edit.requested": { guard: "knownRoom", target: "reading", actions: "requestRoom" },
    } },
    confirmDelete: { on: {
      "home.delete.cancelled": { target: "ready" },
      "home.delete.confirmed": { target: "deleting" },
    } },
    deleting: { invoke: { src: "delete", input: ({ context }) => context,
      onDone: { target: "ready", actions: assign(({ context, event }) => ({ catalog: event.output, message: "", notice: "ルームを削除しました。",
        focusReturnRoomId: null, focusVersion: context.focusVersion + 1 })) },
      onError: { target: "refreshing", actions: assign(({ event }) => ({ message: message(event.error) })) } } },
    refreshing: { invoke: { src: "catalog", input: ({ context }) => context.api,
      onDone: { target: "ready", actions: assign(({ event }) => ({ catalog: event.output })) },
      onError: { target: "ready" } } },
    reading: { invoke: { src: "details", input: ({ context }) => ({ api: context.api, id: context.requestedRoomId }),
      onDone: { target: "ready", actions: assign(({ context, event }) => { const room: RoomDetails = event.output; return {
        editingRoomId: room.id, formOpen: true, invalidField: null, form: { name: room.name, mode: room.connection.mode ?? "host", inputSource: room.connection.input_source ?? "udtalk",
          editorUrl: "", storedLink: room.connection.mode === "client", ai: { ...defaultAiSettings, ...room.ai }, connectionSettings: room.connection }, focusVersion: context.focusVersion + 1,
      }; }) }, onError: { target: "ready", actions: assign(({ event }) => ({ message: message(event.error) })) } } },
    saving: { invoke: { src: "save", input: ({ context }) => context,
      onDone: { target: "connecting", actions: assign(({ context, event }) => ({ requestedRoomId: event.output.id, editingRoomId: event.output.id,
        catalog: { ...context.catalog, rooms: [event.output, ...context.catalog.rooms.filter(room => room.id !== event.output.id)] },
        form: { name: event.output.name, mode: event.output.connection.mode ?? "host", inputSource: event.output.connection.input_source ?? "udtalk",
          editorUrl: "", storedLink: event.output.connection.mode === "client", ai: { ...defaultAiSettings, ...event.output.ai }, connectionSettings: event.output.connection } })) },
      onError: { target: "ready", actions: assign(({ event }) => ({ message: message(event.error) })) } } },
    connecting: { invoke: { src: "connect", input: ({ context }) => ({ api: context.api, id: context.requestedRoomId }),
      onDone: { target: "connected", actions: assign(({ event }) => ({ destination: event.output.id, form: emptyForm() })) },
      onError: { target: "ready", actions: assign(({ event }) => ({ message: message(event.error) })) } } },
    connected: { type: "final" },
  },
});
export type HomeSnapshot = SnapshotFrom<typeof homeMachine>;
