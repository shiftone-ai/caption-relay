import type { AiSettings, Caption, DisclosureId, DisplaySettings, ConnectionSettings } from "../domain";
import { aiProviderNames, editableAiSettings } from "../ai";
import { displayChoices, displayPalettes } from "../display";
import type { OperatorSnapshot } from "../machines/operator";
import { presentDisplayPreview, type DisplayCaption, type DisplayPreviewParameters } from "./display";
import { presentDisclosure, type DisclosureParameters } from "./disclosure";
import { dictionaryLimits, draftDictionary } from "../dictionary";

const receivedTime = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" });
const receivedDateTime = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
});

export interface RowParameters {
  savedDisclosure: DisclosureParameters;
  id: string;
  receivedAt: string;
  timeLabel: string;
  timeDescription: string;
  original: string;
  text: string;
  speaker: string | null;
  draftText: string;
  contentDescription: string;
  editing: boolean;
  dirty: boolean;
  saveLabel: string;
  disabled: boolean;
  readOnly: boolean;
  discardDisabled: boolean;
  editDisabled: boolean;
  message: string;
  invalid: boolean;
  state: string;
  source: "saving" | "unsaved" | "human" | "processing" | "ai" | "original";
  aiPending: boolean;
  aiProgressLabel: string;
  publication: string;
  showPublicationStatus: boolean;
  publicationState: "hidden" | "updating" | "live" | "published" | "receiving" | "waiting" | "native";
  current: boolean;
  firstUnread: boolean;
  focusVersion: number;
  saveSuccess: string;
  saveConsequence: string;
  saveConsequenceVisible: boolean;
  historyOptions: { revision: string; label: string }[];
  republishVisible: boolean;
  republishDisabled: boolean;
  sourceStatusOpen: boolean;
  publicationStatusOpen: boolean;
  statusTooltipPosition: { top: number; left: number; maxWidth: number; maxHeight: number;
    bridge: { top: number; left: number; width: number; height: number } } | null;
}

export interface RecentCaptionParameters {
  id: string;
  receivedAt: string;
  timeLabel: string;
  timeDescription: string;
  text: string;
  original: string;
  receiving: boolean;
}

export interface CaptionMonitorParameters {
  recentCaptions: RecentCaptionParameters[];
  liveText: string;
  liveLabel: string;
}

export interface ToolbarParameters {
  audienceHref: string;
  helpDisclosure: DisclosureParameters;
  preparationDisclosure: DisclosureParameters;
  preparationHint: string;
  testDisabled: boolean;
  toggleDisabled: boolean;
  toggleLabel: string;
  visibilityIcon: "hide" | "show";
  mode: string;
  modeDisabled: boolean;
  settingsOpen: boolean;
  aiSettingsOpen: boolean;
  dictionarySettingsOpen: boolean;
  dictionarySettingsDisabled: boolean;
  aiTitle: string;
  connectionSettingsOpen: boolean;
  localOutput: boolean;
}

export interface AiParameters {
  error: string;
  backgroundInvalid: boolean;
  background: string;
  helpDisclosure: DisclosureParameters;
  comparisonDisclosure: DisclosureParameters;
  connectionDescription: string;
  connectionWarning: boolean;
  showModelSettings: boolean;
  model: string;
  saveDisabled: boolean;
  saveHint: string;
  disabled: boolean;
  models: { id: AiSettings["preferred_model"]; provider: string; label: string; variant: string; inputPrice: string; outputPrice: string;
    sampleCost: string; latency: string; pricingUrl: string; checkedOn: string }[];
}

export interface DictionaryParameters {
  variantsHint: string;
  entries: { index: number; term: string; reading: string; variantsText: string; enabled: boolean; invalidField: "term" | "reading" | "variantsText" | null }[];
  countLabel: string;
  empty: boolean;
  disabled: boolean;
  addDisabled: boolean;
  saveDisabled: boolean;
  discardDisabled: boolean;
  saveHint: string;
  error: string;
  notice: string;
  recognitionHint: string;
}

export interface ConnectionParameters {
  hostHelpDisclosure: DisclosureParameters;
  clientHelpDisclosure: DisclosureParameters;
  mode: "host" | "client";
  modeLabel: string;
  stateLabel: string;
  message: string;
  messageVisible: boolean;
  receiverUrl: string;
  editorUrl: string;
  textFormat: "plain" | "speaker";
  showReceiver: boolean;
  showEditor: boolean;
  disabled: boolean;
  saveDisabled: boolean;
  receivedLabel: string;
  inputSource: string;
  recognizer: string;
  recognizers: { id: string; label: string; disabled: boolean }[];
  showMicrophone: boolean;
  recognizerMessage: string;
  microphoneStatus: string;
  startDisabled: boolean;
  stopDisabled: boolean;
  microphoneLabel: string;
  deviceId: string;
  devices: { id: string; label: string }[];
  deviceDisabled: boolean;
  usageLabel: string;
}

export interface DisplayFieldParameters {
  field: keyof DisplaySettings;
  label: string;
  value: string;
  kind: "color" | "select";
  options: { value: string; label: string }[];
  autofocus?: boolean;
}

export interface DisplayParameters {
  helpDisclosure: DisclosureParameters;
  preview: DisplayPreviewParameters;
  palette: string;
  palettes: { value: string; label: string }[];
  modeField: DisplayFieldParameters;
  primaryFields: DisplayFieldParameters[];
  sections: { id: string; label: string; disclosure: DisclosureParameters; palette: boolean; groups: DisplayFieldParameters[][] }[];
  disabled: boolean;
  saveDisabled: boolean;
  saveHint: string;
}

function presentDisplay(settings: DisplaySettings, saved: DisplaySettings, disabled: boolean, captions: DisplayCaption[], openedDisclosures: ReadonlySet<DisclosureId>): DisplayParameters {
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const field = (key: keyof DisplaySettings, label: string): DisplayFieldParameters => ({
    field: key, label, value: String(settings[key]),
    kind: key === "background" || key === "foreground" ? "color" : "select",
    options: key === "background" || key === "foreground" ? [] : displayChoices[key].map(choice => ({ ...choice, value: String(choice.value) })),
  });
  return {
    helpDisclosure: presentDisclosure("display-help", openedDisclosures),
    preview: presentDisplayPreview(settings, captions),
    palette: Object.entries(displayPalettes).find(([, palette]) => palette.background === settings.background && palette.foreground === settings.foreground)?.[0] ?? "custom",
    palettes: [...Object.entries(displayPalettes).map(([value, palette]) => ({ value, label: palette.label })), { value: "custom", label: "カスタム" }],
    modeField: { ...field("display_mode", "表示方式"), autofocus: true },
    primaryFields: [field("font_size", "文字サイズ"), ...(settings.display_mode === "recent" ? [field("history_count", "表示件数")] : []), field("line_height", "行間")],
    sections: [
      { id: "speaker", label: "発話者", disclosure: presentDisclosure("display-speaker", openedDisclosures), palette: false, groups: [[field("speaker_display", "名前の表示")]] },
      { id: "appearance", label: "文字と配色", disclosure: presentDisclosure("display-appearance", openedDisclosures), palette: true, groups: [
        [field("background", "背景"), field("foreground", "文字")], [field("font", "フォント")],
        [field("font_weight", "太さ")],
      ] },
      { id: "layout", label: "配置と余白", disclosure: presentDisclosure("display-layout", openedDisclosures), palette: false, groups: [
        [field("position", "縦位置"), field("align", "文字揃え")], [field("padding", "余白")],
        [field("aspect", "表示領域")],
      ] },
    ],
    disabled, saveDisabled: disabled || !dirty, saveHint: dirty ? "未反映" : "",
  };
}

export interface OperatorParameters {
  inspector: { width: number; maximum: number; resizing: boolean; widenDisabled: boolean; narrowDisabled: boolean };
  panelFocus: { selector: string; version: number } | null;
  toolbar: ToolbarParameters;
  message: string;
  reloadVisible: boolean;
  rows: RowParameters[];
  editor: RowParameters | null;
  monitor: CaptionMonitorParameters;
  recentCaptions: RecentCaptionParameters[];
  unreadCount: number;
  unreadAnnouncement: string;
  firstUnreadId: string | null;
  latestLabel: string;
  latestVisible: boolean;
  returnToEditorDisabled: boolean;
  returnToEditorVisible: boolean;
  hasUnsavedChanges: boolean;
  liveText: string;
  liveLabel: string;
  scrollToLatest: boolean;
  scrollVersion: string;
  scrollTarget: "latest" | "caption";
  scrollCaptionId: string | null;
  historyFocusCaptionId: string | null;
  historyFocusVersion: number;
  followLabel: string;
  loading: boolean;
  displaySettings: DisplayParameters;
  ai: AiParameters;
  dictionary: DictionaryParameters;
  connection: ConnectionParameters;
}

const rowCache = new WeakMap<Caption, { dependencies: readonly unknown[]; parameters: RowParameters }>();

function settingsFocusSelector(target: NonNullable<OperatorSnapshot["context"]["settingsFocusTarget"]>): string {
  if (target.destination === "word") return `#dictionary-word-${target.index}-${target.field}`;
  if (target.destination === "add") return "#dictionary-add";
  if (target.destination === "error") return "#dictionary-error";
  return target.destination === "field"
    ? `#${target.panel}-settings [data-setting-autofocus]:not(:disabled), #${target.panel}-settings select:not(:disabled)`
    : `[data-settings-trigger="${target.panel}"]`;
}

export function presentOperator(snapshot: OperatorSnapshot, roomId?: string): OperatorParameters {
  const { context } = snapshot;
  const clientMode = context.connection.mode === "client";
  const publicationOrder = [...context.captions].sort((left, right) => left.publication_epoch - right.publication_epoch);
  const publishedCaptions = publicationOrder.filter(caption => caption.published);
  let currentCaption: Caption | undefined;
  if (clientMode) {
    for (let index = context.captions.length - 1; index >= 0; index--) {
      if (context.connection.editable_caption_ids.includes(context.captions[index].id)) { currentCaption = context.captions[index]; break; }
    }
  } else if (context.visible) {
    currentCaption = publishedCaptions.at(-1);
  }
  const currentId = currentCaption?.id;
  const displayedIds = new Set(!clientMode && context.visible
    ? (context.display.display_mode === "scroll" ? publishedCaptions : publishedCaptions.slice(-context.display.history_count)).map(caption => caption.id) : []);
  const displayDraft = context.displayDraft ?? context.display;
  const aiDraft = context.aiDraft ?? editableAiSettings(context.ai);
  const dictionaryDraft = context.dictionaryDraft ?? draftDictionary(context.dictionary);
  const dictionaryDirty = JSON.stringify(dictionaryDraft.entries) !== JSON.stringify(draftDictionary(context.dictionary).entries);
  const dictionaryDisabled = !snapshot.can({ type: "dictionary.save.requested" });
  const selectedAi = context.ai.models.find(model => model.id === context.ai.selected_model);
  const aiDirty = context.aiDraft !== null && JSON.stringify(aiDraft) !== JSON.stringify(context.ai.settings);
  const aiDisabled = !snapshot.can({ type: "ai.save.requested" });
  const connectionDraft: ConnectionSettings = context.connectionDraft ?? { mode: context.connection.mode, editor_url: "", zoom_text_format: context.connection.zoom_text_format,
    input_source: context.connection.input_source, recognizer: context.connection.recognizer };
  const microphoneStatus = context.microphoneState === "stopped" && context.connection.transcription.state !== "stopped"
    ? context.connection.transcription.message : context.microphoneMessage;
  const unreadIds = new Set(context.unreadIds);
  const firstUnreadId = context.captions.find(caption => unreadIds.has(caption.id))?.id ?? null;
  const liveText = clientMode ? currentCaption?.text ?? "" : currentCaption?.public_text ?? currentCaption?.text ?? "";
  const liveLabel = context.errorSource === "load" ? "前回確認した表示" : clientMode ? "UDトークで表示" : !context.visible ? "非表示" : currentId ? "観客に表示中" : "字幕を待っています";
  const recentCaptions = context.captions.slice(-3).map(caption => ({
    id: caption.id, receivedAt: caption.received_at,
    timeLabel: receivedTime.format(new Date(caption.received_at)),
    timeDescription: "受信時刻：" + receivedDateTime.format(new Date(caption.received_at)),
    text: caption.text, original: caption.original, receiving: caption.source_final === false,
  }));
  const modelNames = new Map(context.ai.models.map(model => [model.id, model.label]));
  const statusTarget = context.statusTooltip.focus ?? context.statusTooltip.pointer;
  const statusOpen = statusTarget !== null && (statusTarget.captionId !== context.statusTooltip.dismissed?.captionId
    || statusTarget.kind !== context.statusTooltip.dismissed?.kind);
  const rows: RowParameters[] = context.captions.map(caption => {
    const draft = context.drafts.get(caption.id);
    const saving = context.pendingSave?.captionId === caption.id;
    const rowError = context.errorCaptionId === caption.id ? context.error : "";
    const editing = context.activeCaptionId === caption.id;
    const focusVersion = editing ? context.editorFocusRequest : 0;
    const saveSuccess = context.saveStatus?.captionId === caption.id ? context.saveStatus.message : "";
    const disabled = !snapshot.can({ type: "caption.save.requested", captionId: caption.id });
    const readOnly = !snapshot.can({ type: "caption.draft.changed", captionId: caption.id, text: draft?.text ?? caption.text });
    const discardDisabled = !snapshot.can({ type: "caption.draft.discarded", captionId: caption.id });
    const editDisabled = !snapshot.can({ type: "caption.edit.requested", captionId: caption.id });
    const republishDisabled = !snapshot.can({ type: "caption.save.requested", captionId: caption.id, republish: true });
    const sourceModelName = caption.ai_result ? modelNames.get(caption.ai_result.model_id) ?? caption.ai_result.model_id : "";
    const sourceStatusOpen = statusOpen && statusTarget?.captionId === caption.id && statusTarget.kind === "source";
    const publicationStatusOpen = statusOpen && statusTarget?.captionId === caption.id && statusTarget.kind === "publication";
    const statusTooltipPosition = (sourceStatusOpen || publicationStatusOpen) && context.statusTooltip.measurement?.captionId === caption.id
      && context.statusTooltip.measurement.kind === statusTarget?.kind ? context.statusTooltip.measurement.position : null;
    const savedDisclosure = presentDisclosure(`caption-saved:${caption.id}`, context.openedDisclosures);
    const dependencies = [draft, saving, rowError, editing, focusVersion, saveSuccess, disabled, readOnly, discardDisabled, editDisabled, republishDisabled, context.errorSource === "load",
      sourceModelName, sourceStatusOpen, publicationStatusOpen, statusTooltipPosition, context.visible, currentId === caption.id, displayedIds.has(caption.id), firstUnreadId === caption.id, clientMode, savedDisclosure.open];
    const cached = rowCache.get(caption);
    if (cached && dependencies.every((dependency, index) => dependency === cached.dependencies[index])) return cached.parameters;
    const dirty = Boolean(draft && (draft.text !== caption.text || draft.requestId));
    const aiPending = caption.ai_status === "running" || caption.ai_status === "queued";
    const source = saving ? "saving" : dirty ? "unsaved" : caption.human_edited ? "human" : aiPending ? "processing" : caption.formatted_text ? "ai" : "original";
    const differentPublic = caption.published && caption.public_text != null && caption.public_text !== caption.text;
    const publicationState = clientMode ? "native" : !context.visible || !caption.publish_eligible ? "hidden" : differentPublic && displayedIds.has(caption.id) ? "updating"
      : displayedIds.has(caption.id) ? "live" : caption.published ? "published" : caption.source_final === false ? "receiving" : "waiting";
    const publishes = context.visible && caption.publish_eligible && caption.source_final !== false;
    const publicationText = clientMode ? "UDトーク側の字幕表示を使います。受信文と訂正の受付状態は、このアプリで確認できます。" : { hidden: !context.visible ? "観客には非表示" : "公開の対象外", updating: "観客には前の公開文を表示中", live: "観客に表示中", published: "公開済み・現在の表示範囲外", receiving: "発話の確定待ち", waiting: "保存すると公開", native: "UDトーク側の字幕表示を使います。" }[publicationState]
      + (differentPublic ? `。公開文「${caption.public_text}」と一覧の字幕は異なります。` : "");
    const parameters: RowParameters = {
      savedDisclosure,
      id: caption.id, original: caption.original, text: caption.text, speaker: caption.speaker?.trim() || null,
      receivedAt: caption.received_at,
      timeLabel: receivedTime.format(new Date(caption.received_at)),
      timeDescription: "受信時刻：" + receivedDateTime.format(new Date(caption.received_at)),
      draftText: draft?.text ?? caption.text,
      contentDescription: `字幕：${caption.text}`,

      editing, dirty,
      saveLabel: saving ? "保存中…" : draft?.requestId ? "保存結果を確認" : clientMode ? (draft?.conflict ? "再送して" : "保存して") + "UDトークへ反映" : (draft?.conflict ? "再保存" : "保存") + (publishes ? "して公開" : ""),
      saveConsequence: clientMode ? "編集権と発話の更新を確認し、UDトークへ訂正を送ります。通信失敗時は下書きを保持します。" : publishes ? "保存した文を観客に公開します。" : caption.source_final === false
        ? "発話が未確定のため、保存しても観客の表示は変わりません。" : "「保存」は観客の表示を変えません。",
      saveConsequenceVisible: !clientMode && !publishes,
      historyOptions: [...(caption.edit_history ?? [])].reverse().filter(edit => edit.revision !== caption.revision).map(edit => ({
        revision: String(edit.revision), label: ({ source: "原文", ai: "AI修正", manual: "手修正" }[edit.kind]) + "　" + edit.text,
      })),
      republishVisible: !clientMode && context.visible && caption.source_final !== false && !draft?.requestId
        && (!caption.publish_eligible || !displayedIds.has(caption.id)),
      republishDisabled,
      disabled, readOnly, discardDisabled, editDisabled,
      message: draft?.conflict ?? (rowError || caption.ai_error || ""),
      invalid: Boolean(rowError && !draft?.text.trim()),
      aiPending, aiProgressLabel: caption.ai_status === "queued" ? "AI待機中" : "AI校正中",
      source, state: draft?.requestId && !saving ? "保存結果が未確認です。修正内容を保持しています。" : source === "ai" && caption.ai_result
        ? "AI修正 · " + sourceModelName
        : { saving: "保存中", unsaved: "未保存の下書きがあります。一覧には変更前の字幕を表示しています。", human: "手修正済み", processing: caption.ai_status === "queued" ? "AI待機中" : "AI校正中", ai: "AI修正", original: caption.ai_status === "running" || caption.ai_status === "queued" ? "AIの訂正待ち" : caption.ai_error ? "原文採用 · " + caption.ai_error : "原文採用" }[source],
      showPublicationStatus: !clientMode, publicationState, publication: context.errorSource === "load" ? "前回確認時：" + publicationText : publicationText, current: context.errorSource !== "load" && currentId === caption.id,
      firstUnread: firstUnreadId === caption.id, focusVersion, saveSuccess, sourceStatusOpen, publicationStatusOpen, statusTooltipPosition,
    };
    rowCache.set(caption, { dependencies, parameters });
    return parameters;
  });
  return {
    inspector: { width: context.inspectorPreviewWidth ?? Math.min(context.inspectorWidth, context.inspectorMaxWidth),
      maximum: context.inspectorMaxWidth, resizing: context.inspectorResize !== null,
      widenDisabled: !snapshot.can({ type: "inspector.width.adjusted", direction: "wider" }),
      narrowDisabled: !snapshot.can({ type: "inspector.width.adjusted", direction: "narrower" }) },
    panelFocus: context.settingsFocusTarget ? {
      selector: settingsFocusSelector(context.settingsFocusTarget),
      version: context.settingsFocusRequest,
    } : null,
    toolbar: {
      audienceHref: "/view/demo" + (roomId ? "?room_id=" + encodeURIComponent(roomId) : ""),
      helpDisclosure: presentDisclosure("publication-help", context.openedDisclosures),
      preparationDisclosure: presentDisclosure("preparation", context.openedDisclosures),
      preparationHint: !context.visible ? "非表示中のため、テスト字幕は一覧に追加され、観客には表示されません。"
        : context.autoPublish ? "自動公開中のため、テスト字幕は観客画面にも表示されます。"
        : "テスト字幕は一覧に追加されます。保存して公開するまで観客の表示は変わりません。",
      testDisabled: !snapshot.can({ type: "test.requested" }),
      toggleDisabled: !snapshot.can({ type: "visibility.toggle.requested" }),
      toggleLabel: context.visible ? "字幕を隠す" : "字幕を表示",
      visibilityIcon: context.visible ? "hide" : "show",
      mode: context.autoPublish ? "auto" : "manual",
      modeDisabled: !snapshot.can({ type: "publication.mode.requested", mode: context.autoPublish ? "manual" : "auto" }),
      settingsOpen: !clientMode && context.settingsPanel === "display",
      aiSettingsOpen: context.settingsPanel === "ai",
      dictionarySettingsOpen: context.settingsPanel === "dictionary",
      dictionarySettingsDisabled: !snapshot.can({ type: "dictionary.settings.toggled" }),
      aiTitle: "AI設定 · " + (selectedAi?.label ?? "AIなし"),
      connectionSettingsOpen: context.settingsPanel === "connection",
      localOutput: !clientMode,
    },
    message: context.errorSource === "save" ? "" : context.error,
    reloadVisible: context.roomState === "room_reset",
    rows, editor: rows.find(row => row.editing) ?? null,
    monitor: { recentCaptions, liveText, liveLabel }, recentCaptions,
    unreadCount: context.unreadIds.length, firstUnreadId,
    unreadAnnouncement: context.unreadIds.length ? `新着の字幕が${context.unreadIds.length}件あります。` : "",
    latestLabel: context.unreadIds.length ? `最新へ · 新着 ${context.unreadIds.length} 件` : "最新へ",
    latestVisible: !context.atLatest && context.captions.length > 0,
    returnToEditorDisabled: !snapshot.can({ type: "timeline.editing.requested" }),
    returnToEditorVisible: snapshot.can({ type: "timeline.editing.requested" }) && (context.settingsPanel !== null || !context.editingCaptionVisible),
    hasUnsavedChanges: rows.some(row => row.dirty) || aiDirty || dictionaryDirty || JSON.stringify(displayDraft) !== JSON.stringify(context.display)
      || Boolean(context.connectionDraft && (context.connectionDraft.mode !== context.connection.mode || context.connectionDraft.editor_url?.trim()
        || context.connectionDraft.zoom_text_format !== context.connection.zoom_text_format
        || context.connectionDraft.input_source !== context.connection.input_source || context.connectionDraft.recognizer !== context.connection.recognizer)),
    liveText, liveLabel,
    scrollToLatest: context.followLatest,
    scrollVersion: String(context.latestRequest), scrollTarget: context.scrollTarget, scrollCaptionId: context.activeCaptionId,
    historyFocusCaptionId: context.historyFocusCaptionId, historyFocusVersion: context.historyFocusRequest,
    followLabel: context.followLatest ? "最新に追従中" : "履歴を確認中",
    loading: snapshot.matches("loading"),
    displaySettings: presentDisplay(displayDraft, context.display, !snapshot.can({ type: "display.save.requested" }),
      publicationOrder.map(caption => ({ id: caption.id,
        text: caption.public_text ?? caption.text, speaker: caption.published ? caption.public_speaker : caption.speaker })), context.openedDisclosures),
    dictionary: {
      variantsHint: `任意・1行1件、${dictionaryLimits.maxVariants}件まで`,
      entries: dictionaryDraft.entries.map((word, index) => ({ ...word, index,
        invalidField: context.dictionaryError?.index === index ? context.dictionaryError.field ?? null : null })),
      countLabel: `${dictionaryDraft.entries.length} / ${dictionaryLimits.maxEntries}件`, empty: dictionaryDraft.entries.length === 0,
      disabled: dictionaryDisabled,
      addDisabled: !snapshot.can({ type: "dictionary.word.added" }),
      saveDisabled: dictionaryDisabled || !dictionaryDirty,
      discardDisabled: !snapshot.can({ type: "dictionary.draft.discarded" }) || (!dictionaryDirty && !context.dictionaryError),
      saveHint: snapshot.matches({ ready: "settingDictionary" }) ? "保存中" : dictionaryDirty ? "未保存" : "",
      error: context.dictionaryError?.message ?? "", notice: context.dictionaryNotice,
      recognitionHint: context.connection.input_source === "microphone"
        ? "表記は次に音声認識を開始したときから使います。読みと誤認識の表記はAI校正で参照します。"
        : "UDトークからの入力ではAI校正で参照します。自前の音声入力では認識にも使います。",
    },
    ai: {
      error: context.aiError,
      backgroundInvalid: context.aiBackgroundInvalid,
      background: aiDraft.background,
      helpDisclosure: presentDisclosure("ai-help", context.openedDisclosures),
      comparisonDisclosure: presentDisclosure("ai-comparison", context.openedDisclosures),
      connectionWarning: context.ai.settings.strategy !== "off" && !context.ai.connected,
      showModelSettings: aiDraft.strategy !== "off" || context.aiBackgroundExpanded,
      connectionDescription: context.ai.settings.strategy === "off" ? "AIはオフです。原文を受け取り、手動で訂正できます。"
        : context.ai.connected ? "確定した字幕を選択したAIへ送って訂正します。API利用料がかかります。"
          : "選択したAIのAPIキーが未設定です。サーバーにキーを設定して再起動してください。",
      model: aiDraft.strategy === "off" ? "off" : aiDraft.preferred_model,
      saveDisabled: aiDisabled || !aiDirty, saveHint: aiDirty ? "未保存" : "",
      disabled: aiDisabled,
      models: context.ai.models.map(model => ({
        id: model.id, provider: aiProviderNames[model.provider], label: model.label,
        variant: model.label.replace(/^(Gemini |Claude )/, ""),
        inputPrice: "$" + model.input_usd_per_million.toFixed(2), outputPrice: "$" + model.output_usd_per_million.toFixed(2),
        sampleCost: "$" + ((200 * model.input_usd_per_million + 100 * model.output_usd_per_million) / 1000).toFixed(2),
        latency: model.configured === false ? "キー未設定" : model.measured_latency_ms == null ? "未計測" : `${Math.round(model.measured_latency_ms)} ms · ${model.latency_samples ?? 0} 件`,
        pricingUrl: model.pricing_url, checkedOn: model.pricing_checked_on ?? "",
      })),
    },
    connection: {
      hostHelpDisclosure: presentDisclosure("connection-host-help", context.openedDisclosures),
      clientHelpDisclosure: presentDisclosure("connection-client-help", context.openedDisclosures),
      mode: connectionDraft.mode ?? "host",
      modeLabel: clientMode ? "UDトークへ反映" : "独立配信",
      stateLabel: context.connection.input_source === "microphone" ? microphoneStatus
        : { waiting: "受信待ち", connecting: "接続中", live: "受信中", retrying: "再試行中", failed: "接続停止" }[context.connection.state],
      message: context.connection.message,
      messageVisible: context.connection.state === "failed" || context.connection.state === "retrying",
      receiverUrl: context.receiverUrl,
      editorUrl: connectionDraft.editor_url ?? "",
      textFormat: connectionDraft.zoom_text_format ?? "plain",
      showReceiver: connectionDraft.mode !== "client" && (connectionDraft.input_source ?? context.connection.input_source) !== "microphone",
      showEditor: connectionDraft.mode === "client",
      disabled: !snapshot.can({ type: "connection.mode.selected", mode: "host" }),
      saveDisabled: !snapshot.can({ type: "connection.save.requested" }),
      receivedLabel: `受信した更新：${context.connection.received_events}件`,
      inputSource: connectionDraft.input_source ?? context.connection.input_source,
      recognizer: connectionDraft.recognizer ?? context.connection.recognizer,
      recognizers: context.connection.recognizers.length ? context.connection.recognizers.map(option => ({ id: option.id, label: option.label, disabled: !option.available }))
        : [{ id: "openai", label: "OpenAI", disabled: false }, { id: "apple", label: "Apple", disabled: true }],
      showMicrophone: connectionDraft.mode !== "client" && (connectionDraft.input_source ?? context.connection.input_source) === "microphone",
      recognizerMessage: context.connection.recognizers.find(option => option.id === (connectionDraft.recognizer ?? context.connection.recognizer))?.message ?? "接続を適用すると利用条件を確認できます。",
      microphoneStatus,
      startDisabled: !snapshot.can({ type: "microphone.start.requested" }),
      stopDisabled: !snapshot.can({ type: "microphone.stop.requested" }),
      microphoneLabel: context.microphoneLabel ? `使用するマイク：${context.microphoneLabel}` : "",
      deviceId: context.microphoneDeviceId,
      devices: [{ id: "", label: "既定のマイク" }, ...context.microphoneDevices],
      deviceDisabled: !snapshot.can({ type: "microphone.device.selected", deviceId: context.microphoneDeviceId }),
      usageLabel: connectionDraft.recognizer === "apple" ? "音声は接続先のMacで認識します。クラウドへ送りません。"
        : `試験の送信累計：${Math.ceil((context.connection.transcription.sent_seconds ?? 0) / 60)}分 · 費用見積もり：${Math.ceil(context.connection.transcription.estimated_yen ?? 0)}円（上限100円・20分）`,
    },
  };
}
