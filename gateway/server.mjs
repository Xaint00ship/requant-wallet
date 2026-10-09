import http from "node:http";
export function validateRequest(body) {
  const { method, params } = body || {};
  if (!Array.isArray(params)) throw new Error("Invalid parameters");
  const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const valid =
    (method === "getinfo" && params.length === 0) ||
    (method === "getblock" && params.length === 1 && params[0] === 0) ||
    ((method === "gettx" || method === "utxos") &&
      params.length === 1 &&
      hash(params[0])) ||
    (method === "history" &&
      params.length === 2 &&
      hash(params[0]) &&
      Number.isInteger(params[1]) &&
      params[1] >= 1 &&
      params[1] <= 100) ||
    (method === "sendtx" &&
      params.length === 1 &&
      typeof params[0] === "string" &&
      params[0].length >= 2 &&
      params[0].length <= 200000 &&
      params[0].length % 2 === 0 &&
      /^[a-f0-9]+$/.test(params[0]));
  if (!valid) throw new Error("Unsupported wallet operation");
  return { method, params };
}
export function createGateway({
  rpcUrl,
  rpcToken,
  fetchNode = fetch,
  now = Date.now,
} = {}) {
  let active = 0;
  const limits = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const reply = (status, error) => {
      res.writeHead(status);
      res.end(JSON.stringify({ result: null, error }));
    };
    if (req.method === "GET" && req.url === "/wallet-api/health") {
      res.end(
        JSON.stringify({
          service: "Requant wallet gateway",
          version: 1,
          network: "testnet",
        }),
      );
      return;
    }
    if (req.method !== "POST" || req.url !== "/wallet-api/v1/rpc") {
      reply(404, "Wallet endpoint not found");
      return;
    }
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      reply(415, "JSON required");
      return;
    }
    try {
      let size = 0;
      const parts = [];
      for await (const part of req) {
        size += part.length;
        if (size > 256 * 1024) {
          reply(413, "Request too large");
          return;
        }
        parts.push(part);
      }
      const request = validateRequest(
        JSON.parse(Buffer.concat(parts).toString("utf8")),
      );
      const identity = String(
        req.headers["x-real-ip"] || req.socket.remoteAddress,
      );
      const key = `${identity}:${request.method === "sendtx" ? "send" : "read"}`;
      const timestamp = now();
      for (const [k, v] of limits) if (v.until <= timestamp) limits.delete(k);
      if (limits.size >= 20000 && !limits.has(key)) {
        reply(503, "Gateway busy");
        return;
      }
      const bucket = limits.get(key) || { count: 0, until: timestamp + 60000 };
      limits.set(key, bucket);
      bucket.count++;
      if (bucket.count > (request.method === "sendtx" ? 10 : 240)) {
        reply(429, "Too many requests. Try again later.");
        return;
      }
      if (active >= 8) {
        reply(503, "Gateway busy");
        return;
      }
      if (!rpcUrl || !rpcToken) {
        reply(503, "Wallet node unavailable");
        return;
      }
      active++;
      try {
        const response = await fetchNode(rpcUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${rpcToken}`,
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error("Node unavailable");
        const chunks = [];
        let received = 0;
        for await (const chunk of response.body) {
          received += chunk.length;
          if (received > 4 * 1024 * 1024)
            throw new Error("Node response too large");
          chunks.push(Buffer.from(chunk));
        }
        const raw = Buffer.concat(chunks);
        const parsed = JSON.parse(raw.toString("utf8"));
        if (parsed.error) {
          if (parsed.error === "unauthorized") {
            reply(503, "Wallet node unavailable");
            return;
          }
          res.end(
            JSON.stringify({
              result: null,
              error: "The node rejected this request.",
            }),
          );
          return;
        }
        if (!Object.hasOwn(parsed, "result"))
          throw new Error("Invalid node response");
        res.end(raw);
      } catch {
        reply(503, "Wallet node unavailable");
      } finally {
        active--;
      }
    } catch {
      reply(400, "Invalid wallet request");
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
if (process.env.NODE_ENV !== "test") {
  const server = createGateway({
    rpcUrl: process.env.RPC_URL,
    rpcToken: process.env.RPC_TOKEN,
  });
  server.listen(Number(process.env.PORT || 3312), "0.0.0.0", () =>
    console.log("Requant wallet gateway listening"),
  );
}
