import { assign, fromPromise, sendTo, setup, type SnapshotFrom } from "xstate";
import { microphoneActor } from "./microphone";
import type { MicrophoneAdapter, MicrophoneDevice, TranscriptionStatus } from "../domain";
import { CaptionConflict, OperationError, disclosureIds, type DisclosureId, type ConnectionSettings, type ConnectionStatus, type AiRouting, type AiSettings, type Caption, type DisplaySettings, type Draft, type OperatorApi, type ViewEvent, type PublicationMode, type SaveRequest, type StatusTooltipGeometry } from "../domain";
import { changeDisplayField, defaultDisplay, selectDisplayPalette } from "../display";
import { backgroundValidation, editableAiSettings, defaultAi, knownAiModel } from "../ai";
import { defaultConnection } from "../connection";
import { dictionaryLimits, dictionaryUpdate, dictionaryValidation, draftDictionary, emptyDictionary, type DictionaryDraft, type DictionaryIssue } from "../dictionary";
import type { DictionarySnapshot, DictionaryUpdate } from "../domain";

type StatusTarget = { captionId: string; kind: "source" | "publication" };
type SettingsPanel = "display" | "ai" | "connection" | "dictionary";

interface StatusTooltipPosition {
  top: number;
  left: number;
  maxWidth: number;
  maxHeight: number;
  bridge: { top: number; left: number; width: number; height: number };
}

interface OperatorContext {
  microphone?: MicrophoneAdapter;
  microphoneState: TranscriptionStatus["state"];
  microphoneMessage: string;
  microphoneLabel: string;
  microphoneDevices: MicrophoneDevice[];
  microphoneDeviceId: string;
  api: OperatorApi;
  visible: boolean;
  captions: Caption[];
  captionsById: Map<string, Caption>;
  drafts: Map<string, Draft>;
  pendingSave: SaveRequest | null;
  error: string;
  errorSource: "load" | "save" | "command" | null;
  errorCaptionId: string | null;
  activeCaptionId: string | null;
  editingCaptionVisible: boolean;
  inspectorWidth: number;
  inspectorMaxWidth: number;
  inspectorPreviewWidth: number | null;
  inspectorResize: { pointerId: number; right: number } | null;
  followLatest: boolean;
  atLatest: boolean;
  latestRequest: number;
  scrollTarget: "latest" | "caption";
  editorFocusRequest: number;
  historyFocusRequest: number;
  historyFocusCaptionId: string | null;
  settingsPanel: SettingsPanel | null;
  settingsFocusTarget: { panel: SettingsPanel; destination: "field" | "trigger" }
    | { panel: "dictionary"; destination: "word"; index: number; field: NonNullable<DictionaryIssue["field"]> }
    | { panel: "dictionary"; destination: "add" | "error" } | null;
  settingsFocusRequest: number;
  openedDisclosures: Set<DisclosureId>;
  statusTooltip: { pointer: StatusTarget | null; focus: StatusTarget | null; dismissed: StatusTarget | null;
    measurement: (StatusTarget & { geometry: StatusTooltipGeometry; position: StatusTooltipPosition }) | null };
  unreadIds: string[];
  saveStatus: { captionId: string; message: string } | null;
  autoPublish: boolean;
  requestedMode: PublicationMode;
  display: DisplaySettings;
  displayDraft: DisplaySettings | null;
  ai: AiRouting;
  aiDraft: AiSettings | null;
  aiError: string;
  aiBackgroundInvalid: boolean;
  aiBackgroundExpanded: boolean;
  dictionary: DictionarySnapshot;
  dictionaryDraft: DictionaryDraft | null;
  dictionaryError: DictionaryIssue | null;
  dictionaryNotice: string;
  connection: ConnectionStatus;
  receiverUrl: string;
  connectionDraft: ConnectionSettings | null;
}

function getSaveRequest(context: OperatorContext, captionId: string): SaveRequest | null {
  const caption = context.captionsById.get(captionId);
  if (!caption) return null;
  const draft = context.drafts.get(captionId) ?? { text: caption.text, baseRevision: caption.revision, baseSourceRevision: caption.source_revision };
  return { captionId, ...draft };
}

const saveTransitions = [
  { guard: "validSave", target: "saving", actions: "prepareSave" },
  { guard: "validSaveDestination", actions: "invalidSave" },
] as const;

function isSaveShortcut(event: ViewEvent) {
  return event.type === "caption.editor.keypressed" && !event.isComposing
    && event.key === "Enter" && (event.ctrlKey || event.metaKey);
}

function toggleSettings(context: OperatorContext, panel: SettingsPanel) {
  const opening = context.settingsPanel !== panel;
  return {
    settingsPanel: opening ? panel : null,
    inspectorResize: null, inspectorPreviewWidth: null,
    settingsFocusTarget: { panel, destination: opening ? "field" as const : "trigger" as const },
    settingsFocusRequest: context.settingsFocusRequest + 1,
  };
}

function closeEditor(context: OperatorContext) {
  return { activeCaptionId: null, inspectorResize: null, inspectorPreviewWidth: null, historyFocusCaptionId: context.activeCaptionId,
    historyFocusRequest: context.historyFocusRequest + 1 };
}

function closeInspector(context: OperatorContext) {
  return { ...(context.settingsPanel ? { settingsPanel: null,
    settingsFocusTarget: { panel: context.settingsPanel, destination: "trigger" as const },
    settingsFocusRequest: context.settingsFocusRequest + 1, activeCaptionId: null,
  } : closeEditor(context)), inspectorResize: null, inspectorPreviewWidth: null };
}

function boundedInspectorWidth(width: number, maximum: number) {
  return Math.max(288, Math.min(width, maximum));
}

function canSaveDestination(context: OperatorContext, captionId: string) {
  return context.connection.mode === "host" || (context.connection.state === "live"
    && context.connection.editable_caption_ids.includes(captionId));
}

function sameStatusTarget(left: StatusTarget | null, right: StatusTarget | null) {
  return left?.captionId === right?.captionId && left?.kind === right?.kind;
}

function sameStatusGeometry(left: StatusTooltipGeometry, right: StatusTooltipGeometry) {
  return (Object.keys(left) as (keyof StatusTooltipGeometry)[]).every(key => left[key] === right[key]);
}

function positionStatusTooltip(geometry: StatusTooltipGeometry): StatusTooltipPosition {
  const margin = 8;
  const gap = 8;
  const below = Math.max(0, geometry.viewportHeight - margin - geometry.triggerBottom - gap);
  const above = Math.max(0, geometry.triggerTop - margin - gap);
  const placeBelow = geometry.tooltipHeight <= below || below >= above;
  const maxHeight = Math.min(placeBelow ? below : above, Math.max(0, geometry.viewportHeight - margin * 2));
  const maxWidth = Math.max(0, geometry.viewportWidth - margin * 2);
  const width = Math.min(geometry.tooltipWidth, maxWidth);
  const height = Math.min(geometry.tooltipHeight, maxHeight);
  const left = Math.min(Math.max(margin, geometry.triggerRight - width), Math.max(margin, geometry.viewportWidth - margin - width));
  const proposedTop = placeBelow ? geometry.triggerBottom + gap : geometry.triggerTop - gap - height;
  const top = Math.min(Math.max(margin, proposedTop), Math.max(margin, geometry.viewportHeight - margin - height));
  const bridgeLeft = Math.min(geometry.triggerLeft, left);
  const bridgeTop = placeBelow ? geometry.triggerBottom : top + height;
  return { top, left, maxWidth, maxHeight, bridge: { top: bridgeTop, left: bridgeLeft,
    width: Math.max(geometry.triggerRight, left + width) - bridgeLeft,
    height: Math.max(0, placeBelow ? top - geometry.triggerBottom : geometry.triggerTop - bridgeTop) } };
}

const operations = {
  "caption.save.requested": saveTransitions,
  "caption.history.selected": { guard: "canSelectHistory", actions: "selectHistory" },
  "caption.editor.keypressed": [
    { guard: "validShortcutSave", target: "saving", actions: "prepareSave" },
    { guard: "invalidShortcutSave", actions: "invalidSave" },
  ],
  "visibility.toggle.requested": { guard: "hostMode", target: "toggling", actions: "clearError" },
  "test.requested": { guard: "udtalkHostMode", target: "testing", actions: "clearError" },
  "publication.mode.requested": { guard: "validMode", target: "settingMode", actions: "prepareMode" },
  "display.save.requested": { guard: "hostMode", target: "settingDisplay", actions: "clearError" },
  "display.field.changed": { guard: "hostMode", actions: "editDisplay" },
  "display.palette.selected": { guard: "hostMode", actions: "editDisplay" },
  "ai.background.changed": { actions: "editAi" },
  "ai.model.selected": { guard: "validAiModel", actions: "editAi" },
  "ai.save.requested": [
    { guard: "validAiSettings", target: "settingAi", actions: "clearError" },
    { actions: "invalidAi" },
  ],
  "dictionary.word.added": { guard: "canAddWord", actions: "addWord" },
  "dictionary.word.changed": { guard: "knownWord", actions: "editWord" },
  "dictionary.word.enabled": { guard: "knownWord", actions: "editWord" },
  "dictionary.word.removed": { guard: "knownWord", actions: "removeWord" },
  "dictionary.draft.discarded": { target: "refreshing", actions: "discardDictionary" },
  "dictionary.save.requested": [
    { guard: "validDictionary", target: "settingDictionary", actions: "clearDictionaryMessage" },
    { actions: "invalidDictionary" },
  ],
  "connection.mode.selected": { guard: "validConnectionMode", actions: "editConnection" },
  "connection.url.changed": { actions: "editConnection" },
  "connection.text-format.selected": { guard: "validConnectionTextFormat", actions: "editConnection" },
  "connection.input.selected": { guard: "validInputSource", actions: "editConnection" },
  "connection.recognizer.selected": { guard: "validRecognizer", actions: "editConnection" },
  "connection.save.requested": { guard: "validConnectionSettings", target: "settingConnection", actions: "clearError" },
} as const;

export const operatorMachine = setup({
  types: {
    context: {} as OperatorContext,
    events: {} as ViewEvent,
    input: {} as { api: OperatorApi; microphone?: MicrophoneAdapter },
  },
  actors: {
    microphone: microphoneActor,
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
    dictionary: fromPromise(async ({ input, signal }: { input: { api: OperatorApi; settings: DictionaryUpdate }; signal: AbortSignal }) => input.api.setDictionary(input.settings, signal)),
    connection: fromPromise(async ({ input, signal }: { input: { api: OperatorApi; settings: ConnectionSettings }; signal: AbortSignal }) => input.api.setConnection(input.settings, signal)),
  },
  guards: {
    validAiSettings: ({ context }) => !backgroundValidation((context.aiDraft ?? context.ai.settings).background),
    canAddWord: ({ context }) => (context.dictionaryDraft ?? draftDictionary(context.dictionary)).entries.length < dictionaryLimits.maxEntries,
    knownWord: ({ context, event }) => (event.type === "dictionary.word.changed" || event.type === "dictionary.word.enabled" || event.type === "dictionary.word.removed")
      && Number.isInteger(event.index) && event.index >= 0 && event.index < (context.dictionaryDraft ?? draftDictionary(context.dictionary)).entries.length,
    validDictionary: ({ context }) => !dictionaryValidation(context.dictionaryDraft ?? draftDictionary(context.dictionary)),
    knownDisclosure: ({ context, event }) => event.type === "disclosure.toggled" &&
      (disclosureIds.some(id => id === event.id) || (event.id.startsWith("caption-saved:")
        && context.captionsById.has(event.id.slice(event.id.indexOf(":") + 1)))),
    hostMode: ({ context }) => context.connection.mode === "host",
    canStartMicrophone: ({ context }) => Boolean(context.microphone?.available && context.connection.mode === "host"
      && context.connection.input_source === "microphone" && !["preparing", "live", "retrying"].includes(context.microphoneState)
      && !["preparing", "live", "retrying"].includes(context.connection.transcription.state ?? "stopped")
      && (!context.connectionDraft || (context.connectionDraft.input_source === context.connection.input_source
        && context.connectionDraft.recognizer === context.connection.recognizer && context.connectionDraft.mode === "host"))
      && context.connection.recognizers.some(option => option.id === context.connection.recognizer && option.available)),
    canStopMicrophone: ({ context }) => ["preparing", "live", "retrying"].includes(context.microphoneState),
    canSelectMicrophone: ({ context, event }) => event.type === "microphone.device.selected"
      && !["preparing", "live", "retrying"].includes(context.microphoneState)
      && (event.deviceId === "" || context.microphoneDevices.some(device => device.id === event.deviceId)),
    udtalkHostMode: ({ context }) => context.connection.mode === "host" && context.connection.input_source === "udtalk",
    validInputSource: ({ context, event }) => event.type === "connection.input.selected" && (event.source === "udtalk"
      || (event.source === "microphone" && (context.connectionDraft?.mode ?? context.connection.mode) === "host")),
    validRecognizer: ({ context, event }) => event.type === "connection.recognizer.selected" && (event.recognizer === "openai" || event.recognizer === "apple")
      && (context.connectionDraft?.mode ?? context.connection.mode) === "host",
    validConnectionMode: ({ event }) => event.type === "connection.mode.selected" && (event.mode === "host" || event.mode === "client"),
    validConnectionTextFormat: ({ event }) => event.type === "connection.text-format.selected" && (event.format === "plain" || event.format === "speaker"),
    validConnectionSettings: ({ context }) => Boolean(context.connectionDraft && (context.connectionDraft.mode === "host"
      || context.connectionDraft.editor_url?.trim())),
    validMode: ({ context, event }) => context.connection.mode === "host" && event.type === "publication.mode.requested" && (event.mode === "auto" || event.mode === "manual"),
    validShortcutSave: ({ context, event }) => isSaveShortcut(event) && event.type === "caption.editor.keypressed"
      && context.activeCaptionId === event.captionId && canSaveDestination(context, event.captionId) && Boolean(getSaveRequest(context, event.captionId)?.text.trim()),
    invalidShortcutSave: ({ context, event }) => isSaveShortcut(event) && event.type === "caption.editor.keypressed"
      && context.activeCaptionId === event.captionId && canSaveDestination(context, event.captionId) && Boolean(getSaveRequest(context, event.captionId))
      && !getSaveRequest(context, event.captionId)?.text.trim(),
    closeShortcut: ({ context, event }) => event.type === "caption.editor.keypressed" && !event.isComposing
      && event.key === "Escape" && context.activeCaptionId === event.captionId,
    closeSettingsShortcut: ({ context, event }) => event.type === "settings.keypressed" && !event.defaultPrevented && !event.isComposing
      && event.key === "Escape" && context.settingsPanel !== null,
    dismissStatusShortcut: ({ context, event }) => {
      const target = context.statusTooltip.focus ?? context.statusTooltip.pointer;
      return (event.type === "caption.editor.keypressed" || (event.type === "settings.keypressed" && !event.defaultPrevented))
        && !event.isComposing && event.key === "Escape"
        && target !== null && !sameStatusTarget(target, context.statusTooltip.dismissed);
    },
    canChangeStatusInteraction: ({ context, event }) => event.type === "caption.status.interaction.changed"
      && context.captionsById.has(event.captionId),
    canMeasureStatus: ({ context, event }) => {
      if (event.type !== "caption.status.measured") return false;
      const target = context.statusTooltip.focus ?? context.statusTooltip.pointer;
      return sameStatusTarget(target, event) && !sameStatusTarget(target, context.statusTooltip.dismissed)
        && (!sameStatusTarget(context.statusTooltip.measurement, event)
          || !sameStatusGeometry(context.statusTooltip.measurement!.geometry, event.geometry));
    },
    hasEditor: ({ context }) => context.activeCaptionId !== null,
    canMeasureEditing: ({ context, event }) => event.type === "timeline.editing.measured"
      && context.activeCaptionId === event.captionId && context.editingCaptionVisible !== (event.intersectionRatio > 0),
    validAiModel: ({ event }) => event.type === "ai.model.selected" && (event.modelId === "off" || knownAiModel(event.modelId)),
    validSave: ({ context, event }) => event.type === "caption.save.requested"
      && canSaveDestination(context, event.captionId) && Boolean(getSaveRequest(context, event.captionId)?.text.trim())
      && (!event.republish || (context.connection.mode === "host" && context.visible && context.captionsById.get(event.captionId)?.source_final !== false)),
    validSaveDestination: ({ context, event }) => event.type === "caption.save.requested" && canSaveDestination(context, event.captionId)
      && (!event.republish || (context.connection.mode === "host" && context.visible && context.captionsById.get(event.captionId)?.source_final !== false)),
    canSelectHistory: ({ context, event }) => event.type === "caption.history.selected"
      && context.pendingSave?.captionId !== event.captionId
      && Boolean(context.captionsById.get(event.captionId)?.edit_history?.some(edit => String(edit.revision) === event.revision)),
    canEdit: ({ context, event }) => event.type === "caption.draft.changed"
      && context.pendingSave?.captionId !== event.captionId
      && context.captionsById.has(event.captionId),
    canSelect: ({ context, event }) => event.type === "caption.edit.requested"
      && context.captionsById.has(event.captionId),
    canDiscard: ({ context, event }) => event.type === "caption.draft.discarded"
      && context.pendingSave?.captionId !== event.captionId,
  },
  actions: {
    invalidAi: assign(({ context }) => ({ aiError: backgroundValidation((context.aiDraft ?? context.ai.settings).background), aiBackgroundInvalid: true })),
    discardDictionary: assign({ dictionaryDraft: null, dictionaryError: null, dictionaryNotice: "保存済みの辞書に戻しました。" }),
    clearDictionaryMessage: assign({ dictionaryError: null, dictionaryNotice: "" }),
    addWord: assign(({ context }) => {
      const draft = context.dictionaryDraft ?? draftDictionary(context.dictionary);
      return { dictionaryDraft: { ...draft, entries: [...draft.entries, { term: "", reading: "", variantsText: "", enabled: true }] }, dictionaryError: null, dictionaryNotice: "",
        settingsFocusTarget: { panel: "dictionary" as const, destination: "word" as const, index: draft.entries.length, field: "term" as const },
        settingsFocusRequest: context.settingsFocusRequest + 1 };
    }),
    editWord: assign(({ context, event }) => {
      const draft = context.dictionaryDraft ?? draftDictionary(context.dictionary);
      if (event.type !== "dictionary.word.changed" && event.type !== "dictionary.word.enabled") return {};
      const entries = draft.entries.map((word, index) => index !== event.index ? word : event.type === "dictionary.word.enabled"
        ? { ...word, enabled: event.enabled } : { ...word, [event.field]: event.value });
      return { dictionaryDraft: { ...draft, entries }, dictionaryError: null, dictionaryNotice: "" };
    }),
    removeWord: assign(({ context, event }) => {
      if (event.type !== "dictionary.word.removed") return {};
      const draft = context.dictionaryDraft ?? draftDictionary(context.dictionary);
      const entries = draft.entries.filter((_, index) => index !== event.index);
      return { dictionaryDraft: { ...draft, entries }, dictionaryError: null, dictionaryNotice: "",
        settingsFocusTarget: entries.length
          ? { panel: "dictionary" as const, destination: "word" as const, index: Math.min(event.index, entries.length - 1), field: "term" as const }
          : { panel: "dictionary" as const, destination: "add" as const }, settingsFocusRequest: context.settingsFocusRequest + 1 };
    }),
    invalidDictionary: assign(({ context }) => {
      const issue = dictionaryValidation(context.dictionaryDraft ?? draftDictionary(context.dictionary));
      return { dictionaryError: issue, dictionaryNotice: "", settingsFocusTarget: issue?.index !== undefined && issue.field
        ? { panel: "dictionary" as const, destination: "word" as const, index: issue.index, field: issue.field }
        : { panel: "dictionary" as const, destination: "error" as const }, settingsFocusRequest: context.settingsFocusRequest + 1 };
    }),
    startMicrophone: sendTo("microphone", ({ context }) => ({ type: "start", deviceId: context.microphoneDeviceId, recognizer: context.connection.recognizer })),
    stopMicrophone: sendTo("microphone", { type: "stop" }),
    toggleDisclosure: assign(({ context, event }) => {
      if (event.type !== "disclosure.toggled") return {};
      const openedDisclosures = new Set(context.openedDisclosures);
      if (openedDisclosures.has(event.id)) openedDisclosures.delete(event.id);
      else openedDisclosures.add(event.id);
      return { openedDisclosures };
    }),
    closeSettings: assign(({ context }) => ({
      inspectorResize: null, inspectorPreviewWidth: null,
      settingsPanel: null,
      settingsFocusTarget: context.settingsPanel ? { panel: context.settingsPanel, destination: "trigger" as const } : null,
      settingsFocusRequest: context.settingsFocusRequest + 1,
    })),
    closeEditor: assign(({ context }) => closeEditor(context)),
    changeStatusInteraction: assign(({ context, event }) => {
      if (event.type !== "caption.status.interaction.changed") return {};
      const target = { captionId: event.captionId, kind: event.kind };
      if (!event.active && !sameStatusTarget(context.statusTooltip[event.interaction], target)) return {};
      const statusTooltip = { ...context.statusTooltip, [event.interaction]: event.active ? target : null };
      if (!sameStatusTarget(context.statusTooltip.focus ?? context.statusTooltip.pointer, statusTooltip.focus ?? statusTooltip.pointer)) {
        statusTooltip.measurement = null;
      }
      if (!sameStatusTarget(statusTooltip.dismissed, statusTooltip.pointer) && !sameStatusTarget(statusTooltip.dismissed, statusTooltip.focus)) {
        statusTooltip.dismissed = null;
      }
      return { statusTooltip };
    }),
    measureStatus: assign(({ context, event }) => event.type === "caption.status.measured"
      ? { statusTooltip: { ...context.statusTooltip, measurement: { captionId: event.captionId, kind: event.kind,
        geometry: event.geometry, position: positionStatusTooltip(event.geometry) } } } : {}),
    dismissStatus: assign(({ context }) => ({ statusTooltip: { ...context.statusTooltip,
      dismissed: context.statusTooltip.focus ?? context.statusTooltip.pointer } })),
    clearError: assign({ error: "", errorSource: null, errorCaptionId: null, saveStatus: null }),
    invalidSave: assign(({ event }) => ({ error: "字幕を入力してください。", errorSource: "save" as const, saveStatus: null,
      errorCaptionId: event.type === "caption.save.requested" || event.type === "caption.editor.keypressed" ? event.captionId : null })),
    prepareSave: assign(({ context, event }) => {
      if (event.type !== "caption.save.requested" && event.type !== "caption.editor.keypressed") return {};
      const request = getSaveRequest(context, event.captionId)!;
      const republish = (event.type === "caption.save.requested" && event.republish) || request.republish || false;
      return { pendingSave: { ...request, republish,
        requestId: request.requestId && republish === Boolean(request.republish) ? request.requestId : crypto.randomUUID() },
        error: "", errorSource: null, errorCaptionId: null, saveStatus: null };
    }),
    selectHistory: assign(({ context, event }) => {
      if (event.type !== "caption.history.selected") return {};
      const caption = context.captionsById.get(event.captionId)!;
      const edit = caption.edit_history!.find(edit => String(edit.revision) === event.revision)!;
      const drafts = new Map(context.drafts);
      drafts.set(caption.id, { text: edit.text, baseRevision: caption.revision, baseSourceRevision: caption.source_revision });
      return { drafts, saveStatus: null, error: "", errorSource: null, errorCaptionId: null,
        editorFocusRequest: context.editorFocusRequest + 1 };
    }),
    prepareMode: assign(({ event }) => ({ requestedMode: { auto_publish: event.type === "publication.mode.requested" && event.mode === "auto" },
      error: "", errorSource: null, errorCaptionId: null })),
    editDisplay: assign(({ context, event }) => {
      const settings = context.displayDraft ?? context.display;
      if (event.type === "display.field.changed") return { displayDraft: changeDisplayField(settings, event.field, event.value) };
      if (event.type === "display.palette.selected") return { displayDraft: selectDisplayPalette(settings, event.value) };
      return {};
    }),
    editAi: assign(({ context, event }) => {
      const settings = context.aiDraft ?? editableAiSettings(context.ai);
      if (event.type === "ai.background.changed") return { aiError: "", aiBackgroundInvalid: false, aiBackgroundExpanded: context.aiBackgroundExpanded || Boolean(backgroundValidation(event.value)), aiDraft: { ...settings, background: event.value } };
      if (event.type === "ai.model.selected") {
        if (event.modelId === "off") return { aiError: "", aiBackgroundInvalid: false, aiDraft: { ...settings, strategy: "off" as const } };
        if (knownAiModel(event.modelId)) return { aiError: "", aiBackgroundInvalid: false, aiDraft: { ...settings, strategy: "manual" as const,
          preferred_model: event.modelId, candidates: [event.modelId] } };
      }
      return {};
    }),
    editConnection: assign(({ context, event }) => {
      const current: ConnectionSettings = context.connectionDraft ?? { mode: context.connection.mode, editor_url: "", zoom_text_format: context.connection.zoom_text_format,
        input_source: context.connection.input_source, recognizer: context.connection.recognizer };
      if (event.type === "connection.mode.selected" && (event.mode === "host" || event.mode === "client")) {
        const updated: ConnectionSettings = { ...current, mode: event.mode, input_source: event.mode === "client" ? "udtalk" : current.input_source };
        return { connectionDraft: updated };
      }
      if (event.type === "connection.url.changed") return { connectionDraft: { ...current, editor_url: event.url } };
      if (event.type === "connection.text-format.selected" && (event.format === "plain" || event.format === "speaker")) {
        const updated: ConnectionSettings = { ...current, zoom_text_format: event.format };
        return { connectionDraft: updated };
      }
      if (event.type === "connection.input.selected" && (event.source === "udtalk" || event.source === "microphone")) {
        const updated: ConnectionSettings = { ...current, input_source: event.source };
        return { connectionDraft: updated };
      }
      if (event.type === "connection.recognizer.selected" && (event.recognizer === "openai" || event.recognizer === "apple")) {
        const updated: ConnectionSettings = { ...current, recognizer: event.recognizer };
        return { connectionDraft: updated };
      }
      return {};
    }),
    selectCaption: assign(({ context, event }) => {
      if (event.type !== "caption.edit.requested") return {};
      if (context.activeCaptionId === event.captionId && context.settingsPanel === null) return closeEditor(context);
      const drafts = new Map(context.drafts);
      const caption = context.captionsById.get(event.captionId)!;
      if (!drafts.has(caption.id)) drafts.set(caption.id, { text: caption.text, baseRevision: caption.revision, baseSourceRevision: caption.source_revision });
      return { drafts, activeCaptionId: caption.id, editingCaptionVisible: true, followLatest: false, scrollTarget: "caption" as const,
        latestRequest: context.latestRequest + 1, editorFocusRequest: context.editorFocusRequest + 1, settingsPanel: null, settingsFocusTarget: null };
    }),
    discardDraft: assign(({ context, event }) => {
      if (event.type !== "caption.draft.discarded") return {};
      const drafts = new Map(context.drafts);
      drafts.delete(event.captionId);
      return { drafts, ...closeEditor(context), error: "", errorSource: null, errorCaptionId: null, saveStatus: null };
    }),
    editDraft: assign(({ context, event }) => {
      if (event.type !== "caption.draft.changed") return {};
      const drafts = new Map(context.drafts);
      const caption = context.captionsById.get(event.captionId)!;
      const previous = drafts.get(caption.id);
      drafts.set(caption.id, {
        text: event.text, baseRevision: previous?.baseRevision ?? caption.revision,
        baseSourceRevision: previous?.baseSourceRevision ?? caption.source_revision,
        conflict: previous?.conflict,
      });
      return { drafts, saveStatus: context.saveStatus?.captionId === caption.id ? null : context.saveStatus };
    }),
  },
}).createMachine({
  id: "operator",
  initial: "loading",
  context: ({ input }) => ({
    microphone: input.microphone, microphoneState: "stopped", microphoneMessage: "マイクの認識は停止しています。",
    microphoneLabel: "", microphoneDevices: [], microphoneDeviceId: "",
    api: input.api, visible: true, captions: [], captionsById: new Map(), drafts: new Map(), pendingSave: null,
    error: "", errorSource: null, errorCaptionId: null, inspectorWidth: 384, inspectorMaxWidth: 960, inspectorPreviewWidth: null, inspectorResize: null,
    activeCaptionId: null, editingCaptionVisible: true,
    followLatest: true, atLatest: true, latestRequest: 0, scrollTarget: "latest", editorFocusRequest: 0,
    historyFocusRequest: 0, historyFocusCaptionId: null, statusTooltip: { pointer: null, focus: null, dismissed: null, measurement: null }, unreadIds: [], saveStatus: null, autoPublish: true,
    settingsPanel: null, settingsFocusTarget: null, settingsFocusRequest: 0,
    openedDisclosures: new Set<DisclosureId>(["display-speaker", "display-appearance"]),
    requestedMode: { auto_publish: true },
    display: defaultDisplay, displayDraft: null,
    ai: defaultAi, aiDraft: null, aiError: "", aiBackgroundInvalid: false, aiBackgroundExpanded: false,
    dictionary: emptyDictionary, dictionaryDraft: null, dictionaryError: null, dictionaryNotice: "",
    connection: defaultConnection, receiverUrl: "", connectionDraft: null,
  }),
  on: { "disclosure.toggled": { guard: "knownDisclosure", actions: "toggleDisclosure" } },
  states: {
    loading: {
      invoke: {
        src: "load", input: ({ context }) => context.api,
        onDone: { target: "ready", actions: assign(({ context, event }) => ({ ...event.output,
          captionsById: new Map(event.output.captions.map(caption => [caption.id, caption])), error: "", errorSource: null,
          unreadIds: [], latestRequest: context.latestRequest + 1 })) },
        onError: { target: "failed", actions: assign({ error: "字幕を取得できませんでした。接続を確認してください。", errorSource: "load" }) },
      },
    },
    failed: {
      after: { 1500: "loading" },
      on: { "refresh.requested": "loading" },
    },
    ready: {
      invoke: { id: "microphone", src: "microphone", input: ({ context }) => ({ adapter: context.microphone }) },
      initial: "idle",
      on: {
        "microphone.start.requested": { guard: "canStartMicrophone", actions: [assign({ microphoneState: "preparing", microphoneMessage: "マイクを準備しています。" }), "startMicrophone"] },
        "microphone.stop.requested": { guard: "canStopMicrophone", actions: "stopMicrophone" },
        "microphone.device.selected": { guard: "canSelectMicrophone", actions: assign(({ event }) => ({ microphoneDeviceId: event.deviceId })) },
        "microphone.devices.changed": { actions: assign(({ event }) => ({ microphoneDevices: event.devices })) },
        "microphone.state.changed": { actions: assign(({ context, event }) => ({ microphoneState: event.state, microphoneMessage: event.message,
          microphoneLabel: event.label ?? context.microphoneLabel })) },
        "caption.draft.changed": { guard: "canEdit", actions: "editDraft" },
        "caption.edit.requested": { guard: "canSelect", actions: "selectCaption" },
        "caption.edit.closed": { actions: "closeEditor" },
        "caption.editor.keypressed": [
          { guard: "dismissStatusShortcut", actions: "dismissStatus" },
          { guard: "closeShortcut", actions: "closeEditor" },
        ],
        "caption.draft.discarded": { guard: "canDiscard", actions: "discardDraft" },
        "caption.status.interaction.changed": { guard: "canChangeStatusInteraction", actions: "changeStatusInteraction" },
        "caption.status.measured": { guard: "canMeasureStatus", actions: "measureStatus" },
        "inspector.measured": { guard: ({ event }) => Number.isFinite(event.workspaceWidth) && event.workspaceWidth > 0,
          actions: assign(({ event }) => ({ inspectorMaxWidth: Math.max(288, event.workspaceWidth - 320) })) },
        "inspector.width.adjusted": { guard: ({ context, event }) => Boolean(context.settingsPanel || context.activeCaptionId) && context.inspectorResize === null
          && (event.direction === "wider" ? context.inspectorWidth < context.inspectorMaxWidth : Math.min(context.inspectorWidth, context.inspectorMaxWidth) > 288),
          actions: assign(({ context, event }) => ({ inspectorWidth: boundedInspectorWidth(Math.min(context.inspectorWidth, context.inspectorMaxWidth)
            + (event.direction === "wider" ? 24 : -24), context.inspectorMaxWidth) })) },
        "inspector.resize.started": { guard: ({ context, event }) => Boolean(context.settingsPanel || context.activeCaptionId)
          && Number.isFinite(event.clientX) && Number.isFinite(event.right) && Number.isFinite(event.workspaceWidth) && event.workspaceWidth > 720,
          actions: assign(({ event }) => ({ inspectorResize: { pointerId: event.pointerId, right: event.right },
            inspectorMaxWidth: Math.max(288, event.workspaceWidth - 320) })) },
        "inspector.resize.moved": { guard: ({ context, event }) => context.inspectorResize?.pointerId === event.pointerId && Number.isFinite(event.clientX),
          actions: assign(({ context, event }) => ({ inspectorPreviewWidth: Math.max(0, Math.min(context.inspectorResize!.right - event.clientX, context.inspectorMaxWidth)) })) },
        "inspector.resize.ended": { guard: ({ context, event }) => context.inspectorResize?.pointerId === event.pointerId && Number.isFinite(event.clientX),
          actions: assign(({ context, event }) => context.inspectorResize!.right - event.clientX <= 72 ? closeInspector(context)
            : { inspectorWidth: boundedInspectorWidth(context.inspectorResize!.right - event.clientX, context.inspectorMaxWidth),
              inspectorResize: null, inspectorPreviewWidth: null }) },
        "inspector.resize.cancelled": { guard: ({ context, event }) => context.inspectorResize?.pointerId === event.pointerId,
          actions: assign({ inspectorResize: null, inspectorPreviewWidth: null }) },
        "inspector.resize.keypressed": { guard: ({ context, event }) => Boolean(context.settingsPanel || context.activeCaptionId)
          && ["ArrowLeft", "ArrowRight", "Home", "End", "Enter", "Escape"].includes(event.key),
          actions: assign(({ context, event }) => ["Home", "Enter", "Escape"].includes(event.key) ? closeInspector(context)
            : { inspectorWidth: event.key === "End" ? context.inspectorMaxWidth : boundedInspectorWidth(
              Math.min(context.inspectorWidth, context.inspectorMaxWidth) + (event.key === "ArrowLeft" ? 1 : -1) * (event.shiftKey ? 64 : 24), context.inspectorMaxWidth) }) },
        "timeline.latest.requested": { actions: assign(({ context }) => ({ followLatest: true, atLatest: true, unreadIds: [], scrollTarget: "latest" as const,
          historyFocusCaptionId: context.activeCaptionId ? context.historyFocusCaptionId : context.captions.at(-1)?.id ?? null,
          historyFocusRequest: context.activeCaptionId ? context.historyFocusRequest : context.historyFocusRequest + 1,
          latestRequest: context.latestRequest + 1, editorFocusRequest: context.activeCaptionId ? context.editorFocusRequest + 1 : context.editorFocusRequest })) },
        "timeline.editing.requested": { guard: "hasEditor", actions: assign(({ context }) => ({ followLatest: false,
          settingsPanel: null, settingsFocusTarget: null,
          scrollTarget: "caption" as const, latestRequest: context.latestRequest + 1, editorFocusRequest: context.editorFocusRequest + 1 })) },
        "timeline.editing.measured": { guard: "canMeasureEditing", actions: assign(({ event }) => ({ editingCaptionVisible: event.intersectionRatio > 0 })) },
        "timeline.scrolled": { actions: assign(({ context, event }) => {
          const atLatest = event.scrollHeight - event.clientHeight - event.scrollTop < 8;
          const followLatest = !(context.activeCaptionId && context.scrollTarget === "caption")
            && atLatest;
          return { atLatest, followLatest, unreadIds: atLatest ? [] : context.unreadIds };
        }) },
        "timeline.resized": { actions: assign(({ context, event }) => {
          if (context.followLatest) return { atLatest: true, scrollTarget: "latest" as const, latestRequest: context.latestRequest + 1 };
          const atLatest = event.scrollHeight - event.clientHeight - event.scrollTop < 8;
          return { atLatest, followLatest: !(context.activeCaptionId && context.scrollTarget === "caption") && atLatest,
            unreadIds: atLatest ? [] : context.unreadIds };
        }) },
        "settings.keypressed": [
          { guard: "dismissStatusShortcut", actions: "dismissStatus" },
          { guard: "closeSettingsShortcut", actions: "closeSettings" },
        ],
        "display.settings.toggled": { guard: "hostMode", actions: assign(({ context }) => toggleSettings(context, "display")) },
        "ai.settings.toggled": { actions: assign(({ context }) => toggleSettings(context, "ai")) },
        "dictionary.settings.toggled": { actions: assign(({ context }) => toggleSettings(context, "dictionary")) },
        "connection.settings.toggled": { actions: assign(({ context }) => toggleSettings(context, "connection")) },
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
              const captionsById = new Map(event.output.captions.map(caption => [caption.id, caption]));
              const incoming = event.output.captions.filter(caption => !context.captionsById.has(caption.id)).map(caption => caption.id);
              const timelineChanged = event.output.captions.length !== context.captions.length
                || event.output.captions.some((caption, index) => caption.id !== context.captions[index]?.id || caption.text !== context.captions[index]?.text || caption.original !== context.captions[index]?.original);
              return {
                ...event.output,
                captionsById,
                drafts: new Map([...context.drafts].filter(([id]) => captionsById.has(id))),
                activeCaptionId: context.activeCaptionId && captionsById.has(context.activeCaptionId) ? context.activeCaptionId : null,
                statusTooltip: {
                  pointer: context.statusTooltip.pointer && captionsById.has(context.statusTooltip.pointer.captionId) ? context.statusTooltip.pointer : null,
                  focus: context.statusTooltip.focus && captionsById.has(context.statusTooltip.focus.captionId) ? context.statusTooltip.focus : null,
                  dismissed: context.statusTooltip.dismissed && captionsById.has(context.statusTooltip.dismissed.captionId) ? context.statusTooltip.dismissed : null,
                  measurement: context.statusTooltip.measurement && captionsById.has(context.statusTooltip.measurement.captionId) ? context.statusTooltip.measurement : null,
                },
                unreadIds: context.followLatest ? [] : [...new Set([...context.unreadIds, ...incoming])].filter(id => captionsById.has(id)),
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
              const current = context.captionsById.get(event.output.id);
              const newer = current && (current.revision > event.output.revision || current.source_revision > event.output.source_revision);
              const caption = newer ? current : event.output;
              const captionsById = new Map(context.captionsById);
              captionsById.set(caption.id, caption);
              return {
                captions: context.captions.map(item => item.id === caption.id ? caption : item),
                captionsById,
                drafts, pendingSave: null,
                saveStatus: { captionId: event.output.id, message: newer ? "保存済みの訂正を確認しました。現在は新しい更新があります。" : context.connection.mode === "client"
                  ? "UDトークが訂正を受け付けました。純正画面の表示を確認してください。" : context.visible && event.output.publish_eligible && event.output.source_final !== false
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
                const captionsById = new Map(context.captionsById);
                captionsById.set(latest.id, latest);
                drafts.set(pending.captionId, {
                  text: retainedText, baseRevision: latest.revision, baseSourceRevision: latest.source_revision,
                  conflict: `別の更新がありました。最新の字幕「${latest.text}」を確認して、もう一度保存してください。`,
                });
                return {
                  drafts, pendingSave: null,
                  captions: context.captions.map(caption => caption.id === latest.id ? latest : caption),
                  captionsById,
                };
              }
              drafts.set(pending.captionId, { text: retainedText, baseRevision: pending.baseRevision, baseSourceRevision: pending.baseSourceRevision,
                requestId: pending.requestId, republish: pending.republish });
              return { drafts, pendingSave: null, error: event.error instanceof OperationError ? event.error.message : "保存結果を確認できませんでした。修正内容は保持しています。保存結果を確認してください。", errorSource: "save" as const, errorCaptionId: pending.captionId };
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
            onDone: { target: "idle", actions: assign(({ event }) => ({ ai: event.output, aiDraft: null, aiError: "", aiBackgroundInvalid: false, aiBackgroundExpanded: false })) },
            onError: { target: "idle", actions: assign({ aiError: "AI設定を保存できませんでした。設定内容は保持しています。" }) },
          },
        },
        settingDictionary: {
          invoke: {
            src: "dictionary", input: ({ context }) => ({ api: context.api, settings: dictionaryUpdate(context.dictionaryDraft ?? draftDictionary(context.dictionary)) }),
            onDone: { target: "idle", actions: assign(({ event }) => ({ dictionary: event.output, dictionaryDraft: null, dictionaryError: null, dictionaryNotice: "辞書を保存しました。" })) },
            onError: { target: "idle", actions: assign(({ event }) => ({ dictionaryError: { message: event.error instanceof OperationError
              ? event.error.message : "辞書を保存できませんでした。入力内容は保持しています。" }, dictionaryNotice: "" })) },
          },
        },
        settingConnection: {
          invoke: {
            src: "connection", input: ({ context }) => ({ api: context.api, settings: {
              ...context.connectionDraft!, editor_url: context.connectionDraft?.mode === "client" ? context.connectionDraft.editor_url : null,
            } }),
            onDone: [
              { guard: ({ context, event }) => context.connection.mode !== event.output.mode
                || context.connection.input_source !== event.output.input_source || context.connection.recognizer !== event.output.recognizer,
                target: "refreshing", actions: ["stopMicrophone", assign(({ event }) => ({ connection: event.output, connectionDraft: null }))] },
              { target: "refreshing", actions: assign(({ event }) => ({ connection: event.output, connectionDraft: null })) },
            ],
            onError: { target: "idle", actions: assign(({ event }) => ({ error: event.error instanceof OperationError
              ? event.error.message : "接続を変更できませんでした。現在の接続と下書きは保持しています。", errorSource: "command" as const })) },
          },
        },
      },
    },
  },
});

export type OperatorSnapshot = SnapshotFrom<typeof operatorMachine>;
