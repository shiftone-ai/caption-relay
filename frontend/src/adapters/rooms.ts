import { OperationError, type RoomBinding, type RoomCatalog, type RoomDetails, type RoomDraft, type RoomsApi } from "../domain";

async function request<T>(path: string, signal: AbortSignal, method = "GET", payload?: unknown): Promise<T> {
  const response = await fetch(path, { method, signal,
    ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: unknown };
    throw new OperationError(typeof body.detail === "string" ? body.detail : "ルームの接続を確認できませんでした。もう一度お試しください。");
  }
  return response.json() as Promise<T>;
}

const resource = (id: string) => "/api/rooms/" + encodeURIComponent(id);
export const roomUrl = (id: string) => "/rooms/" + encodeURIComponent(id);

export function roomIdFromPath(path: string): string | null {
  return /^\/rooms\/([a-z0-9-]{1,64})\/?$/.exec(path)?.[1] ?? null;
}

export function navigate(path: string): void { window.location.assign(path); }

export const roomsApi: RoomsApi = {
  delete: (room, signal) => request<RoomCatalog>(resource(room.roomId) + "?generation=" + room.generation, signal, "DELETE"),
  catalog: signal => request<RoomCatalog>("/api/rooms", signal),
  details: (id, signal) => request<RoomDetails>(resource(id), signal),
  save: (draft: RoomDraft, id, signal) => request<RoomDetails>(id ? resource(id) : "/api/rooms", signal, id ? "PUT" : "POST", draft),
  connect: (id, signal) => request<RoomDetails>(resource(id) + "/connect", signal, "POST"),
  async leave(room: RoomBinding, signal) {
    const response = await fetch(resource(room.roomId) + "/leave", { method: "POST", signal,
      headers: { "content-type": "application/json" }, body: JSON.stringify({ generation: room.generation }) });
    // A stale tab can return home, but cannot disconnect the newer connection.
    if (response.ok || response.status === 409 || response.status === 404) return;
    throw new OperationError("ルームの接続を終了できませんでした。もう一度お試しください。");
  },
  reset: (room, signal) => request<RoomDetails>(resource(room.roomId) + "/reset", signal, "POST", { generation: room.generation }),
};
