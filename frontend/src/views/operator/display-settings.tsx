import { X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { viewHierarchy } from "../../events/hierarchy";
import type { DisplayFieldParameters, DisplayParameters } from "../../presenters/operator";
import { CaptionDisplayView } from "../caption-display";

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
      <p className="display-settings-description">変更はプレビューで確認できます。「表示設定を反映」で観客画面へ送ります。</p>
      <figure className="display-preview" aria-label="表示設定のプレビュー">
        <div className="display-sample"><CaptionDisplayView parameters={parameters.preview.display} /></div>
        <figcaption className="display-preview-labels">
          <p>{parameters.preview.viewportLabel}</p>
          <p>{parameters.preview.scaleLabel}</p>
          <p>{parameters.preview.sourceLabel}</p>
        </figcaption>
      </figure>
      <div className="display-settings-scroll">
        <fieldset disabled={parameters.disabled} className="display-fields">
          {parameters.sections.map(section => <details key={section.id} className="display-setting-group" open={section.open}>
            <summary>{section.label}</summary>
            <div className="display-setting-group-fields">
              {section.palette && <label>配色<select data-setting-autofocus value={parameters.palette}
                onChange={event => emit({ type: "display.palette.selected", value: event.currentTarget.value })}>
                {parameters.palettes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select></label>}
              {section.groups.map(group => <div key={group[0].field} className={group.length === 2 ? "display-field-pair" : undefined}>
                {group.map(field => <DisplayFieldView key={field.field} parameters={field} />)}
              </div>)}
            </div>
          </details>)}
        </fieldset>
        <p className="display-settings-note">書体は観客の端末で変わります。別ディスプレイへ移して「全画面」で読みやすさを確認してください。</p>
      </div>
      <div className="display-settings-actions">
        <Button className="operator-button display-save" disabled={parameters.saveDisabled} intent={{ type: "display.save.requested" }}>表示設定を反映</Button>
        <p className="caption-hint" role="status">{parameters.saveHint}</p>
      </div>
    </aside>}
  </viewHierarchy.Scope>;
}
