// Fetches the official Telegram Web Apps SDK into public/ for the Mini App build and checks it against
// a pinned SHA-256. The SDK is Telegram's code with no stated license, so it is not committed; the
// build serves this verified copy from our own origin. A changed upstream file stops the build: review
// it, then update SHA256 below.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

if (existsSync(out) && sha(readFileSync(out)) === SHA256) {
  console.log("Telegram Web Apps SDK: verified copy present.");
} else {
  const response = await fetch(URL);
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
  writeFileSync(out, bytes);
  console.log(
    `Telegram Web Apps SDK: fetched and verified (${bytes.length} bytes).`,
  );
}
