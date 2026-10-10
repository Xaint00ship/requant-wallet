import { useEffect, useState, useRef } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  House,
  List,
  Download,
  Settings as SettingsIcon,
  Lock,
  Plus,
  Copy,
  RefreshCw,
  Send,
  ShieldCheck,
  FileKey,
  ExternalLink,
  Check,
  WifiOff,
  Share2,
} from "lucide-react";
import QRCode from "qrcode";
import {
  command,
  native,
  pickBackup,
  saveBackup,
  copyAddress,
  explorer,
  android,
  fileDialogOpen,
} from "./api";
import { rqt, short } from "./amounts.mjs";
import useWalletUpdates from "./WalletUpdates";
type Wallet = {
  id: string;
  name: string;
  address: string;
  locked: boolean;
  backedUp: boolean;
};
type Event = {
  txid: string;
  height: number | null;
  confirmations: number;
  time: number | null;
  received: string;
  sent: string;
};
type Snapshot = {
  confirmed: string;
  pending: string;
  maturing: string;
  spendable: string;
  info: { height: number; peers: number; network: string };
  events: Event[];
  observedAt: number;
};
type Settings = { endpoint: string; autoLockMinutes: number };
type Review = {
  id: string;
  recipient: string;
  amount: string;
  fee: string;
  total: string;
  inputCount: number;
};
type Sent = { txid: string; status: string; message: string };
type Page = "overview" | "activity" | "receive" | "settings" | "send";
const errorText = (error: unknown) =>
  typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "The operation could not be completed.";
function Badge() {
  return (
    <span className="badge">
      <i />
      TESTNET
    </span>
  );
}
function Brand() {
  return (
    <div className="brand">
      <img src="/requant-mark.svg" alt="" />
      <span>
        Requant
        <br />
        Wallet
      </span>
    </div>
  );
}
function Tensor() {
  return (
    <div className="tensor" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} style={{ top: `${i * 11}px` }} />
      ))}
    </div>
  );
}
export default function App() {
  const [wallets, setWallets] = useState<Wallet[]>([]),
    [selected, setSelected] = useState(""),
    [page, setPage] = useState<Page>("overview"),
    [setup, setSetup] = useState<"" | "create" | "restore" | "backup">(""),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [settings, setSettings] = useState<Settings>({
      endpoint: "https://requant.network/wallet-api/v1/rpc",
      autoLockMinutes: 5,
    }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [connection, setConnection] = useState<
      "connecting" | "connected" | "offline"
    >("connecting"),
    [qr, setQR] = useState(""),
    [filter, setFilter] = useState(""),
    [review, setReview] = useState<Review | null>(null),
    [sent, setSent] = useState<Sent | null>(null),
    [detail, setDetail] = useState<any>(null),
    [outbox, setOutbox] = useState<Sent[]>([]);
  const current = wallets.find((w) => w.id === selected),
    activeRef = useRef(""),
    refreshing = useRef(false),
    lastTouch = useRef(0);
  activeRef.current = selected;
  async function loadWallets(prefer?: string) {
    const list = await command<Wallet[]>("list_wallets");
    setWallets(list);
    if (prefer) setSelected(prefer);
    else if (!list.some((w) => w.id === selected))
      setSelected(list[0]?.id || "");
    return list;
  }
  async function refresh() {
    if (!current || current.locked || refreshing.current) return;
    refreshing.current = true;
    const id = current.id;
    try {
      const data = await command<Snapshot>("wallet_snapshot", { id });
      if (activeRef.current !== id) return;
      setSnapshot(data);
      setConnection("connected");
      const pending = await command<Sent[]>("pending_broadcasts", { id });
      if (activeRef.current === id) setOutbox(pending);
    } catch (error) {
      if (activeRef.current === id) {
        setConnection("offline");
        setMessage(errorText(error));
        await loadWallets();
      }
    } finally {
      refreshing.current = false;
    }
  }
  async function lock() {
    await command("lock_wallet");
    setSnapshot(null);
    setReview(null);
    setSent(null);
    setDetail(null);
    setOutbox([]);
    setSetup("");
    setMessage("");
    setWallets((ws) => ws.map((w) => ({ ...w, locked: true })));
  }
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (native) {
      void command<Settings>("get_settings").then(setSettings);
      void loadWallets().catch((e) => setMessage(errorText(e)));
    }
  }, []);
  useEffect(() => {
    setSnapshot(null);
    setReview(null);
    setSent(null);
    setDetail(null);
    setOutbox([]);
    setMessage("");
    if (current && !current.locked) {
      setConnection("connecting");
      void refresh();
    }
    let disposed = false;
    if (current)
      void QRCode.toDataURL(current.address, {
        width: 256,
        margin: 2,
        color: { dark: "#171717", light: "#fbfaf7" },
      }).then((value) => {
        if (!disposed) setQR(value);
      });
    return () => {
      disposed = true;
    };
  }, [selected, current?.locked]);
  useEffect(() => {
    if (!current || current.locked) return;
    const poll = setInterval(() => {
      void refresh();
      void loadWallets();
    }, 30000);
    const hidden = () => {
      if (document.hidden && !fileDialogOpen) void lock();
    };
    const touch = () => {
      if (Date.now() - lastTouch.current > 15000) {
        lastTouch.current = Date.now();
        void command("touch_wallet", { id: current.id }).catch(
          () => void lock(),
        );
      }
    };
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("pointerdown", touch);
    document.addEventListener("keydown", touch);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("pointerdown", touch);
      document.removeEventListener("keydown", touch);
    };
  }, [current?.id, current?.locked]);
  useEffect(() => {
    if (!detail) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    const elements = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>("button,a[href],input,select") ||
          [],
      );
    elements()[0]?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDetail(null);
        e.preventDefault();
      } else if (e.key === "Tab") {
        const items = elements(),
          first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last?.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first?.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [detail]);
  const navigate = (next: Page) => {
    setPage(next);
    setMessage("");
    setReview(null);
    setSent(null);
    setDetail(null);
  };
  const inputPassword = (
    label = "Wallet password",
    name = "password",
    newValue = false,
  ) => (
    <label>
      {label}
      <input
        name={name}
        type="password"
        required
        maxLength={1024}
        autoComplete={newValue ? "new-password" : "current-password"}
        minLength={newValue ? 10 : undefined}
      />
    </label>
  );
  const notice = (
    <div className="notice" role="status">
      {message}
    </div>
  );
  const button = (
    text: string,
    fn: () => void,
    primary = false,
    Icon?: any,
  ) => (
    <button
      type="button"
      className={primary ? "button primary" : "button"}
      disabled={busy}
      onClick={fn}
    >
      {Icon && <Icon size={19} />} {text}
    </button>
  );
  function footer() {
    return (
      <footer>
        <span>Requant Wallet · v0.4.0</span>
        <span>Testnet coins have no value.</span>
      </footer>
    );
  }
  const setupMode =
    setup || (!current ? "welcome" : current.locked ? "unlock" : "");
  const walletUpdates = useWalletUpdates({
    locked: wallets.every((w) => w.locked),
    blocked:
      busy ||
      !!review ||
      !!setup ||
      page === "send" ||
      (setupMode !== "unlock" && setupMode !== "welcome" && !!setupMode),
    beforeInstall: async () => {
      await lock();
    },
    onInstalling: setBusy,
    showDetails: page === "settings",
  });
  if (setupMode) {
    return (
      <div className="setup-shell">
        <header>
          <Brand />
          <Badge />
        </header>
        {!native && (
          <div className="preview-banner">
            Interface preview · Open the native app to create, restore or use a
            wallet.
          </div>
        )}
        <main className="setup-card">
          {walletUpdates}
          {setupMode === "welcome" && (
            <>
              <div className="eyebrow">LOCAL KEY STORAGE</div>
              <Tensor />
              <h1>
                Set up
                <br />
                your wallet
              </h1>
              <p>Create a wallet or restore an encrypted backup.</p>
              <div className="stack">
                {button("Create wallet", () => setSetup("create"), true, Plus)}
                {button(
                  "Restore wallet",
                  () => setSetup("restore"),
                  false,
                  FileKey,
                )}
              </div>
              <div className="setup-note">
                <ShieldCheck size={18} /> Your keys are encrypted on this
                device.
              </div>
            </>
          )}
          {(setupMode === "create" || setupMode === "restore") && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                void task(async () => {
                  const password = String(data.get("password"));
                  if (
                    setupMode === "create" &&
                    password !== data.get("confirm")
                  )
                    throw new Error("The passwords do not match.");
                  const wallet =
                    setupMode === "create"
                      ? await command<Wallet>("create_wallet", {
                          name: String(data.get("name")),
                          password,
                        })
                      : await (async () => {
                          const backup = await pickBackup();
                          if (!backup) return null;
                          return command<Wallet>("import_wallet", {
                            name: String(data.get("name")),
                            password,
                            backup,
                            legacy: data.get("legacy") === "on",
                          });
                        })();
                  form.reset();
                  if (wallet) {
                    await loadWallets(wallet.id);
                    setPage("overview");
                    setSetup("backup");
                  }
                });
              }}
            >
              <div className="eyebrow">
                {setupMode === "create" ? "CREATE / 01" : "RESTORE / 01"}
              </div>
              <h1>
                {setupMode === "create"
                  ? "Protect your wallet"
                  : "Restore your wallet"}
              </h1>
              <p>
                {setupMode === "create"
                  ? "This password unlocks your wallet on this device."
                  : "Select your encrypted Requant backup and enter its password."}
              </p>
              <label>
                Wallet name
                <input
                  name="name"
                  required
                  maxLength={60}
                  defaultValue="Main wallet"
                  autoComplete="off"
                />
              </label>
              {inputPassword(
                "Wallet password",
                "password",
                setupMode === "create",
              )}
              {setupMode === "create" ? (
                inputPassword("Confirm password", "confirm", true)
              ) : (
                <label className="check">
                  <input name="legacy" type="checkbox" />
                  Import a legacy unencrypted key and encrypt it with this
                  password
                </label>
              )}
              <div className="actions">
                {button("Back", () => setSetup(""), false, ArrowLeft)}
                <button className="button primary" disabled={busy || !native}>
                  {busy
                    ? "Working…"
                    : setupMode === "create"
                      ? "Create encrypted wallet"
                      : "Choose backup and restore"}
                  <ArrowRight size={18} />
                </button>
              </div>
            </form>
          )}
          {setupMode === "unlock" && current && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                void task(async () => {
                  await command("unlock_wallet", {
                    id: current.id,
                    password: String(data.get("password")),
                  });
                  form.reset();
                  await loadWallets();
                  setConnection("connecting");
                });
              }}
            >
              <div className="eyebrow">LOCAL WALLET</div>
              <h1>Unlock your wallet</h1>
              <p>Your encrypted keys stay on this device.</p>
              <label>
                Wallet
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              {inputPassword()}
              <button disabled={busy} className="button primary">
                <Lock size={18} />
                {busy ? "Unlocking…" : "Unlock wallet"}
              </button>
              <div className="actions">
                {button("Create another wallet", () => setSetup("create"))}
                {button("Restore wallet", () => setSetup("restore"))}
              </div>
            </form>
          )}
          {setupMode === "backup" && current && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                void task(async () => {
                  if (
                    await saveBackup(current.id, String(data.get("password")))
                  ) {
                    form.reset();
                    await loadWallets();
                    setMessage("Encrypted backup saved.");
                  }
                });
              }}
            >
              <div className="eyebrow">BACKUP / 02</div>
              <h1>Save your wallet backup</h1>
              <FileKey className="big-icon" />
              <p>
                Keep the encrypted file and its password. Both are needed to
                restore your wallet.
              </p>
              {inputPassword()}
              <button className="button primary" disabled={busy}>
                <Download size={18} />
                {busy ? "Saving…" : "Save backup file"}
              </button>
              <button
                className="button"
                type="button"
                disabled={!current.backedUp || busy}
                onClick={() => setSetup("")}
              >
                Continue
                <ArrowRight size={18} />
              </button>
            </form>
          )}
          {message && notice}
        </main>
        {footer()}
      </div>
    );
  }
  const nav: [Page, string, any][] = [
    ["overview", "Overview", House],
    ["activity", "Activity", List],
    ["receive", "Receive", Download],
    ["settings", "Settings", SettingsIcon],
  ];
  const events = (snapshot?.events || []).filter((e) =>
    e.txid.includes(filter),
  );
  function receive() {
    return (
      <section className="card receive-card">
        <h2>Your testnet address</h2>
        {qr ? (
          <img
            className="qr"
            src={qr}
            alt="QR code for this wallet’s Requant testnet address"
          />
        ) : (
          <div className="qr skeleton" />
        )}
        <div className="full-address">{current!.address}</div>
        {button(
          "Copy address",
          () =>
            void task(async () => {
              await copyAddress(current!.address);
              setMessage("Address copied.");
            }),
          false,
          Copy,
        )}
        {android &&
          native &&
          button(
            "Share address",
            () =>
              void task(async () => {
                await command("share_address", { id: current!.id });
              }),
            false,
            Share2,
          )}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            void explorer(`address/${current!.address}`);
          }}
        >
          Open in explorer <ExternalLink size={15} />
        </a>
        <p className="muted small">Only receive RQT on Requant testnet.</p>
      </section>
    );
  }
  function activity() {
    return (
      <section className="card activity-card">
        <div className="section-top">
          <h2>Recent activity</h2>
          {page === "overview" && (
            <button
              className="text-button"
              onClick={() => navigate("activity")}
            >
              View all activity <ArrowRight size={16} />
            </button>
          )}
        </div>
        {page === "activity" && (
          <label className="search">
            Transaction ID
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search transaction ID"
            />
          </label>
        )}
        <div className="activity-table">
          <div className="table-head">
            <span>Type / Transaction</span>
            <span>Status</span>
            <span>Amount</span>
            <span>Time</span>
          </div>
          {events.slice(0, page === "overview" ? 5 : 100).map((e) => {
            const difference = BigInt(e.received) - BigInt(e.sent),
              incoming = difference >= 0n;
            return (
              <button
                key={e.txid}
                className="activity-row"
                onClick={() =>
                  void task(async () =>
                    setDetail(
                      await command("transaction_detail", {
                        id: current!.id,
                        txid: e.txid,
                      }),
                    ),
                  )
                }
              >
                <span className="activity-type">
                  {incoming ? (
                    <ArrowDownLeft className="green" />
                  ) : (
                    <ArrowUpRight className="orange" />
                  )}
                  <span>
                    {incoming ? "Received" : "Sent"}
                    <small className="mono">{short(e.txid)}</small>
                  </span>
                </span>
                <span
                  className={`status ${e.confirmations ? "confirmed" : "pending"}`}
                >
                  {e.confirmations ? "Confirmed" : "Pending"}
                </span>
                <span className={`mono amount ${incoming ? "green" : ""}`}>
                  {incoming ? "+" : ""}
                  {rqt(difference)} <small>RQT</small>
                </span>
                <span className="muted small">
                  {e.time
                    ? new Date(e.time * 1000).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Unconfirmed"}
                </span>
              </button>
            );
          })}
          {!events.length && (
            <div className="empty">
              <List size={30} />
              <h3>
                {snapshot ? "No transactions yet" : "Waiting for wallet data"}
              </h3>
              <p>
                {snapshot
                  ? "Receive testnet RQT to see your activity here."
                  : "Connect to a node to load your balances and activity."}
              </p>
            </div>
          )}
        </div>
        {page === "activity" && (
          <p className="muted small">
            Most recent 100 transactions. Open the explorer for more details.
          </p>
        )}
      </section>
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => navigate(key)}
            >
              <Icon size={21} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {button("Add wallet", () => setSetup("create"), false, Plus)}
          {button("Lock wallet", () => void task(lock), false, Lock)}
          <span className="muted small">v0.2.0 / Testnet</span>
        </div>
      </aside>
      <main className="workspace">
        {walletUpdates}
        <header className="workspace-header">
          <h1>
            {page === "send"
              ? "Send RQT"
              : page[0].toUpperCase() + page.slice(1)}
          </h1>
          <select
            className="wallet-select"
            aria-label="Current wallet"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {wallets.map((w) => (
              <option value={w.id} key={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <Badge />
          <div className={`connection ${connection}`}>
            <i />
            {connection === "connected"
              ? "Node connected"
              : connection === "connecting"
                ? "Connecting"
                : "Offline"}
          </div>
          <button
            className="icon-button"
            aria-label="Refresh wallet"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={20} />
          </button>
        </header>
        {message && notice}
        {connection === "offline" && snapshot && (
          <div className="offline-note">
            <WifiOff size={18} /> Showing data from{" "}
            {new Date(snapshot.observedAt * 1000).toLocaleTimeString("en-US")}.
            Refresh before sending.
          </div>
        )}
        {!current!.backedUp && (
          <div className="backup-note">
            <ShieldCheck size={18} /> Save an encrypted backup to protect access
            to this wallet.
            <button className="text-button" onClick={() => setSetup("backup")}>
              Save backup <ArrowRight size={16} />
            </button>
          </div>
        )}
        {page === "overview" && (
          <>
            <div className="overview-grid">
              <section className="card balance-card">
                <div className="eyebrow muted">Confirmed balance</div>
                <div className="balance">
                  <span>{snapshot?.confirmed || "—"}</span>
                  <small>RQT</small>
                </div>
                <Tensor />
                <div className="actions">
                  {button("Send", () => navigate("send"), true, Send)}
                  {button(
                    "Receive",
                    () => navigate("receive"),
                    false,
                    Download,
                  )}
                </div>
                <div className="sub-balances">
                  <div>
                    Pending
                    <strong className="mono">
                      {snapshot?.pending || "—"} <small>RQT</small>
                    </strong>
                  </div>
                  <div>
                    Maturing
                    <strong className="mono">
                      {snapshot?.maturing || "—"} <small>RQT</small>
                    </strong>
                  </div>
                </div>
              </section>
              {receive()}
            </div>
            {activity()}
            {outbox
              .filter((b) => b.status === "unknown")
              .map((b) => (
                <div className="backup-note" key={b.txid}>
                  A transfer has an unknown broadcast result.
                  <button
                    className="text-button"
                    onClick={() => void explorer(`tx/${b.txid}`)}
                  >
                    Check {short(b.txid)}
                  </button>
                </div>
              ))}
          </>
        )}
        {page === "activity" && activity()}
        {page === "receive" && <div className="receive-page">{receive()}</div>}
        {page === "send" && !sent && !review && (
          <form
            className="card form-card"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void task(async () =>
                setReview(
                  await command<Review>("prepare_transfer", {
                    id: current!.id,
                    recipient: String(data.get("recipient")).trim(),
                    amount: String(data.get("amount")),
                    fee: String(data.get("fee")),
                    allowPending: false,
                  }),
                ),
              );
            }}
          >
            <h2>Where are you sending RQT?</h2>
            <label>
              Recipient address
              <input
                name="recipient"
                required
                placeholder="trq1q…"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              Amount{" "}
              <span className="input-unit">
                <input
                  name="amount"
                  inputMode="decimal"
                  required
                  placeholder="0.00000000"
                />
                <span>RQT</span>
              </span>
            </label>
            <p className="muted small">
              Available {snapshot?.spendable || "—"} RQT · Confirmed outputs
              only
            </p>
            <label>
              Network fee{" "}
              <span className="input-unit">
                <input
                  name="fee"
                  inputMode="decimal"
                  defaultValue="0.00001000"
                  required
                />
                <span>RQT</span>
              </span>
            </label>
            <p className="muted small">
              The fee is paid to miners. Review the complete recipient, amount
              and total before signing.
            </p>
            <button
              className="button primary"
              disabled={busy || connection !== "connected" || !snapshot}
            >
              {busy ? "Preparing…" : "Review transfer"}
              <ArrowRight size={18} />
            </button>
          </form>
        )}
        {page === "send" && review && !sent && (
          <form
            className="card form-card"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget,
                data = new FormData(form);
              void task(async () => {
                const result = await command<Sent>("confirm_transfer", {
                  reviewId: review.id,
                  password: String(data.get("password")),
                });
                form.reset();
                setSent(result);
                setReview(null);
                void refresh();
              });
            }}
          >
            <div className="eyebrow">REVIEW / TRANSFER</div>
            <h2>Review transfer</h2>
            <dl>
              <dt>Recipient</dt>
              <dd className="full-address">{review.recipient}</dd>
              <dt>Amount</dt>
              <dd>{review.amount} RQT</dd>
              <dt>Network fee</dt>
              <dd>{review.fee} RQT</dd>
              <dt>Total</dt>
              <dd className="total">{review.total} RQT</dd>
              <dt>Network</dt>
              <dd>Requant testnet</dd>
            </dl>
            {inputPassword()}
            <p className="muted small">
              Signed on this device. This review expires after two minutes.
            </p>
            <div className="actions">
              {button("Back", () => setReview(null), false, ArrowLeft)}
              <button className="button primary" disabled={busy}>
                {busy ? "Submitting…" : "Confirm and send"}
                <Send size={18} />
              </button>
            </div>
          </form>
        )}
        {page === "send" && sent && (
          <section className="card form-card">
            <Check className="big-icon" />
            <h2>
              {sent.status === "pending"
                ? "Transfer submitted"
                : sent.status === "rejected"
                  ? "Transfer rejected"
                  : "Check your transfer"}
            </h2>
            <p>{sent.message}</p>
            <div className="full-address mono">{sent.txid}</div>
            <div className="actions">
              {button(
                "Open in explorer",
                () => void explorer(`tx/${sent.txid}`),
                true,
                ExternalLink,
              )}
              {button("Back to wallet", () => navigate("overview"))}
            </div>
          </section>
        )}
        {page === "settings" && (
          <div className="settings-grid">
            <form
              className="card"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void task(async () => {
                  const next = {
                    endpoint: String(data.get("endpoint")).trim(),
                    autoLockMinutes: Number(data.get("timeout")),
                  };
                  await command("save_settings", { settings: next });
                  setSettings(next);
                  await loadWallets();
                  setMessage("Settings saved. Unlock the wallet to reconnect.");
                });
              }}
            >
              <h2>Connection & lock</h2>
              <p className="muted">
                Wallet balances come from the selected node. Keys and passwords
                stay on this device.
              </p>
              <label>
                Wallet API endpoint
                <input
                  name="endpoint"
                  type="url"
                  required
                  defaultValue={settings.endpoint}
                />
              </label>
              <label>
                Auto-lock after
                <select name="timeout" defaultValue={settings.autoLockMinutes}>
                  {[1, 5, 10, 15, 30].map((n) => (
                    <option key={n} value={n}>
                      {n} minutes
                    </option>
                  ))}
                </select>
              </label>
              <button className="button primary" disabled={busy}>
                Save settings
              </button>
              <p className="muted small">
                The app locks when it goes into the background.
              </p>
            </form>
            <section className="card">
              <h2>Encrypted backup</h2>
              <p>
                {current!.backedUp
                  ? "A backup has been saved for this wallet."
                  : "Save a backup before relying on this wallet."}
              </p>
              {button(
                "Save backup file",
                () => setSetup("backup"),
                true,
                Download,
              )}
              <div className="full-address">{current!.address}</div>
              <p className="muted small">
                Keep the encrypted file and its password. Website and server
                passwords cannot restore a wallet.
              </p>
            </section>
            <form
              className="card"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget,
                  data = new FormData(form);
                void task(async () => {
                  if (data.get("password") !== data.get("confirm"))
                    throw new Error("The passwords do not match.");
                  await command("change_password", {
                    id: current!.id,
                    current: String(data.get("current")),
                    password: String(data.get("password")),
                  });
                  form.reset();
                  await loadWallets();
                  setMessage(
                    "Password changed. Save a fresh encrypted backup after unlocking.",
                  );
                });
              }}
            >
              <h2>Change wallet password</h2>
              {inputPassword("Current wallet password", "current")}
              {inputPassword("New wallet password", "password", true)}
              {inputPassword("Confirm new password", "confirm", true)}
              <button className="button" disabled={busy}>
                Change password
              </button>
            </form>
          </div>
        )}
        {detail && (
          <div className="modal-backdrop">
            <section
              className="card detail-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="transaction-title"
            >
              <button className="text-button" onClick={() => setDetail(null)}>
                <ArrowLeft size={16} /> Close
              </button>
              <h2 id="transaction-title">Transaction details</h2>
              <div className="full-address mono">{detail.txid}</div>
              <dl>
                <dt>Status</dt>
                <dd>{detail.height === null ? "Pending" : "Confirmed"}</dd>
                <dt>Confirmations</dt>
                <dd>{detail.confirmations}</dd>
                <dt>Height</dt>
                <dd>{detail.height ?? "—"}</dd>
                <dt>Fee</dt>
                <dd>{detail.fee} RQT</dd>
              </dl>
              <h3>Outputs</h3>
              {detail.outputs?.map((o: any, i: number) => (
                <div className="output" key={i}>
                  <span className="mono">{o.value} RQT</span>
                  <span className="full-address">{o.address}</span>
                </div>
              ))}
              {button(
                "Open in explorer",
                () => void explorer(`tx/${detail.txid}`),
                true,
                ExternalLink,
              )}
            </section>
          </div>
        )}
        {footer()}
        <div className="mobile-nav">
          {nav
            .filter(([key]) => key !== "receive")
            .map(([key, label, Icon]) => (
              <button
                className={page === key ? "active" : ""}
                key={key}
                onClick={() => navigate(key)}
              >
                <Icon size={22} />
                <span>{key === "overview" ? "Home" : label}</span>
              </button>
            ))}
          <button onClick={() => void task(lock)}>
            <Lock size={22} />
            <span>Lock</span>
          </button>
        </div>
      </main>
    </div>
  );
}
