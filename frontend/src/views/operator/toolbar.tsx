import { Bot, ExternalLink, FlaskConical, Settings2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { viewHierarchy } from "../../events/hierarchy";
import type { ToolbarParameters } from "../../presenters/operator";

export function ToolbarView({ parameters }: { parameters: ToolbarParameters }) {
  return (
    <viewHierarchy.Scope name="toolbar">
      {emit => (
        <div className="operator-toolbar">
          <label className="operator-mode">反映
            <select aria-label="反映モード" value={parameters.mode} disabled={parameters.modeDisabled}
              onChange={event => emit({ type: "publication.mode.requested", mode: event.currentTarget.value })}>
              <option value="auto">自動反映</option><option value="manual">確認して反映</option>
            </select>
          </label>
          <Button variant="outline" className="operator-button toolbar-test" aria-label="テスト字幕を送る" title="テスト字幕を送る" intent={{ type: "test.requested" }} disabled={parameters.testDisabled}><FlaskConical size={16} className="toolbar-test-icon" /><span>テスト字幕を送る</span></Button>
          <Button variant="outline" className="operator-button toolbar-visibility" intent={{ type: "visibility.toggle.requested" }} disabled={parameters.toggleDisabled}>{parameters.toggleLabel}</Button>
          <Button variant="outline" className="operator-icon-button toolbar-ai" aria-label="AI設定" title={parameters.aiTitle} aria-expanded={parameters.aiSettingsOpen} aria-controls="ai-settings"
            intent={{ type: "ai.settings.toggled" }}><Bot size={16} /></Button>
          <Button variant="outline" className="operator-icon-button toolbar-display" aria-label="表示設定" title="表示設定" aria-expanded={parameters.settingsOpen} aria-controls="display-settings"
            intent={{ type: "display.settings.toggled" }}><Settings2 size={16} /></Button>
          <a className="operator-output-link" aria-label="観客画面" title="観客画面を開く" href="/view/demo" target="_blank" rel="noopener noreferrer"><span>観客画面</span><ExternalLink size={16} aria-hidden="true" /></a>
        </div>
      )}
    </viewHierarchy.Scope>
  );
}
