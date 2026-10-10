import { Info, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { Disclosure } from "../../components/ui/disclosure";
import { viewHierarchy } from "../../events/hierarchy";
import type { ConnectionParameters } from "../../presenters/operator";

export function ConnectionSettingsView({ parameters }: { parameters: ConnectionParameters }) {
  return <viewHierarchy.Scope name="connection-settings">
    {emit => <aside id="connection-settings" className="display-settings connection-settings" aria-label="UDトークの接続設定">
      <div className="display-settings-heading"><h2>UDトークの接続</h2>
        <Button variant="ghost" className="operator-icon-button" aria-label="接続設定を閉じる" intent={{ type: "connection.settings.toggled" }}><X size={16} /></Button>
      </div>
      {parameters.messageVisible && <p role="status" className="operator-error">{parameters.message}</p>}
      <fieldset disabled={parameters.disabled} className="display-fields connection-fields operator-panel-scroll">
        <label>字幕の配信先<select data-setting-autofocus aria-label="字幕の配信先" value={parameters.mode}
          onChange={event => emit({ type: "connection.mode.selected", mode: event.currentTarget.value })}>
          <option value="host">独立配信</option><option value="client">UDトークへ反映（試験接続）</option>
        </select></label>
        {parameters.showReceiver && <section className="connection-instructions">
          <label>UDトークに設定する送信先<input aria-label="UDトークに設定する送信先" type="text" readOnly value={parameters.receiverUrl} autoComplete="off" /></label>
          <label>送られる字幕<select aria-label="送られる字幕" value={parameters.textFormat}
            onChange={event => emit({ type: "connection.text-format.selected", format: event.currentTarget.value })}>
            <option value="plain">本文のみ</option><option value="speaker">発話者名と本文</option>
          </select></label>
          <Disclosure parameters={parameters.hostHelpDisclosure} className="panel-help" summaryLabel="独立配信の接続手順" summaryTitle="独立配信の接続手順" summary={<Info size={16} aria-hidden="true" />}>
            <ol><li>同じMacのUDトークで、Zoom連携の送信先に上のURLを設定します。</li><li>字幕送信を有効にして、音声認識を開始します。</li></ol>
            <p>UDトーク側の訂正も受け取る場合は「Send Edited Results」を有効にします。</p>
            <p>「Send Speaker Name」を有効にした場合は「発話者名と本文」を選びます。</p>
            <p>再起動やモード変更後は送信先を設定し直してください。</p>
          </Disclosure>
        </section>}
        {parameters.showEditor && <section className="connection-instructions">
          <p className="connection-warning">試験接続 · 字幕の表示と反映はUDトークで確認</p>
          <label htmlFor="udtalk-editor-url">編集用の参加リンク</label>
          <Textarea id="udtalk-editor-url" value={parameters.editorUrl} readOnly={parameters.disabled}
            autoComplete="off" spellCheck={false} change={url => ({ type: "connection.url.changed", url })}
            keypress={key => ({ type: "settings.keypressed", key: key.key, isComposing: key.isComposing, defaultPrevented: false })} />
          <Disclosure parameters={parameters.clientHelpDisclosure} className="panel-help" summaryLabel="編集参加の接続手順" summaryTitle="編集参加の接続手順" summary={<Info size={16} aria-hidden="true" />}>
            <p>「トークを公開」で編集を許可したリンクを使います。Web閲覧リンクは使えません。</p>
            <p>AIと手動の訂正をUDトークへ返します。通信の応答だけでは、純正画面への反映は確認できません。</p>
          </Disclosure>
        </section>}
      </fieldset>
      <div className="display-settings-actions">
        <Button className="operator-button display-save" disabled={parameters.saveDisabled} intent={{ type: "connection.save.requested" }}>接続を適用</Button>
        <p className="caption-hint">{parameters.receivedLabel}</p>
      </div>
    </aside>}
  </viewHierarchy.Scope>;
}
