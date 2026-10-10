import React from "react";
import { createRoot } from "react-dom/client";
import App from "../web/src/App";
import { initialize } from "../web/src/storage";
import { installNativePlatform } from "./native-platform";
import "../web/src/signal.css";
import "./full-wallet.css";
installNativePlatform();
await initialize();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
