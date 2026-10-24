import type { components } from "./generated/api";

export type Caption = components["schemas"]["Caption"];
export type DisplaySettings = Required<components["schemas"]["DisplaySettings"]>;
export type PublicationMode = components["schemas"]["PublicationMode"];
export type AiSettings = Required<components["schemas"]["AiSettings"]>;
export type AiRouting = Omit<components["schemas"]["AiRouting"], "settings"> & { settings: AiSettings };
export type ConnectionStatus = Required<components["schemas"]["ConnectionStatus"]>;
export type ConnectionSettings = components["schemas"]["ConnectionSettings"];
export type TranscriptionStatus = Required<components["schemas"]["TranscriptionStatus"]>;
export type DictionaryWord = Required<components["schemas"]["DictionaryWord"]>;
export type DictionarySnapshot = Omit<Required<components["schemas"]["DictionarySnapshot"]>, "entries"> & { entries: DictionaryWord[] };
export type DictionaryUpdate = Omit<Required<components["schemas"]["DictionaryUpdate"]>, "entries"> & { entries: DictionaryWord[] };
export interface MicrophoneDevice { id: string; label: string }
export interface MicrophoneSession { label: string; stop(): Promise<void> }
export interface MicrophoneAdapter {
  available: boolean;
  devices(): Promise<MicrophoneDevice[]>;
  start(input: { deviceId: string; recognizer: ConnectionStatus["recognizer"] }, signal: AbortSignal, status: (state: TranscriptionStatus) => void): Promise<MicrophoneSession>;
}

export interface Snapshot {
  visible: boolean;
  captions: Caption[];
  autoPublish?: boolean;
  display?: DisplaySettings;
  ai?: AiRouting;
  connection?: ConnectionStatus;
  receiverUrl?: string;
  dictionary?: DictionarySnapshot;
}

export type PublicSnapshot = components["schemas"]["PublicSnapshot"];

export interface Draft {
  text: string;
  baseRevision: number;
  baseSourceRevision?: number;
  conflict?: string;
}

export interface SaveRequest extends Draft {
  captionId: string;
}

export interface StatusTooltipGeometry {
  triggerTop: number;
  triggerBottom: number;
  triggerLeft: number;
  triggerRight: number;
  tooltipWidth: number;
  tooltipHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export const disclosureIds = [
  "publication-help", "preparation", "display-speaker", "display-appearance", "display-layout", "display-help",
  "ai-help", "ai-comparison", "connection-host-help", "connection-client-help",
] as const;
export type DisclosureId = typeof disclosureIds[number] | `caption-saved:${string}`;

export type OperatorEvent =
  | { type: "inspector.measured"; workspaceWidth: number }
  | { type: "inspector.resize.started"; pointerId: number; clientX: number; right: number; workspaceWidth: number }
  | { type: "inspector.resize.moved"; pointerId: number; clientX: number }
  | { type: "inspector.resize.ended"; pointerId: number; clientX: number }
  | { type: "inspector.resize.cancelled"; pointerId: number }
  | { type: "inspector.resize.keypressed"; key: string; shiftKey: boolean }
  | { type: "disclosure.toggled"; id: DisclosureId }
  | { type: "caption.draft.changed"; captionId: string; text: string }
  | { type: "caption.save.requested"; captionId: string }
  | { type: "caption.edit.requested"; captionId: string }
  | { type: "caption.edit.closed" }
  | { type: "caption.editor.keypressed"; captionId: string; key: string; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }
  | { type: "caption.draft.discarded"; captionId: string }
  | { type: "caption.status.interaction.changed"; captionId: string; kind: "source" | "publication"; interaction: "pointer" | "focus"; active: boolean }
  | { type: "caption.status.measured"; captionId: string; kind: "source" | "publication"; geometry: StatusTooltipGeometry }
  | { type: "timeline.latest.requested" }
  | { type: "timeline.editing.requested" }
  | { type: "timeline.editing.measured"; captionId: string; intersectionRatio: number }
  | { type: "timeline.scrolled"; scrollHeight: number; clientHeight: number; scrollTop: number }
  | { type: "timeline.resized"; scrollHeight: number; clientHeight: number; scrollTop: number }
  | { type: "settings.keypressed"; key: string; isComposing: boolean; defaultPrevented: boolean }
  | { type: "publication.mode.requested"; mode: string }
  | { type: "display.settings.toggled" }
  | { type: "display.field.changed"; field: keyof DisplaySettings; value: string }
  | { type: "display.palette.selected"; value: string }
  | { type: "display.save.requested" }
  | { type: "ai.settings.toggled" }
  | { type: "ai.background.changed"; value: string }
  | { type: "ai.model.selected"; modelId: string }
  | { type: "ai.save.requested" }
  | { type: "dictionary.settings.toggled" }
  | { type: "dictionary.word.added" }
  | { type: "dictionary.word.changed"; index: number; field: "term" | "reading" | "variantsText"; value: string }
  | { type: "dictionary.word.enabled"; index: number; enabled: boolean }
  | { type: "dictionary.word.removed"; index: number }
  | { type: "dictionary.save.requested" }
  | { type: "dictionary.draft.discarded" }
  | { type: "connection.settings.toggled" }
  | { type: "connection.mode.selected"; mode: string }
  | { type: "connection.url.changed"; url: string }
  | { type: "connection.text-format.selected"; format: string }
  | { type: "connection.input.selected"; source: string }
  | { type: "connection.recognizer.selected"; recognizer: string }
  | { type: "connection.save.requested" }
  | { type: "microphone.start.requested" }
  | { type: "microphone.stop.requested" }
  | { type: "microphone.device.selected"; deviceId: string }
  | { type: "microphone.state.changed"; state: TranscriptionStatus["state"]; message: string; label?: string }
  | { type: "microphone.devices.changed"; devices: MicrophoneDevice[] }
  | { type: "visibility.toggle.requested" }
  | { type: "test.requested" }
  | { type: "refresh.requested" };

export type AudienceEvent =
  | { type: "display.scrolled"; scrollHeight: number; clientHeight: number; scrollTop: number }
  | { type: "display.latest.requested" }
  | { type: "display.fullscreen.requested" }
  | { type: "display.fullscreen.changed"; active: boolean }
  | { type: "stream.opened" }
  | { type: "stream.failed" }
  | { type: "stream.snapshot"; snapshot: PublicSnapshot };

export type AudienceViewEvent = Extract<AudienceEvent, { type: "display.fullscreen.requested" | "display.scrolled" | "display.latest.requested" }>;
export type ViewEvent = OperatorEvent | AudienceViewEvent;

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
  setConnection(settings: ConnectionSettings, signal: AbortSignal): Promise<ConnectionStatus>;
  setDictionary(settings: DictionaryUpdate, signal: AbortSignal): Promise<DictionarySnapshot>;
}

export interface AudienceApi {
  subscribe(emit: (event: AudienceEvent) => void): () => void;
}

export class CaptionConflict extends Error {
  constructor(public readonly latest: Caption) {
    super("Caption revision conflict");
  }
}

export class OperationError extends Error {}
