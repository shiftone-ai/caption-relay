import { formLimits } from "./generated/form-limits";
import type { AiRouting, AiSettings } from "./domain";

export const defaultAiSettings: AiSettings = {
  background: "",
  strategy: "off", preferred_model: "gpt-6-luna",
  candidates: ["gemini-3.5-flash-lite", "claude-haiku-5-5", "gpt-6.1-sol", "gpt-6-luna"],
};

export const defaultAi: AiRouting = {
  settings: defaultAiSettings, models: [], selected_model: null, reason: "off", connected: false,
};

export const aiProviderNames = { gemini: "Gemini", claude: "Claude", openai: "OpenAI" };

export function editableAiSettings(ai: AiRouting): AiSettings {
  const model = ai.settings.strategy === "manual" ? ai.settings.preferred_model
    : ai.selected_model ?? ai.settings.preferred_model;
  return { ...ai.settings, strategy: ai.settings.strategy === "off" ? "off" : "manual",
    preferred_model: model, candidates: [model] };
}

export function knownAiModel(value: string): value is AiSettings["preferred_model"] {
  return defaultAiSettings.candidates.some(model => model === value);
}

export function backgroundValidation(value: string): string {
  return Array.from(value).length > formLimits.background
    ? `トークの背景は${formLimits.background.toLocaleString("ja-JP")}文字以内で入力してください。` : "";
}
