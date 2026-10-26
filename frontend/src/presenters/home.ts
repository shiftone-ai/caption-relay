import type { HomeSnapshot } from "../machines/home";

const usedAt = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

export function presentHome(snapshot: HomeSnapshot) {
  const { context } = snapshot;
  const busy = !snapshot.matches("ready") && !snapshot.matches("failed");
  return {
    loading: snapshot.matches("loading"), failed: snapshot.matches("failed"), busy,
    newDisabled: !snapshot.can({ type: "home.new.requested" }),
    message: context.formOpen ? "" : context.message, destination: context.destination, formOpen: context.formOpen,
    focusReturn: !context.formOpen && context.focusVersion > 0 ? { version: context.focusVersion,
      selector: context.focusReturnRoomId ? `[data-room-settings="${context.focusReturnRoomId}"]` : "[data-room-create]" } : null,
    form: {
      message: context.message,
      invalidField: context.invalidField,
      name: context.form.name, background: context.form.ai.background, mode: context.form.mode,
      inputSource: context.form.inputSource, editorUrl: context.form.editorUrl,
      title: context.editingRoomId ? "ルームの接続設定" : "新しいルームに接続",
      submitLabel: context.editingRoomId ? "保存して接続" : "登録して接続",
      linkLabel: context.form.storedLink ? "新しい参加リンク" : "編集用の参加リンク",
      linkRequired: context.form.mode === "client" && !context.form.storedLink,
      showLink: context.form.mode === "client", showInputSource: context.form.mode === "host",
      storedLinkHint: context.form.storedLink ? "変更するときだけ入力" : "",
      saveDisabled: !snapshot.can({ type: "home.save.requested" }), busy,
      focusVersion: context.focusVersion,
    },
    rooms: context.catalog.rooms.map(room => ({
      id: room.id, name: room.name,
      lastUsed: room.last_used_at ? usedAt.format(new Date(room.last_used_at)) : "",
      captionCount: room.caption_count,
      connectionLabel: room.mode === "client" ? "UDトークへ反映" : room.input_source === "microphone" ? "独立配信・マイク" : "独立配信・UDトーク",
      active: room.id === context.catalog.active_room_id,
      connecting: snapshot.matches("connecting") && room.id === context.requestedRoomId,
      disabled: busy,
    })),
  };
}
export type HomeParameters = ReturnType<typeof presentHome>;
