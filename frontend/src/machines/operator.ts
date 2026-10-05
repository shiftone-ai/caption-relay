import { assign, fromPromise, setup, type SnapshotFrom } from "xstate";
import { CaptionConflict, type Caption, type Draft, type OperatorApi, type OperatorEvent, type SaveRequest } from "../domain";

interface OperatorContext {
  api: OperatorApi;
  visible: boolean;
  captions: Caption[];
  drafts: Map<string, Draft>;
  pendingSave: SaveRequest | null;
  error: string;
  errorSource: "load" | "save" | "command" | null;
}

function getSaveRequest(context: OperatorContext, captionId: string): SaveRequest | null {
  const caption = context.captions.find(item => item.id === captionId);
  if (!caption) return null;
  const draft = context.drafts.get(captionId) ?? { text: caption.text, baseRevision: caption.revision };
  return { captionId, ...draft };
}

const saveTransitions = [
  { guard: "validSave", target: "saving", actions: "prepareSave" },
  { actions: "invalidSave" },
] as const;

const operations = {
  "caption.save.requested": saveTransitions,
  "visibility.toggle.requested": { target: "toggling", actions: "clearError" },
  "test.requested": { target: "testing", actions: "clearError" },
} as const;

export const operatorMachine = setup({
  types: {
    context: {} as OperatorContext,
    events: {} as OperatorEvent,
    input: {} as { api: OperatorApi },
  },
  actors: {
    load: fromPromise(async ({ input, signal }: { input: OperatorApi; signal: AbortSignal }) => input.load(signal)),
    save: fromPromise(async ({ input, signal }: {
      input: { api: OperatorApi; request: SaveRequest }; signal: AbortSignal;
    }) => input.api.save(input.request, signal)),
    toggle: fromPromise(async ({ input, signal }: {
      input: { api: OperatorApi; visible: boolean }; signal: AbortSignal;
    }) => input.api.setVisible(input.visible, signal)),
    test: fromPromise(async ({ input, signal }: { input: OperatorApi; signal: AbortSignal }) => input.sendTest(signal)),
  },
  guards: {
    validSave: ({ context, event }) => event.type === "caption.save.requested"
      && Boolean(getSaveRequest(context, event.captionId)?.text.trim()),
    canEdit: ({ context, event }) => event.type === "caption.draft.changed"
      && context.pendingSave?.captionId !== event.captionId
      && context.captions.some(caption => caption.id === event.captionId),
  },
  actions: {
    clearError: assign({ error: "", errorSource: null }),
    invalidSave: assign({ error: "字幕を入力してください。", errorSource: "save" }),
    prepareSave: assign(({ context, event }) => ({
      pendingSave: event.type === "caption.save.requested" ? getSaveRequest(context, event.captionId) : null,
      error: "", errorSource: null,
    })),
    editDraft: assign(({ context, event }) => {
      if (event.type !== "caption.draft.changed") return {};
      const drafts = new Map(context.drafts);
      const caption = context.captions.find(item => item.id === event.captionId)!;
      const previous = drafts.get(caption.id);
      drafts.set(caption.id, {
        text: event.text, baseRevision: previous?.baseRevision ?? caption.revision,
        conflict: previous?.conflict,
      });
      return { drafts };
    }),
  },
}).createMachine({
  id: "operator",
  initial: "loading",
  context: ({ input }) => ({
    api: input.api, visible: true, captions: [], drafts: new Map(), pendingSave: null,
    error: "", errorSource: null,
  }),
  states: {
    loading: {
      invoke: {
        src: "load", input: ({ context }) => context.api,
        onDone: { target: "ready", actions: assign(({ event }) => ({ ...event.output, error: "", errorSource: null })) },
        onError: { target: "failed", actions: assign({ error: "字幕を取得できませんでした。接続を確認してください。", errorSource: "load" }) },
      },
    },
    failed: {
      after: { 1500: "loading" },
      on: { "refresh.requested": "loading" },
    },
    ready: {
      initial: "idle",
      on: { "caption.draft.changed": { guard: "canEdit", actions: "editDraft" } },
      states: {
        idle: {
          after: { 1500: "refreshing" },
          on: { ...operations, "refresh.requested": "refreshing" },
        },
        refreshing: {
          on: operations,
          invoke: {
            src: "load", input: ({ context }) => context.api,
            onDone: { target: "idle", actions: assign(({ context, event }) => ({
              ...event.output,
              drafts: new Map([...context.drafts].filter(([id]) => event.output.captions.some(caption => caption.id === id))),
              error: context.errorSource === "load" ? "" : context.error,
              errorSource: context.errorSource === "load" ? null : context.errorSource,
            })) },
            onError: { target: "idle", actions: assign({ error: "字幕を取得できませんでした。接続を確認してください。", errorSource: "load" }) },
          },
        },
        saving: {
          invoke: {
            src: "save", input: ({ context }) => ({ api: context.api, request: context.pendingSave! }),
            onDone: { target: "idle", actions: assign(({ context, event }) => {
              const drafts = new Map(context.drafts);
              drafts.delete(event.output.id);
              return {
                captions: context.captions.map(caption => caption.id === event.output.id ? event.output : caption),
                drafts, pendingSave: null,
              };
            }) },
            onError: { target: "idle", actions: assign(({ context, event }) => {
              const pending = context.pendingSave!;
              const drafts = new Map(context.drafts);
              if (event.error instanceof CaptionConflict) {
                const latest = event.error.latest;
                drafts.set(pending.captionId, {
                  text: pending.text, baseRevision: latest.revision,
                  conflict: `競合しました。最新の字幕: ${latest.text}。修正案を確認して再反映してください。`,
                });
                return {
                  drafts, pendingSave: null,
                  captions: context.captions.map(caption => caption.id === latest.id ? latest : caption),
                };
              }
              drafts.set(pending.captionId, { text: pending.text, baseRevision: pending.baseRevision });
              return { drafts, pendingSave: null, error: "反映できませんでした。修正内容は保持しています。", errorSource: "save" as const };
            }) },
          },
        },
        toggling: {
          invoke: {
            src: "toggle", input: ({ context }) => ({ api: context.api, visible: !context.visible }),
            onDone: { target: "refreshing", actions: assign({ visible: ({ event }) => event.output }) },
            onError: { target: "idle", actions: assign({ error: "表示を切り替えられませんでした。接続を確認してください。", errorSource: "command" }) },
          },
        },
        testing: {
          invoke: {
            src: "test", input: ({ context }) => context.api,
            onDone: "refreshing",
            onError: { target: "idle", actions: assign({ error: "テスト字幕を送れませんでした。接続を確認してください。", errorSource: "command" }) },
          },
        },
      },
    },
  },
});

export type OperatorSnapshot = SnapshotFrom<typeof operatorMachine>;
