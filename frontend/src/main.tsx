import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OperatorRoot } from "./roots";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<StrictMode><OperatorRoot /></StrictMode>);
