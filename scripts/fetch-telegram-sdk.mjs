// Fetch the Telegram Web Apps SDK for build/development without tracking a copy in Git.
// Verify the pinned SHA-256 before writing it; review upstream changes before updating the pin.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const URL = "https://telegram.org/js/telegram-web-app.js?64";
const SHA256 =
  "124bdff7ba3fe86c8ba5143467afec21e020405e74abdb92cfdda6c0ee3b5908";
const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "telegram-web-app.js",
);

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function ensureTelegramSdk({
  outPath = out,
  fetchSdk = globalThis.fetch,
} = {}) {
  if (existsSync(outPath) && sha(readFileSync(outPath)) === SHA256) {
    console.log("Telegram Web Apps SDK: verified copy present.");
  } else {
    const response = await fetchSdk(URL, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(
        `Telegram Web Apps SDK: HTTP ${response.status} from ${URL}`,
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    const got = sha(bytes);
    if (got !== SHA256) {
      throw new Error(
        `Telegram Web Apps SDK changed upstream: SHA-256 ${got}, expected ${SHA256}. Review it before updating the pin.`,
      );
    }
    writeFileSync(outPath, bytes);
    console.log(
      `Telegram Web Apps SDK: fetched and verified (${bytes.length} bytes).`,
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await ensureTelegramSdk();
}
