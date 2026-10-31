import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopSettingsRoot, HomeRoot, RoomRoot } from "./roots";
import { roomIdFromPath } from "./adapters/rooms";
import "./styles.css";
import "./rooms.css";
import "./desktop-settings.css";

const roomId = roomIdFromPath(window.location.pathname);
createRoot(document.getElementById("root")!).render(<StrictMode>{window.location.pathname === "/desktop/settings" ? <DesktopSettingsRoot /> : roomId ? <RoomRoot id={roomId} /> : <HomeRoot />}</StrictMode>);
