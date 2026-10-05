import { CaptionConflict, type AudienceApi, type Caption, type OperatorApi, type PublicSnapshot } from "./domain";
import type { components } from "./generated/api";

async function request<T>(path: string, signal: AbortSignal, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, signal });
  if (!response.ok) {
    if (response.status === 409) {
      const data = await response.json() as components["schemas"]["ConflictResponse"];
      throw new CaptionConflict(data.detail.latest);
    }
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const json = (method: string, data: unknown): RequestInit => ({
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(data),
});

export const operatorApi: OperatorApi = {
  async load(signal) {
    const [session, captions] = await Promise.all([
      request<components["schemas"]["Session"]>("/api/session", signal),
      request<Caption[]>("/api/events", signal),
    ]);
    return { visible: session.visible, captions };
  },
  save(draft, signal) {
    return request<Caption>(`/api/captions/${encodeURIComponent(draft.captionId)}`, signal,
      json("PATCH", { text: draft.text, base_revision: draft.baseRevision } satisfies components["schemas"]["CaptionPatch"]));
  },
  async setVisible(visible, signal) {
    const result = await request<components["schemas"]["Visibility"]>("/api/commands", signal,
      json("POST", { command: visible ? "show" : "hide" } satisfies components["schemas"]["Command"]));
    return result.visible;
  },
  async sendTest(signal) {
    const id = `test-${crypto.randomUUID()}`;
    await request("/api/source/events", signal, json("POST", {
      utterance_id: id, revision: 1, text: "えー，本日は，本日はありがとうございます．",
      is_final: true, source_event_id: id,
    } satisfies components["schemas"]["SourceEvent"]));
  },
};

export const audienceApi: AudienceApi = {
  subscribe(emit) {
    const stream = new EventSource("/api/view/events");
    stream.addEventListener("open", () => emit({ type: "stream.opened" }));
    stream.addEventListener("error", () => emit({ type: "stream.failed" }));
    stream.addEventListener("snapshot", event => {
      try {
        const snapshot = JSON.parse(event.data) as PublicSnapshot;
        emit({ type: "stream.snapshot", snapshot });
      } catch {
        emit({ type: "stream.failed" });
      }
    });
    return () => stream.close();
  },
};
