import test from "node:test";
import assert from "node:assert/strict";
import { protocolRequest } from "../protocol.mjs";
process.env.NODE_ENV = "test";
const { createGateway, validateRequest } = await import("../server.mjs");
const address = "trq1" + "a".repeat(52),
  hash = "1".repeat(64),
  tron = "TYfBAJYoXxJnVdnF8Gk3CpNZkPvT6ohg8T";
test("protocol gateway accepts only bounded public operations and known Nile contracts", () => {
  assert.equal(
    protocolRequest({ method: "maker.info", params: [] }).target,
    "maker",
  );
  assert.equal(
    protocolRequest({
      method: "maker.swap_create_usdt",
      params: [100000000, hash, tron, address],
    }).write,
    true,
  );
  for (const method of [
    "maker.export_key",
    "maker.tron-stake",
    "tron./wallet/createtransaction",
    "tron./wallet/deploycontract",
    "http://127.0.0.1/secrets",
  ])
    assert.throws(() => protocolRequest({ method, params: [{}] }));
  assert.throws(() =>
    protocolRequest({
      method: "maker.swap_create_ln",
      params: [Number.MAX_SAFE_INTEGER + 1, hash, address],
    }),
  );
  assert.throws(() =>
    protocolRequest({
      method: "tron./wallet/getaccount",
      params: [{ address: tron, visible: true, password: "never-transmit" }],
    }),
  );
  assert.throws(() =>
    protocolRequest({
      method: "tron./wallet/triggerconstantcontract",
      params: [
        {
          owner_address: tron,
          contract_address: tron,
          data: "70a08231" + "0".repeat(64),
          visible: true,
        },
      ],
    }),
  );
  const read = {
    owner_address: tron,
    contract_address: "TBBkQ4hqoH9Ji21QQ5mb6t22MxjWknFiwk",
    data: "fbdc1ef1" + hash,
    visible: true,
  };
  assert.equal(
    protocolRequest({
      method: "tron./wallet/triggerconstantcontract",
      params: [read],
    }).write,
    false,
  );
  assert.throws(() =>
    protocolRequest({
      method: "tron./wallet/triggerconstantcontract",
      params: [{ ...read, data: "a9059cbb" + hash }],
    }),
  );
  assert.equal(
    validateRequest({ method: "sendpackage", params: [["aa", "bb"]] }).method,
    "sendpackage",
  );
  assert.throws(() =>
    validateRequest({ method: "sendpackage", params: [Array(26).fill("aa")] }),
  );
  assert.throws(() =>
    validateRequest({
      method: "sendpackage",
      params: [["aa".repeat(100000), "bb".repeat(100000), "cc"]],
    }),
  );
});
test("protocol relay separates node credentials, refuses redirects and preserves exact response bytes", async () => {
  const observed = [];
  const server = createGateway({
    rpcUrl: "http://private-node",
    rpcToken: "test-only-private-token",
    makerUrl: "http://configured-maker",
    fetchNode: async (url, options) => {
      observed.push({ url, options });
      return new Response(
        '{"result":{"min_rqt":9223372036854775808},"error":null}',
      );
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/wallet-api/v1/protocol`;
    const post = (body) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const r = await post({ method: "maker.info", params: [] });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /9223372036854775808/);
    assert.equal(observed[0].url, "http://configured-maker");
    assert.equal(observed[0].options.headers.Authorization, undefined);
    assert.equal(observed[0].options.redirect, "error");
    assert.deepEqual(JSON.parse(observed[0].options.body), {
      method: "info",
      params: [],
    });
    assert.equal(
      (await post({ method: "maker.export_key", params: [] })).status,
      400,
    );
    assert.equal(observed.length, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
