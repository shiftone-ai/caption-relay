import { ExternalLink, Info, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Disclosure } from "../../components/ui/disclosure";
import { Textarea } from "../../components/ui/textarea";
import { viewHierarchy } from "../../events/hierarchy";
import type { AiParameters } from "../../presenters/operator";

export function AiSettingsView({ parameters }: { parameters: AiParameters }) {
  return <viewHierarchy.Scope name="ai-settings">
    {emit => <aside id="ai-settings" className="display-settings ai-settings" aria-label="字幕修正のAI設定" aria-describedby="ai-settings-description">
        <div className="display-settings-heading"><h2>AI設定</h2><Button variant="ghost" className="operator-icon-button" aria-label="AI設定を閉じる" intent={{ type: "ai.settings.toggled" }}><X size={16} /></Button></div>
        <p id="ai-settings-description" className={parameters.connectionWarning ? "operator-error" : "sr-only"}>{parameters.connectionDescription}</p>
        {parameters.showCurrentSelection && <div className="ai-current" title={parameters.selectionNote}><div className="ai-current-heading"><span>{parameters.selectionHeading}</span><strong>{parameters.selectedLabel}</strong></div></div>}
        <fieldset disabled={parameters.disabled} className="display-fields ai-fields operator-panel-scroll">
          <label>選び方<select data-setting-autofocus aria-label="AIの選び方" aria-describedby={parameters.strategyHint ? "ai-strategy-hint" : undefined} value={parameters.strategy} onChange={event => emit({ type: "ai.strategy.selected", value: event.currentTarget.value })}>
            {parameters.strategies.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
          {parameters.strategyHint && <p id="ai-strategy-hint" className="sr-only">{parameters.strategyHint}</p>}
          {parameters.showModelSettings && <>
          <label>{parameters.preferredLabel}<select aria-label={parameters.preferredLabel} aria-describedby="ai-preferred-hint" value={parameters.preferredModel} onChange={event => emit({ type: "ai.preferred.selected", modelId: event.currentTarget.value })}>{parameters.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
          <p id="ai-preferred-hint" className="sr-only">{parameters.preferredHint}</p>
          <label htmlFor="ai-background">トークの背景
            <Textarea id="ai-background" value={parameters.background} maxLength={4000} rows={4}
              placeholder="テーマ、登壇者、作品名など"
              change={value => ({ type: "ai.background.changed", value })}
              keypress={key => ({ type: "settings.keypressed", key: key.key, isComposing: key.isComposing, defaultPrevented: false })} />
          </label>
          <fieldset className="ai-candidates">
            <legend>比較する候補</legend>
            {parameters.models.map(model => <label key={model.id} className="ai-candidate">
              <input type="checkbox" aria-label={model.label + "を候補に含める"} checked={model.selected} disabled={model.disabled}
                onChange={event => emit({ type: "ai.candidate.changed", modelId: model.id, included: event.currentTarget.checked })} />
              <span><strong>{model.provider}</strong><small>{model.variant}</small></span>
              <span className="caption-hint">{model.latency}</span>
            </label>)}
          </fieldset>
          </>}
          <Disclosure parameters={parameters.helpDisclosure} className="panel-help" summaryLabel="AIの選び方の説明" summaryTitle="AIの選び方の説明" summary={<Info size={16} aria-hidden="true" />}>
            {parameters.strategyHint && <p>{parameters.strategyHint}</p>}
            {parameters.showModelSettings && <p>{parameters.preferredHint}</p>}
            <p>保存後の確定字幕から使います。AIの利用にはAPI料金がかかります。</p>
          </Disclosure>
          <Disclosure parameters={parameters.comparisonDisclosure} className="ai-details" summary="料金と速度の比較">
            <div className="ai-comparison">
              <table><caption>USD、入力・出力は100万トークンあたり</caption>
              <thead><tr><th scope="col">AI</th><th scope="col">入力<br />出力</th><th scope="col">参考<br />1,000件</th><th scope="col">応答時間</th></tr></thead>
              <tbody>{parameters.models.map(model => <tr key={model.id}>
                <td><div className="ai-model-title"><span><strong>{model.provider}</strong><small>{model.variant}</small></span>
                  <a className="ai-pricing-link" href={model.pricingUrl} target="_blank" rel="noopener noreferrer" aria-label={model.label + "の公式料金（" + model.checkedOn + "確認）"} title={model.label + "の公式料金（" + model.checkedOn + "確認）"}><ExternalLink size={12} aria-hidden="true" /></a></div></td>
                <td><span className="ai-money">{model.inputPrice}</span><span className="ai-money">{model.outputPrice}</span></td>
                <td>{model.sampleCost}</td><td>{model.latency}</td>
              </tr>)}</tbody>
              </table>
            </div>
            <p className="caption-hint">参考費用は1件あたり入力200・出力100トークン。キャッシュ・追加機能・税は含みません。各AIの料金確認日は公式料金リンクに表示しています。</p>
            <p className="caption-hint">応答時間は受信した結果の直近20件の中央値です。</p>
          </Disclosure>
        </fieldset>
        <div className="display-settings-actions">
          <Button className="operator-button display-save" disabled={parameters.saveDisabled} intent={{ type: "ai.save.requested" }}>AI設定を保存</Button>
          <p className="caption-hint">{parameters.saveHint}</p>
        </div>
      </aside>}
  </viewHierarchy.Scope>;
}
