import * as api from "./service";
import * as storage from "./storage";
import { platform } from "./platform";
export type Swap = {
  id: string;
  walletId: string;
  record: string;
  details: any;
  backedUp: boolean;
  outbox?: any[];
};
export type Channel = {
  id: string;
  walletId: string;
  channel: string;
  details: any;
  state?: string;
};
type Store = { swaps: Swap[]; channels: Channel[] };
const KEY = "requant.protocols.v1";
export function list(): Store {
  return JSON.parse(storage.read(KEY, '{"swaps":[],"channels":[]}'));
}
async function save(next: Store) {
  const data = JSON.stringify(next);
  await api.core("protocolStore", {
    data,
    previous: storage.read(KEY, '{"swaps":[],"channels":[]}'),
  });
  await storage.write(KEY, data);
}
export async function putSwap(row: Swap) {
  const s = list();
  s.swaps = [row, ...s.swaps.filter((r) => r.id !== row.id)];
  await save(s);
  return row;
}
export async function putChannel(row: Channel) {
  const s = list(),
    old = s.channels.find((c) => c.id === row.id);
  if (old && BigInt(old.details.paid) > BigInt(row.details.paid))
    throw new Error(
      "An older channel file cannot replace a newer payment total.",
    );
  s.channels = [row, ...s.channels.filter((r) => r.id !== row.id)];
  await save(s);
  return row;
}
export async function external(
  method: string,
  params: unknown[] = [],
): Promise<{ raw: string; result: any }> {
  let raw: string;
  if (platform()?.protocol) raw = await platform()!.protocol!(method, params);
  else {
    const r = await fetch("/wallet-api/v1/protocol", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      throw new Error(
        r.status === 429
          ? "Too many swap requests. Wait a minute."
          : "Swap service is unavailable. Refresh and try again.",
      );
    const reader = r.body!.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024)
          throw new Error("Protocol response too large.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    raw = new TextDecoder().decode(bytes);
  }
  return { raw, result: await api.core("rpc", { raw }) };
}
export const makerInfo = () => external("maker.info");
export async function createSwap(
  walletId: string,
  kind: string,
  amount: string,
  password: string,
) {
  await api.info();
  const info = await makerInfo();
  const draft = await api.core("swapDraft", {
    file: api.wallet(walletId).file,
    kind,
    amount,
    password,
    info: info.raw,
  });
  let row = await putSwap({
    id: crypto.randomUUID(),
    walletId,
    record: draft.record,
    details: draft.details,
    backedUp: false,
  });
  const request = JSON.parse(draft.request);
  const offer = await external(`maker.${request.method}`, request.params);
  const now =
    kind === "usdt"
      ? BigInt(
          (await external("tron./wallet/getnowblock", [{}])).result.block_header
            .raw_data.timestamp,
        ) / 1000n
      : BigInt(Math.floor(Date.now() / 1000));
  const checked = await api.core("swapOffer", {
    record: row.record,
    password,
    offer: offer.raw,
    now: now.toString(),
  });
  return putSwap({ ...row, ...checked });
}
export async function inspectSwap(row: Swap, password: string) {
  return api.core("swapInspect", { record: row.record, password });
}
export async function status(row: Swap, password: string) {
  const details = await inspectSwap(row, password);
  if (details.state === "draft")
    throw new Error(
      "This quote was not completed. Create a new swap before paying.",
    );
  const response = await external("maker.swap_status", [details.id]);
  const checked = await api.core("swapStatus", {
    record: row.record,
    password,
    status: response.raw,
  });
  return { ...checked, raw: response.raw, details };
}
async function parents(ids: string[]) {
  const p: Record<string, string> = {};
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const r = await api.rpc("gettxbatch", [unique.slice(i, i + 100)]);
    for (const x of r.result) p[x.txid] = x.raw;
  }
  return p;
}
export async function claim(row: Swap, password: string, rate: string) {
  const n = await api.info(),
    st = await status(row, password);
  if (!st.condition) throw new Error("The maker has not locked RQT yet.");
  const owner = (await api.core("condition", { condition: st.condition }))
    .owner;
  const coins = [{ owner, raw: (await api.rpc("utxos", [owner])).raw }];
  const args = {
    record: row.record,
    password,
    status: st.raw,
    rate,
    height: n.height,
    coins,
  };
  const first = await api.core("swapClaimPrepare", args);
  const p = await parents(first.inputs.map((i: any) => i.txid));
  if ((await api.info()).tip !== n.tip)
    throw new Error("The chain changed. Review the claim again.");
  return api.core("swapClaimPrepare", { ...args, parents: p });
}
export async function tronState(row: Swap, password: string) {
  const q = await api.core("swapTronQueries", { record: row.record, password });
  const call = async (body: any, solid = false) =>
    JSON.stringify(
      (
        await external(
          `tron.${solid ? "/walletsolidity" : "/wallet"}/triggerconstantcontract`,
          [body],
        )
      ).result,
    );
  const balance = await call(q.balance),
    allowance = await call(q.allowance, true),
    state = await call(q.state);
  const account = JSON.stringify(
    (await external("tron./wallet/getaccount", [q.account])).result,
  );
  const resource = JSON.stringify(
    (await external("tron./wallet/getaccountresource", [q.account])).result,
  );
  return api.core("swapTronRead", {
    balance,
    allowance,
    state,
    account,
    resource,
  });
}
export async function tronPrepare(
  row: Swap,
  password: string,
  action: string,
  recipient: string,
) {
  const st = await tronState(row, password),
    b = await external("tron./wallet/getnowblock", [{}]);
  return api.core("swapTronSign", {
    record: row.record,
    password,
    action,
    recipient,
    ...st,
    block: JSON.stringify(b.result),
    now: Math.floor(Date.now() / 1000).toString(),
    status:
      action === "returnFees" ? (await status(row, password)).raw : undefined,
  });
}
export async function tronSend(row: Swap, signed: any) {
  const outbox = [
    { ...signed, status: "Broadcast status unknown", created: Date.now() },
    ...(row.outbox ?? []).filter((x) => x.txid !== signed.txid),
  ].slice(0, 20);
  await putSwap({ ...row, outbox });
  const r = await external("tron./wallet/broadcasthex", [
    { transaction: signed.hex },
  ]);
  if (r.result.result !== true && r.result.code !== "DUP_TRANSACTION_ERROR")
    throw new Error(
      "TRON rejected the transaction. Refresh its state before retrying.",
    );
  outbox[0].status = "Submitted — waiting for irreversible confirmation";
  return putSwap({ ...row, outbox });
}
export async function tronHistory(row: Swap) {
  const outbox = await Promise.all(
    (row.outbox ?? []).map(async (tx) => {
      if (tx.status === "Confirmed" || tx.status.startsWith("Failed:"))
        return tx;
      const r = (
        await external("tron./walletsolidity/gettransactioninfobyid", [
          { value: tx.txid },
        ])
      ).result;
      if (!r.id || !r.blockNumber) return tx;
      return {
        ...tx,
        status:
          r.receipt?.result === "SUCCESS" || (!r.receipt?.result && !r.result)
            ? "Confirmed"
            : `Failed: ${r.receipt?.result ?? r.result ?? "TRON execution failed"}`,
      };
    }),
  );
  return putSwap({ ...row, outbox });
}
export async function channelStatus(row: Channel) {
  const c = await api.core("channelInspect", { channel: row.channel }),
    node = await api.info();
  const owner = (
    await api.core("protocolAddress", { address: c.details.address })
  ).owner;
  const coins = (await api.rpc("utxos", [owner])).result;
  const coin = coins.find(
    (x: any) =>
      x.txid === c.details.funding_txid && String(x.vout) === c.details.vout,
  );
  let known = false;
  if (!coin) {
    try {
      await api.rpc("gettx", [c.details.funding_txid]);
      known = true;
    } catch {}
  }
  return {
    node,
    funded: !!coin,
    confirmed: !!coin?.confirmed,
    closed: !coin && known,
    blocksLeft: BigInt(c.details.expiry) - BigInt(node.height),
  };
}
export async function channelFunding(row: Channel, password?: string) {
  const checked = await api.core("channelInspect", { channel: row.channel });
  const first = checked;
  const p = await parents(first.inputs);
  const node = await api.info();
  const t = JSON.parse(row.channel),
    inspected = await api.core("channelFundingInputs", {
      channel: row.channel,
    });
  const owners = [...new Set<string>(t.funding_owners)],
    coins: any[] = [];
  for (let i = 0; i < owners.length; i += 200)
    coins.push(...(await api.rpc("utxos", [owners.slice(i, i + 200)])).result);
  for (let i = 0; i < inspected.inputs.length; i++) {
    const input = inspected.inputs[i];
    if (
      !coins.some(
        (c) =>
          c.owner === t.funding_owners[i] &&
          c.txid === input.txid &&
          String(c.vout) === input.vout &&
          c.confirmed &&
          c.spendable,
      )
    )
      throw new Error("A funding output is spent, unconfirmed or immature.");
  }
  if ((await api.info()).tip !== node.tip)
    throw new Error("The chain changed. Review funding again.");
  return api.core(password ? "channelFund" : "channelFundReview", {
    channel: row.channel,
    parents: p,
    height: node.height,
    password,
    file: api.wallet(row.walletId).file,
    details: checked.details,
  });
}
export async function inspectPackage(file: string) {
  const first = await api.core("packageInspect", { package: file });
  const node = await api.info(),
    p = await parents(first.external.map((i: any) => i.txid));
  const reviewed = await api.core("packageInspect", {
    package: file,
    parents: p,
    height: node.height,
  });
  for (const i of reviewed.external) {
    const r = await api.rpc("utxos", [i.owner]);
    if (
      !r.result.some(
        (c: any) =>
          c.txid === i.txid &&
          String(c.vout) === i.vout &&
          c.spendable &&
          (BigInt(i.afterBlocks) === 0n ||
            (c.confirmed &&
              c.height != null &&
              BigInt(node.height) + 1n >=
                BigInt(c.height) + BigInt(i.afterBlocks))),
      )
    )
      throw new Error("A package source is spent or immature.");
  }
  if ((await api.info()).tip !== node.tip)
    throw new Error("Chain changed. Review package again.");
  return reviewed;
}
export async function sendPackage(file: string, expected: any) {
  const fresh = await inspectPackage(file);
  if (JSON.stringify(fresh) !== JSON.stringify(expected))
    throw new Error("Package changed. Review again.");
  const outbox = api.outbox();
  for (let i = 0; i < fresh.txids.length; i++) {
    const txid = fresh.txids[i];
    if (!outbox.some((x) => x.txid === txid))
      outbox.unshift({
        txid,
        hex: fresh.transactions[i],
        status: "Broadcast status unknown",
        created: Date.now(),
      });
  }
  await storage.write(
    "requant.web.outbox.v1",
    JSON.stringify(outbox.slice(0, 100)),
  );
  const r = await api.rpc("sendpackage", [fresh.transactions]);
  if (JSON.stringify(r.result) !== JSON.stringify(fresh.txids))
    throw new Error(
      "Package status is unknown. Check all transaction IDs before retrying.",
    );
  await storage.write(
    "requant.web.outbox.v1",
    JSON.stringify(
      outbox
        .map((x) =>
          fresh.txids.includes(x.txid) ? { ...x, status: "Pending" } : x,
        )
        .slice(0, 100),
    ),
  );
  return r.result;
}
