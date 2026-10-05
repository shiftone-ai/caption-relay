import type { AudienceSnapshot } from "../machines/audience";

export function presentAudience(snapshot: AudienceSnapshot): { text: string } {
  const { context } = snapshot;
  return { text: context.visible ? (context.captions.at(-1)?.text ?? "字幕を待っています") : "" };
}
