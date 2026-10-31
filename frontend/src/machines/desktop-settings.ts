import { assign, fromPromise, setup, type SnapshotFrom } from "xstate";
import { OperationError, type ViewEvent } from "../domain";
import { credentialFields, type CredentialKey, type CredentialsApi } from "../desktop";

interface Context {
  api: CredentialsApi;
  configured: Partial<Record<CredentialKey, boolean>>;
  values: Partial<Record<CredentialKey, string>>;
  removals: Partial<Record<CredentialKey, boolean>>;
  sttRate: string;
  message: string;
}
const changes = (context: Context) => Object.fromEntries(credentialFields.flatMap(({ key }) => context.removals[key]
  ? [[key, ""]] : context.values[key]?.trim() && !(key === "CAPTION_RELAY_STT_JPY_PER_USD" && context.values[key] === context.sttRate)
    ? [[key, context.values[key]!.trim()]] : []));
const errorMessage = (error: unknown) => error instanceof OperationError ? error.message : "設定を読み書きできません。もう一度お試しください。";

export const desktopSettingsMachine = setup({
  types: {} as { context: Context; events: ViewEvent; input: { api: CredentialsApi } },
  actors: {
    status: fromPromise(({ input }: { input: CredentialsApi }) => input.status()),
    save: fromPromise(({ input }: { input: Context }) => input.api.save(changes(input))),
  },
  guards: { changed: ({ context }) => Object.keys(changes(context)).length > 0 },
}).createMachine({
  context: ({ input }) => ({ api: input.api, configured: {}, values: {}, removals: {}, sttRate: "", message: "" }),
  initial: "loading",
  states: {
    loading: { invoke: { src: "status", input: ({ context }) => context.api,
      onDone: { target: "ready", actions: assign({ configured: ({ event }) => event.output.configured,
        values: ({ event }) => ({ CAPTION_RELAY_STT_JPY_PER_USD: event.output.stt_rate }),
        sttRate: ({ event }) => event.output.stt_rate, message: "" }) },
      onError: { target: "failed", actions: assign({ message: ({ event }) => errorMessage(event.error) }) } } },
    failed: { on: { "desktop.retry.requested": "loading" } },
    ready: { on: {
      "desktop.changed": { actions: assign(({ context, event }) => ({ values: { ...context.values, [event.key]: event.value }, message: "" })) },
      "desktop.removal.changed": { actions: assign(({ context, event }) => ({ removals: { ...context.removals, [event.key]: event.remove }, message: "" })) },
      "desktop.save.requested": { target: "confirming", guard: "changed" },
    } },
    confirming: { on: { "desktop.save.cancelled": "ready", "desktop.save.confirmed": "saving" } },
    saving: { invoke: { src: "save", input: ({ context }) => context,
      onDone: "restarting", onError: { target: "ready", actions: assign({ message: ({ event }) => errorMessage(event.error) }) } } },
    restarting: {},
  },
});
export type DesktopSettingsSnapshot = SnapshotFrom<typeof desktopSettingsMachine>;
