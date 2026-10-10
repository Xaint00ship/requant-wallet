import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Plus,
  Copy,
  Check,
  RefreshCw,
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  Wallet,
  Send,
  ContactRound,
  Layers,
  Activity,
  Settings,
  FileDown,
  FileUp,
  Globe,
  ChevronRight,
  ExternalLink,
  X,
  Trash2,
  AlertCircle,
  ScanLine,
} from "lucide-react";
import QRCode from "qrcode";
import Conditions from "./Conditions";
import * as api from "./service";
import { rqt, short } from "../../src/amounts.mjs";
import { platform, site } from "./platform";
import { useWebUpdates } from "./updates";
type View =
  | "wallet"
  | "send"
  | "receive"
  | "addresses"
  | "coins"
  | "activity"
  | "offline"
  | "conditions"
  | "settings";
type Modal =
  | "newAddress"
  | "phrase"
  | "password"
  | "scan"
  | "signOffline"
  | "broadcast"
  | "transaction"
  | null;
const nav: { id: View; name: string; icon: typeof Wallet }[] = [
  { id: "wallet", name: "Wallet", icon: Wallet },
  { id: "send", name: "Send RQT", icon: Send },
  { id: "addresses", name: "Addresses", icon: ContactRound },
  { id: "coins", name: "Coins", icon: Layers },
  { id: "activity", name: "Activity", icon: Activity },
  { id: "offline", name: "Offline signing", icon: ShieldCheck },
  { id: "conditions", name: "Conditions", icon: ShieldCheck },
];
const titles: Record<View, [string, string]> = {
  wallet: ["Your wallet", "A clear view of your Requant testnet wallet."],
  send: ["Send RQT", "Send to one or more recipients. Review before signing."],
  receive: ["Receive RQT", "Share a receive address from your wallet."],
  addresses: [
    "Wallet addresses",
    "Receive and change addresses derived from your recovery phrase.",
  ],
  coins: ["Your coins", "Inspect unspent outputs and their availability."],
  activity: ["Activity", "Payments, mining rewards and network confirmations."],
  offline: [
    "Offline signing",
    "Prepare online. Sign offline. Broadcast online.",
  ],
  conditions: [
    "Spending conditions",
    "Create conditions. Review payments. Sign and cosign locally.",
  ],
  settings: [
    "Wallet settings",
    "Backup, recovery and your connection to the testnet.",
  ],
};
function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={primary ? "button primary" : "button"}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Status({ children }: { children: ReactNode }) {
  return (
    <span className="status">
      <span />
      {children}
    </span>
  );
}
function Amount({
  value = "—",
  large = false,
}: {
  value?: string;
  large?: boolean;
}) {
  return (
    <span className={large ? "amount large" : "amount"}>
      {value}
      <small> RQT</small>
    </span>
  );
}
function ReviewRows({
  review,
  totalLabel = "Total debited",
}: {
  review: api.Review;
  totalLabel?: string;
}) {
  return (
    <>
      {review.locks && (
        <div className="notice">
          <strong>Spending conditions</strong>
          <br />
          Activation: block {review.locks.activationHeight} · Absolute lock:{" "}
          {review.locks.afterHeight} · Relative lock: {review.locks.afterBlocks}{" "}
          blocks
          <br />
          {review.locks.anyoneCanPay
            ? "Anyone-can-pay permits additional inputs. "
            : ""}
          {review.locks.revealsSecret
            ? "This transaction reveals the HTLC secret."
            : ""}
        </div>
      )}
      <div className="review-outputs">
        {review.outputs.map((o, i) => (
          <div key={i} className="review-output">
            <span className="label">
              {o.change ? "Change to your wallet" : `Recipient ${i + 1}`}
            </span>
            <span className="full-address">{o.address}</span>
            <Amount value={o.amount} />
          </div>
        ))}
      </div>
      <div className="summary-line">
        <span>Network fee</span>
        <Amount value={review.fee} />
      </div>
      <div className="summary-line">
        <span>Inputs</span>
        <span>{review.inputCount}</span>
      </div>
      <div className="total">
        <span>{totalLabel}</span>
        <Amount large value={review.total} />
      </div>
    </>
  );
}
export default function App() {
  const [wallets, setWallets] = useState<api.PublicWallet[]>(() => {
      try {
        return api.list();
      } catch {
        return [];
      }
    }),
    [selected, setSelected] = useState(() => {
      try {
        return api.list()[0]?.id || "";
      } catch {
        return "";
      }
    }),
    [view, setView] = useState<View>("wallet");
  const [snapshot, setSnapshot] = useState<api.Snapshot | null>(null),
    [node, setNode] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  const [setup, setSetup] = useState<null | "create" | "phrase" | "file">(
      wallets.length ? null : "create",
    ),
    [name, setName] = useState("My Requant wallet"),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [source, setSource] = useState(""),
    [fileName, setFileName] = useState(""),
    [scanOnRestore, setScanOnRestore] = useState(true);
  const [phrase, setPhrase] = useState(""),
    [reveal, setReveal] = useState(false),
    [backed, setBacked] = useState(false),
    [receive, setReceive] = useState(""),
    [qr, setQr] = useState("");
  const [payments, setPayments] = useState([{ address: "", amount: "" }]),
    [rate, setRate] = useState("5"),
    [feeTarget, setFeeTarget] = useState(3),
    [estimateAvailable, setEstimateAvailable] = useState(false),
    [mode, setMode] = useState("payment"),
    [plan, setPlan] = useState<api.Plan | null>(null),
    [result, setResult] = useState("");
  const [modal, setModal] = useState<Modal>(null),
    [offline, setOffline] = useState(""),
    [offlineName, setOfflineName] = useState(""),
    [offlineReview, setOfflineReview] = useState<api.Review | null>(null),
    [signed, setSigned] = useState<{
      hex: string;
      txid: string;
      review?: api.Review;
    } | null>(null);
  const [copied, setCopied] = useState(""),
    [updates, setUpdates] = useState(0);
  const [lockTick, setLockTick] = useState(0),
    [toolsOpen, setToolsOpen] = useState(false),
    [transaction, setTransaction] = useState<any>(null);
  const [addressCount, setAddressCount] = useState("1"),
    [knownCount, setKnownCount] = useState("1"),
    [addressPage, setAddressPage] = useState(0);
  const [legacyPlain, setLegacyPlain] = useState(false);
  const [endpoint, setEndpoint] = useState(""),
    [savedEndpoint, setSavedEndpoint] = useState("");
  useEffect(() => {
    void platform()
      ?.settings?.()
      .then((v) => {
        setEndpoint(v.endpoint);
        setSavedEndpoint(v.endpoint);
      });
  }, []);
  const actionRunning = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const epoch = useRef(0);
  const current = wallets.find((w) => w.id === selected);
  const reload = () => {
    setWallets(api.list());
    setUpdates((v) => v + 1);
  };
  const clear = () => {
    epoch.current++;
    setLockTick((v) => v + 1);
    api.lock();
    setPassword("");
    setConfirm("");
    setPhrase("");
    setSource("");
    setReveal(false);
    setPlan(null);
    setOfflineReview(null);
    setSigned(null);
    setModal(null);
    setNotice("Signing session locked.");
  };
  const updateBlocked =
    toolsOpen ||
    syncing ||
    !!busy ||
    !!setup ||
    !!phrase ||
    !!modal ||
    !!plan ||
    !!signed ||
    !!offlineReview ||
    view === "send" ||
    view === "offline" ||
    view === "conditions" ||
    !!password ||
    !!source;
  const walletUpdate = useWebUpdates(
    updateBlocked,
    clear,
    () => {
      clear();
      setBusy("Updating wallet…");
    },
    () => setBusy(""),
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(clear, 5 * 60000);
    };
    const hidden = () => {
      if (document.hidden && !platform()?.fileDialogOpen?.()) clear();
    };
    touch();
    document.addEventListener("pointerdown", touch);
    document.addEventListener("keydown", touch);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", touch);
      document.removeEventListener("keydown", touch);
      document.removeEventListener("visibilitychange", hidden);
      api.lock();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    api
      .info()
      .then((v) => {
        if (alive) setNode(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    setSnapshot(null);
    setReceive("");
    setPlan(null);
    setResult("");
    if (!selected) return;
    let alive = true;
    setSyncing(true);
    api
      .snapshot(selected)
      .then((s) => {
        if (alive) {
          setSnapshot(s);
          setNode(s.info);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setSyncing(false);
      });
    return () => {
      alive = false;
    };
  }, [selected]);
  const address = receive || current?.meta.address || "";
  useEffect(() => {
    let alive = true;
    setQr("");
    if (address)
      QRCode.toDataURL(address, {
        width: 240,
        margin: 2,
        color: { dark: "#20231f", light: "#ffffff" },
        errorCorrectionLevel: "M",
      }).then((v) => {
        if (alive) setQr(v);
      });
    return () => {
      alive = false;
    };
  }, [address]);
  async function task(label: string, fn: () => Promise<void>) {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setError("");
    setNotice("");
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This action could not be completed.",
      );
    } finally {
      actionRunning.current = false;
      setBusy("");
    }
  }
  async function refresh() {
    await task("Refreshing wallet…", async () => {
      const s = await api.snapshot(selected);
      setSnapshot(s);
      setNode(s.info);
      reload();
    });
  }
  async function showTransaction(txid: string) {
    await task("Loading transaction…", async () => {
      await api.info();
      const reply = await api.rpc("gettx", [txid]);
      const tx = await api.core("transaction", { raw: reply.raw, txid });
      setTransaction(tx);
      setModal("transaction");
    });
  }
  async function copy(text: string) {
    try {
      if (platform()?.copy) await platform()!.copy!(text);
      else await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      setError("Clipboard unavailable. Select and copy the full address.");
    }
  }
  async function create() {
    await task(
      setup === "create"
        ? "Creating your wallet locally…"
        : "Restoring your wallet locally…",
      async () => {
        if ((setup !== "file" || legacyPlain) && password !== confirm)
          throw new Error("The passwords do not match.");
        const entered = password;
        setPassword("");
        setConfirm("");
        const w = await api.add(
          setup!,
          name,
          entered,
          source,
          Number(knownCount),
          legacyPlain,
        );
        setSource("");
        setFileName("");
        reload();
        setSelected(w.id);
        setSetup(null);
        if (w.phrase) {
          setPhrase(w.phrase);
          setBacked(false);
          setReveal(false);
        } else if (setup === "phrase" && scanOnRestore) {
          try {
            await api.scan(w.id, entered, setBusy);
            reload();
            setNotice("Recovery scan complete.");
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Recovery scan incomplete. Continue in Settings.",
            );
          }
        }
        setView("wallet");
      },
    );
  }
  async function estimate(target: number) {
    setFeeTarget(target);
    try {
      const r = await api.rpc("estimatefee", [target]);
      const value =
        r.result.feerate ?? r.result.atoms_per_byte ?? r.result.rate;
      if (value && /^\d+$/.test(String(value))) {
        setRate(String(value));
        setEstimateAvailable(true);
      } else setEstimateAvailable(false);
    } catch {
      setEstimateAvailable(false);
    }
  }
  async function prepare(nextMode = mode) {
    await task("Verifying coins and preparing payment…", async () => {
      if (!current?.backedUp)
        throw new Error(
          "Save an encrypted wallet backup before preparing a payment.",
        );
      const p = await api.prepare(selected, payments, Number(rate), nextMode);
      setPlan(p);
      setPassword("");
      reload();
    });
  }
  async function send() {
    if (!plan) return;
    const entered = password,
      start = epoch.current;
    setPassword("");
    await task("Checking coins and signing locally…", async () => {
      await api.fresh(plan);
      if (start !== epoch.current)
        throw new Error("Signing session locked. Review again.");
      const tx = await api.sign(selected, plan.unsigned, entered);
      setSigned(tx);
      try {
        const id = await api.broadcast(tx);
        setResult(id);
        setPlan(null);
        setNotice(
          "Payment broadcast. Track its confirmations in the explorer.",
        );
      } catch (e) {
        setPlan(null);
        setResult(tx.txid);
        throw e;
      }
      reload();
    });
  }
  async function protectedAction() {
    const entered = password,
      next = confirm;
    setPassword("");
    setConfirm("");
    await task("Working locally…", async () => {
      const w = api.wallet(selected);
      if (modal === "newAddress") {
        const out = await api.core("nextAddress", {
          file: w.file,
          password: entered,
          count: Number(addressCount),
        });
        await api.update(selected, { file: out.file, meta: out.meta });
        const a = out.meta.addresses
          .filter((a: api.Address) => a.chain === 0 && a.issued)
          .at(-1);
        setReceive(a.address);
        setModal(null);
        reload();
        setView("receive");
      } else if (modal === "phrase") {
        const out = await api.core("phrase", {
          file: w.file,
          password: entered,
        });
        setPhrase(out.phrase);
        setReveal(false);
        setModal(null);
        setBacked(true);
      } else if (modal === "password") {
        const out = await api.core("changePassword", {
          file: w.file,
          password: entered,
          nextPassword: next,
        });
        await api.update(selected, { file: out.file, backedUp: false });
        setModal(null);
        reload();
        setNotice("Local password changed. Save a new encrypted backup.");
      } else if (modal === "scan") {
        await api.scan(selected, entered, setBusy);
        reload();
        setModal(null);
        setNotice("Recovery scan complete.");
      } else if (modal === "signOffline") {
        const out = await api.core("reviewOffline", {
          file: w.file,
          unsigned: offline,
          password: entered,
        });
        setOfflineReview(out.review);
        setModal(null);
      }
    });
  }
  async function offlineSign() {
    const entered = password;
    setPassword("");
    await task("Signing payment locally…", async () => {
      const tx = await api.sign(selected, offline, entered);
      await api.download(tx.hex, "requant-signed-payment.txt");
      setOfflineReview(null);
      setNotice(
        "Signed payment exported. Move it to your online device to broadcast.",
      );
      api.lock();
    });
  }
  const canSend = !!current && !current.meta.watchOnly && current.backedUp;
  const goto = (v: View) => {
    if (v === "send") setMode("payment");
    setSource("");
    setConfirm("");
    setView(v);
    setPlan(null);
    setSigned(null);
    setPassword("");
    setOfflineReview(null);
    setError("");
    setResult("");
  };
  const issued = current?.meta.addresses.filter((a) => a.issued) || [];
  const fileInput = (
    label: string,
    onRead: (text: string, name: string) => void,
    max?: number,
  ) =>
    platform()?.pick ? (
      <button
        className="file-picker"
        disabled={!!busy}
        onClick={() =>
          void task("Opening wallet file…", async () => {
            const file = await platform()!.pick!(max ?? 32 * 1024 * 1024);
            if (file) onRead(file.text, file.name);
          })
        }
      >
        <FileUp size={18} />
        <span>{label}</span>
      </button>
    ) : (
      <label className="file-picker">
        <FileUp size={18} />
        <span>{label}</span>
        <input
          type="file"
          accept=".json,.key,.txt,application/json,text/plain"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              api
                .readFile(file, max)
                .then((text) => onRead(text, file.name))
                .catch((e) => setError(e.message));
            e.target.value = "";
          }}
        />
      </label>
    );
  function empty(text: string) {
    return (
      <div className="empty-state">
        <Layers size={24} />
        <p>{text}</p>
      </div>
    );
  }
  function activity() {
    const events = snapshot?.events || [];
    return events.length ? (
      <div className="transaction-list">
        {events.map((e) => {
          const net = BigInt(e.received) - BigInt(e.sent);
          return (
            <a
              key={e.txid}
              className="transaction"
              onClick={(event) => {
                event.preventDefault();
                void showTransaction(e.txid);
              }}
              href={`https://requant.network/explorer/tx/${e.txid}`}
              target="_blank"
              rel="noreferrer"
            >
              <div
                className={`transaction-icon ${net >= 0n ? "incoming" : ""}`}
              >
                {net >= 0n ? (
                  <ArrowDownLeft size={18} />
                ) : (
                  <ArrowUpRight size={18} />
                )}
              </div>
              <div className="transaction-description">
                <strong>{net >= 0n ? "Received RQT" : "Sent RQT"}</strong>
                <span>{short(e.txid, 12, 10)}</span>
              </div>
              <div className="transaction-value">
                <Amount value={(net > 0n ? "+" : "") + rqt(net)} />
                <span>
                  {e.height === null
                    ? "Pending"
                    : `${e.confirmations} confirmations`}
                </span>
              </div>
              <ChevronRight size={16} />
            </a>
          );
        })}
      </div>
    ) : (
      empty(
        snapshot
          ? "No transactions yet. Your activity will appear here."
          : "Connect to the testnet to load wallet activity.",
      )
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="https://requant.network/">
          <img
            src={platform() ? "./requant-mark.svg" : "/wallet/requant-mark.svg"}
            alt="Requant"
          />
          <span>
            <strong>REQUANT</strong>
            <small>
              {platform()?.kind === "extension"
                ? "BROWSER WALLET"
                : platform()
                  ? "WALLET"
                  : platform()?.kind === "extension"
                    ? "BROWSER WALLET"
                    : platform()
                      ? "WALLET"
                      : "WEB WALLET"}
            </small>
          </span>
        </a>
        <div className="wallet-picker">
          <label htmlFor="wallet-select">Your wallets</label>
          <select
            id="wallet-select"
            value={selected}
            onChange={(e) => {
              clear();
              setSelected(e.target.value);
            }}
          >
            <option value="" disabled>
              Select a wallet
            </option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            aria-label="Add wallet"
            onClick={() => {
              setSetup("create");
              setName("My Requant wallet");
              setPassword("");
              setConfirm("");
              setSource("");
            }}
          >
            <Plus size={16} />
          </button>
        </div>
        <nav aria-label="Wallet navigation">
          {nav.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              className={view === id && !setup ? "nav-item active" : "nav-item"}
              aria-current={view === id && !setup ? "page" : undefined}
              onClick={() => {
                setSetup(null);
                goto(id);
              }}
              disabled={!current}
            >
              <Icon size={18} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={
              view === "settings" && !setup ? "nav-item active" : "nav-item"
            }
            onClick={() => {
              setSetup(null);
              goto("settings");
            }}
            disabled={!current}
          >
            <Settings size={18} />
            Settings
          </button>
          <button className="nav-item" onClick={clear}>
            <Lock size={18} />
            Lock signing session
          </button>
          <a
            className="nav-item"
            href="https://requant.network/docs"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={18} />
            Help & documentation
          </a>
          <div className="sidebar-note">
            Open research.
            <br />
            Stronger systems.
            <br />
            For everyone.
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <a href="https://requant.network/">
            requant.network <ArrowUpRight size={13} />
          </a>
          <Status>TESTNET</Status>
        </div>
        <header className="page-header">
          <div>
            <div className="eyebrow">
              REQUANT /{" "}
              {setup
                ? "GET STARTED"
                : current?.meta.watchOnly
                  ? "WATCH-ONLY WALLET"
                  : platform()?.kind === "extension"
                    ? "BROWSER WALLET"
                    : platform()
                      ? "WALLET"
                      : "WEB WALLET"}
            </div>
            <h1>
              {setup
                ? "Your keys. Your wallet."
                : phrase
                  ? "Back up your wallet."
                  : titles[view][0]}
            </h1>
            <p>
              {setup
                ? "Create or restore a wallet. Keys are encrypted and kept on this device."
                : phrase
                  ? "Write down all 24 words in order and keep them offline."
                  : titles[view][1]}
            </p>
          </div>
          {current && !setup && !phrase && (
            <button
              className="icon-button refresh"
              aria-label="Refresh wallet"
              onClick={refresh}
              disabled={!!busy}
            >
              <RefreshCw size={18} className={busy ? "spin" : ""} />
            </button>
          )}
        </header>
        {platform()?.updates({
          blocked: updateBlocked,
          locked: !password && !phrase && !source,
          clear,
          installing: (value) => setBusy(value ? "Updating wallet…" : ""),
          details: view === "settings",
        })}
        {walletUpdate.waiting && (
          <div className="message" role="status">
            <RefreshCw size={17} />
            <span>{walletUpdate.status}</span>
            <Button disabled={updateBlocked} onClick={walletUpdate.apply}>
              Update wallet
            </Button>
          </div>
        )}
        {busy && (
          <div className="message working" role="status">
            <RefreshCw size={17} className="spin" />
            {busy}
          </div>
        )}
        {error && (
          <div className="message error" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            <ShieldCheck size={17} />
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notice"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {setup ? (
          <div className="setup-grid">
            <section className="panel setup-panel">
              <div className="tabs">
                {(["create", "phrase", "file"] as const).map((m) => (
                  <button
                    key={m}
                    className={setup === m ? "selected" : ""}
                    onClick={() => {
                      setSetup(m);
                      setPassword("");
                      setConfirm("");
                      setSource("");
                      setFileName("");
                    }}
                  >
                    {m === "create"
                      ? "Create wallet"
                      : m === "phrase"
                        ? "Restore phrase"
                        : "Import backup"}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  create();
                }}
              >
                <Field label="Wallet name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={40}
                    autoComplete="off"
                    required
                  />
                </Field>
                {setup === "phrase" && (
                  <Field label="24-word recovery phrase">
                    <textarea
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      rows={4}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="Enter all 24 English words in order"
                      required
                    />
                  </Field>
                )}
                {setup === "file" && (
                  <>
                    {fileInput(
                      "Choose encrypted wallet or watch-only backup",
                      (text, name) => {
                        setSource(text);
                        setFileName(name);
                      },
                    )}
                    {fileName && (
                      <div className="file-name">
                        <Check size={16} />
                        {fileName}
                      </div>
                    )}
                    <p className="subtle">
                      Supports Requant 0.4+ wallet JSON, watch-only JSON and
                      encrypted legacy key files.
                    </p>
                  </>
                )}
                <Field
                  label={
                    setup === "file"
                      ? legacyPlain
                        ? "New local password for the imported key"
                        : "Backup password (leave empty for watch-only)"
                      : "Local wallet password"
                  }
                >
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={
                      setup === "file" && !legacyPlain ? undefined : 12
                    }
                    maxLength={256}
                    autoComplete="new-password"
                    required={setup !== "file" || legacyPlain}
                  />
                </Field>
                {(setup !== "file" || legacyPlain) && (
                  <Field label="Confirm local password">
                    <input
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </Field>
                )}
                {(setup === "create" || setup === "phrase") && (
                  <Field label="Receive address count · 1 to 100,000">
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={knownCount}
                      onChange={(e) => setKnownCount(e.target.value)}
                      required
                    />
                    <small>
                      For restoration, enter the number of addresses you
                      previously issued. Gap scanning also checks used receive
                      and change addresses.
                    </small>
                  </Field>
                )}
                {setup === "file" && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={legacyPlain}
                      onChange={(e) => setLegacyPlain(e.target.checked)}
                    />
                    Import a plain legacy key and encrypt it with this new
                    password
                  </label>
                )}
                {setup === "phrase" && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={scanOnRestore}
                      onChange={(e) => setScanOnRestore(e.target.checked)}
                    />
                    Scan used addresses after restoring
                  </label>
                )}
                <div className="form-actions">
                  <Button
                    type="submit"
                    primary
                    disabled={!!busy || (setup === "file" && !source)}
                  >
                    {setup === "create"
                      ? "Create wallet locally"
                      : "Restore wallet"}
                    <ArrowRight size={16} />
                  </Button>
                  {current && (
                    <Button
                      onClick={() => {
                        setSetup(null);
                        setSource("");
                        setPassword("");
                        setConfirm("");
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </section>
            <aside className="setup-aside">
              <div className="signal-art" aria-hidden="true">
                <div className="signal-block one" />
                <div className="signal-block two" />
                <div className="signal-block three" />
                <div className="art-caption">RESEARCH. BUILD. VERIFY.</div>
              </div>
              <div className="privacy-note">
                <ShieldCheck size={21} />
                <div>
                  <h2>Locally encrypted.</h2>
                  <p>
                    Your password and recovery phrase stay on your device. The
                    node receives public addresses and signed transactions.
                  </p>
                </div>
              </div>
              <div className="testnet-note">
                Testnet coins have no value. This network may be reset.
              </div>
            </aside>
          </div>
        ) : phrase ? (
          <section className="panel backup-panel">
            <div className="panel-heading">
              <h2>24-word recovery phrase</h2>
              <Button onClick={() => setReveal(!reveal)}>
                {reveal ? <EyeOff size={16} /> : <Eye size={16} />}{" "}
                {reveal ? "Hide phrase" : "Reveal phrase"}
              </Button>
            </div>
            <div className="phrase-grid">
              {phrase.split(" ").map((word, i) => (
                <div key={i}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <strong>{reveal ? word : "••••••••"}</strong>
                </div>
              ))}
            </div>
            <p className="subtle">
              Anyone with this phrase can spend your coins. Requant will never
              ask you to share it.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={backed}
                onChange={(e) => setBacked(e.target.checked)}
              />
              I have stored my recovery phrase safely offline.
            </label>
            <div className="form-actions">
              <Button
                onClick={() =>
                  void task("Saving encrypted backup…", async () => {
                    await api.backup(selected);
                    reload();
                    setNotice(
                      "Encrypted backup downloaded. Keep it with your local password.",
                    );
                  })
                }
              >
                <FileDown size={16} />
                Save encrypted backup
              </Button>
              <Button
                primary
                disabled={!backed || !!busy}
                onClick={() =>
                  void task("Saving backup confirmation…", async () => {
                    await api.update(selected, { backedUp: true });
                    setPhrase("");
                    setReveal(false);
                    reload();
                    setView("wallet");
                  })
                }
              >
                Continue to wallet
                <ArrowRight size={16} />
              </Button>
            </div>
          </section>
        ) : current ? (
          <>
            {!current.backedUp && (
              <div className="message warning">
                <ShieldCheck size={18} />
                <span>Back up this wallet before making payments.</span>
                <Button
                  onClick={() =>
                    void task("Saving encrypted backup…", async () => {
                      await api.backup(selected);
                      reload();
                    })
                  }
                >
                  Save encrypted backup
                </Button>
              </div>
            )}
            {current.scanIncomplete && (
              <div className="message warning">
                <ScanLine size={18} />
                <span>
                  Recovery scan is incomplete. Continue it in Settings to find
                  all used addresses.
                </span>
              </div>
            )}
            {view === "wallet" && (
              <>
                <div className="overview-grid">
                  <section className="panel balance-panel">
                    <div className="panel-heading">
                      <span className="label">Confirmed & spendable</span>
                      <span className="wallet-type">
                        {current.meta.watchOnly
                          ? "Watch-only"
                          : current.meta.legacy
                            ? "Legacy key"
                            : "Phrase wallet"}
                      </span>
                    </div>
                    <Amount large value={snapshot?.confirmed} />
                    <div className="balance-breakdown">
                      <div>
                        <span>Pending</span>
                        <Amount value={snapshot?.pending} />
                      </div>
                      <div>
                        <span>Maturing</span>
                        <Amount value={snapshot?.maturing} />
                      </div>
                    </div>
                    <div className="form-actions">
                      <Button
                        primary
                        onClick={() => goto("send")}
                        disabled={!canSend}
                      >
                        <Send size={17} />
                        Send RQT
                      </Button>
                      <Button onClick={() => goto("receive")}>
                        <ArrowDownLeft size={17} />
                        Receive
                      </Button>
                    </div>
                  </section>
                  <section className="panel receive-preview">
                    <div className="panel-heading">
                      <h2>Receive RQT</h2>
                      <ArrowDownLeft size={18} />
                    </div>
                    <div className="address-preview">
                      {short(address, 20, 12)}
                    </div>
                    <p className="subtle">
                      Receive only Requant testnet coins at this address.
                    </p>
                    <Button onClick={() => goto("receive")}>
                      Show address & QR
                      <ArrowRight size={16} />
                    </Button>
                  </section>
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Recent activity</h2>
                    <button
                      className="text-button"
                      onClick={() => goto("activity")}
                    >
                      View all
                      <ArrowRight size={15} />
                    </button>
                  </div>
                  {activity()}
                </section>
              </>
            )}
            {view === "send" && (
              <>
                {result ? (
                  <section className="panel result-panel">
                    <ShieldCheck size={32} />
                    <h2>Track your payment</h2>
                    <p>
                      Use the transaction ID to check its status before sending
                      again.
                    </p>
                    <div className="full-address">{result}</div>
                    <a
                      className="button primary"
                      href={`https://requant.network/explorer/tx/${result}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View in explorer
                      <ArrowUpRight size={16} />
                    </a>
                    <Button onClick={() => setResult("")}>New payment</Button>
                  </section>
                ) : plan ? (
                  <section className="panel review-panel">
                    <div className="panel-heading">
                      <h2>Review payment</h2>
                      <Status>TESTNET</Status>
                    </div>
                    <ReviewRows review={plan.review} />
                    {current.meta.watchOnly ? (
                      <>
                        <p className="subtle">
                          This wallet has no private keys. Export this payment
                          and sign on your offline device.
                        </p>
                        <Button
                          primary
                          onClick={() =>
                            void task(
                              "Exporting unsigned payment…",
                              async () => {
                                await api.download(
                                  plan.unsigned,
                                  "requant-unsigned-payment.json",
                                );
                                setPlan(null);
                                setNotice("Unsigned payment exported.");
                              },
                            )
                          }
                        >
                          <FileDown size={16} />
                          Export unsigned payment
                        </Button>
                      </>
                    ) : (
                      <>
                        {modal === "transaction"
                          ? "Transaction details"
                          : modal === "newAddress" && (
                              <Field label="Number of receive addresses · 1 to 100,000">
                                <input
                                  type="number"
                                  min={1}
                                  max={100000}
                                  value={addressCount}
                                  onChange={(e) =>
                                    setAddressCount(e.target.value)
                                  }
                                  required
                                />
                              </Field>
                            )}
                        <Field label="Local wallet password">
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                          />
                        </Field>
                        <div className="form-actions">
                          <Button
                            onClick={() => {
                              setPlan(null);
                              setPassword("");
                            }}
                            disabled={!!busy}
                          >
                            Back
                          </Button>
                          <Button
                            primary
                            onClick={send}
                            disabled={!!busy || !password}
                          >
                            Confirm, sign & broadcast
                            <ArrowRight size={16} />
                          </Button>
                        </div>
                      </>
                    )}
                  </section>
                ) : (
                  <div className="payment-grid">
                    <div className="stack">
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>Recipients</h2>
                          <span className="subtle">
                            {payments.length} recipient
                            {payments.length > 1 ? "s" : ""}
                          </span>
                        </div>
                        {payments.map((p, i) => (
                          <div className="recipient-row" key={i}>
                            <Field label="Address">
                              <input
                                value={p.address}
                                onChange={(e) => {
                                  const next = [...payments];
                                  next[i] = {
                                    ...p,
                                    address: e.target.value.trim(),
                                  };
                                  setPayments(next);
                                }}
                                spellCheck={false}
                                autoComplete="off"
                                placeholder="Full trq1… testnet address"
                              />
                            </Field>
                            <Field label="Amount (RQT)">
                              <input
                                value={p.amount}
                                onChange={(e) => {
                                  const next = [...payments];
                                  next[i] = { ...p, amount: e.target.value };
                                  setPayments(next);
                                }}
                                inputMode="decimal"
                                placeholder="0.00000000"
                                disabled={mode === "max"}
                              />
                            </Field>
                            {payments.length > 1 && (
                              <button
                                className="icon-button"
                                aria-label={`Remove recipient ${i + 1}`}
                                onClick={() =>
                                  setPayments(
                                    payments.filter((_, n) => n !== i),
                                  )
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        ))}
                        <div className="form-actions split">
                          <Button
                            onClick={() => {
                              setMode("payment");
                              setPayments([
                                ...payments,
                                { address: "", amount: "" },
                              ]);
                            }}
                            disabled={payments.length >= 100}
                          >
                            <Plus size={16} />
                            Add recipient
                          </Button>
                          <button
                            className={`text-button ${mode === "max" ? "selected" : ""}`}
                            onClick={() => {
                              setMode(mode === "max" ? "payment" : "max");
                              setPayments([payments[0]]);
                            }}
                          >
                            Send max
                            <ArrowRight size={15} />
                          </button>
                        </div>
                      </section>
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>Network fee</h2>
                          <span className="subtle">
                            {estimateAvailable
                              ? "Estimated targets"
                              : "Manual rate"}
                          </span>
                        </div>
                        <div className="fee-options">
                          {[
                            [1, "Fast"],
                            [3, "Normal"],
                            [10, "Slow"],
                          ].map(([target, label]) => (
                            <button
                              key={target}
                              className={
                                feeTarget === target
                                  ? "fee-option selected"
                                  : "fee-option"
                              }
                              onClick={() => estimate(Number(target))}
                            >
                              <span className="radio" />
                              <strong>{label}</strong>
                              <span>
                                {target} block{target !== 1 ? "s" : ""}
                              </span>
                            </button>
                          ))}
                          <Field label="Custom · atoms/byte">
                            <input
                              value={rate}
                              onChange={(e) => {
                                setRate(e.target.value);
                                setEstimateAvailable(false);
                              }}
                              inputMode="numeric"
                            />
                          </Field>
                        </div>
                        <p className="subtle">
                          {estimateAvailable
                            ? "Confirmation targets are estimates."
                            : "This node does not provide live fee estimates. The selected rate is a manual rate."}{" "}
                          The wallet calculates the fee from transaction size,
                          with a 1,000-atom minimum.
                        </p>
                      </section>
                    </div>
                    <aside className="panel payment-aside">
                      <h2>Payment summary</h2>
                      <div className="summary-line">
                        <span>Available</span>
                        <Amount value={snapshot?.confirmed} />
                      </div>
                      <div className="summary-line">
                        <span>Recipients</span>
                        <span>{payments.length}</span>
                      </div>
                      <div className="summary-placeholder">
                        Exact fee and change appear after the wallet verifies
                        your selected coins.
                      </div>
                      <Button
                        primary
                        onClick={() => prepare()}
                        disabled={
                          !!busy ||
                          !current.backedUp ||
                          !node ||
                          !payments[0].address
                        }
                      >
                        Review payment
                        <ArrowRight size={16} />
                      </Button>
                    </aside>
                  </div>
                )}
              </>
            )}
            {view === "receive" && (
              <section className="panel receive-panel">
                <div className="receive-qr">
                  {qr ? (
                    <img
                      src={qr}
                      alt="QR code for your full Requant testnet receive address"
                    />
                  ) : (
                    <div className="qr-placeholder" />
                  )}
                </div>
                <div>
                  <span className="label">Your testnet receive address</span>
                  <div className="full-address receive-address">{address}</div>
                  <div className="form-actions">
                    <Button primary onClick={() => copy(address)}>
                      {copied === address ? (
                        <Check size={16} />
                      ) : (
                        <Copy size={16} />
                      )}
                      Copy address
                    </Button>
                    {!current.meta.legacy && !current.meta.watchOnly && (
                      <Button
                        onClick={() => {
                          setPassword("");
                          setModal("newAddress");
                        }}
                      >
                        <Plus size={16} />
                        New address
                      </Button>
                    )}
                    <a
                      className="button"
                      href={`https://requant.network/explorer/address/${address}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View in explorer
                      <ArrowUpRight size={16} />
                    </a>
                  </div>
                  {platform()?.share && (
                    <Button
                      onClick={() =>
                        void task("Sharing public address…", async () => {
                          await platform()!.share!(address);
                        })
                      }
                    >
                      Share address
                    </Button>
                  )}
                  <p className="subtle">
                    Only send RQT from the Requant testnet. This is not an
                    Ethereum address.
                  </p>
                </div>
              </section>
            )}
            {view === "addresses" && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Receive & change addresses</h2>
                  <Button
                    onClick={() => {
                      setPassword("");
                      setModal("newAddress");
                    }}
                    disabled={current.meta.legacy || current.meta.watchOnly}
                  >
                    <Plus size={16} />
                    New address
                  </Button>
                </div>
                <div className="address-table">
                  {issued
                    .slice(addressPage * 50, addressPage * 50 + 50)
                    .map((a) => (
                      <div key={a.owner} className="address-row">
                        <span className="address-kind">
                          {a.chain === 0 ? "Receive" : "Change"} {a.index + 1}
                        </span>
                        <button
                          className="address-link"
                          onClick={() => {
                            setReceive(a.address);
                            goto("receive");
                          }}
                        >
                          {short(a.address, 22, 12)}
                        </button>
                        <span>
                          {rqt(
                            (
                              snapshot?.coins.filter(
                                (c) => c.owner === a.owner,
                              ) || []
                            ).reduce((s, c) => s + BigInt(c.value), 0n),
                          )}{" "}
                          RQT
                        </span>
                        <button
                          className="icon-button"
                          aria-label={`Copy ${a.chain === 0 ? "receive" : "change"} address ${a.index + 1}`}
                          onClick={() => copy(a.address)}
                        >
                          {copied === a.address ? (
                            <Check size={16} />
                          ) : (
                            <Copy size={16} />
                          )}
                        </button>
                      </div>
                    ))}
                </div>
                <div className="form-actions">
                  <Button
                    disabled={!addressPage}
                    onClick={() => setAddressPage((v) => v - 1)}
                  >
                    Previous
                  </Button>
                  <span>
                    {issued.length} issued addresses · Page {addressPage + 1}
                  </span>
                  <Button
                    disabled={(addressPage + 1) * 50 >= issued.length}
                    onClick={() => setAddressPage((v) => v + 1)}
                  >
                    Next
                  </Button>
                  <Button
                    onClick={() =>
                      void task("Exporting receive addresses…", async () => {
                        await api.download(
                          issued
                            .filter((a) => a.chain === 0)
                            .map((a) => a.address)
                            .join("\n"),
                          "requant-deposit-addresses.txt",
                        );
                      })
                    }
                  >
                    Export deposit list
                  </Button>
                </div>
                <p className="subtle">
                  The wallet also keeps 20 lookahead addresses on each chain for
                  recovery scanning.
                </p>
              </section>
            )}
            {view === "coins" && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Unspent outputs ({snapshot?.coins.length || 0})</h2>
                  <Button
                    disabled={!canSend || !!busy || !snapshot?.coins.length}
                    onClick={() => {
                      setView("send");
                      setMode("consolidate");
                      prepare("consolidate");
                    }}
                  >
                    Consolidate
                    <Layers size={16} />
                  </Button>
                </div>
                {snapshot?.coins.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Source transaction</th>
                          <th>Amount (RQT)</th>
                          <th>Status</th>
                          <th>Output</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.coins.map((c) => (
                          <tr key={c.txid + ":" + c.vout}>
                            <td>
                              <a
                                href={`https://requant.network/explorer/tx/${c.txid}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {short(c.txid, 12, 8)}
                              </a>
                            </td>
                            <td className="numeric">{rqt(c.value)}</td>
                            <td>
                              {!c.confirmed
                                ? "Pending"
                                : c.spendable
                                  ? "Spendable"
                                  : "Maturing"}
                            </td>
                            <td>{c.vout}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  empty("No unspent outputs yet.")
                )}
                <p className="subtle">
                  Consolidation combines your smallest confirmed, spendable
                  outputs into one wallet output. Up to 600 inputs per
                  transaction.
                </p>
              </section>
            )}
            {view === "activity" && (
              <>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Transactions</h2>
                    <span className="subtle">Latest 100 per address</span>
                  </div>
                  {activity()}
                </section>
                {api.outbox().length > 0 && (
                  <section className="panel">
                    <h2>Broadcast records</h2>
                    <div className="transaction-list">
                      {api.outbox().map((tx) => (
                        <a
                          className="transaction"
                          key={tx.txid}
                          href={`https://requant.network/explorer/tx/${tx.txid}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Send size={18} />
                          <div className="transaction-description">
                            <strong>{tx.status}</strong>
                            <span>{short(tx.txid, 16, 10)}</span>
                          </div>
                          <ArrowUpRight size={16} />
                        </a>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
            {view === "conditions" && (
              <Conditions
                wallet={current}
                reset={lockTick}
                busy={!!busy}
                node={node}
                task={task}
                fund={(address) => {
                  setPayments([{ address, amount: "" }]);
                  goto("send");
                }}
              />
            )}
            {view === "offline" && (
              <>
                <div className="offline-steps">
                  <section className="panel">
                    <span className="step-number">1</span>
                    <h2>Prepare online</h2>
                    <p>
                      Prepare a payment using public wallet addresses and
                      verified source transactions.
                    </p>
                    <Button onClick={() => goto("send")}>
                      <FileDown size={16} />
                      Prepare payment
                    </Button>
                    <Button
                      onClick={() =>
                        task("Exporting watch-only wallet…", async () => {
                          await api.watchCopy(selected);
                        })
                      }
                      disabled={current.meta.legacy}
                    >
                      <Eye size={16} />
                      Export watch-only wallet
                    </Button>
                  </section>
                  <section className="panel">
                    <span className="step-number">2</span>
                    <h2>Review & sign offline</h2>
                    <p>
                      Open this wallet page before disconnecting. Import the
                      payment, check its outputs and sign locally.
                    </p>
                    {fileInput(
                      "Import unsigned payment",
                      (text, name) => {
                        setOffline(text);
                        setOfflineName(name);
                        setOfflineReview(null);
                      },
                      8 * 1024 * 1024,
                    )}
                    {offlineName && (
                      <div className="file-name">{offlineName}</div>
                    )}
                    <Button
                      onClick={() => {
                        setPassword("");
                        setModal("signOffline");
                      }}
                      disabled={!offline || current.meta.watchOnly}
                    >
                      <ShieldCheck size={16} />
                      Review offline payment
                    </Button>
                  </section>
                  <section className="panel">
                    <span className="step-number">3</span>
                    <h2>Broadcast online</h2>
                    <p>
                      Bring the signed file to the online device. Your signing
                      keys stay on the offline device.
                    </p>
                    {fileInput(
                      "Import signed payment",
                      (text) =>
                        task("Checking signed transaction…", async () => {
                          const tx = await api.importSigned(text.trim());
                          setSigned(tx);
                          setModal("broadcast");
                        }),
                      250000,
                    )}
                  </section>
                </div>
                {offlineReview && (
                  <section className="panel review-panel">
                    <h2>Review offline payment</h2>
                    <ReviewRows review={offlineReview} />
                    {modal === "newAddress" && (
                      <Field label="Number of receive addresses · 1 to 100,000">
                        <input
                          type="number"
                          min={1}
                          max={100000}
                          value={addressCount}
                          onChange={(e) => setAddressCount(e.target.value)}
                          required
                        />
                      </Field>
                    )}
                    <Field label="Local wallet password">
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                      />
                    </Field>
                    <div className="form-actions">
                      <Button
                        onClick={() => {
                          setOfflineReview(null);
                          setPassword("");
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        primary
                        onClick={offlineSign}
                        disabled={!password || !!busy}
                      >
                        Sign & export file
                        <FileDown size={16} />
                      </Button>
                    </div>
                  </section>
                )}
              </>
            )}
            {view === "settings" && (
              <div className="settings-grid">
                <section className="panel">
                  <h2>Backup & recovery</h2>
                  <button
                    className="setting-row"
                    onClick={() =>
                      void task("Saving encrypted backup…", async () => {
                        await api.backup(selected);
                        reload();
                        setNotice("Encrypted backup saved.");
                      })
                    }
                  >
                    <FileDown size={20} />
                    <span>
                      <strong>Export encrypted wallet</strong>
                      <small>
                        {current.backedUp
                          ? "Backup saved"
                          : "Backup recommended"}
                      </small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                  <button
                    className="setting-row"
                    disabled={current.meta.watchOnly || current.meta.legacy}
                    onClick={() => {
                      setPassword("");
                      setModal("phrase");
                    }}
                  >
                    <Eye size={20} />
                    <span>
                      <strong>Reveal recovery phrase</strong>
                      <small>24 English words · Keep offline</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                  <button
                    className="setting-row"
                    disabled={current.meta.watchOnly}
                    onClick={() => {
                      setPassword("");
                      setConfirm("");
                      setModal("password");
                    }}
                  >
                    <Lock size={20} />
                    <span>
                      <strong>Change local password</strong>
                      <small>Save a new backup after changing</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                  <button
                    className="setting-row"
                    disabled={current.meta.watchOnly || current.meta.legacy}
                    onClick={() => {
                      setPassword("");
                      setModal("scan");
                    }}
                  >
                    <ScanLine size={20} />
                    <span>
                      <strong>Scan used addresses</strong>
                      <small>
                        Receive and change · 20-address recovery gap
                      </small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                </section>
                <section className="panel">
                  <h2>Network & local storage</h2>
                  <div className="setting-detail">
                    <Globe size={20} />
                    <div>
                      <strong>Requant testnet</strong>
                      <span>
                        {savedEndpoint || "requant.network/wallet-api"}
                      </span>
                      <small>
                        {node
                          ? `Verified genesis · Observed height ${node.height}`
                          : "Node connection unavailable"}
                      </small>
                    </div>
                  </div>
                  {platform()?.configure && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void task("Saving node connection…", async () => {
                          await platform()!.configure!(endpoint);
                          setSavedEndpoint(endpoint);
                          setNode(null);
                          setSnapshot(null);
                          const verified = await api.info();
                          setNode(verified);
                        });
                      }}
                    >
                      <Field label="Public API or own node URL">
                        <input
                          type="url"
                          required
                          value={endpoint}
                          onChange={(e) => setEndpoint(e.target.value)}
                        />
                      </Field>
                      <Button type="submit" disabled={!!busy}>
                        Save & verify node
                      </Button>
                    </form>
                  )}
                  <div className="setting-detail">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>Local signing</strong>
                      <span>
                        Passwords and recovery phrases stay on this device.
                      </span>
                      <small>
                        Signing sessions clear when the page is hidden or after
                        five minutes of inactivity.
                      </small>
                    </div>
                  </div>
                  <div className="setting-detail">
                    <Wallet size={20} />
                    <div>
                      <strong>
                        {platform()
                          ? "Saved on this device"
                          : "Saved in this browser"}
                      </strong>
                      <span>
                        Keep your encrypted backup before uninstalling or
                        clearing application data.
                      </span>
                      <small>
                        Keep your offline recovery phrase or encrypted backup
                        before clearing browser storage.
                      </small>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </>
        ) : (
          <section className="panel">
            Select or add a wallet to continue.
          </section>
        )}
        <footer className="footer">
          <span className={node ? "connection connected" : "connection"}>
            <span />
            {node ? "Testnet node verified" : "Node unavailable"}
            {snapshot &&
              ` · Updated ${new Date(snapshot.observedAt).toLocaleTimeString("en-US")}`}
          </span>
          <span>TESTNET · COINS HAVE NO VALUE</span>
        </footer>
      </main>
      <nav className="mobile-navigation" aria-label="Mobile wallet navigation">
        <button
          disabled={!current}
          onClick={() => {
            setSetup(null);
            goto("wallet");
          }}
        >
          <Wallet size={20} />
          Wallet
        </button>
        <button
          disabled={!current}
          onClick={() => {
            setSetup(null);
            goto("activity");
          }}
        >
          <Activity size={20} />
          Activity
        </button>
        <button disabled={!current} onClick={() => setToolsOpen((v) => !v)}>
          <Layers size={20} />
          Tools
        </button>
        <button
          disabled={!current}
          onClick={() => {
            setSetup(null);
            goto("settings");
          }}
        >
          <Settings size={20} />
          Settings
        </button>
      </nav>
      {toolsOpen && (
        <div className="modal-backdrop">
          <section className="modal panel">
            <div className="panel-heading">
              <h2>Wallet tools</h2>
              <Button onClick={() => setToolsOpen(false)}>Close</Button>
            </div>
            {[
              { id: "send", name: "Send RQT" },
              { id: "receive", name: "Receive RQT" },
              { id: "addresses", name: "Addresses & deposit lists" },
              { id: "coins", name: "Coins & consolidation" },
              { id: "offline", name: "Offline signing" },
              { id: "conditions", name: "Spending conditions" },
            ].map((item) => (
              <button
                className="setting-row"
                key={item.id}
                onClick={() => {
                  setSetup(null);
                  goto(item.id as View);
                  setToolsOpen(false);
                }}
              >
                {item.name}
                <ArrowRight size={18} />
              </button>
            ))}
            <button
              className="setting-row"
              onClick={() => {
                clear();
                setToolsOpen(false);
              }}
            >
              Lock signing session
              <Lock size={18} />
            </button>
            <a
              className="setting-row"
              href="https://requant.network/docs"
              target="_blank"
              rel="noreferrer"
            >
              Help & documentation
              <ExternalLink size={18} />
            </a>
          </section>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop">
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="panel-heading">
              <h2 id="modal-title">
                {modal === "newAddress"
                  ? "Create receive address"
                  : modal === "phrase"
                    ? "Reveal recovery phrase"
                    : modal === "password"
                      ? "Change local password"
                      : modal === "scan"
                        ? "Scan wallet addresses"
                        : modal === "signOffline"
                          ? "Verify offline payment"
                          : "Broadcast signed payment"}
              </h2>
              <button
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => {
                  setModal(null);
                  setPassword("");
                  setConfirm("");
                }}
                disabled={!!busy}
              >
                <X size={18} />
              </button>
            </div>
            {modal === "transaction" ? (
              <>
                <div className="full-address">{transaction?.txid}</div>
                <p>
                  {transaction?.coinbase ? "Mining reward" : "Payment"} ·{" "}
                  {transaction?.confirmations ?? "0"} observed confirmations
                </p>
                {transaction?.outputs?.map((o: any, i: number) => (
                  <div className="review-output" key={i}>
                    <span className="label">Output {i + 1}</span>
                    <span className="full-address">{o.address}</span>
                    <Amount value={o.amount} />
                  </div>
                ))}
                <p className="subtle">
                  Transaction bytes and ID verified locally. Confirmations are
                  reported by the connected node.
                </p>
                <a
                  className="button"
                  href={`https://requant.network/explorer/tx/${transaction?.txid}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View in explorer
                  <ExternalLink size={16} />
                </a>
              </>
            ) : modal === "broadcast" ? (
              <>
                <p className="subtle">
                  This file contains a signed transaction. Broadcasting sends it
                  to the Requant testnet.
                </p>
                <div className="full-address">{signed?.txid}</div>
                {signed?.review && (
                  <ReviewRows
                    review={signed.review}
                    totalLabel="Total input amount"
                  />
                )}
                <div className="form-actions">
                  <Button onClick={() => setModal(null)}>Cancel</Button>
                  <Button
                    primary
                    disabled={!!busy}
                    onClick={() =>
                      task("Broadcasting signed payment…", async () => {
                        if (!signed) return;
                        try {
                          await api.broadcast(signed);
                          setNotice("Signed payment broadcast.");
                        } finally {
                          setResult(signed.txid);
                          setView("send");
                          setModal(null);
                          reload();
                        }
                      })
                    }
                  >
                    Broadcast transaction
                    <Send size={16} />
                  </Button>
                </div>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  protectedAction();
                }}
              >
                <p className="subtle">
                  Your password is used only by the local wallet core on this
                  device.
                </p>
                {modal === "newAddress" && (
                  <Field label="Number of receive addresses · 1 to 100,000">
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={addressCount}
                      onChange={(e) => setAddressCount(e.target.value)}
                      required
                    />
                  </Field>
                )}
                <Field label="Local wallet password">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    autoFocus
                    required
                  />
                </Field>
                {modal === "password" && (
                  <Field label="New password · at least 12 characters">
                    <input
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="new-password"
                      minLength={12}
                      required
                    />
                  </Field>
                )}
                <Button type="submit" primary disabled={!!busy || !password}>
                  Continue locally
                  <ArrowRight size={16} />
                </Button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
