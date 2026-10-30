import { BookOpen, Bot, Cable, Eye, EyeOff, FlaskConical, Info, Monitor, Settings2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Disclosure } from "../../components/ui/disclosure";
import { viewHierarchy } from "../../events/hierarchy";
import type { ToolbarParameters } from "../../presenters/operator";

export function ToolbarView({ parameters }: { parameters: ToolbarParameters }) {
  const VisibilityIcon = { hide: EyeOff, show: Eye }[parameters.visibilityIcon];
  return (
    <viewHierarchy.Scope name="toolbar">
      {emit => (
        <div className="operator-toolbar" data-local-output={parameters.localOutput}>
          <div className="operator-publication-controls">
            {parameters.localOutput && <>
              <label className="operator-mode"><span className="operator-mode-label">新着の公開</span>
                <select aria-label="新着の公開" value={parameters.mode} disabled={parameters.modeDisabled}
                  onChange={event => emit({ type: "publication.mode.requested", mode: event.currentTarget.value })}>
                  <option value="auto">自動公開</option><option value="manual">確認して公開</option>
                </select>
              </label>
              <Disclosure parameters={parameters.helpDisclosure} className="operator-mode-help" summaryLabel="公開方法の説明" summary={<Info size={16} aria-hidden="true" />}>
                <p className="operator-mode-help-body">新しく届く確定字幕の公開方法です。どちらの方法でも、編集した文は保存するまで観客に送られません。</p>
              </Disclosure>
            </>}
            <Button variant="outline" className="operator-icon-button toolbar-visibility" aria-label={parameters.toggleLabel} title={parameters.toggleLabel} intent={{ type: "visibility.toggle.requested" }} disabled={parameters.toggleDisabled}><VisibilityIcon size={16} /></Button>
          </div>
          <div className="operator-utility-controls">
            <Disclosure parameters={parameters.preparationDisclosure} className="operator-preparation" summary={<><FlaskConical size={16} aria-hidden="true" /><span>準備</span></>}>
              <div className="operator-preparation-body">
                <p>{parameters.preparationHint}</p>
                <Button variant="outline" className="operator-button toolbar-test" intent={{ type: "test.requested" }} disabled={parameters.testDisabled}>テスト字幕を送る</Button>
              </div>
            </Disclosure>
            <Button variant="outline" className="operator-icon-button toolbar-connection" data-settings-trigger="connection" aria-label="字幕入力の接続設定" title="字幕入力の接続設定" aria-expanded={parameters.connectionSettingsOpen} aria-controls="connection-settings"
              intent={{ type: "connection.settings.toggled" }}><Cable size={16} /></Button>
            <Button variant="outline" className="operator-icon-button toolbar-ai" data-settings-trigger="ai" aria-label="AI設定" title={parameters.aiTitle} aria-expanded={parameters.aiSettingsOpen} aria-controls="ai-settings"
              intent={{ type: "ai.settings.toggled" }}><Bot size={16} /></Button>
            <Button variant="outline" className="operator-icon-button toolbar-dictionary" data-settings-trigger="dictionary" aria-label="単語辞書" title="単語辞書" aria-expanded={parameters.dictionarySettingsOpen} aria-controls="dictionary-settings"
              disabled={parameters.dictionarySettingsDisabled} intent={{ type: "dictionary.settings.toggled" }}><BookOpen size={16} /></Button>
            <Button variant="outline" className="operator-icon-button toolbar-display" data-settings-trigger="display" aria-label="表示設定" title="表示設定" disabled={!parameters.localOutput} aria-expanded={parameters.settingsOpen} aria-controls="display-settings"
              intent={{ type: "display.settings.toggled" }}><Settings2 size={16} /></Button>
            {parameters.localOutput && <a className="operator-output-link" aria-label="観客画面" title="観客画面を開く" href={parameters.audienceHref} target="_blank" rel="noopener noreferrer"><Monitor size={16} aria-hidden="true" /></a>}
          </div>
        </div>
      )}
    </viewHierarchy.Scope>
  );
}
