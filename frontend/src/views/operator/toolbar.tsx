import { Bot, ExternalLink, FlaskConical, Info, Settings2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { viewHierarchy } from "../../events/hierarchy";
import type { ToolbarParameters } from "../../presenters/operator";

export function ToolbarView({ parameters }: { parameters: ToolbarParameters }) {
  return (
    <viewHierarchy.Scope name="toolbar">
      {emit => (
        <div className="operator-toolbar">
          <label className="operator-mode">新着の公開
            <select aria-label="新着の公開" value={parameters.mode} disabled={parameters.modeDisabled}
              onChange={event => emit({ type: "publication.mode.requested", mode: event.currentTarget.value })}>
              <option value="auto">自動公開</option><option value="manual">確認して公開</option>
            </select>
          </label>
          <details className="operator-mode-help">
            <summary aria-label="公開方法の説明"><Info size={16} aria-hidden="true" /></summary>
            <p className="operator-mode-help-body">新しく届く確定字幕の公開方法です。どちらの方法でも、編集した文は保存するまで観客に送られません。</p>
          </details>
          <details className="operator-preparation">
            <summary><FlaskConical size={16} aria-hidden="true" /><span>準備</span></summary>
            <div className="operator-preparation-body">
              <p>{parameters.preparationHint}</p>
              <Button variant="outline" className="operator-button toolbar-test" intent={{ type: "test.requested" }} disabled={parameters.testDisabled}>テスト字幕を送る</Button>
              <p className="caption-hint">編集と配信の確認用です。音声認識や UDトークの接続は確認できません。</p>
            </div>
          </details>
          <Button variant="outline" className="operator-button toolbar-visibility" intent={{ type: "visibility.toggle.requested" }} disabled={parameters.toggleDisabled}>{parameters.toggleLabel}</Button>
          <Button variant="outline" className="operator-icon-button toolbar-ai" data-settings-trigger="ai" aria-label="AI設定" title={parameters.aiTitle} aria-expanded={parameters.aiSettingsOpen} aria-controls="ai-settings"
            intent={{ type: "ai.settings.toggled" }}><Bot size={16} /></Button>
          <Button variant="outline" className="operator-icon-button toolbar-display" data-settings-trigger="display" aria-label="表示設定" title="表示設定" aria-expanded={parameters.settingsOpen} aria-controls="display-settings"
            intent={{ type: "display.settings.toggled" }}><Settings2 size={16} /></Button>
          <a className="operator-output-link" aria-label="観客画面" title="観客画面を開く" href="/view/demo" target="_blank" rel="noopener noreferrer"><span>観客画面</span><ExternalLink size={16} aria-hidden="true" /></a>
        </div>
      )}
    </viewHierarchy.Scope>
  );
}
