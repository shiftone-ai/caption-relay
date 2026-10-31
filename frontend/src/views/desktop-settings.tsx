import { viewHierarchy } from "../events/hierarchy";
import { Button } from "../components/ui/button";
import { Form } from "../components/ui/form";
import { ConfirmationDialog } from "../components/ui/confirmation-dialog";
import type { DesktopSettingsParameters } from "../presenters/desktop-settings";

export function DesktopSettingsView({ parameters }: { parameters: DesktopSettingsParameters }) {
  return <viewHierarchy.Scope name="desktop-settings">
    {emit => <main className="desktop-settings">
      <h1>APIキー</h1>
      {parameters.loading && <p role="status">設定を読み込んでいます</p>}
      {parameters.message && <p className="desktop-settings-error" role="alert">{parameters.message}</p>}
      {parameters.retry && <Button intent={{ type: "desktop.retry.requested" }}>再読み込み</Button>}
      <Form intent={{ type: "desktop.save.requested" }}>
        {parameters.fields.map(field => <section className="desktop-credential" key={field.key}>
          <label htmlFor={field.key}>{field.label}</label>
          <input id={field.key} type={field.secret ? "password" : "text"} inputMode={field.secret ? "text" : "decimal"}
            value={field.value} disabled={field.disabled} placeholder={field.placeholder} autoComplete="off" autoCapitalize="off" spellCheck={false}
            onChange={event => emit({ type: "desktop.changed", key: field.key, value: event.currentTarget.value })} />
          {field.removable && <label className="desktop-credential-removal"><input type="checkbox" checked={field.remove} disabled={field.removalDisabled}
            onChange={event => emit({ type: "desktop.removal.changed", key: field.key, remove: event.currentTarget.checked })} />保存済みの値を削除</label>}
        </section>)}
        <Button type="submit" disabled={parameters.saveDisabled}>{parameters.saving ? "再起動しています…" : "保存して再起動"}</Button>
      </Form>
      <ConfirmationDialog parameters={parameters.confirmation} />
    </main>}
  </viewHierarchy.Scope>;
}
