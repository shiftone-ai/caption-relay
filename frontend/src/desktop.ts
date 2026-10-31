export const credentialFields = [
  { key: "OPENAI_API_KEY", label: "OpenAI · AI校正", secret: true },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic · AI校正", secret: true },
  { key: "GEMINI_API_KEY", label: "Gemini · AI校正", secret: true },
  { key: "CAPTION_RELAY_OPENAI_API_KEY", label: "OpenAI · 音声認識専用", secret: true },
  { key: "CAPTION_RELAY_STT_JPY_PER_USD", label: "音声認識の円換算（円/USD）", secret: false },
] as const;
export type CredentialKey = typeof credentialFields[number]["key"];
export interface CredentialsApi {
  status(): Promise<{ configured: Partial<Record<CredentialKey, boolean>>; stt_rate: string }>;
  save(changes: Partial<Record<CredentialKey, string>>): Promise<void>;
}
export type DesktopEvent =
  | { type: "desktop.changed"; key: CredentialKey; value: string }
  | { type: "desktop.removal.changed"; key: CredentialKey; remove: boolean }
  | { type: "desktop.save.requested" }
  | { type: "desktop.save.confirmed" }
  | { type: "desktop.save.cancelled" }
  | { type: "desktop.retry.requested" };
