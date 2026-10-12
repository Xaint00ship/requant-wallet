import { readFile, writeFile, mkdir } from "node:fs/promises";
export function commandReply(message, url) {
  if (
    message?.chat?.type !== "private" ||
    !Number.isSafeInteger(message.chat.id)
  )
    return null;
  const command =
    typeof message.text === "string"
      ? message.text.split(/\s/)[0].split("@")[0].toLowerCase()
      : "";
  if (!["/start", "/wallet", "/help", "/privacy"].includes(command))
    return null;
  const text =
    command === "/privacy"
      ? "Requant Wallet signs on your device. Recovery phrases, private keys and wallet passwords are never sent to this bot or our server. Encrypted wallet data stays on this device. File exports use an additional encryption layer created on your device; the server holds only temporary ciphertext. Back up your wallet before clearing Telegram data. Telegram identity does not restore your wallet."
      : "Welcome to Requant Wallet.\n\nOpen your self-custody wallet in Telegram: create or restore a wallet, receive and send RQT, use watch-only and offline signing, swaps, channels and transaction packages.\n\nTestnet only. Coins have no value. Keep an encrypted backup and your recovery phrase offline. Never send a recovery phrase, private key or password to this bot.";
  return {
    chat_id: message.chat.id,
    text,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Open Requant Wallet", web_app: { url } }],
        [
          {
            text: "Help & downloads",
            url: "https://requant.network/docs/wallet",
          },
        ],
      ],
    },
  };
}
export function telegramApi(token) {
  return async (method, body = {}) => {
    let response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(method === "getUpdates" ? 45_000 : 20_000),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error();
      return json.result;
    } catch {
      throw new Error(`Telegram ${method} request failed`);
    }
  };
}
export async function runBot(api, { url, stateDir, signal }) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const offsetFile = `${stateDir}/offset`;
  let offset = 0;
  try {
    const old = Number(await readFile(offsetFile, "utf8"));
    if (Number.isSafeInteger(old) && old >= 0) offset = old;
  } catch {}
  while (!signal.aborted) {
    try {
      const updates = await api("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message"],
        limit: 50,
      });
      for (const update of updates) {
        if (signal.aborted) break;
        const reply = commandReply(update.message, url);
        if (reply) {
          try {
            await api("sendMessage", reply);
          } catch {
            console.warn(
              "Bot response failed; update acknowledged without retaining message content.",
            );
          }
        }
        offset = update.update_id + 1;
        await writeFile(offsetFile, String(offset), { mode: 0o600 });
      }
    } catch {
      if (!signal.aborted) {
        console.warn("Telegram connection unavailable; retrying.");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}
