import { Home, LoaderCircle, RotateCcw } from "lucide-react";
import { Button } from "../components/ui/button";
import { ConfirmationDialog } from "../components/ui/confirmation-dialog";
import { viewHierarchy } from "../events/hierarchy";
import type { RoomParameters } from "../presenters/room";

export function RoomActionsView({ parameters }: { parameters: RoomParameters }) {
  return <viewHierarchy.Scope name="room-actions">
    <header className="room-actions-bar">
      <Button variant="ghost" className="room-home-button" aria-label="ホームへ戻る" title="ホームへ戻る" disabled={parameters.homeDisabled}
        intent={{ type: "room.home.requested" }}><Home size={16} aria-hidden="true" /></Button>
      <h2>{parameters.room?.name ?? "Caption Relay"}</h2>
      {parameters.showOperator && <Button variant="ghost" className="room-reset-button" aria-label="字幕をリセット" title="字幕をリセット" disabled={parameters.disabled} intent={{ type: "room.reset.requested" }}><RotateCcw size={16} aria-hidden="true" /><span className="room-reset-label">字幕をリセット</span></Button>}
      {parameters.message && <p role="status" className="room-notice">{parameters.message}</p>}
      {parameters.loading && <p role="status"><LoaderCircle size={16} className="home-loading-icon" aria-hidden="true" />接続中…</p>}
      {parameters.failed && <Button variant="outline" intent={{ type: "room.retry.requested" }}>再接続</Button>}
      <ConfirmationDialog parameters={parameters.confirmation} />
    </header>
  </viewHierarchy.Scope>;
}
