import type { CSSProperties } from "react";
import { displayFonts } from "../display";
import type { DisplaySettings } from "../domain";

export interface CaptionDisplayParameters {
  texts: string[];
  utterances: { id: string; text: string; speakerLabel: string | null }[];
  scrollVersion: string;
  followLatest: boolean;
  keyboardScrollable: boolean;
  announceChanges: boolean;
  focusVersion: number;
  screenStyle: CSSProperties;
  frameStyle: CSSProperties;
  captionStyle: CSSProperties;
  paragraphStyle: CSSProperties;
  speakerStyle: CSSProperties;
  aspect: DisplaySettings["aspect"];
  position: DisplaySettings["position"];
}

export interface DisplayCaption { id?: string; text: string; speaker?: string | null }

export interface DisplayPreviewParameters {
  display: CaptionDisplayParameters;
  viewportLabel: string;
  scaleLabel: string;
  sourceLabel: string;
}

const previewWidth = 1280;
const sampleTexts = [
  "本日はご参加いただき、ありがとうございます。会場では講演の内容を字幕でお伝えします。聞き取りにくい箇所があった場合も、前後の話を合わせてご確認ください。",
  "最初に、この取り組みを始めた背景についてお話しします。私たちは年齢や経験にかかわらず、誰もが同じ情報を受け取れる場をつくりたいと考えています。",
  "字幕には話された順に発話が表示されます。文字の大きさや行間によって、一度に読める量が変わりますので、会場の後方からも読みやすい設定をご確認ください。",
  "たとえば長い説明が続くときは、文章が複数の行に折り返されます。句読点や改行を保ちながら、画面の幅に合わせて表示し、最後に届いた発話へ進みます。",
  "ここからは、実際の利用場面を見ていきましょう。登壇者と参加者がやりとりする場面では、直前の発言も読めるようにすると、質問の流れを確認しやすくなります。",
  "画面の余白を広げると文字を表示できる範囲が狭くなり、同じ文章でも折り返しが増えます。投影する場所や客席からの距離に合わせて調整してください。",
  "画面全体を使う場合と、十六対九の表示領域を使う場合では、字幕を置ける高さが変わります。上、中央、下の位置を切り替えて、見やすい場所をご確認ください。",
  "複数の発話を表示するときには、文章の間に間隔を設けています。話の切れ目を追いながら読めるか、文字の太さや背景との組み合わせも合わせて確認しましょう。",
  "講演のあとには質疑応答の時間があります。質問される方は、お近くの係にお知らせください。マイクが届いてから、ゆっくりお話しいただければと思います。",
  "以上が本日のご案内です。この文章は表示を確認するための例です。文字サイズ、行間、余白、表示する発話数を変えて、長い日本語の文章が読みやすく収まるかをご確認ください。",
];

const verticalPosition = { top: "flex-start", center: "center", bottom: "flex-end" } as const;

/** Project the same display rules for full-size output and a scaled reference viewport. */
export function presentCaptionDisplay(settings: DisplaySettings, captions: readonly DisplayCaption[], referenceWidth?: number): CaptionDisplayParameters {
  const pixels = (value: number) => referenceWidth ? `${value / referenceWidth * 100}cqw` : value;
  const visible = settings.display_mode === "scroll" ? captions : captions.slice(-settings.history_count);
  const utterances = visible.map((caption, index) => {
    const speaker = settings.speaker_display !== "hidden" ? caption.speaker?.trim() || null : null;
    return { id: caption.id ?? String(index), text: caption.text,
      speakerLabel: speaker && settings.speaker_display === "inline" ? speaker + "：" : speaker };
  });
  return {
    texts: utterances.map(caption => caption.text), utterances, followLatest: true, focusVersion: 0,
    keyboardScrollable: settings.display_mode === "scroll" && !referenceWidth,
    announceChanges: !referenceWidth,
    scrollVersion: JSON.stringify([utterances, settings.display_mode, settings.speaker_display, settings.font, settings.font_size, settings.font_weight, settings.line_height,
      settings.padding, settings.align, settings.aspect, settings.position, referenceWidth]),
    screenStyle: { background: settings.background, color: settings.foreground },
    frameStyle: {
      width: settings.aspect === "16:9" ? "min(100cqw, 177.7777777778cqh)" : "100%",
      height: settings.aspect === "16:9" ? "min(100cqh, 56.25cqw)" : "100%",
      justifyContent: verticalPosition[settings.position],
    },
    captionStyle: {
      fontFamily: displayFonts[settings.font], fontSize: pixels(settings.font_size), fontWeight: settings.font_weight,
      lineHeight: settings.line_height, padding: pixels(settings.padding), textAlign: settings.align,
      display: "flex", flexDirection: "column", gap: pixels(16),
    },
    paragraphStyle: { margin: 0, flexShrink: 0 },
    speakerStyle: settings.speaker_display === "above"
      ? { display: "block", fontSize: ".625em", fontWeight: 600, lineHeight: 1.25, marginBottom: pixels(8) }
      : { fontWeight: 600 },
    aspect: settings.aspect,
    position: settings.position,
  };
}

export function presentDisplayPreview(settings: DisplaySettings, captions: readonly DisplayCaption[]): DisplayPreviewParameters {
  const useSaved = captions.length > 0;
  return {
    display: presentCaptionDisplay(settings, useSaved ? captions : sampleTexts.map((text, index) => ({ text, speaker: index % 2 ? "登壇者" : "司会" })), previewWidth),
    viewportLabel: "基準画面 1280 × 800 px（16:10）",
    scaleLabel: (settings.aspect === "16:9" ? "表示領域 16:9" : "表示領域は画面全体") + " · 枠の幅に合わせて縮小",
    sourceLabel: useSaved ? "字幕プレビュー" : "表示例（配信されません）",
  };
}
