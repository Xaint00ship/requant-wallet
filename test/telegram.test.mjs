import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { verifyInitData } from "../telegram/auth.mjs";
import { exportService } from "../telegram/exports.mjs";
import { commandReply } from "../telegram/bot.mjs";
import { sealExport, openExport } from "../web/src/telegram/crypto.mjs";
const token = "12345:unfunded-test-token";
function signed(now = Math.floor(Date.now() / 1000), id = 42) {
  const p = new URLSearchParams({
    auth_date: String(now),
    query_id: "unfunded-test-session",
    user: JSON.stringify({ id, first_name: "Test" }),
  });
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const data = [...p]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  p.set("hash", createHmac("sha256", secret).update(data).digest("hex"));
  return p.toString();
}
test("Telegram server authentication rejects forged, duplicate, stale and future initData", () => {
  assert.deepEqual(verifyInitData(signed(1000), token, 1000), { id: 42 });
  for (const input of [
    signed(1000) + "&user=%7B%7D",
    signed(1000).replace("Test", "Changed"),
    signed(1000),
    signed(200000),
    "hash=not-a-hash",
  ]) {
    assert.throws(() => verifyInitData(input, token, 100000));
  }
  assert.throws(() => verifyInitData(signed(1000), "wrong-bot", 1000));
});
test("file exports are encrypted on the device, authenticated on decrypt, and reject unsafe filenames", async () => {
  const text = "unfunded fixture - private content must never reach the server";
  const a = await sealExport(text, "requant-wallet.json"),
    b = await sealExport(text, "requant-wallet.json");
  assert.notEqual(a.key, b.key);
  assert.notEqual(a.iv, b.iv);
  assert.equal(Buffer.from(a.encrypted).includes(Buffer.from(text)), false);
  assert.deepEqual(await openExport(a.encrypted, a.key, a.iv), {
    text,
    name: "requant-wallet.json",
  });
  const changed = new Uint8Array(a.encrypted.slice(0));
  changed[0] ^= 1;
  await assert.rejects(openExport(changed, a.key, a.iv));
  await assert.rejects(openExport(a.encrypted, b.key, a.iv));
  await assert.rejects(sealExport(text, "../../wallet.key"));
});
test("temporary export service verifies sessions and capabilities, serves ciphertext only and deletes completed or expired payloads", async (t) => {
  let now = Date.now();
  const service = exportService({ token, now: () => now });
  const server = createServer((req, res) => void service.handle(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/telegram-wallet-api`;
  const sealed = await sealExport("unfunded fixture", "requant-wallet.json");
  const upload = (auth = signed(Math.floor(now / 1000)), extra = {}) =>
    fetch(`${base}/exports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Telegram-Init-Data": auth,
        ...extra,
      },
      body: sealed.encrypted,
    });
  assert.equal((await upload("forged")).status, 401);
  assert.equal(
    (await upload(undefined, { Origin: "https://attacker.example" })).status,
    403,
  );
  const created = await upload();
  assert.equal(created.status, 201);
  const { id, acknowledgment } = await created.json();
  const downloaded = await fetch(`${base}/exports/${id}`);
  assert.equal(downloaded.headers.get("cache-control"), "no-store");
  assert.deepEqual(
    Buffer.from(await downloaded.arrayBuffer()),
    Buffer.from(sealed.encrypted),
  );
  assert.equal((await fetch(`${base}/exports/${id}/status`)).status, 404);
  const headers = { Authorization: `Bearer ${acknowledgment}` };
  assert.deepEqual(
    await (await fetch(`${base}/exports/${id}/status`, { headers })).json(),
    { saved: false },
  );
  assert.equal(
    (
      await fetch(`${base}/exports/${id}/saved`, {
        method: "POST",
        headers: { Authorization: "Bearer " + "A".repeat(32) },
      })
    ).status,
    404,
  );
  assert.equal(
    (await fetch(`${base}/exports/${id}/saved`, { method: "POST", headers }))
      .status,
    200,
  );
  assert.equal((await fetch(`${base}/exports/${id}`)).status, 404);
  assert.deepEqual(
    await (await fetch(`${base}/exports/${id}/status`, { headers })).json(),
    { saved: true },
  );
  const second = await (await upload()).json();
  now += 600001;
  service.sweep();
  assert.equal((await fetch(`${base}/exports/${second.id}`)).status, 404);
  for (let i = 0; i < 8; i++) assert.equal((await upload()).status, 201);
  assert.equal((await upload()).status, 429);
});
test("bot responds to requested private commands, never echoes chat content or accepts keys", () => {
  const url = "https://requant.network/wallet/telegram.html";
  const reply = commandReply(
    { chat: { type: "private", id: 42 }, text: "/start" },
    url,
  );
  assert.equal(reply.reply_markup.inline_keyboard[0][0].web_app.url, url);
  assert.equal(
    commandReply({ chat: { type: "group", id: 42 }, text: "/start" }, url),
    null,
  );
  assert.equal(
    commandReply(
      { chat: { type: "private", id: 42 }, text: "sensitive phrase" },
      url,
    ),
    null,
  );
  assert.equal(
    commandReply({ chat: { type: "private", id: 42 }, document: {} }, url),
    null,
  );
});
