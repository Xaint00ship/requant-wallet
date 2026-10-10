import { useEffect, useRef, useState } from "react";
import {
  Copy,
  FileDown,
  FileUp,
  KeyRound,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import * as api from "./service";
import { platform } from "./platform";
type Props = {
  wallet: api.PublicWallet;
  reset: number;
  busy: boolean;
  node: any;
  task: (label: string, fn: () => Promise<void>) => Promise<void>;
  fund: (address: string) => void;
};
const fields: Record<string, [string, string][]> = {
  multi2: [
    ["first", "First public key (64 hex digits)"],
    ["second", "Second public key (64 hex digits)"],
  ],
  htlc: [
    ["hash", "SHA-256 of the 32-byte secret"],
    ["claim", "Claim address"],
    ["refund", "Refund address"],
    ["timeout", "Refund from block height"],
  ],
  delayed: [
    ["owner", "Owner address"],
    ["revoke", "Revocation address"],
    ["delay", "Owner delay in blocks"],
  ],
  "htlc-revocable": [
    ["hash", "SHA-256 of the 32-byte secret"],
    ["claim", "Claim address"],
    ["refund", "Refund address"],
    ["revoke", "Revocation address"],
    ["timeout", "Refund from block height"],
    ["claim_delay", "Claim delay in blocks"],
    ["refund_delay", "Refund delay in blocks"],
  ],
};
const names: Record<string, string> = {
  multi2: "2-of-2 signatures",
  htlc: "Hash and time lock (HTLC)",
  delayed: "Revocable delayed output",
  "htlc-revocable": "Revocable HTLC",
};
export default function Conditions({
  wallet,
  reset,
  busy,
  node,
  task,
  fund,
}: Props) {
  const [kind, setKind] = useState("multi2"),
    [values, setValues] = useState<Record<string, string>>({}),
    [descriptor, setDescriptor] = useState<any>(null),
    [conditionFile, setConditionFile] = useState(""),
    [owner, setOwner] = useState(""),
    [activation, setActivation] = useState(0);
  const [path, setPath] = useState(""),
    [recipient, setRecipient] = useState(""),
    [rate, setRate] = useState("5"),
    [preimage, setPreimage] = useState(""),
    [acp, setAcp] = useState(false);
  const [secret, setSecret] = useState(""),
    [secretHash, setSecretHash] = useState(""),
    [publicKey, setPublicKey] = useState(""),
    [keyAddress, setKeyAddress] = useState(wallet.meta.address),
    [password, setPassword] = useState("");
  const [payment, setPayment] = useState(""),
    [review, setReview] = useState<api.Review | null>(null),
    [output, setOutput] = useState<{
      hex?: string;
      txid?: string;
      partial?: string;
    } | null>(null),
    [sent, setSent] = useState(false),
    [copied, setCopied] = useState("");
  const file = useRef<HTMLInputElement>(null),
    generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setPassword("");
    setPreimage("");
    setSecret("");
    setSecretHash("");
    setPublicKey("");
    setPayment("");
    setReview(null);
    setOutput(null);
    setSent(false);
    setKeyAddress(wallet.meta.address);
  }, [reset, wallet.id]);
  const run = (label: string, fn: (valid: () => boolean) => Promise<void>) =>
    task(label, async () => {
      const g = generation.current;
      await fn(() => g === generation.current);
    });
  const invalidate = () => {
    setReview(null);
    setPayment("");
    setOutput(null);
    setSent(false);
  };
  async function copy(text: string) {
    if (platform()?.copy) await platform()!.copy!(text);
    else await navigator.clipboard.writeText(text);
    setCopied(text);
  }
  async function load(text: string, valid: () => boolean) {
    const v = JSON.parse(text);
    if (v.requant_condition === 1) {
      const r = await api.core("condition", { condition: text });
      if (!valid()) return;
      setDescriptor(r.condition);
      setConditionFile(r.file);
      setOwner(r.owner);
      setActivation(r.activationHeight);
      setPath(r.condition.paths[0]);
      invalidate();
    } else {
      const r = await api.inspectCondition(text);
      if (!valid()) return;
      setPayment(r.payment);
      setReview(r.review);
      setOutput(null);
      setSent(false);
    }
  }
  const pick = () =>
    void run("Reading condition file…", async (valid) => {
      if (platform()) {
        const picked = await platform()!.pick!(8 * 1024 * 1024);
        if (picked && valid()) await load(picked.text, valid);
      } else file.current?.click();
    });
  const locks = review?.locks;
  return (
    <div className="conditions-workspace">
      <section className="panel">
        <div className="panel-heading">
          <h2>Create or import a condition</h2>
          <button className="button" disabled={busy} onClick={pick}>
            <FileUp size={16} />
            Import condition / payment
          </button>
        </div>
        <input
          ref={file}
          type="file"
          hidden
          accept=".json,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f)
              void run("Reading condition file…", async (valid) => {
                const text = await api.readFile(f, 8 * 1024 * 1024);
                if (valid()) await load(text, valid);
              });
            e.target.value = "";
          }}
        />
        <p className="subtle">
          Lock coins under a public condition, then spend through its claim,
          refund or revocation path. Keep the condition file: its address alone
          does not describe how to spend it.
        </p>
        <div className="conditions-grid">
          <label className="field">
            <span>Condition type</span>
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setValues({});
                setDescriptor(null);
                invalidate();
              }}
            >
              {Object.entries(names).map(([k, n]) => (
                <option key={k} value={k}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {fields[kind].map(([k, n]) => (
            <label className="field" key={k}>
              <span>{n}</span>
              <input
                value={values[k] || ""}
                onChange={(e) => {
                  setValues({ ...values, [k]: e.target.value });
                  setDescriptor(null);
                  invalidate();
                }}
                inputMode={/delay|timeout/.test(k) ? "numeric" : "text"}
              />
            </label>
          ))}
        </div>
        <div className="form-actions">
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void run("Computing condition address…", async (valid) => {
                const r = await api.core("condition", {
                  words: [
                    kind,
                    ...fields[kind].map(([k]) => (values[k] || "").trim()),
                  ],
                });
                if (valid()) {
                  setDescriptor(r.condition);
                  setConditionFile(r.file);
                  setOwner(r.owner);
                  setActivation(r.activationHeight);
                  setPath(r.condition.paths[0]);
                  invalidate();
                }
              })
            }
          >
            Create condition <ArrowRight size={16} />
          </button>
        </div>
        {descriptor && (
          <div className="condition-result">
            <strong>{names[descriptor.kind]}</strong>
            <p className="full-address">{descriptor.address}</p>
            <p className="subtle">
              Spending activates at block {activation}. Current height:{" "}
              {node?.height || "unavailable"}.
            </p>
            <div className="form-actions">
              <button
                className="button"
                onClick={() => void copy(descriptor.address)}
              >
                <Copy size={16} />
                {copied === descriptor.address ? "Copied" : "Copy address"}
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run("Exporting condition…", async () =>
                    api.download(conditionFile, "requant-condition.json"),
                  )
                }
              >
                <FileDown size={16} />
                Save condition
              </button>
              <button
                className="button"
                onClick={() => fund(descriptor.address)}
              >
                Fund condition <ArrowRight size={16} />
              </button>
            </div>
            <details>
              <summary>Condition parameters</summary>
              <pre className="condition-json">
                {JSON.stringify(descriptor, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>Keys & HTLC secrets</h2>
        <p className="subtle">
          Public keys identify the two signers. Share only the secret's SHA-256
          hash before a claim. A claim payment includes the secret; anyone with
          that file can read it.
        </p>
        <div className="conditions-grid">
          <label className="field">
            <span>Wallet address for public key</span>
            <input
              list="condition-key-addresses"
              value={keyAddress}
              onChange={(e) => setKeyAddress(e.target.value)}
            />
            <datalist id="condition-key-addresses">
              {wallet.meta.addresses
                .filter((a) => a.issued)
                .slice(0, 200)
                .map((a) => (
                  <option key={a.owner} value={a.address}>
                    {a.chain === 0 ? "Receive" : "Change"} {a.index + 1}
                  </option>
                ))}
            </datalist>
          </label>
          <label className="field">
            <span>Local wallet password</span>
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={wallet.meta.watchOnly}
            />
          </label>
        </div>
        <div className="form-actions">
          <button
            className="button"
            disabled={busy || wallet.meta.watchOnly || !password}
            onClick={() =>
              void run("Reading local public key…", async (valid) => {
                const r = await api.conditionPublicKey(
                  wallet.id,
                  keyAddress,
                  password,
                );
                if (valid()) {
                  setPublicKey(r.pubkey);
                  setPassword("");
                }
              })
            }
          >
            <KeyRound size={16} />
            Show public key
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run("Generating secret…", async (valid) => {
                const r = await api.core("secret");
                if (valid()) {
                  setSecret(r.secret);
                  setSecretHash(r.hash);
                }
              })
            }
          >
            Generate 32-byte secret
          </button>
        </div>
        {publicKey && (
          <div className="condition-result">
            <span className="label">Public key</span>
            <p className="full-address">{publicKey}</p>
            <button className="button" onClick={() => void copy(publicKey)}>
              Copy public key
            </button>
          </div>
        )}
        {secret && (
          <div className="condition-result">
            <span className="label">Private secret — keep offline</span>
            <p className="full-address">{secret}</p>
            <span className="label">Shareable SHA-256</span>
            <p className="full-address">{secretHash}</p>
            <div className="form-actions">
              <button
                className="button"
                onClick={() =>
                  void run("Exporting private secret…", async () =>
                    api.download(
                      JSON.stringify({ secret, sha256: secretHash }, null, 2),
                      "requant-private-htlc-secret.json",
                    ),
                  )
                }
              >
                Save secret offline
              </button>
              <button className="button" onClick={() => void copy(secretHash)}>
                Copy SHA-256
              </button>
              <button
                className="button"
                onClick={() => {
                  setValues({ ...values, hash: secretHash });
                  setDescriptor(null);
                  invalidate();
                }}
              >
                Use hash in condition
              </button>
              <button
                className="button"
                onClick={() => {
                  setSecret("");
                  setSecretHash("");
                }}
              >
                Hide & clear secret
              </button>
            </div>
          </div>
        )}
      </section>
      {descriptor && (
        <section className="panel">
          <h2>Prepare a condition payment</h2>
          <p className="subtle">
            Spend all confirmed outputs at this condition address into one
            recipient. Preparation and signing are separate from broadcasting.
          </p>
          <div className="conditions-grid">
            <label className="field">
              <span>Spending path</span>
              <select
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  invalidate();
                }}
              >
                {descriptor.paths.map((p: string) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Recipient address</span>
              <input
                value={recipient}
                onChange={(e) => {
                  setRecipient(e.target.value);
                  invalidate();
                }}
              />
            </label>
            <label className="field">
              <span>Fee rate (atoms per byte)</span>
              <input
                inputMode="numeric"
                value={rate}
                onChange={(e) => {
                  setRate(e.target.value);
                  invalidate();
                }}
              />
            </label>
            {path === "claim" && (
              <label className="field">
                <span>32-byte secret (64 hex digits)</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={preimage}
                  onChange={(e) => {
                    setPreimage(e.target.value);
                    invalidate();
                  }}
                />
              </label>
            )}
          </div>
          <label className="condition-acp">
            <input
              type="checkbox"
              checked={acp}
              onChange={(e) => {
                setAcp(e.target.checked);
                invalidate();
              }}
            />
            Allow additional inputs (anyone-can-pay, activates at block 4700)
          </label>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void run("Preparing condition payment…", async (valid) => {
                const r = await api.prepareCondition(
                  {
                    condition: conditionFile,
                    path,
                    recipient,
                    rate,
                    preimage,
                    anyoneCanPay: acp,
                  },
                  owner,
                );
                if (valid()) {
                  setPayment(r.payment);
                  setReview(r.review);
                  setOutput(null);
                  setSent(false);
                  setPreimage("");
                }
              })
            }
          >
            Prepare & review <ArrowRight size={16} />
          </button>
        </section>
      )}
      {review && (
        <section className="panel condition-review">
          <h2>Review condition payment</h2>
          {review.outputs.map((o, i) => (
            <div className="condition-result" key={i}>
              <span className="label">Recipient {i + 1}</span>
              <p className="full-address">{o.address}</p>
              <strong>{o.amount} RQT</strong>
            </div>
          ))}
          <div className="review-line">
            <span>Network fee</span>
            <strong>{review.fee} RQT</strong>
          </div>
          <div className="review-line">
            <span>Total spent · {review.inputCount} input(s)</span>
            <strong>{review.total} RQT</strong>
          </div>
          {locks && (
            <div className="condition-result">
              <strong>Signing conditions</strong>
              <p>
                Activation: block {locks.activationHeight} · Absolute lock:{" "}
                {locks.afterHeight === "0" ? "none" : locks.afterHeight} ·
                Relative lock: {locks.afterBlocks} blocks per source output
              </p>
              <p>
                {locks.anyoneCanPay
                  ? "Anyone-can-pay: additional inputs may be added; the outputs stay signed."
                  : "Signatures bind all inputs and outputs."}
              </p>
              {locks.revealsSecret && (
                <p className="warning-text">
                  This payment file reveals the HTLC secret. Share it only when
                  you intend to reveal the secret.
                </p>
              )}
            </div>
          )}
          {!output && (
            <>
              <div className="form-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void run("Exporting payment…", async () =>
                      api.download(payment, "requant-condition-payment.json"),
                    )
                  }
                >
                  <FileDown size={16} />
                  Export for offline signing
                </button>
              </div>
              <label className="field">
                <span>Local wallet password</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={wallet.meta.watchOnly}
                />
              </label>
              <button
                className="button primary"
                disabled={
                  busy || !wallet.backedUp || wallet.meta.watchOnly || !password
                }
                onClick={() =>
                  void run("Signing condition payment…", async (valid) => {
                    const r = await api.signCondition(
                      wallet.id,
                      payment,
                      password,
                    );
                    if (valid()) {
                      setOutput(r);
                      setPassword("");
                    }
                  })
                }
              >
                <ShieldCheck size={16} />
                Sign locally / cosign
              </button>
            </>
          )}
          {output?.partial && (
            <div className="condition-result">
              <strong>First signature complete</strong>
              <p>
                Send this file to the holder of the second public key. They
                import it, review every output and cosign.
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run("Exporting partial signature…", async () =>
                    api.download(output.partial!, "requant-partial.json"),
                  )
                }
              >
                <FileDown size={16} />
                Export partial signature
              </button>
            </div>
          )}
          {output?.hex && (
            <div className="condition-result">
              <strong>
                {sent
                  ? "Broadcast pending confirmation"
                  : "Signed payment ready"}
              </strong>
              <p className="full-address">{output.txid}</p>
              <div className="form-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void run("Exporting signed payment…", async () =>
                      api.download(output.hex!, "requant-signed-condition.txt"),
                    )
                  }
                >
                  Save signed file
                </button>
                {!sent && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        "Checking locks & broadcasting…",
                        async (valid) => {
                          const checked = await api.checkConditionBroadcast(
                            output.hex!,
                          );
                          if (!valid()) return;
                          await api.broadcast(checked);
                          if (valid()) setSent(true);
                        },
                      )
                    }
                  >
                    Confirm & broadcast <ArrowRight size={16} />
                  </button>
                )}
                <a
                  href={`https://requant.network/explorer/tx/${output.txid}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View in explorer
                </a>
              </div>
            </div>
          )}
          <div className="form-actions">
            <button
              className="button"
              onClick={() => {
                invalidate();
                setPassword("");
              }}
            >
              Clear payment
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
