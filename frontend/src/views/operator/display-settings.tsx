import { X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { viewHierarchy } from "../../events/hierarchy";
import type { DisplayFieldParameters, DisplayParameters } from "../../presenters/operator";

export function DisplayFieldView({ parameters }: { parameters: DisplayFieldParameters }) {
  return <viewHierarchy.Scope name={"display-field:" + parameters.field}>
    {emit => <label>{parameters.label}
      {parameters.kind === "color"
        ? <input aria-label={parameters.label + "色"} type="color" value={parameters.value}
          onChange={event => emit({ type: "display.field.changed", field: parameters.field, value: event.currentTarget.value })} />
        : <select value={parameters.value}
          onChange={event => emit({ type: "display.field.changed", field: parameters.field, value: event.currentTarget.value })}>
          {parameters.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>}
    </label>}
  </viewHierarchy.Scope>;
}

export function DisplaySettingsView({ parameters }: { parameters: DisplayParameters }) {
  return <viewHierarchy.Scope name="display-settings">
    {emit => <aside id="display-settings" className="display-settings" aria-label="観客画面の表示設定">
      <div className="display-settings-heading"><h2>表示設定</h2><Button variant="ghost" className="operator-icon-button" aria-label="表示設定を閉じる" intent={{ type: "display.settings.toggled" }}><X size={16} /></Button></div>
      <p className="display-settings-description">別画面の見た目を調整します。設定は「反映」で観客画面へ送ります。</p>
      <div className="display-sample" aria-label="表示設定のプレビュー" style={parameters.previewStyle}><span>本日はありがとうございます。</span></div>
      <fieldset disabled={parameters.disabled} className="display-fields">
        <label>配色<select value={parameters.palette} onChange={event => emit({ type: "display.palette.selected", value: event.currentTarget.value })}>
          {parameters.palettes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        {parameters.groups.map(group => <div key={group[0].field} className={group.length === 2 ? "display-field-pair" : undefined}>
          {group.map(field => <DisplayFieldView key={field.field} parameters={field} />)}
        </div>)}
      </fieldset>
      <Button className="operator-button display-save" disabled={parameters.saveDisabled} intent={{ type: "display.save.requested" }}>表示設定を反映</Button>
      <p className="caption-hint">{parameters.saveHint}</p>
      <p className="display-settings-note">観客画面を別ディスプレイへ移し、「全画面」を押してください。フォントは表示端末にあるものを使います。</p>
    </aside>}
  </viewHierarchy.Scope>;
}
