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

export const aiStrategies = {
  off: "AIなし", manual: "AIを指定", cost: "費用を優先", speed: "実測の速度を優先",
} satisfies Record<AiSettings["strategy"], string>;

export function knownAiModel(value: string): value is AiSettings["preferred_model"] {
  return defaultAiSettings.candidates.some(model => model === value);
}
