import { readFile } from "node:fs/promises";
import { telegramApi } from "./bot.mjs";
const token = (
  await readFile(
    process.env.BOT_TOKEN_FILE ?? "/run/secrets/telegram-bot-token",
    "utf8",
  )
).trim();
const api = telegramApi(token);
const bot = await api("getMe"),
  webhook = await api("getWebhookInfo");
if (webhook.url)
  throw new Error(
    "This bot already has a webhook. Preserve it and review configuration before polling.",
  );
await api("setMyName", { name: "Requant Wallet" });
await api("setMyDescription", {
  description:
    "Your keys. Your wallet. In Telegram. Create and restore Requant wallets, receive and send RQT, use swaps, channels and offline signing. All signing happens on your device. Testnet only — coins have no value. Tap Open Wallet to begin.",
});
await api("setMyShortDescription", {
  short_description:
    "Self-custody Requant wallet · Testnet · Local signing, swaps, channels & offline payments.",
});
await api("setMyCommands", {
  commands: [
    { command: "start", description: "Open Requant Wallet" },
    { command: "wallet", description: "Launch the wallet Mini App" },
    { command: "help", description: "Wallet help and downloads" },
    { command: "privacy", description: "Local keys, backups and data privacy" },
  ],
});
await api("setChatMenuButton", {
  menu_button: {
    type: "web_app",
    text: "Open Wallet",
    web_app: { url: "https://requant.network/telegram-wallet/" },
  },
});
const menu = await api("getChatMenuButton");
console.log(JSON.stringify({ bot: bot.username, menu, configured: true }));
