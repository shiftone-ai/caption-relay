import { CaptionConflict, OperationError, type ConnectionStatus, type AiRouting, type AudienceApi, type Caption, type DisplaySettings, type OperatorApi, type PublicSnapshot, type DictionarySnapshot, type RoomBinding } from "./domain";
import { defaultDisplay } from "./display";
import type { components } from "./generated/api";

async function request<T>(path: string, signal: AbortSignal, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, signal });
  if (!response.ok) {
    if (response.status === 409) {
      const data = await response.json() as components["schemas"]["ConflictResponse"] | components["schemas"]["DictionaryError"];
      if (typeof data.detail === "string") throw new OperationError(data.detail);
      if (data.detail && typeof data.detail === "object" && data.detail.latest) throw new CaptionConflict(data.detail.latest);
    } else if (response.status === 502) {
      throw new OperationError(await response.text());
    } else if (response.status === 422 || response.status === 503) {
      const data = await response.json() as { detail?: unknown };
      if (typeof data.detail === "string") throw new OperationError(data.detail);
    }
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const json = (method: string, data: unknown): RequestInit => ({
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(data),
});

export function createOperatorApi(room?: RoomBinding): OperatorApi {
  const scopedRequest = <T,>(path: string, signal: AbortSignal, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    if (room) {
      headers.set("X-Caption-Relay-Room", room.roomId);
      headers.set("X-Caption-Relay-Generation", String(room.generation));
    }
    return request<T>(path, signal, { ...options, headers });
  };
  return {
    async load(signal) {
      const [session, captions, ai, connection, dictionary] = await Promise.all([
        scopedRequest<components["schemas"]["Session"]>("/api/session", signal),
        scopedRequest<Caption[]>("/api/events", signal),
        scopedRequest<AiRouting>("/api/ai", signal),
        scopedRequest<ConnectionStatus>("/api/connection", signal),
        scopedRequest<DictionarySnapshot>("/api/dictionary", signal),
      ]);
      return { visible: session.visible, captions, autoPublish: session.auto_publish ?? true,
        display: { ...defaultDisplay, ...session.display }, ai, connection, dictionary,
        receiverUrl: connection.receiver_path ? new URL(connection.receiver_path, window.location.origin).href : "" };
    },
    save(draft, signal) {
      return scopedRequest<Caption>(`/api/captions/${encodeURIComponent(draft.captionId)}`, signal,
        json("PATCH", { text: draft.text, base_revision: draft.baseRevision, base_source_revision: draft.baseSourceRevision,
          request_id: draft.requestId, republish: draft.republish ?? false } satisfies components["schemas"]["CaptionPatch"]));
    },
    async setVisible(visible, signal) {
      const result = await scopedRequest<components["schemas"]["Visibility"]>("/api/commands", signal,
        json("POST", { command: visible ? "show" : "hide" } satisfies components["schemas"]["Command"]));
      return result.visible;
    },
    async sendTest(signal) {
      const id = `test-${crypto.randomUUID()}`;
      await scopedRequest("/api/source/events", signal, json("POST", {
        utterance_id: id, revision: 1, text: "えー，本日は，本日はありがとうございます．",
        is_final: true, source_event_id: id, removed: false,
      } satisfies components["schemas"]["SourceEvent"]));
    },
    async setPublicationMode(mode, signal) {
      const result = await scopedRequest<components["schemas"]["PublicationMode"]>("/api/publication-mode", signal,
        json("PUT", mode));
      return result;
    },
    async setDisplay(settings, signal) {
      return scopedRequest<DisplaySettings>("/api/display", signal, json("PUT", settings));
    },
    async setAi(settings, signal) {
      return scopedRequest<AiRouting>("/api/ai", signal, json("PUT", settings));
    },
    async setConnection(settings, signal) {
      return scopedRequest<ConnectionStatus>("/api/connection", signal, json("PUT", settings));
    },
    async setDictionary(settings, signal) {
      return scopedRequest<DictionarySnapshot>("/api/dictionary", signal, json("PUT", settings));
    },
  };
}
export const operatorApi = createOperatorApi();

export const audienceApi: AudienceApi = {
  subscribe(emit) {
    const roomId = new URLSearchParams(window.location.search).get("room_id");
    const stream = new EventSource("/api/view/events" + (roomId ? "?room_id=" + encodeURIComponent(roomId) : ""));
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
