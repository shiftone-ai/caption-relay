import type { components } from "./generated/api";

export type Caption = components["schemas"]["Caption"];

export interface Snapshot {
  visible: boolean;
  captions: Caption[];
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
  | { type: "visibility.toggle.requested" }
  | { type: "test.requested" }
  | { type: "refresh.requested" };

export type AudienceEvent =
  | { type: "stream.opened" }
  | { type: "stream.failed" }
  | { type: "stream.snapshot"; snapshot: PublicSnapshot };

export interface OperatorApi {
  load(signal: AbortSignal): Promise<Snapshot>;
  save(request: SaveRequest, signal: AbortSignal): Promise<Caption>;
  setVisible(visible: boolean, signal: AbortSignal): Promise<boolean>;
  sendTest(signal: AbortSignal): Promise<void>;
}

export interface AudienceApi {
  subscribe(emit: (event: AudienceEvent) => void): () => void;
}

export class CaptionConflict extends Error {
  constructor(public readonly latest: Caption) {
    super("Caption revision conflict");
  }
}
