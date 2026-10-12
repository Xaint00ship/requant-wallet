import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { exportService } from "./exports.mjs";
import { telegramApi, runBot } from "./bot.mjs";
const token = (
  await readFile(
    process.env.BOT_TOKEN_FILE ?? "/run/secrets/telegram-bot-token",
    "utf8",
  )
).trim();
if (!/^\d+:[A-Za-z0-9_-]+$/.test(token))
  throw new Error("Bot credential is missing");
const service = exportService({ token });
const server = createServer((req, res) => {
  void service.handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500, { "Cache-Control": "no-store" });
    res.end();
  });
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.maxHeadersCount = 32;
server.listen(Number(process.env.PORT ?? 3313), "0.0.0.0", () =>
  console.log("Telegram wallet service listening"),
);
const clean = setInterval(service.sweep, 30_000);
clean.unref();
const controller = new AbortController();
void runBot(telegramApi(token), {
  url: "https://requant.network/telegram-wallet/",
  stateDir: process.env.STATE_DIR ?? "/data",
  signal: controller.signal,
});
for (const event of ["SIGINT", "SIGTERM"])
  process.on(event, () => {
    controller.abort();
    server.close();
    setTimeout(() => process.exit(0), 1000).unref();
  });
