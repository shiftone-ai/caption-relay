import { Info, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Disclosure } from "../../components/ui/disclosure";
import { viewHierarchy } from "../../events/hierarchy";
import type { DisplayFieldParameters, DisplayParameters } from "../../presenters/operator";
import { CaptionDisplayView } from "../caption-display";

export function DisplayFieldView({ parameters }: { parameters: DisplayFieldParameters }) {
  return <viewHierarchy.Scope name={"display-field:" + parameters.field}>
    {emit => <label>{parameters.label}
      {parameters.kind === "color"
        ? <input aria-label={parameters.label + "色"} type="color" value={parameters.value}
          onChange={event => emit({ type: "display.field.changed", field: parameters.field, value: event.currentTarget.value })} />
        : <select data-setting-autofocus={parameters.autofocus || undefined} value={parameters.value}
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
      <fieldset disabled={parameters.disabled} className="display-fields display-mode-field">
        <DisplayFieldView parameters={parameters.modeField} />
      </fieldset>
      <fieldset disabled={parameters.disabled} className="display-fields display-field-pair display-primary-fields">
        {parameters.primaryFields.map(field => <DisplayFieldView key={field.field} parameters={field} />)}
      </fieldset>
      <figure className="display-preview" aria-label="表示設定のプレビュー">
        <div className="display-sample" style={parameters.preview.surfaceStyle}><CaptionDisplayView parameters={parameters.preview.display} /></div>
        <figcaption className="display-preview-labels">
          <p title={parameters.preview.viewportLabel + " · " + parameters.preview.scaleLabel}>{parameters.preview.sourceLabel}</p>
        </figcaption>
      </figure>
      <div className="display-settings-scroll operator-panel-scroll">
        <fieldset disabled={parameters.disabled} className="display-fields">
          {parameters.sections.map(section => <Disclosure key={section.id} parameters={section.disclosure} className="display-setting-group" summary={section.label}>
            <div className="display-setting-group-fields">
              {section.palette && <label>配色<select value={parameters.palette}
                onChange={event => emit({ type: "display.palette.selected", value: event.currentTarget.value })}>
                {parameters.palettes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select></label>}
              {section.groups.map(group => <div key={group[0].field} className={group.length === 2 ? "display-field-pair" : undefined}>
                {group.map(field => <DisplayFieldView key={field.field} parameters={field} />)}
              </div>)}
            </div>
          </Disclosure>)}
        </fieldset>
        <Disclosure parameters={parameters.helpDisclosure} className="panel-help" summaryLabel="表示設定の説明" summaryTitle="表示設定の説明" summary={<Info size={16} aria-hidden="true" />}>
          <p>「表示設定を反映」で観客画面へ送ります。</p>
          <p>プレビューは1280×800pxを縮小しています。書体は観客の端末により変わります。</p>
        </Disclosure>
      </div>
      <div className="display-settings-actions">
        <Button className="operator-button display-save" disabled={parameters.saveDisabled} intent={{ type: "display.save.requested" }}>表示設定を反映</Button>
        <p className="caption-hint" role="status">{parameters.saveHint}</p>
      </div>
    </aside>}
  </viewHierarchy.Scope>;
}
