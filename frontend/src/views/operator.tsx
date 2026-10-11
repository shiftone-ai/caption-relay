import { useEffect, useRef } from "react";
import { viewHierarchy } from "../events/hierarchy";
import type { OperatorParameters } from "../presenters/operator";
import { ToolbarView } from "./operator/toolbar";
import { CaptionListView } from "./operator/captions";
import { DisplaySettingsView } from "./operator/display-settings";
import { AiSettingsView } from "./operator/ai-settings";
import { CaptionEditorView } from "./operator/editor";
import { CaptionMonitorView } from "./operator/monitor";
import { ConnectionSettingsView } from "./operator/connection-settings";
import { DictionarySettingsView } from "./operator/dictionary-settings";

export function OperatorView({ parameters }: { parameters: OperatorParameters }) {
  const screen = useRef<HTMLElement>(null);
  const activePanel = parameters.toolbar.settingsOpen ? "display" : parameters.toolbar.aiSettingsOpen ? "ai" : parameters.toolbar.connectionSettingsOpen ? "connection" : parameters.toolbar.dictionarySettingsOpen ? "dictionary" : null;

  useEffect(() => {
    if (parameters.panelFocus) screen.current?.querySelector<HTMLElement>(parameters.panelFocus.selector)?.focus();
  }, [parameters.panelFocus?.version, parameters.panelFocus?.selector]);

  return (
    <viewHierarchy.Scope name="operator-screen">
      <main ref={screen} className="operator-shell">
        <header className="operator-header"><h1>Caption Relay</h1><ToolbarView parameters={parameters.toolbar} /></header>
        <p className="operator-connection-status" role="status">{parameters.connection.modeLabel} · {parameters.connection.stateLabel}</p>
        {parameters.message && <p role="status" className="operator-global-error">{parameters.message}</p>}
        <CaptionMonitorView parameters={parameters.monitor} />
        <div className="operator-workspace">
          <CaptionListView parameters={parameters} />
          {parameters.toolbar.settingsOpen && <DisplaySettingsView parameters={parameters.displaySettings} />}
          {parameters.toolbar.aiSettingsOpen && <AiSettingsView parameters={parameters.ai} />}
          {parameters.toolbar.dictionarySettingsOpen && <DictionarySettingsView parameters={parameters.dictionary} />}
          {parameters.toolbar.connectionSettingsOpen && <ConnectionSettingsView parameters={parameters.connection} />}
          {!activePanel && parameters.editor && <div className="operator-inspector"><CaptionEditorView row={parameters.editor} /></div>}
        </div>
      </main>
    </viewHierarchy.Scope>
  );
}
