import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HomeRoot, RoomRoot } from "./roots";
import { roomIdFromPath } from "./adapters/rooms";
import "./styles.css";
import "./rooms.css";

const roomId = roomIdFromPath(window.location.pathname);
createRoot(document.getElementById("root")!).render(<StrictMode>{roomId ? <RoomRoot id={roomId} /> : <HomeRoot />}</StrictMode>);
