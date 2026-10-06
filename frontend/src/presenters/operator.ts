import type { AiSettings, DisplaySettings } from "../domain";
import type { CSSProperties } from "react";
import { aiProviderNames, aiStrategies } from "../ai";
import { displayChoices, displayFonts, displayPalettes } from "../display";
import type { OperatorSnapshot } from "../machines/operator";

export interface RowParameters {
  id: string;
  number: number;
  original: string;
  text: string;
  draftText: string;
  contentDescription: string;
  formattedText: string | null;
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
  source: "saving" | "unsaved" | "human" | "ai" | "original";
  publication: string;
  publicationState: "hidden" | "updating" | "live" | "published" | "receiving" | "waiting";
  current: boolean;
  firstUnread: boolean;
  focusVersion: number;
  saveSuccess: string;
  saveConsequence: string;
}

export interface RecentCaptionParameters {
  id: string;
  number: number;
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
  testDisabled: boolean;
  toggleDisabled: boolean;
  toggleLabel: string;
  mode: string;
  modeDisabled: boolean;
  settingsOpen: boolean;
  aiSettingsOpen: boolean;
  aiTitle: string;
}

export interface AiParameters {
  strategy: string;
  strategies: { value: string; label: string }[];
  preferredModel: string;
  saveDisabled: boolean;
  saveHint: string;
  disabled: boolean;
  selectedLabel: string;
  selectionNote: string;
  models: { id: AiSettings["preferred_model"]; provider: string; label: string; variant: string; inputPrice: string; outputPrice: string;
    sampleCost: string; latency: string; selected: boolean; disabled: boolean; pricingUrl: string; checkedOn: string }[];
}

export interface DisplayFieldParameters {
  field: keyof DisplaySettings;
  label: string;
  value: string;
  kind: "color" | "select";
  options: { value: string; label: string }[];
}

export interface DisplayParameters {
  previewStyle: CSSProperties;
  palette: string;
  palettes: { value: string; label: string }[];
  groups: DisplayFieldParameters[][];
  disabled: boolean;
  saveDisabled: boolean;
  saveHint: string;
}

function presentDisplay(settings: DisplaySettings, saved: DisplaySettings, disabled: boolean): DisplayParameters {
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const field = (key: keyof DisplaySettings, label: string): DisplayFieldParameters => ({
    field: key, label, value: String(settings[key]),
    kind: key === "background" || key === "foreground" ? "color" : "select",
    options: key === "background" || key === "foreground" ? [] : displayChoices[key].map(choice => ({ ...choice, value: String(choice.value) })),
  });
  return {
    previewStyle: { background: settings.background, color: settings.foreground, fontFamily: displayFonts[settings.font], fontWeight: settings.font_weight, textAlign: settings.align },
    palette: Object.entries(displayPalettes).find(([, palette]) => palette.background === settings.background && palette.foreground === settings.foreground)?.[0] ?? "custom",
    palettes: [...Object.entries(displayPalettes).map(([value, palette]) => ({ value, label: palette.label })), { value: "custom", label: "カスタム" }],
    groups: [[field("background", "背景"), field("foreground", "文字")], [field("font", "フォント")],
      [field("font_size", "文字サイズ"), field("font_weight", "太さ")], [field("line_height", "行間"), field("padding", "余白")],
      [field("position", "縦位置"), field("align", "文字揃え")], [field("history_count", "表示する発話"), field("aspect", "表示領域")]],
    disabled, saveDisabled: disabled || !dirty, saveHint: dirty ? "未反映の設定があります" : "現在の表示設定",
  };
}

export interface OperatorParameters {
  toolbar: ToolbarParameters;
  message: string;
  rows: RowParameters[];
  editor: RowParameters | null;
  monitor: CaptionMonitorParameters;
  recentCaptions: RecentCaptionParameters[];
  unreadCount: number;
  firstUnreadId: string | null;
  latestLabel: string;
  returnToEditorDisabled: boolean;
  hasUnsavedChanges: boolean;
  liveText: string;
  liveLabel: string;
  scrollToLatest: boolean;
  scrollVersion: string;
  scrollTarget: "latest" | "caption";
  scrollCaptionId: string | null;
  followLabel: string;
  loading: boolean;
  displaySettings: DisplayParameters;
  ai: AiParameters;
}

export function presentOperator(snapshot: OperatorSnapshot): OperatorParameters {
  const { context } = snapshot;
  const currentId = context.visible ? context.captions.filter(caption => caption.published).at(-1)?.id : undefined;
  const displayDraft = context.displayDraft ?? context.display;
  const aiDraft = context.aiDraft ?? context.ai.settings;
  const selectedAi = context.ai.models.find(model => model.id === context.ai.selected_model);
  const aiDirty = JSON.stringify(aiDraft) !== JSON.stringify(context.ai.settings);
  const aiDisabled = !snapshot.can({ type: "ai.save.requested" });
  const firstUnreadId = context.captions.find(caption => context.unreadIds.includes(caption.id))?.id ?? null;
  const liveText = context.captions.find(caption => caption.id === currentId)?.public_text
    ?? context.captions.find(caption => caption.id === currentId)?.text ?? "";
  const liveLabel = !context.visible ? "非表示 · 入力と編集は継続中" : currentId ? "観客に表示中" : "新しい字幕を待っています";
  const recentCaptions = context.captions.slice(-3).map((caption, index) => ({
    id: caption.id, number: Math.max(0, context.captions.length - 3) + index + 1,
    text: caption.text, original: caption.original, receiving: caption.source_final === false,
  }));
  const rows: RowParameters[] = context.captions.map((caption, index) => {
    const draft = context.drafts.get(caption.id);
    const saving = context.pendingSave?.captionId === caption.id;
    const dirty = Boolean(draft && draft.text !== caption.text);
    const rowError = context.errorCaptionId === caption.id ? context.error : "";
    const source = saving ? "saving" : dirty ? "unsaved" : caption.human_edited ? "human" : caption.formatted_text ? "ai" : "original";
    const differentPublic = caption.published && caption.public_text != null && caption.public_text !== caption.text;
    const publicationState = !context.visible || !caption.publish_eligible ? "hidden" : differentPublic ? "updating"
      : currentId === caption.id ? "live" : caption.published ? "published" : caption.source_final === false ? "receiving" : "waiting";
    const publishes = context.visible && caption.publish_eligible && caption.source_final !== false;
    const publication = { hidden: !context.visible ? "観客には非表示" : "公開の対象外", updating: "観客には前の公開文を表示中", live: "観客に表示中", published: "公開済み", receiving: "発話の確定待ち", waiting: "保存すると公開" }[publicationState]
      + (differentPublic ? `。公開文「${caption.public_text}」と保存済みの表示文は異なります。` : "");
    return {
      id: caption.id, number: index + 1, original: caption.original, text: caption.text,
      draftText: draft?.text ?? caption.text,
      contentDescription: `原文：${caption.original}。保存済みの表示文：${caption.text}`,
      formattedText: caption.formatted_text ?? null,
      editing: context.activeCaptionId === caption.id, dirty,
      saveLabel: saving ? "保存中…" : (draft?.conflict ? "再保存" : "保存") + (publishes ? "して公開" : ""),
      saveConsequence: publishes ? "保存した文を観客に公開します。" : caption.source_final === false
        ? "発話が未確定のため、保存しても観客の表示は変わりません。" : "保存しても観客の表示は変わりません。",
      disabled: !snapshot.can({ type: "caption.save.requested", captionId: caption.id }),
      readOnly: !snapshot.can({ type: "caption.draft.changed", captionId: caption.id, text: draft?.text ?? caption.text }),
      discardDisabled: !snapshot.can({ type: "caption.draft.discarded", captionId: caption.id }),
      editDisabled: !snapshot.can({ type: "caption.edit.requested", captionId: caption.id }),
      message: draft?.conflict ?? rowError,
      invalid: Boolean(rowError && !draft?.text.trim()),
      source, state: source === "ai" && caption.ai_result
        ? "AI修正 · " + (context.ai.models.find(model => model.id === caption.ai_result?.model_id)?.label ?? caption.ai_result.model_id)
        : { saving: "保存中", unsaved: "未保存の下書きがあります。この行は保存済みの表示文です。", human: "手修正済み", ai: "AI修正", original: "原文採用" }[source],
      publicationState, publication, current: currentId === caption.id,
      firstUnread: firstUnreadId === caption.id, focusVersion: context.editorFocusRequest,
      saveSuccess: context.saveStatus?.captionId === caption.id ? context.saveStatus.message : "",
    };
  });
  return {
    toolbar: {
      testDisabled: !snapshot.can({ type: "test.requested" }),
      toggleDisabled: !snapshot.can({ type: "visibility.toggle.requested" }),
      toggleLabel: context.visible ? "字幕を隠す" : "字幕を表示",
      mode: context.autoPublish ? "auto" : "manual",
      modeDisabled: !snapshot.can({ type: "publication.mode.requested", mode: context.autoPublish ? "manual" : "auto" }),
      settingsOpen: context.settingsOpen,
      aiSettingsOpen: context.aiSettingsOpen,
      aiTitle: "AI設定 · " + (selectedAi?.label ?? "AIなし"),
    },
    message: context.errorSource === "save" ? "" : context.error,
    rows, editor: rows.find(row => row.editing) ?? null,
    monitor: { recentCaptions, liveText, liveLabel }, recentCaptions,
    unreadCount: context.unreadIds.length, firstUnreadId,
    latestLabel: context.unreadIds.length ? `最新へ · 新着 ${context.unreadIds.length} 件` : "最新へ",
    returnToEditorDisabled: !snapshot.can({ type: "timeline.editing.requested" }),
    hasUnsavedChanges: rows.some(row => row.dirty) || aiDirty || JSON.stringify(displayDraft) !== JSON.stringify(context.display),
    liveText, liveLabel,
    scrollToLatest: context.followLatest,
    scrollVersion: String(context.latestRequest), scrollTarget: context.scrollTarget, scrollCaptionId: context.activeCaptionId,
    followLabel: context.followLatest ? "最新に追従中" : "履歴を確認中",
    loading: snapshot.matches("loading"),
    displaySettings: presentDisplay(displayDraft, context.display, !snapshot.can({ type: "display.save.requested" })),
    ai: {
      strategy: aiDraft.strategy, preferredModel: aiDraft.preferred_model,
      strategies: Object.entries(aiStrategies).map(([value, label]) => ({ value, label })),
      saveDisabled: aiDisabled || !aiDirty, saveHint: aiDirty ? "未保存の設定があります" : "設定は次の確定字幕から使います",
      disabled: aiDisabled,
      selectedLabel: selectedAi?.label ?? "AIなし",
      selectionNote: { off: "原文を採用します。", manual: "指定したAIへ振り分けます。", cost: "候補の中から参考条件で最も安いAIを選びます。",
        speed: "候補の中から実測の応答時間が短いAIを選びます。", unmeasured: "応答時間が未計測のため、指定したAIを使います。" }[context.ai.reason],
      models: context.ai.models.map(model => ({
        id: model.id, provider: aiProviderNames[model.provider], label: model.label,
        variant: model.label.replace(/^(Gemini |Claude |Codex · )/, ""),
        inputPrice: "$" + model.input_usd_per_million.toFixed(2), outputPrice: "$" + model.output_usd_per_million.toFixed(2),
        sampleCost: "$" + ((200 * model.input_usd_per_million + 100 * model.output_usd_per_million) / 1000).toFixed(2),
        latency: model.measured_latency_ms == null ? "未計測" : `${Math.round(model.measured_latency_ms)} ms · ${model.latency_samples ?? 0} 件`,
        selected: aiDraft.candidates.includes(model.id),
        disabled: !snapshot.can({ type: "ai.candidate.changed", modelId: model.id, included: !aiDraft.candidates.includes(model.id) }),
        pricingUrl: model.pricing_url, checkedOn: model.pricing_checked_on ?? "",
      })),
    },
  };
}
