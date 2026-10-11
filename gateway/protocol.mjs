const HASH = /^[a-f0-9]{64}$/;
const HEX = /^([a-f0-9]{2})+$/;
const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const CONTRACTS = new Set([
  "TBBkQ4hqoH9Ji21QQ5mb6t22MxjWknFiwk",
  "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
]);
export function protocolRequest({ method, params } = {}) {
  if (!Array.isArray(params)) throw new Error("Invalid parameters");
  const hash = (v) => typeof v === "string" && HASH.test(v);
  const address = (v) =>
    typeof v === "string" && /^trq1[a-z0-9]{30,100}$/.test(v);
  const amount = (v) =>
    Number.isSafeInteger(v) && v >= 1 && v <= 10000000000000;
  const maker = method?.startsWith("maker.") && method.slice(6);
  if (maker) {
    const valid =
      (maker === "info" && params.length === 0) ||
      (["swap_status", "swap_fees"].includes(maker) &&
        params.length === 1 &&
        hash(params[0])) ||
      (maker === "swap_create_ln" &&
        params.length === 3 &&
        amount(params[0]) &&
        hash(params[1]) &&
        address(params[2])) ||
      (maker === "swap_create" &&
        params.length === 4 &&
        amount(params[0]) &&
        hash(params[1]) &&
        /^0[23][a-f0-9]{64}$/.test(params[2]) &&
        address(params[3])) ||
      (maker === "swap_create_usdt" &&
        params.length === 4 &&
        amount(params[0]) &&
        hash(params[1]) &&
        TRON.test(params[2]) &&
        address(params[3]));
    if (!valid) throw new Error("Unsupported maker operation");
    return {
      target: "maker",
      path: "/",
      body: { method: maker, params },
      write: [
        "swap_create",
        "swap_create_ln",
        "swap_create_usdt",
        "swap_fees",
      ].includes(maker),
    };
  }
  const path = method?.startsWith("tron.") && method.slice(5);
  const body = params[0];
  if (
    !path ||
    params.length !== 1 ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  )
    throw new Error("Unsupported protocol operation");
  const keys = Object.keys(body).sort().join(",");
  let valid =
    (["/wallet/getnowblock", "/wallet/getchainparameters"].includes(path) &&
      keys === "") ||
    (["/wallet/getaccount", "/wallet/getaccountresource"].includes(path) &&
      keys === "address,visible" &&
      TRON.test(body.address) &&
      body.visible === true) ||
    ([
      "/walletsolidity/gettransactioninfobyid",
      "/wallet/gettransactioninfobyid",
    ].includes(path) &&
      keys === "value" &&
      hash(body.value)) ||
    (path === "/wallet/broadcasthex" &&
      keys === "transaction" &&
      typeof body.transaction === "string" &&
      body.transaction.length <= 16000 &&
      HEX.test(body.transaction));
  if (
    [
      "/wallet/triggerconstantcontract",
      "/walletsolidity/triggerconstantcontract",
    ].includes(path)
  ) {
    // Read-only selectors: balanceOf, allowance, RequantHtlc.state.
    const selectors = new Set(["70a08231", "dd62ed3e", "fbdc1ef1"]);
    valid =
      keys === "contract_address,data,owner_address,visible" &&
      CONTRACTS.has(body.contract_address) &&
      TRON.test(body.owner_address) &&
      body.visible === true &&
      typeof body.data === "string" &&
      body.data.length <= 392 &&
      HEX.test(body.data) &&
      selectors.has(body.data.slice(0, 8));
  }
  if (!valid) throw new Error("Unsupported TRON operation");
  return { target: "tron", path, body, write: path === "/wallet/broadcasthex" };
}
export async function relayProtocol(request, fetchNode, makerUrl) {
  const url =
    request.target === "maker"
      ? makerUrl
      : `https://nile.trongrid.io${request.path}`;
  if (!url) throw new Error("Swap service unavailable");
  const r = await fetchNode(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request.body),
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error("Swap service unavailable");
  let size = 0;
  const chunks = [];
  for await (const chunk of r.body) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Protocol response too large");
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const value = JSON.parse(raw);
  if (request.target === "maker") {
    if (value.error || !Object.hasOwn(value, "result"))
      throw new Error(
        "The maker rejected this request. Refresh its limits and availability.",
      );
    return raw;
  }
  return `{"result":${raw},"error":null}`;
}
