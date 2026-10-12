import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureTelegramSdk } from "../scripts/fetch-telegram-sdk.mjs";

function destination(t) {
  const dir = mkdtempSync(join(tmpdir(), "requant-sdk-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "telegram-web-app.js");
}

test("changed upstream SDK fails before publishing executable code", async (t) => {
  const outPath = destination(t);
  await assert.rejects(
    ensureTelegramSdk({
      outPath,
      fetchSdk: async (url, options) => {
        assert.equal(url, "https://telegram.org/js/telegram-web-app.js?64");
        assert(options.signal instanceof AbortSignal);
        return new Response("unexpected upstream JavaScript");
      },
    }),
    /SDK changed upstream/,
  );
  assert(!existsSync(outPath));
});

test("failed verification never replaces an existing local copy", async (t) => {
  const outPath = destination(t);
  writeFileSync(outPath, "local copy");
  await assert.rejects(
    ensureTelegramSdk({
      outPath,
      fetchSdk: async () => new Response("different upstream copy"),
    }),
    /SDK changed upstream/,
  );
  assert.equal(readFileSync(outPath, "utf8"), "local copy");
});

test("HTTP failures stop SDK preparation without creating a file", async (t) => {
  const outPath = destination(t);
  await assert.rejects(
    ensureTelegramSdk({
      outPath,
      fetchSdk: async () => new Response("unavailable", { status: 503 }),
    }),
    /HTTP 503/,
  );
  assert(!existsSync(outPath));
});
