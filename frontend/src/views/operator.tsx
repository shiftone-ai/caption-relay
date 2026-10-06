import { useEffect, useRef } from "react";
import { viewHierarchy } from "../events/hierarchy";
import type { OperatorParameters } from "../presenters/operator";
import { ToolbarView } from "./operator/toolbar";
import { CaptionListView } from "./operator/captions";
import { DisplaySettingsView } from "./operator/display-settings";
import { AiSettingsView } from "./operator/ai-settings";
import { CaptionEditorView } from "./operator/editor";
import { CaptionMonitorView } from "./operator/monitor";

export function OperatorView({ parameters }: { parameters: OperatorParameters }) {
  const screen = useRef<HTMLElement>(null);
  const previousPanel = useRef<"display" | "ai" | null>(null);
  const previousEditorFocus = useRef(parameters.editor?.focusVersion);
  const activePanel = parameters.toolbar.settingsOpen ? "display" : parameters.toolbar.aiSettingsOpen ? "ai" : null;

  useEffect(() => {
    if (activePanel) {
      screen.current?.querySelector<HTMLElement>(`#${activePanel}-settings [data-setting-autofocus], #${activePanel}-settings select:not(:disabled)`)?.focus();
    } else if (previousPanel.current && previousEditorFocus.current === parameters.editor?.focusVersion) {
      screen.current?.querySelector<HTMLElement>(`[data-settings-trigger="${previousPanel.current}"]`)?.focus();
    }
    previousPanel.current = activePanel;
    previousEditorFocus.current = parameters.editor?.focusVersion;
  }, [activePanel, parameters.editor?.focusVersion]);

  return (
    <viewHierarchy.Scope name="operator-screen">
      <main ref={screen} className="operator-shell">
        <header className="operator-header"><h1>Caption Relay</h1><ToolbarView parameters={parameters.toolbar} /></header>
        {parameters.message && <p role="status" className="operator-global-error">{parameters.message}</p>}
        <CaptionMonitorView parameters={parameters.monitor} />
        <div className="operator-workspace">
          <CaptionListView parameters={parameters} />
          {parameters.toolbar.settingsOpen && <DisplaySettingsView parameters={parameters.displaySettings} />}
          {parameters.toolbar.aiSettingsOpen && <AiSettingsView parameters={parameters.ai} />}
          {!activePanel && parameters.editor && <div className="operator-inspector"><CaptionEditorView row={parameters.editor} /></div>}
        </div>
      </main>
    </viewHierarchy.Scope>
  );
}
