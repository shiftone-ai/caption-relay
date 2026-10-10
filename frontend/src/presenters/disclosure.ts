import type { DisclosureId } from "../domain";

export interface DisclosureParameters {
  id: DisclosureId;
  open: boolean;
}

export function presentDisclosure(id: DisclosureId, opened: ReadonlySet<DisclosureId>): DisclosureParameters {
  return { id, open: opened.has(id) };
}
