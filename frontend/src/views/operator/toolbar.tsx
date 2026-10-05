import { Button } from "../../components/ui/button";
import { operatorHierarchy } from "../../events/hierarchy";
import type { ToolbarParameters } from "../../presenters/operator";

export function ToolbarView({ parameters }: { parameters: ToolbarParameters }) {
  return (
    <operatorHierarchy.Scope name="toolbar">
      {emit => (
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="outline" size="lg" onClick={() => emit({ type: "test.requested" })} disabled={parameters.testDisabled}>
            テスト字幕を送る
          </Button>
          <Button variant="outline" size="lg" onClick={() => emit({ type: "visibility.toggle.requested" })} disabled={parameters.toggleDisabled}>
            {parameters.toggleLabel}
          </Button>
          <a className="underline underline-offset-4" href="/view/demo" target="_blank" rel="noopener noreferrer">観客画面 ↗</a>
        </div>
      )}
    </operatorHierarchy.Scope>
  );
}
