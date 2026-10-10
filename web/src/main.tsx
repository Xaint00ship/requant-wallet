import React from "react";
import { createRoot } from "react-dom/client";
import { initialize } from "./storage";
import App from "./App";
import "./signal.css";
await initialize();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
