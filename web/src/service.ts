import * as storage from "./storage";
import { platform } from "./platform";
import { rqt } from "../../src/amounts.mjs";
export type Address = {
  address: string;
  owner: string;
  chain: number;
  index: number;
  issued: boolean;
};
export type Meta = {
  address: string;
  watchOnly: boolean;
  legacy: boolean;
  addresses: Address[];
};
export type LocalWallet = {
  id: string;
  name: string;
  file: string;
  meta: Meta;
  backedUp: boolean;
  scanIncomplete?: boolean;
};
export type PublicWallet = Omit<LocalWallet, "file">;
export type Snapshot = {
  confirmed: string;
  pending: string;
  maturing: string;
  observedAt: number;
  info: any;
  events: any[];
  coins: any[];
  used: string[];
  coinBatches: { owner: string; raw: string }[];
};
export type Review = {
  outputs: { address: string; amount: string; change: boolean }[];
  amount: string;
  change: string;
  fee: string;
  total: string;
  inputCount: number;
  kind?: string;
  path?: string;
  second?: string;
  bytes?: number;
  locks?: {
    activationHeight: number;
    afterHeight: string;
    afterBlocks: number;
    anyoneCanPay: boolean;
    revealsSecret: boolean;
  };
};
export type Plan = {
  unsigned: string;
  file: string;
  review: Review;
  inputs: { txid: string; vout: number; value: string; owner: string }[];
  walletId: string;
  created: number;
  tip: string;
};
const STORAGE = "requant.web.v1";
let worker: Worker | undefined;
let coreLoad: AbortController | undefined;
let serial = 0;
let generation = 0;
let activeRpc = 0;
const rpcWaiters: (() => void)[] = [];
async function rpcSlot() {
  if (activeRpc >= 6)
    await new Promise<void>((resolve) => rpcWaiters.push(resolve));
  else activeRpc++;
}
function releaseRpc() {
  const next = rpcWaiters.shift();
  if (next) next();
  else activeRpc--;
}
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
export function lock() {
  generation++;
  platform()?.lock();
  coreLoad?.abort();
  coreLoad = undefined;
  worker?.terminate();
  worker = undefined;
  for (const p of pending.values()) p.reject(new Error("Wallet locked."));
  pending.clear();
}
export async function core<T = any>(
  op: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (typeof args.password === "string" && document.hidden)
    throw new Error("Signing session locked. Keep the wallet page active.");
  const adapter = platform();
  if (adapter?.core) {
    const start = generation;
    const result = await adapter.core(op, args);
    if (start !== generation) throw new Error("Wallet locked. Try again.");
    return result;
  }
  if (!worker) {
    worker = new Worker(new URL("./core.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      if (data.type === "LOAD_CORE") {
        const current = worker!;
        const controller = new AbortController();
        coreLoad = controller;
        const timeout = setTimeout(() => controller.abort(), 15000);
        void (async () => {
          try {
            const url = new URL(data.url);
            if (
              url.origin !== location.origin ||
              !url.pathname.endsWith(".wasm") ||
              !url.pathname.startsWith("/wallet/")
            )
              throw new Error();
            const response = await fetch(url, {
              credentials: "omit",
              redirect: "error",
              signal: controller.signal,
            });
            if (!response.ok) throw new Error();
            const bytes = await response.arrayBuffer();
            if (bytes.byteLength > 4 * 1024 * 1024) throw new Error();
            if (worker === current)
              current.postMessage({ type: "CORE_BYTES", bytes }, [bytes]);
          } catch {
            if (worker === current)
              current.postMessage({ type: "CORE_FAILED" });
          } finally {
            clearTimeout(timeout);
            if (coreLoad === controller) coreLoad = undefined;
          }
        })();
        return;
      }
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
    };
    worker.onerror = () => {
      lock();
    };
  }
  const id = ++serial;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, op, args });
  });
}
function db(): LocalWallet[] {
  try {
    const value = JSON.parse(storage.read(STORAGE));
    if (!Array.isArray(value) || value.length > 20) throw Error();
    return value;
  } catch {
    throw new Error(
      "Local wallet storage is unreadable. Restore an encrypted backup.",
    );
  }
}
async function persist(wallets: LocalWallet[]) {
  await storage.write(STORAGE, JSON.stringify(wallets));
}
export function list(): PublicWallet[] {
  return db().map(({ file, ...safe }) => safe);
}
export function wallet(id: string): LocalWallet {
  const w = db().find((w) => w.id === id);
  if (!w) throw new Error("Select a wallet first.");
  return w;
}
export async function update(id: string, patch: Partial<LocalWallet>) {
  const all = db();
  const w = all.find((w) => w.id === id);
  if (!w) throw new Error("Wallet no longer exists.");
  Object.assign(w, patch);
  await persist(all);
}
export async function add(
  mode: "create" | "phrase" | "file",
  name: string,
  password: string,
  source = "",
  count = 1,
  plain = false,
) {
  if (!name.trim() || name.length > 40)
    throw new Error("Use a wallet name between 1 and 40 characters.");
  const all = db();
  if (all.length >= 20)
    throw new Error("This browser supports up to 20 wallets.");
  const result = await core(
    mode === "create"
      ? "create"
      : mode === "phrase"
        ? "restorePhrase"
        : plain
          ? "importPlain"
          : "import",
    mode === "file"
      ? { file: source, password }
      : { password, count, ...(mode === "phrase" ? { phrase: source } : {}) },
  );
  if (all.some((w) => w.meta.address === result.meta.address))
    throw new Error("This wallet is already saved in this browser.");
  const w: LocalWallet = {
    id: crypto.randomUUID(),
    name: name.trim(),
    file: result.file,
    meta: result.meta,
    backedUp: mode !== "create" && !plain,
    scanIncomplete: mode === "phrase",
  };
  await persist([...all, w]);
  return { ...w, phrase: result.phrase };
}
export async function download(text: string, name: string) {
  if (platform()) {
    if (!(await platform()!.download(text, name)))
      throw new Error("File export canceled.");
    return;
  }
  const url = URL.createObjectURL(
    new Blob([text + "\n"], { type: "application/octet-stream" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function readFile(file: File, max = 32 * 1024 * 1024) {
  if (file.size > max) throw new Error("The selected file is too large.");
  return file.text();
}
export async function backup(id: string) {
  const w = wallet(id);
  const parsed = JSON.parse(w.file);
  await download(
    w.meta.legacy ? parsed.encrypted : w.file,
    w.meta.legacy ? "requant-wallet.key" : "requant-wallet.json",
  );
  await update(id, { backedUp: true });
}
export async function watchCopy(id: string) {
  const out = await core("watch", { file: wallet(id).file });
  await download(out.file, "requant-watch-only.json");
}
async function mapLimit<T, R>(
  items: T[],
  fn: (v: T) => Promise<R>,
  limit = 3,
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const n = i++;
        result[n] = await fn(items[n]);
      }
    }),
  );
  return result;
}
export async function rpc(method: string, params: unknown[] = []) {
  await rpcSlot();
  try {
    if (platform()?.rpc) {
      const raw = await platform()!.rpc!(method, params);
      return { raw, result: await core("rpc", { raw }) };
    }
    let r: Response;
    try {
      r = await fetch("/wallet-api/v1/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, params }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error("The testnet node is unavailable. Try again later.");
    }
    if (!r.ok)
      throw new Error(
        r.status === 429
          ? "Too many requests. Wait a minute and refresh."
          : "The testnet node is unavailable.",
      );
    const reader = r.body!.getReader();
    let length = 0;
    const parts: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 4 * 1024 * 1024)
          throw new Error("Node response is too large.");
        parts.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const b = new Uint8Array(length);
    let offset = 0;
    for (const p of parts) {
      b.set(p, offset);
      offset += p.length;
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(b);
    return { raw, result: await core("rpc", { raw }) };
  } finally {
    releaseRpc();
  }
}
export async function info() {
  const [i, g] = await Promise.all([rpc("getinfo"), rpc("getblock", [0])]);
  return core("info", { raw: i.raw, genesis: g.raw });
}
export async function snapshot(id: string): Promise<Snapshot> {
  const w = wallet(id),
    before = await info();
  const groups: Address[][] = [];
  for (let i = 0; i < w.meta.addresses.length; i += 200)
    groups.push(w.meta.addresses.slice(i, i + 200));
  const batches = (
    await mapLimit(
      groups,
      async (group) => {
        const owners = group.map((a) => a.owner);
        const [coins, history] = await Promise.all([
          rpc("utxos", [owners]),
          rpc("history", [owners, 200]),
        ]);
        if (!Array.isArray(coins.result) || !Array.isArray(history.result))
          throw new Error("Invalid batch wallet response.");
        return owners.map((owner) => {
          if (
            [...coins.result, ...history.result].some(
              (r: any) => !owners.includes(r.owner),
            )
          )
            throw new Error("Node returned an unknown address.");
          const c = coins.result.filter((r: any) => r.owner === owner),
            h = history.result.filter((r: any) => r.owner === owner);
          return {
            owner,
            coins: {
              result: c,
              raw: JSON.stringify({ result: c, error: null }),
            },
            history: { result: h },
          };
        });
      },
      2,
    )
  ).flat();
  const after = await info();
  if (before.tip !== after.tip)
    throw new Error("The chain changed during refresh. Refresh again.");
  let confirmed = 0n,
    pending = 0n,
    maturing = 0n;
  const events = new Map<string, any>();
  const outputs: any[] = [];
  const used: string[] = [];
  for (const b of batches) {
    if (!Array.isArray(b.coins.result) || !Array.isArray(b.history.result))
      throw new Error("Invalid node wallet data.");
    if (b.coins.result.length || b.history.result.length) used.push(b.owner);
    for (const c of b.coins.result) {
      const amount = BigInt(c.value);
      if (amount <= 0n || amount > 2n ** 63n)
        throw new Error("Invalid node output amount.");
      if (c.confirmed && c.spendable) confirmed += amount;
      else if (!c.confirmed) pending += amount;
      else maturing += amount;
      outputs.push({ ...c, owner: b.owner });
    }
    for (const e of b.history.result) {
      if (!/^[a-f0-9]{64}$/.test(e.txid))
        throw new Error("Invalid node transaction ID.");
      const old = events.get(e.txid);
      events.set(e.txid, {
        ...e,
        received: String(
          BigInt(e.received) + (old ? BigInt(old.received) : 0n),
        ),
        sent: String(BigInt(e.sent) + (old ? BigInt(old.sent) : 0n)),
      });
    }
  }
  if (confirmed + pending + maturing > 2n ** 63n)
    throw new Error("Wallet balance exceeds the consensus limit.");
  return {
    confirmed: rqt(confirmed),
    pending: rqt(pending),
    maturing: rqt(maturing),
    observedAt: Date.now(),
    info: after,
    events: [...events.values()].sort(
      (a, b) => Number(b.time || 0) - Number(a.time || 0),
    ),
    coins: outputs,
    used,
    coinBatches: batches.map((b) => ({ owner: b.owner, raw: b.coins.raw })),
  };
}
export async function scan(
  id: string,
  password: string,
  onProgress: (message: string) => void,
) {
  const start = generation;
  let used = new Set<string>();
  for (let i = 0; i < 100; i++) {
    onProgress("Scanning receive and change addresses…");
    const w = wallet(id);
    const s = await snapshot(id);
    if (start !== generation)
      throw new Error(
        "Recovery scan paused because the signing session was locked.",
      );
    for (const owner of s.used) used.add(owner);
    const out = await core("scan", { file: w.file, password, used: [...used] });
    await update(id, { file: out.file, meta: out.meta, scanIncomplete: true });
    if (out.meta.addresses.length === w.meta.addresses.length) {
      await update(id, { scanIncomplete: false });
      return s;
    }
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
  throw new Error(
    "Recovery scan is incomplete. Continue the scan in Settings.",
  );
}
export async function prepare(
  id: string,
  payments: { address: string; amount: string }[],
  rate: number,
  mode = "payment",
): Promise<Plan> {
  const w = wallet(id);
  const s = await snapshot(id);
  const request = {
    file: w.file,
    coins: s.coinBatches,
    payments,
    rate,
    mode,
    recipient: payments[0]?.address,
  };
  const selected = await core("plan", request);
  const parents: Record<string, string> = {};
  const ids = [
    ...new Set<string>(selected.inputs.map((c: { txid: string }) => c.txid)),
  ];
  for (let start = 0; start < ids.length; start += 100) {
    const batch = await rpc("gettxbatch", [ids.slice(start, start + 100)]);
    for (const item of batch.result) parents[item.txid] = item.raw;
  }
  if ((await info()).tip !== s.info.tip)
    throw new Error("The chain changed. Review a fresh payment.");
  const result = await core("plan", {
    file: w.file,
    coins: s.coinBatches,
    parents,
    payments,
    rate,
    mode,
    recipient: payments[0]?.address,
  });
  await update(id, {
    file: result.file,
    meta: await core("metadata", { file: result.file }),
  });
  return { ...result, walletId: id, created: Date.now(), tip: s.info.tip };
}
export async function sign(id: string, unsigned: string, password: string) {
  return core<{ hex: string; txid: string; review: Review }>("sign", {
    file: wallet(id).file,
    unsigned,
    password,
  });
}
export async function fresh(plan: Plan) {
  if (Date.now() - plan.created > 120000)
    throw new Error("Payment review expired. Prepare it again.");
  const s = await snapshot(plan.walletId);
  for (const i of plan.inputs) {
    if (
      !s.coins.some(
        (c) =>
          c.txid === i.txid &&
          Number(c.vout) === i.vout &&
          c.owner === i.owner &&
          c.value === i.value &&
          c.confirmed &&
          c.spendable,
      )
    )
      throw new Error(
        "A selected coin changed. Prepare and review the payment again.",
      );
  }
}
const OUTBOX = "requant.web.outbox.v1";
export function outbox(): any[] {
  try {
    return JSON.parse(storage.read(OUTBOX));
  } catch {
    return [];
  }
}
export async function broadcast(signed: { hex: string; txid: string }) {
  const validated = await core("signed", { hex: signed.hex });
  if (validated.txid !== signed.txid)
    throw new Error("Signed transaction ID mismatch.");
  if (validated.locks.activationHeight > 0)
    await checkConditionBroadcast(signed.hex);
  let list = outbox().filter((x) => x.txid !== signed.txid);
  list.unshift({ ...signed, status: "Broadcast pending", created: Date.now() });
  await storage.write(OUTBOX, JSON.stringify(list.slice(0, 20)));
  try {
    await info();
    const r = await rpc("sendtx", [signed.hex]);
    if (r.result !== signed.txid)
      throw new Error("Transaction response mismatch.");
    list[0].status = "Pending";
    await storage.write(OUTBOX, JSON.stringify(list.slice(0, 20)));
    return signed.txid;
  } catch {
    list[0].status = "Broadcast status unknown";
    await storage.write(OUTBOX, JSON.stringify(list.slice(0, 20)));
    throw new Error(
      "Broadcast status is unknown. Check the transaction ID in the explorer before retrying.",
    );
  }
}

export async function importSigned(hex: string) {
  const first = await core("signed", { hex });
  const ids = [...new Set<string>(first.inputs)];
  const parents: Record<string, string> = {};
  for (let start = 0; start < ids.length; start += 100) {
    const batch = await rpc("gettxbatch", [ids.slice(start, start + 100)]);
    for (const item of batch.result) parents[item.txid] = item.raw;
  }
  return core<{ hex: string; txid: string; review: Review }>("signed", {
    hex,
    parents,
  });
}

async function conditionParents(ids: string[]) {
  ids = [...new Set(ids)];
  const parents: Record<string, string> = {};
  for (let start = 0; start < ids.length; start += 100) {
    const batch = await rpc("gettxbatch", [
      [...new Set(ids)].slice(start, start + 100),
    ]);
    for (const item of batch.result) parents[item.txid] = item.raw;
  }
  return parents;
}
export async function prepareCondition(
  args: Record<string, unknown>,
  owner: string,
) {
  const node = await info();
  const coins = [{ owner, raw: (await rpc("utxos", [owner])).raw }];
  const first = await core("contractPrepare", { ...args, coins });
  const parents = await conditionParents(first.inputs.map((i: any) => i.txid));
  if ((await info()).tip !== node.tip)
    throw new Error("The chain changed. Prepare a fresh condition payment.");
  return core<{ payment: string; review: Review }>("contractPrepare", {
    ...args,
    coins,
    parents,
  });
}
export async function inspectCondition(payment: string, online = true) {
  const first = await core("contractInspect", { payment });
  if (!first.inputs)
    return first as { payment: string; review: Review; partial: boolean };
  if (!online)
    throw new Error(
      "This CLI partial file needs verified parent transactions. Load it online before moving to the offline signer.",
    );
  await info();
  return core<{ payment: string; review: Review; partial: boolean }>(
    "contractInspect",
    { payment, parents: await conditionParents(first.inputs) },
  );
}
export async function conditionPublicKey(
  id: string,
  address: string,
  password: string,
) {
  return core<{ address: string; pubkey: string }>("pubkey", {
    file: wallet(id).file,
    address,
    password,
  });
}
export async function signCondition(
  id: string,
  payment: string,
  password: string,
) {
  return core<{
    hex?: string;
    txid?: string;
    partial?: string;
    review: Review;
  }>("contractSign", { file: wallet(id).file, payment, password });
}
export async function checkConditionBroadcast(hex: string) {
  const tx = await core("signed", { hex });
  const node = await info();
  const next = BigInt(node.height) + 1n;
  if (next < BigInt(tx.locks.activationHeight))
    throw new Error(
      `This transaction activates at testnet block ${tx.locks.activationHeight}. Current height: ${node.height}.`,
    );
  for (const i of tx.details) {
    const response = await rpc("utxos", [i.owner]);
    const coin = response.result.find(
      (c: any) => c.txid === i.txid && String(c.vout) === String(i.vout),
    );
    if (!coin || !coin.confirmed || !coin.spendable)
      throw new Error(
        "A source output is spent, unconfirmed or immature. Prepare a fresh payment.",
      );
    if (
      next < BigInt(i.afterHeight) ||
      next < BigInt(coin.height) + BigInt(i.afterBlocks)
    )
      throw new Error(
        "This payment is still time locked. Keep the signed file and broadcast after its locks expire.",
      );
  }
  return importSigned(hex);
}
