import { assign, fromPromise, setup, type SnapshotFrom } from "xstate";
import { CaptionConflict, type AiRouting, type AiSettings, type Caption, type DisplaySettings, type Draft, type OperatorApi, type OperatorEvent, type PublicationMode, type SaveRequest } from "../domain";
import { changeDisplayField, defaultDisplay, selectDisplayPalette } from "../display";
import { aiStrategies, defaultAi, knownAiModel } from "../ai";

interface OperatorContext {
  api: OperatorApi;
  visible: boolean;
  captions: Caption[];
  drafts: Map<string, Draft>;
  pendingSave: SaveRequest | null;
  error: string;
  errorSource: "load" | "save" | "command" | null;
  errorCaptionId: string | null;
  activeCaptionId: string | null;
  followLatest: boolean;
  latestRequest: number;
  scrollTarget: "latest" | "caption";
  editorFocusRequest: number;
  unreadIds: string[];
  saveStatus: { captionId: string; message: string } | null;
  autoPublish: boolean;
  requestedMode: PublicationMode;
  display: DisplaySettings;
  displayDraft: DisplaySettings | null;
  settingsOpen: boolean;
  ai: AiRouting;
  aiDraft: AiSettings | null;
  aiSettingsOpen: boolean;
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

function isSaveShortcut(event: OperatorEvent) {
  return event.type === "caption.editor.keypressed" && !event.isComposing
    && event.key === "Enter" && (event.ctrlKey || event.metaKey);
}

const operations = {
  "caption.save.requested": saveTransitions,
  "caption.editor.keypressed": [
    { guard: "validShortcutSave", target: "saving", actions: "prepareSave" },
    { guard: "invalidShortcutSave", actions: "invalidSave" },
  ],
  "visibility.toggle.requested": { target: "toggling", actions: "clearError" },
  "test.requested": { target: "testing", actions: "clearError" },
  "publication.mode.requested": { guard: "validMode", target: "settingMode", actions: "prepareMode" },
  "display.save.requested": { target: "settingDisplay", actions: "clearError" },
  "display.field.changed": { actions: "editDisplay" },
  "display.palette.selected": { actions: "editDisplay" },
  "ai.strategy.selected": { guard: "validAiStrategy", actions: "editAi" },
  "ai.preferred.selected": { guard: "validAiModel", actions: "editAi" },
  "ai.candidate.changed": { guard: "canChangeAiCandidate", actions: "editAi" },
  "ai.save.requested": { target: "settingAi", actions: "clearError" },
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
    mode: fromPromise(async ({ input, signal }: { input: { api: OperatorApi; mode: PublicationMode }; signal: AbortSignal }) => input.api.setPublicationMode(input.mode, signal)),
    display: fromPromise(async ({ input, signal }: { input: { api: OperatorApi; settings: DisplaySettings }; signal: AbortSignal }) => input.api.setDisplay(input.settings, signal)),
    ai: fromPromise(async ({ input, signal }: { input: { api: OperatorApi; settings: AiSettings }; signal: AbortSignal }) => input.api.setAi(input.settings, signal)),
  },
  guards: {
    validMode: ({ event }) => event.type === "publication.mode.requested" && (event.mode === "auto" || event.mode === "manual"),
    validShortcutSave: ({ context, event }) => isSaveShortcut(event) && event.type === "caption.editor.keypressed"
      && context.activeCaptionId === event.captionId && Boolean(getSaveRequest(context, event.captionId)?.text.trim()),
    invalidShortcutSave: ({ context, event }) => isSaveShortcut(event) && event.type === "caption.editor.keypressed"
      && context.activeCaptionId === event.captionId && Boolean(getSaveRequest(context, event.captionId))
      && !getSaveRequest(context, event.captionId)?.text.trim(),
    closeShortcut: ({ context, event }) => event.type === "caption.editor.keypressed" && !event.isComposing
      && event.key === "Escape" && context.activeCaptionId === event.captionId,
    closeSettingsShortcut: ({ context, event }) => event.type === "settings.keypressed" && !event.isComposing
      && event.key === "Escape" && (context.settingsOpen || context.aiSettingsOpen),
    hasEditor: ({ context }) => context.activeCaptionId !== null,
    validAiStrategy: ({ event }) => event.type === "ai.strategy.selected" && Object.keys(aiStrategies).includes(event.value),
    validAiModel: ({ event }) => event.type === "ai.preferred.selected" && knownAiModel(event.modelId),
    canChangeAiCandidate: ({ context, event }) => event.type === "ai.candidate.changed" && knownAiModel(event.modelId)
      && (event.included || event.modelId !== (context.aiDraft ?? context.ai.settings).preferred_model),
    validSave: ({ context, event }) => event.type === "caption.save.requested"
      && Boolean(getSaveRequest(context, event.captionId)?.text.trim()),
    canEdit: ({ context, event }) => event.type === "caption.draft.changed"
      && context.pendingSave?.captionId !== event.captionId
      && context.captions.some(caption => caption.id === event.captionId),
    canSelect: ({ context, event }) => event.type === "caption.edit.requested"
      && context.captions.some(caption => caption.id === event.captionId),
    canDiscard: ({ context, event }) => event.type === "caption.draft.discarded"
      && context.pendingSave?.captionId !== event.captionId,
  },
  actions: {
    clearError: assign({ error: "", errorSource: null, errorCaptionId: null }),
    invalidSave: assign(({ event }) => ({ error: "字幕を入力してください。", errorSource: "save" as const, saveStatus: null,
      errorCaptionId: event.type === "caption.save.requested" || event.type === "caption.editor.keypressed" ? event.captionId : null })),
    prepareSave: assign(({ context, event }) => ({
      pendingSave: event.type === "caption.save.requested" || event.type === "caption.editor.keypressed" ? getSaveRequest(context, event.captionId) : null,
      error: "", errorSource: null, errorCaptionId: null, saveStatus: null,
    })),
    prepareMode: assign(({ event }) => ({ requestedMode: { auto_publish: event.type === "publication.mode.requested" && event.mode === "auto" },
      error: "", errorSource: null, errorCaptionId: null })),
    editDisplay: assign(({ context, event }) => {
      const settings = context.displayDraft ?? context.display;
      if (event.type === "display.field.changed") return { displayDraft: changeDisplayField(settings, event.field, event.value) };
      if (event.type === "display.palette.selected") return { displayDraft: selectDisplayPalette(settings, event.value) };
      return {};
    }),
    editAi: assign(({ context, event }) => {
      const settings = context.aiDraft ?? context.ai.settings;
      if (event.type === "ai.strategy.selected") {
        const strategy = Object.keys(aiStrategies).find(value => value === event.value) as AiSettings["strategy"];
        return { aiDraft: { ...settings, strategy } };
      }
      if (event.type === "ai.preferred.selected" && knownAiModel(event.modelId)) {
        return { aiDraft: { ...settings, preferred_model: event.modelId,
          candidates: [...new Set([...settings.candidates, event.modelId])] } };
      }
      if (event.type === "ai.candidate.changed" && knownAiModel(event.modelId)) {
        return { aiDraft: { ...settings, candidates: event.included ? [...new Set([...settings.candidates, event.modelId])]
          : settings.candidates.filter(id => id !== event.modelId) } };
      }
      return {};
    }),
    selectCaption: assign(({ context, event }) => {
      if (event.type !== "caption.edit.requested") return {};
      if (context.activeCaptionId === event.captionId && !context.settingsOpen && !context.aiSettingsOpen) return { activeCaptionId: null };
      const drafts = new Map(context.drafts);
      const caption = context.captions.find(item => item.id === event.captionId)!;
      if (!drafts.has(caption.id)) drafts.set(caption.id, { text: caption.text, baseRevision: caption.revision });
      return { drafts, activeCaptionId: caption.id, followLatest: false, scrollTarget: "caption" as const,
        latestRequest: context.latestRequest + 1, editorFocusRequest: context.editorFocusRequest + 1, settingsOpen: false, aiSettingsOpen: false };
    }),
    discardDraft: assign(({ context, event }) => {
      if (event.type !== "caption.draft.discarded") return {};
      const drafts = new Map(context.drafts);
      drafts.delete(event.captionId);
      return { drafts, activeCaptionId: null, error: "", errorSource: null, errorCaptionId: null, saveStatus: null };
    }),
    editDraft: assign(({ context, event }) => {
      if (event.type !== "caption.draft.changed") return {};
      const drafts = new Map(context.drafts);
      const caption = context.captions.find(item => item.id === event.captionId)!;
      const previous = drafts.get(caption.id);
      drafts.set(caption.id, {
        text: event.text, baseRevision: previous?.baseRevision ?? caption.revision,
        conflict: previous?.conflict,
      });
      return { drafts, saveStatus: context.saveStatus?.captionId === caption.id ? null : context.saveStatus };
    }),
  },
}).createMachine({
  id: "operator",
  initial: "loading",
  context: ({ input }) => ({
    api: input.api, visible: true, captions: [], drafts: new Map(), pendingSave: null,
    error: "", errorSource: null, errorCaptionId: null, activeCaptionId: null,
    followLatest: true, latestRequest: 0, scrollTarget: "latest", editorFocusRequest: 0, unreadIds: [], saveStatus: null, autoPublish: true,
    requestedMode: { auto_publish: true },
    display: defaultDisplay, displayDraft: null, settingsOpen: false,
    ai: defaultAi, aiDraft: null, aiSettingsOpen: false,
  }),
  states: {
    loading: {
      invoke: {
        src: "load", input: ({ context }) => context.api,
        onDone: { target: "ready", actions: assign(({ context, event }) => ({ ...event.output, error: "", errorSource: null,
          unreadIds: [], latestRequest: context.latestRequest + 1 })) },
        onError: { target: "failed", actions: assign({ error: "字幕を取得できませんでした。接続を確認してください。", errorSource: "load" }) },
      },
    },
    failed: {
      after: { 1500: "loading" },
      on: { "refresh.requested": "loading" },
    },
    ready: {
      initial: "idle",
      on: {
        "caption.draft.changed": { guard: "canEdit", actions: "editDraft" },
        "caption.edit.requested": { guard: "canSelect", actions: "selectCaption" },
        "caption.edit.closed": { actions: assign({ activeCaptionId: null }) },
        "caption.editor.keypressed": { guard: "closeShortcut", actions: assign({ activeCaptionId: null }) },
        "caption.draft.discarded": { guard: "canDiscard", actions: "discardDraft" },
        "timeline.latest.requested": { actions: assign(({ context }) => ({ followLatest: true, unreadIds: [], scrollTarget: "latest" as const,
          latestRequest: context.latestRequest + 1, editorFocusRequest: context.activeCaptionId ? context.editorFocusRequest + 1 : context.editorFocusRequest })) },
        "timeline.editing.requested": { guard: "hasEditor", actions: assign(({ context }) => ({ followLatest: false,
          scrollTarget: "caption" as const, latestRequest: context.latestRequest + 1, editorFocusRequest: context.editorFocusRequest + 1 })) },
        "timeline.scrolled": { actions: assign(({ context, event }) => {
          const followLatest = event.scrollHeight - event.clientHeight - event.scrollTop < 8;
          return { followLatest, unreadIds: followLatest ? [] : context.unreadIds };
        }) },
        "timeline.resized": { actions: assign(({ context }) => context.followLatest
          ? { scrollTarget: "latest" as const, latestRequest: context.latestRequest + 1 } : {}) },
        "settings.keypressed": { guard: "closeSettingsShortcut", actions: assign({ settingsOpen: false, aiSettingsOpen: false }) },
        "display.settings.toggled": { actions: assign(({ context }) => ({ settingsOpen: !context.settingsOpen, aiSettingsOpen: false })) },
        "ai.settings.toggled": { actions: assign(({ context }) => ({ aiSettingsOpen: !context.aiSettingsOpen, settingsOpen: false })) },
      },
      states: {
        idle: {
          after: { 1500: "refreshing" },
          on: { ...operations, "refresh.requested": "refreshing" },
        },
        refreshing: {
          on: operations,
          invoke: {
            src: "load", input: ({ context }) => context.api,
            onDone: { target: "idle", actions: assign(({ context, event }) => {
              const ids = new Set(context.captions.map(caption => caption.id));
              const incoming = event.output.captions.filter(caption => !ids.has(caption.id)).map(caption => caption.id);
              const timelineChanged = event.output.captions.length !== context.captions.length
                || event.output.captions.some((caption, index) => caption.id !== context.captions[index]?.id || caption.text !== context.captions[index]?.text || caption.original !== context.captions[index]?.original);
              return {
                ...event.output,
                drafts: new Map([...context.drafts].filter(([id]) => event.output.captions.some(caption => caption.id === id))),
                activeCaptionId: event.output.captions.some(caption => caption.id === context.activeCaptionId) ? context.activeCaptionId : null,
                unreadIds: context.followLatest ? [] : [...new Set([...context.unreadIds, ...incoming])].filter(id => event.output.captions.some(caption => caption.id === id)),
                latestRequest: context.followLatest && timelineChanged ? context.latestRequest + 1 : context.latestRequest,
                scrollTarget: context.followLatest ? "latest" as const : context.scrollTarget,
                error: context.errorSource === "load" ? "" : context.error,
                errorSource: context.errorSource === "load" ? null : context.errorSource,
              };
            }) },
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
                saveStatus: { captionId: event.output.id, message: context.visible && event.output.publish_eligible && event.output.source_final !== false
                  && event.output.published && (event.output.public_text ?? event.output.text) === event.output.text
                  ? "保存して公開しました。" : "保存しました。観客の表示は変わりません。" },
                latestRequest: context.followLatest ? context.latestRequest + 1 : context.latestRequest,
              };
            }) },
            onError: { target: "idle", actions: assign(({ context, event }) => {
              const pending = context.pendingSave!;
              const drafts = new Map(context.drafts);
              const retainedText = drafts.get(pending.captionId)?.text ?? pending.text;
              if (event.error instanceof CaptionConflict) {
                const latest = event.error.latest;
                drafts.set(pending.captionId, {
                  text: retainedText, baseRevision: latest.revision,
                  conflict: `別の更新がありました。保存済みの表示文「${latest.text}」を確認して、もう一度保存してください。`,
                });
                return {
                  drafts, pendingSave: null,
                  captions: context.captions.map(caption => caption.id === latest.id ? latest : caption),
                };
              }
              drafts.set(pending.captionId, { text: retainedText, baseRevision: pending.baseRevision });
              return { drafts, pendingSave: null, error: "保存できませんでした。修正内容は保持しています。もう一度保存してください。", errorSource: "save" as const, errorCaptionId: pending.captionId };
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
        settingMode: {
          invoke: {
            src: "mode", input: ({ context }) => ({ api: context.api, mode: context.requestedMode }),
            onDone: { target: "refreshing", actions: assign(({ event }) => ({ autoPublish: event.output.auto_publish })) },
            onError: { target: "idle", actions: assign({ error: "反映モードを変更できませんでした。もう一度お試しください。", errorSource: "command" }) },
          },
        },
        settingDisplay: {
          invoke: {
            src: "display", input: ({ context }) => ({ api: context.api, settings: context.displayDraft ?? context.display }),
            onDone: { target: "idle", actions: assign(({ event }) => ({ display: event.output, displayDraft: null })) },
            onError: { target: "idle", actions: assign({ error: "表示設定を反映できませんでした。設定内容は保持しています。", errorSource: "command" }) },
          },
        },
        settingAi: {
          invoke: {
            src: "ai", input: ({ context }) => ({ api: context.api, settings: context.aiDraft ?? context.ai.settings }),
            onDone: { target: "idle", actions: assign(({ event }) => ({ ai: event.output, aiDraft: null })) },
            onError: { target: "idle", actions: assign({ error: "AI設定を保存できませんでした。設定内容は保持しています。", errorSource: "command" }) },
          },
        },
      },
    },
  },
});

export type OperatorSnapshot = SnapshotFrom<typeof operatorMachine>;
