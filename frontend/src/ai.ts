import type { AiRouting, AiSettings } from "./domain";

export const defaultAiSettings: AiSettings = {
  strategy: "off", preferred_model: "gemini-3.1-flash-lite",
  candidates: ["gemini-3.1-flash-lite", "claude-haiku-4-5", "gpt-5.3-codex"],
};

export const defaultAi: AiRouting = {
  settings: defaultAiSettings, models: [], selected_model: null, reason: "off", connected: false,
};

export const aiProviderNames = { gemini: "Gemini", claude: "Claude", codex: "Codex" };

export const aiStrategies = {
  off: "AIなし", manual: "AIを指定", cost: "費用を優先", speed: "実測の速度を優先",
} satisfies Record<AiSettings["strategy"], string>;

export function knownAiModel(value: string): value is AiSettings["preferred_model"] {
  return defaultAiSettings.candidates.some(model => model === value);
}
