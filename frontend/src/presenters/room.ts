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
  const reload = snapshot.matches("confirmReload");
  return {
    room: context.room, showOperator: context.room !== null && !snapshot.matches("departed"),
    loading: snapshot.matches("connecting"), failed: snapshot.matches("failed"),
    disabled: !snapshot.matches("ready"),
    homeDisabled: !snapshot.can({ type: "room.home.requested" }),
    busy: snapshot.matches("leaving") || snapshot.matches("resetting"),
    destination: context.destination, message: context.message,
    confirmation: {
      open: reset || reload || snapshot.matches("confirmLeave"),
      title: reset ? "字幕をリセットしますか？" : reload ? "字幕を読み直しますか？" : "変更を破棄して戻りますか？",
      body: reset ? `「${context.room?.name ?? ""}」の字幕と未保存の訂正を消します。設定の下書きとUDトーク側の字幕は残ります。` : reload ? "未保存の訂正を破棄し、現在の字幕を取得します。設定の下書きは残ります。" : "未保存の変更を破棄してホームへ戻ります。",
      confirmLabel: reset ? "字幕をリセット" : reload ? "読み直す" : "破棄して戻る",
      confirm: { type: "room.confirm.accepted" }, cancel: { type: "room.confirm.cancelled" },
    } satisfies ConfirmationParameters,
  };
}
export type RoomParameters = ReturnType<typeof presentRoom>;
