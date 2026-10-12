import React from "react";
import { createRoot } from "react-dom/client";
import App from "../App";
import { initialize } from "../storage";
import { connectTelegram } from "./runtime";
import "../signal.css";
import "./telegram.css";
const root = createRoot(document.getElementById("root")!);
try {
  const tg = window.Telegram?.WebApp;
  if (!tg || tg.platform === "unknown" || !tg.initData)
    throw new Error("Open Requant Wallet inside Telegram to use the Mini App.");
  window.__REQUANT_PLATFORM__ = connectTelegram(tg);
  await initialize();
  void navigator.storage?.persist?.().catch(() => {});
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} catch (error) {
  root.render(
    <main className="telegram-start panel">
      <img src="/wallet/requant-mark.svg" width="48" alt="Requant" />
      <div className="eyebrow">REQUANT / TELEGRAM WALLET · TESTNET</div>
      <h1>Your keys. In Telegram.</h1>
      <p>
        {error instanceof Error
          ? error.message
          : "Wallet could not start. Reopen the Mini App."}
      </p>
      <div className="action-row">
        <a className="button primary" href="https://t.me/requant_wallet_bot">
          Open Telegram bot
        </a>
        <a className="button" href="/wallet/">
          Open Web Wallet
        </a>
      </div>
      <p className="muted">
        Wallets are stored on this device. Restore an existing wallet using its
        encrypted backup or recovery phrase.
      </p>
    </main>,
  );
}
