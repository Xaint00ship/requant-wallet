import test from "node:test";
import assert from "node:assert/strict";
process.env.NODE_ENV = "test";
const { validateRequest, createGateway } = await import("../server.mjs");
test("gateway permits only bounded wallet operations", () => {
  assert.deepEqual(validateRequest({ method: "getinfo", params: [] }), {
    method: "getinfo",
    params: [],
  });
  for (const method of [
    "addpeer",
    "submitwork",
    "getwork",
    "peers",
    "anything",
  ])
    assert.throws(() => validateRequest({ method, params: [] }));
  assert.throws(() => validateRequest({ method: "sendtx", params: ["zz"] }));
  assert.throws(() =>
    validateRequest({ method: "history", params: ["a".repeat(64), 101] }),
  );
  assert.throws(() => validateRequest({ method: "getblock", params: [1] }));
});
test("gateway preserves uint64 bytes and blocks mutations before reaching the node", async () => {
  let calls = 0;
  const raw = '{"result":{"value":9223372036854775808},"error":null}';
  const server = createGateway({
    rpcUrl: "http://node",
    rpcToken: "test-only-token",
    fetchNode: async (url, options) => {
      calls++;
      assert.equal(options.headers.Authorization, "Bearer test-only-token");
      return new Response(raw);
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/wallet-api/v1/rpc`;
    let response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "addpeer", params: ["arbitrary"] }),
    });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "getinfo", params: [] }),
    });
    assert.equal(await response.text(), raw);
    assert.equal(calls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("broadcast is rate-limited and secrets are never exposed in node errors", async () => {
  const server = createGateway({
    rpcUrl: "http://node",
    rpcToken: "hidden-test-token",
    fetchNode: async () =>
      new Response(
        '{"result":null,"error":"hidden-test-token internal node error"}',
      ),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/wallet-api/v1/rpc`;
    for (let i = 0; i < 11; i++) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "sendtx", params: ["ab"] }),
      });
      assert.equal(response.status, i === 10 ? 429 : 200);
      assert(!(await response.text()).includes("hidden-test-token"));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
