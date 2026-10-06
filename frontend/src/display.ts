import type { DisplaySettings } from "./domain";

export const defaultDisplay: DisplaySettings = {
  background: "#0a0a0a", foreground: "#ffffff", font: "sans", font_size: 64,
  font_weight: "bold", line_height: 1.5, padding: 48, position: "center",
  align: "left", history_count: 1, aspect: "window",
};

export const displayFonts = {
  sans: 'system-ui, "Hiragino Sans", "Yu Gothic", sans-serif',
  serif: '"Hiragino Mincho ProN", "Yu Mincho", serif',
  mono: 'ui-monospace, "BIZ UDGothic", monospace',
} as const;

export const displayPalettes = {
  dark: { label: "黒背景・白文字", background: "#0a0a0a", foreground: "#ffffff" },
  light: { label: "白背景・黒文字", background: "#ffffff", foreground: "#171717" },
  green: { label: "クロマキー緑", background: "#00ff00", foreground: "#171717" },
} as const;

type ChoiceField = Exclude<keyof DisplaySettings, "background" | "foreground">;
export const displayChoices = {
  font: [{ value: "sans", label: "ゴシック（端末標準）" }, { value: "serif", label: "明朝" }, { value: "mono", label: "等幅" }],
  font_size: [24,32,40,48,56,64,72,80,88,96].map(value => ({ value, label: value + " px" })),
  font_weight: [{ value: "normal", label: "標準" }, { value: "bold", label: "太字" }],
  line_height: [{ value: 1.25, label: "狭め" }, { value: 1.5, label: "標準" }, { value: 1.75, label: "広め" }, { value: 2, label: "2倍" }],
  padding: [0,8,16,24,32,40,48,64,80,96].map(value => ({ value, label: value + " px" })),
  position: [{ value: "top", label: "上" }, { value: "center", label: "中央" }, { value: "bottom", label: "下" }],
  align: [{ value: "left", label: "左" }, { value: "center", label: "中央" }],
  history_count: [1,2,3,5,10].map(value => ({ value, label: "直近 " + value + " 件" })),
  aspect: [{ value: "window", label: "画面に合わせる" }, { value: "16:9", label: "16:9" }],
} satisfies { [Field in ChoiceField]: { value: DisplaySettings[Field]; label: string }[] };

export function changeDisplayField(settings: DisplaySettings, field: keyof DisplaySettings, value: string): DisplaySettings {
  if (field === "background" || field === "foreground") {
    return /^#[0-9a-f]{6}$/i.test(value) ? { ...settings, [field]: value } : settings;
  }
  const choice = displayChoices[field].find(choice => String(choice.value) === value);
  return choice ? { ...settings, [field]: choice.value } : settings;
}

export function selectDisplayPalette(settings: DisplaySettings, value: string): DisplaySettings {
  const palette = Object.entries(displayPalettes).find(([key]) => key === value)?.[1];
  return palette ? { ...settings, background: palette.background, foreground: palette.foreground } : settings;
}
