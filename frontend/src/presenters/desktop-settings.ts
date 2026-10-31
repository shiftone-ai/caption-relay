import { credentialFields } from "../desktop";
import type { DesktopSettingsSnapshot } from "../machines/desktop-settings";
import type { ConfirmationParameters } from "./room";

export function presentDesktopSettings(snapshot: DesktopSettingsSnapshot) {
  const { context } = snapshot;
  return {
    loading: snapshot.matches("loading"),
    retry: snapshot.can({ type: "desktop.retry.requested" }),
    message: context.message,
    fields: credentialFields.map(field => ({ ...field, value: context.values[field.key] ?? "",
      remove: context.removals[field.key] ?? false, removable: context.configured[field.key] ?? false,
      placeholder: context.configured[field.key] ? "設定済み · 空欄で保持" : "未設定",
      disabled: !snapshot.can({ type: "desktop.changed", key: field.key, value: "" }) || Boolean(context.removals[field.key]),
      removalDisabled: !snapshot.can({ type: "desktop.removal.changed", key: field.key, remove: true }),
    })),
    saveDisabled: !snapshot.can({ type: "desktop.save.requested" }),
    saving: snapshot.matches("saving") || snapshot.matches("restarting"),
    confirmation: {
      open: snapshot.matches("confirming"), title: "保存して再起動しますか？",
      body: "録音と接続を終了し、現在の字幕と未保存の訂正を消去します。ルーム設定と辞書は残ります。",
      confirmLabel: "保存して再起動", confirm: { type: "desktop.save.confirmed" }, cancel: { type: "desktop.save.cancelled" },
    } satisfies ConfirmationParameters,
  };
}
export type DesktopSettingsParameters = ReturnType<typeof presentDesktopSettings>;
