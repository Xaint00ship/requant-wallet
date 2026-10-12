import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { verifyInitData } from "./auth.mjs";
const MAX_FILE = 32 * 1024 * 1024 + 16;
const MAX_TOTAL = 128 * 1024 * 1024;
export function exportService({
  token,
  origin = "https://requant.network",
  now = Date.now,
  ttl = 10 * 60_000,
} = {}) {
  const files = new Map();
  const pending = new Map();
  const reserved = () =>
    [...pending.values()].reduce((n, count) => n + count * MAX_FILE, 0);
  const digest = (text) => createHash("sha256").update(text).digest();
  function sweep() {
    for (const [id, file] of files) if (file.expires <= now()) files.delete(id);
  }
  const total = () =>
    [...files.values()].reduce(
      (size, file) => size + (file.bytes?.length ?? 0),
      0,
    );
  const match = (provided, stored) =>
    typeof provided === "string" && timingSafeEqual(digest(provided), stored);
  function response(res, status, body) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(JSON.stringify(body));
  }
  return {
    sweep,
    async handle(req, res) {
      sweep();
      if (req.headers.origin && req.headers.origin !== origin)
        return response(res, 403, { error: "Origin rejected" });
      const path = new URL(req.url, origin).pathname;
      if (path === "/telegram-wallet-api/health" && req.method === "GET")
        return response(res, 200, { ok: true });
      if (path === "/telegram-wallet-api/exports" && req.method === "POST") {
        let user;
        try {
          user = verifyInitData(
            req.headers["x-telegram-init-data"],
            token,
            Math.floor(now() / 1000),
          );
        } catch {
          return response(res, 401, { error: "Reopen the Telegram Mini App" });
        }
        if (
          [...files.values()].filter((file) => file.user === user.id).length +
            (pending.get(user.id) ?? 0) >=
            8 ||
          files.size >= 128 ||
          total() + reserved() + MAX_FILE > MAX_TOTAL
        )
          return response(res, 429, { error: "Export limit reached" });
        if (req.headers["content-type"] !== "application/octet-stream")
          return response(res, 415, { error: "Encrypted bytes required" });
        const length = Number(req.headers["content-length"]);
        if (Number.isFinite(length) && length > MAX_FILE)
          return response(res, 413, { error: "Export too large" });
        const chunks = [];
        let size = 0;
        pending.set(user.id, (pending.get(user.id) ?? 0) + 1);
        const deadline = setTimeout(() => req.destroy(), 30_000);
        deadline.unref();
        try {
          for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_FILE) {
              response(res, 413, { error: "Export too large" });
              req.destroy();
              return;
            }
            chunks.push(chunk);
          }
        } catch {
          if (!res.destroyed)
            response(res, 400, { error: "Upload interrupted" });
          return;
        } finally {
          clearTimeout(deadline);
          const left = pending.get(user.id) - 1;
          left ? pending.set(user.id, left) : pending.delete(user.id);
        }
        // Recheck after streaming: concurrent requests cannot exceed the memory cap.
        if (
          size < 17 ||
          total() + size > MAX_TOTAL ||
          files.size >= 128 ||
          [...files.values()].filter((file) => file.user === user.id).length >=
            8
        )
          return response(res, 429, { error: "Export limit reached" });
        const id = randomBytes(24).toString("base64url"),
          acknowledgment = randomBytes(24).toString("base64url");
        files.set(id, {
          bytes: Buffer.concat(chunks),
          user: user.id,
          digest: digest(acknowledgment),
          expires: now() + ttl,
          saved: false,
        });
        return response(res, 201, {
          id,
          acknowledgment,
          expiresIn: ttl / 1000,
        });
      }
      const route = path.match(
        /^\/telegram-wallet-api\/exports\/([A-Za-z0-9_-]{32})(?:\/(status|saved))?$/,
      );
      if (!route) return response(res, 404, { error: "Not found" });
      const [, id, action] = route,
        file = files.get(id);
      if (!file) return response(res, 404, { error: "Export expired" });
      if (req.method === "GET" && !action) {
        if (!file.bytes)
          return response(res, 404, { error: "Export completed" });
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": file.bytes.length,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        });
        return res.end(file.bytes);
      }
      const capability = req.headers.authorization?.match(
        /^Bearer ([A-Za-z0-9_-]{32})$/,
      )?.[1];
      if (!capability || !match(capability, file.digest))
        return response(res, 404, { error: "Not found" });
      if (req.method === "GET" && action === "status")
        return response(res, 200, { saved: file.saved });
      if (req.method === "POST" && action === "saved") {
        file.bytes = null;
        file.saved = true;
        file.expires = now() + 2 * 60_000;
        return response(res, 200, { saved: true });
      }
      if (req.method === "DELETE" && !action) {
        files.delete(id);
        return response(res, 200, { deleted: true });
      }
      return response(res, 405, { error: "Method not allowed" });
    },
  };
}
