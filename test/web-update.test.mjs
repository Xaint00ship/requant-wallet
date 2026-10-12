import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { MessageChannel } from "node:worker_threads";
const source = await readFile(
  new URL("../web/service-worker.js", import.meta.url),
  "utf8",
);
function worker(clientSafety = [], telegram = false) {
  const listeners = {};
  let activated = 0,
    deferred = 0;
  const clients = clientSafety.map((safe) => ({
    url: "https://requant.network/wallet/",
    postMessage: (_msg, [port]) => {
      port.postMessage({ safe });
      port.close();
    },
  }));
  const self = {
    location: { origin: "https://requant.network" },
    registration: {
      scope: telegram
        ? "https://requant.network/telegram-wallet/"
        : "https://requant.network/wallet/",
    },
    clients: { matchAll: async () => clients, claim: async () => {} },
    skipWaiting: async () => {
      activated++;
    },
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
  };
  vm.runInNewContext(source, {
    self,
    CACHE: telegram ? "requant-telegram-wallet-new" : "requant-wallet-new",
    FILES: [
      "/wallet/index.html",
      "/wallet/telegram.html",
      "/wallet/export.html",
      "/telegram-wallet/",
      "/telegram-wallet/export.html",
      "/wallet/assets/app.js",
    ],
    URL,
    MessageChannel,
    setTimeout,
    clearTimeout,
    fetch: async () => {},
    caches: {
      open: async () => ({
        addAll: async () => {},
        match: async () => "cached-public-file",
      }),
      keys: async () => [],
      delete: async () => {},
    },
  });
  const run = async (type, data = {}) => {
    let promise;
    listeners[type]({
      data,
      source: {
        postMessage: () => {
          deferred++;
        },
      },
      waitUntil: (p) => {
        promise = p;
      },
    });
    await promise;
  };
  return {
    run,
    listeners,
    activated: () => activated,
    deferred: () => deferred,
  };
}
test("service worker downloads a revision without forcing activation, and every wallet tab must be safe", async () => {
  const busy = worker([true, false]);
  await busy.run("install");
  assert.equal(busy.activated(), 0);
  await busy.run("message", { type: "REQUEST_ACTIVATE" });
  assert.equal(busy.activated(), 0);
  assert.equal(busy.deferred(), 1);
  const idle = worker([true, true]);
  await idle.run("message", { type: "REQUEST_ACTIVATE" });
  assert.equal(idle.activated(), 1);
});
test("offline cache serves the matching public shell and never intercepts RPC or wallet download files", async () => {
  const w = worker();
  let response;
  const request = (url, mode = "cors", method = "GET") => {
    response = null;
    w.listeners.fetch({
      request: { url, mode, method },
      respondWith: (p) => {
        response = p;
      },
    });
    return response;
  };
  assert.equal(
    await request("https://requant.network/wallet/", "navigate"),
    "cached-public-file",
  );
  assert.equal(
    await request("https://requant.network/wallet/telegram.html", "navigate"),
    "cached-public-file",
  );
  assert.equal(
    await request(
      "https://requant.network/wallet/export.html?id=opaque",
      "navigate",
    ),
    "cached-public-file",
  );
  for (const path of [
    "/wallet-api/v1/rpc",
    "/telegram-wallet-api/exports/opaque",
    "/wallet/downloads/wallet/private.key",
    "/downloads/wallet/v0.3.0-testnet/app.exe",
    "/wallet/sw.js",
  ])
    assert.equal(request(`https://requant.network${path}`), null);
  assert.equal(
    request("https://requant.network/wallet/assets/app.js", "cors", "POST"),
    null,
  );
});
test("Telegram has its own offline entry and scope; export links keep the export page", async () => {
  const w = worker([], true);
  for (const url of [
    "https://requant.network/telegram-wallet/",
    "https://requant.network/telegram-wallet/export.html?id=opaque",
  ]) {
    let response;
    w.listeners.fetch({
      request: { url, method: "GET", mode: "navigate" },
      respondWith: (p) => {
        response = p;
      },
    });
    assert.equal(await response, "cached-public-file");
  }
});
