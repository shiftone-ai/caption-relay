import type { ViewEvent } from "../domain";
import type { RoomSnapshot } from "../machines/room";

export interface ConfirmationParameters {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  confirm: ViewEvent;
  cancel: ViewEvent;
}

export function presentRoom(snapshot: RoomSnapshot) {
  const { context } = snapshot;
  const reset = snapshot.matches("confirmReset");
  return {
    room: context.room, showOperator: context.room !== null && !snapshot.matches("departed"),
    loading: snapshot.matches("connecting"), failed: snapshot.matches("failed"),
    disabled: !snapshot.matches("ready"),
    homeDisabled: !snapshot.can({ type: "room.home.requested" }),
    busy: snapshot.matches("leaving") || snapshot.matches("resetting"),
    destination: context.destination, message: context.message,
    confirmation: {
      open: reset || snapshot.matches("confirmLeave"),
      title: reset ? "字幕をリセットしますか？" : "変更を破棄して戻りますか？",
      body: reset ? `「${context.room?.name ?? ""}」の字幕と未保存の訂正を消します。ルームの設定とUDトーク側の字幕は残ります。` : "未保存の変更を破棄してホームへ戻ります。",
      confirmLabel: reset ? "字幕をリセット" : "破棄して戻る",
      confirm: { type: "room.confirm.accepted" }, cancel: { type: "room.confirm.cancelled" },
    } satisfies ConfirmationParameters,
  };
}
export type RoomParameters = ReturnType<typeof presentRoom>;
