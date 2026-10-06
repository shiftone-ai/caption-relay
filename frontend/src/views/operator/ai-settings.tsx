import { ExternalLink, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { viewHierarchy } from "../../events/hierarchy";
import type { AiParameters } from "../../presenters/operator";

export function AiSettingsView({ parameters }: { parameters: AiParameters }) {
  return <viewHierarchy.Scope name="ai-settings">
    {emit => <aside id="ai-settings" className="display-settings ai-settings" aria-label="字幕修正のAI設定">
        <div className="display-settings-heading"><h2>AI設定</h2><Button variant="ghost" className="operator-icon-button" aria-label="AI設定を閉じる" intent={{ type: "ai.settings.toggled" }}><X size={16} /></Button></div>
        <p className="display-settings-description">接続前の設定です。AIへの送信はまだ行いません。</p>
        <div className="ai-current"><div className="ai-current-heading"><span className="caption-hint">保存済み</span><strong>{parameters.selectedLabel}</strong></div><p>{parameters.selectionNote}</p></div>
        <fieldset disabled={parameters.disabled} className="display-fields ai-fields">
          <label>選び方<select aria-label="AIの選び方" value={parameters.strategy} onChange={event => emit({ type: "ai.strategy.selected", value: event.currentTarget.value })}>
            {parameters.strategies.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
          <label>指定AI<select aria-label="指定AI" value={parameters.preferredModel} onChange={event => emit({ type: "ai.preferred.selected", modelId: event.currentTarget.value })}>{parameters.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
          <div className="ai-comparison">
            <table><caption>候補と比較 · USD、入出力は100万単位</caption>
              <thead><tr><th scope="col">AI</th><th scope="col">入力<br />出力</th><th scope="col">参考<br />1,000件</th><th scope="col">応答</th></tr></thead>
              <tbody>{parameters.models.map(model => <tr key={model.id}>
                <td><div className="ai-model-title"><label className="ai-model-choice"><input type="checkbox" aria-label={model.provider + "を候補に含める"} checked={model.selected} disabled={model.disabled}
                  onChange={event => emit({ type: "ai.candidate.changed", modelId: model.id, included: event.currentTarget.checked })} />
                  <span><strong>{model.provider}</strong><small>{model.variant}</small></span></label>
                  <a className="ai-pricing-link" href={model.pricingUrl} target="_blank" rel="noopener noreferrer" aria-label={model.provider + "の公式料金"} title={model.provider + "の公式料金"}><ExternalLink size={12} aria-hidden="true" /></a></div></td>
                <td><span className="ai-money">{model.inputPrice}</span><span className="ai-money">{model.outputPrice}</span></td>
                <td>{model.sampleCost}</td><td>{model.latency}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="caption-hint">参考費用は1件あたり入力200・出力100トークン。キャッシュ・追加機能・税は含みません。料金確認日：{parameters.models[0]?.checkedOn}。</p>
          <p className="caption-hint">料金はAPI利用の比較です。Codex・Claudeの月額契約とは異なります。指定AIは候補に残します。</p>
          <p className="caption-hint">応答時間は受信した結果の直近20件の中央値。未計測のAIは速度比較から除き、全候補が未計測なら指定AIを使います。</p>
        </fieldset>
        <Button className="operator-button display-save" disabled={parameters.saveDisabled} intent={{ type: "ai.save.requested" }}>AI設定を保存</Button>
        <p className="caption-hint">{parameters.saveHint}</p>
      </aside>}
  </viewHierarchy.Scope>;
}
