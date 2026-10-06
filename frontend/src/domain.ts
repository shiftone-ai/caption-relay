import type { components } from "./generated/api";

export type Caption = components["schemas"]["Caption"];
export type DisplaySettings = Required<components["schemas"]["DisplaySettings"]>;
export type PublicationMode = components["schemas"]["PublicationMode"];
export type AiSettings = Required<components["schemas"]["AiSettings"]>;
export type AiRouting = Omit<components["schemas"]["AiRouting"], "settings"> & { settings: AiSettings };

export interface Snapshot {
  visible: boolean;
  captions: Caption[];
  autoPublish?: boolean;
  display?: DisplaySettings;
  ai?: AiRouting;
}

export type PublicSnapshot = components["schemas"]["PublicSnapshot"];

export interface Draft {
  text: string;
  baseRevision: number;
  conflict?: string;
}

export interface SaveRequest extends Draft {
  captionId: string;
}

export type OperatorEvent =
  | { type: "caption.draft.changed"; captionId: string; text: string }
  | { type: "caption.save.requested"; captionId: string }
  | { type: "caption.edit.requested"; captionId: string }
  | { type: "caption.edit.closed" }
  | { type: "caption.editor.keypressed"; captionId: string; key: string; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }
  | { type: "caption.draft.discarded"; captionId: string }
  | { type: "timeline.latest.requested" }
  | { type: "timeline.editing.requested" }
  | { type: "timeline.scrolled"; scrollHeight: number; clientHeight: number; scrollTop: number }
  | { type: "timeline.resized"; scrollHeight: number; clientHeight: number; scrollTop: number }
  | { type: "settings.keypressed"; key: string; isComposing: boolean }
  | { type: "publication.mode.requested"; mode: string }
  | { type: "display.settings.toggled" }
  | { type: "display.field.changed"; field: keyof DisplaySettings; value: string }
  | { type: "display.palette.selected"; value: string }
  | { type: "display.save.requested" }
  | { type: "ai.settings.toggled" }
  | { type: "ai.strategy.selected"; value: string }
  | { type: "ai.preferred.selected"; modelId: string }
  | { type: "ai.candidate.changed"; modelId: string; included: boolean }
  | { type: "ai.save.requested" }
  | { type: "visibility.toggle.requested" }
  | { type: "test.requested" }
  | { type: "refresh.requested" };

export type AudienceEvent =
  | { type: "display.fullscreen.requested" }
  | { type: "display.fullscreen.changed"; active: boolean }
  | { type: "stream.opened" }
  | { type: "stream.failed" }
  | { type: "stream.snapshot"; snapshot: PublicSnapshot };

export type ViewEvent = OperatorEvent | Extract<AudienceEvent, { type: "display.fullscreen.requested" }>;

export interface FullscreenAdapter {
  available: boolean;
  isActive(): boolean;
  subscribe(emit: (event: Extract<AudienceEvent, { type: "display.fullscreen.changed" }>) => void): () => void;
  setActive(active: boolean): Promise<void>;
}

export interface OperatorApi {
  load(signal: AbortSignal): Promise<Snapshot>;
  save(request: SaveRequest, signal: AbortSignal): Promise<Caption>;
  setVisible(visible: boolean, signal: AbortSignal): Promise<boolean>;
  sendTest(signal: AbortSignal): Promise<void>;
  setPublicationMode(mode: PublicationMode, signal: AbortSignal): Promise<PublicationMode>;
  setDisplay(settings: DisplaySettings, signal: AbortSignal): Promise<DisplaySettings>;
  setAi(settings: AiSettings, signal: AbortSignal): Promise<AiRouting>;
}

export interface AudienceApi {
  subscribe(emit: (event: AudienceEvent) => void): () => void;
}

export class CaptionConflict extends Error {
  constructor(public readonly latest: Caption) {
    super("Caption revision conflict");
  }
}
