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
  const activePanel = parameters.toolbar.settingsOpen ? "display" : parameters.toolbar.aiSettingsOpen ? "ai" : null;

  useEffect(() => {
    if (activePanel) {
      screen.current?.querySelector<HTMLElement>(`#${activePanel}-settings [data-setting-autofocus], #${activePanel}-settings select:not(:disabled)`)?.focus();
    } else if (previousPanel.current) {
      screen.current?.querySelector<HTMLElement>(`[data-settings-trigger="${previousPanel.current}"]`)?.focus();
    }
    previousPanel.current = activePanel;
  }, [activePanel]);

  return (
    <viewHierarchy.Scope name="operator-screen">
      {emit => <main ref={screen} className="operator-shell">
        <header className="operator-header"><h1>Caption Relay</h1><ToolbarView parameters={parameters.toolbar} /></header>
        {parameters.message && <p role="status" className="operator-global-error">{parameters.message}</p>}
        <CaptionMonitorView parameters={parameters.monitor} />
        <div className="operator-workspace" onKeyDown={event => emit({ type: "settings.keypressed", key: event.key, isComposing: event.nativeEvent.isComposing })}>
          {parameters.toolbar.settingsOpen && <DisplaySettingsView parameters={parameters.displaySettings} />}
          {parameters.toolbar.aiSettingsOpen && <AiSettingsView parameters={parameters.ai} />}
          {!activePanel && parameters.editor && <div className="operator-inspector"><CaptionEditorView row={parameters.editor} /></div>}
          <CaptionListView parameters={parameters} />
        </div>
      </main>}
    </viewHierarchy.Scope>
  );
}
