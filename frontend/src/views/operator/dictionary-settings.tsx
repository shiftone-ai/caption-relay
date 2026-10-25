import { Plus, Trash2, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { viewHierarchy } from "../../events/hierarchy";
import type { DictionaryParameters } from "../../presenters/operator";

export function DictionarySettingsView({ parameters }: { parameters: DictionaryParameters }) {
  return <viewHierarchy.Scope name="dictionary-settings">
    {emit => <aside id="dictionary-settings" className="display-settings dictionary-settings" aria-labelledby="dictionary-heading">
      <div className="display-settings-heading">
        <h2 id="dictionary-heading">単語辞書 <small>{parameters.countLabel}</small></h2>
        <Button variant="ghost" className="operator-icon-button" aria-label="単語辞書を閉じる" intent={{ type: "dictionary.settings.toggled" }}><X size={16} /></Button>
      </div>
      <div className="dictionary-fields operator-panel-scroll">
        <p className="caption-hint">人名、会社名、専門用語など、認識してほしい表記を登録します。</p>
        <p className="caption-hint">{parameters.recognitionHint}</p>
        <p className="caption-hint">AI校正は保存後の確定字幕から参照します。辞書は接続先の端末に保存され、再起動後も残ります。</p>
        <Button variant="outline" className="operator-button" data-setting-autofocus intent={{ type: "dictionary.word.added" }} disabled={parameters.addDisabled}><Plus size={16} aria-hidden="true" />単語を追加</Button>
        {parameters.empty && <p className="caption-hint">単語はまだ登録されていません。</p>}
        {parameters.entries.map(word => <fieldset key={word.index} className="dictionary-word" disabled={parameters.disabled}>
          <legend>{word.index + 1}件目</legend>
          <div className="dictionary-word-actions">
            <label className="dictionary-enabled"><input type="checkbox" aria-label={`${word.index + 1}件目を有効にする`} checked={word.enabled}
              onChange={event => emit({ type: "dictionary.word.enabled", index: word.index, enabled: event.currentTarget.checked })} />有効</label>
            <Button variant="ghost" className="operator-icon-button" aria-label={`${word.index + 1}件目を削除`} title="単語を削除" disabled={parameters.disabled}
              intent={{ type: "dictionary.word.removed", index: word.index }}><Trash2 size={16} aria-hidden="true" /></Button>
          </div>
          <label>表記<input data-setting-autofocus aria-label={`${word.index + 1}件目の表記`} value={word.term} placeholder="例：Caption Relay"
            onChange={event => emit({ type: "dictionary.word.changed", index: word.index, field: "term", value: event.currentTarget.value })} /></label>
          <label>読み <span className="caption-hint">任意</span><input aria-label={`${word.index + 1}件目の読み`} value={word.reading} placeholder="例：きゃぷしょんりれー"
            onChange={event => emit({ type: "dictionary.word.changed", index: word.index, field: "reading", value: event.currentTarget.value })} /></label>
          <label>誤認識されやすい表記 <span className="caption-hint">{parameters.variantsHint}</span>
            <Textarea aria-label={`${word.index + 1}件目の誤認識の表記`} rows={2} value={word.variantsText} disabled={parameters.disabled}
              placeholder="例：キャプションリレー" change={value => ({ type: "dictionary.word.changed", index: word.index, field: "variantsText", value })}
              keypress={key => ({ type: "settings.keypressed", key: key.key, isComposing: key.isComposing, defaultPrevented: false })} />
          </label>
        </fieldset>)}
      </div>
      <div className="display-settings-actions">
        {parameters.error && <p role="alert" className="dictionary-error">{parameters.error}</p>}
        {parameters.notice && <p role="status" className="caption-hint">{parameters.notice}</p>}
        <Button className="operator-button" intent={{ type: "dictionary.save.requested" }} disabled={parameters.saveDisabled}>辞書を保存</Button>
        <Button variant="outline" className="operator-button" intent={{ type: "dictionary.draft.discarded" }} disabled={parameters.discardDisabled}>保存済みに戻す</Button>
        <p className="caption-hint">{parameters.saveHint}</p>
      </div>
    </aside>}
  </viewHierarchy.Scope>;
}
