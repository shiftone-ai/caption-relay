import { viewHierarchy } from "../events/hierarchy";
import type { OperatorParameters } from "../presenters/operator";
import { ToolbarView } from "./operator/toolbar";
import { CaptionListView } from "./operator/captions";
import { DisplaySettingsView } from "./operator/display-settings";
import { AiSettingsView } from "./operator/ai-settings";

export function OperatorView({ parameters }: { parameters: OperatorParameters }) {
  return (
    <viewHierarchy.Scope name="operator-screen">
      <main className="operator-shell">
        <header className="operator-header"><h1>Caption Relay</h1><ToolbarView parameters={parameters.toolbar} /></header>
        {parameters.message && <p role="status" className="operator-global-error">{parameters.message}</p>}
        <div className="operator-live-preview"><span className="operator-live-label">{parameters.liveLabel}</span><p>{parameters.liveText}</p></div>
        <div className="operator-workspace">
          <CaptionListView parameters={parameters} />
          {parameters.toolbar.settingsOpen && <DisplaySettingsView parameters={parameters.displaySettings} />}
          {parameters.toolbar.aiSettingsOpen && <AiSettingsView parameters={parameters.ai} />}
        </div>
      </main>
    </viewHierarchy.Scope>
  );
}
