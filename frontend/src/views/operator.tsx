import { operatorHierarchy } from "../events/hierarchy";
import type { OperatorParameters } from "../presenters/operator";
import { ToolbarView } from "./operator/toolbar";
import { CaptionListView } from "./operator/captions";

const { Scope } = operatorHierarchy;

export function OperatorView({ parameters }: { parameters: OperatorParameters }) {
  return (
    <Scope name="operator-screen">
      <main className="mx-auto max-w-[1100px] px-[18px] py-8 md:px-8">
        <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Caption Relay</h1>
            <p className="mt-2 text-neutral-600">UDトーク等 → 整形 → 手修正 → 字幕</p>
          </div>
          <ToolbarView parameters={parameters.toolbar} />
        </header>
        {parameters.message && <p role="status" className="mt-4 text-red-800">{parameters.message}</p>}
        <CaptionListView rows={parameters.rows} />
      </main>
    </Scope>
  );
}
