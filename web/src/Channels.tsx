import { useState } from "react";
import { ArrowRight, FileDown, FileUp, RefreshCw } from "lucide-react";
import * as api from "./service";
import * as protocol from "./protocols";
import {
  Button,
  Details,
  Field,
  Review,
  units,
  usePicker,
  useRunner,
  type Props,
} from "./ProtocolUI";
export default function Channels(p: Props) {
  const belongs = (r: protocol.Channel) =>
    r.walletId === p.wallet.id ||
    p.wallet.meta.addresses.some(
      (a) =>
        a.address === r.details.client_to || a.address === r.details.server_to,
    );
  const [rows, setRows] = useState(() =>
      protocol.list().channels.filter(belongs),
    ),
    [selected, setSelected] = useState<protocol.Channel | null>(null);
  const [server, setServer] = useState(""),
    [serverAddress, setServerAddress] = useState(""),
    [amount, setAmount] = useState("1"),
    [expiry, setExpiry] = useState(""),
    [rate, setRate] = useState("5"),
    [password, setPassword] = useState("");
  const [paid, setPaid] = useState(""),
    [stateHex, setStateHex] = useState(""),
    [status, setStatus] = useState<any>(null),
    [review, setReview] = useState<any>(null),
    [plan, setPlan] = useState<api.Plan | null>(null),
    [action, setAction] = useState("");
  const refreshRows = () => setRows(protocol.list().channels.filter(belongs));
  const run = useRunner(p, () => {
    setPassword("");
    setSelected(null);
    setPlan(null);
    setReview(null);
    setStatus(null);
    setStateHex("");
    setAction("");
    refreshRows();
  });
  const choose = (r: protocol.Channel) => {
    setSelected(r);
    setReview(null);
    setPlan(null);
    setStatus(null);
    setStateHex(r.state ?? "");
    setPaid(r.details.paidAmount);
    setPassword("");
  };
  const picker = usePicker(run, async (text, valid) => {
    if (text.trim().startsWith("{")) {
      const checked = await api.core("channelInspect", { channel: text });
      if (!valid()) return;
      const old = protocol
        .list()
        .channels.find((c) => c.id === checked.details.funding_txid);
      const row = await protocol.putChannel({
        ...checked,
        id: checked.details.funding_txid,
        walletId: p.wallet.id,
        state: old?.state,
      });
      if (valid()) {
        choose(row);
        refreshRows();
      }
    } else {
      if (!selected)
        throw new Error(
          "Import or select the channel before importing a payment state.",
        );
      const checked = await api.core("channelReceive", {
        channel: selected.channel,
        state: text.trim(),
      });
      if (!valid()) return;
      const row = await protocol.putChannel({ ...selected, ...checked });
      if (valid()) {
        setSelected(row);
        setStateHex(checked.state);
        refreshRows();
        setReview(null);
      }
    }
  });
  const refresh = () =>
    run("Checking channel deposit…", async (valid) => {
      if (!selected) return;
      const s = await protocol.channelStatus(selected);
      if (valid()) {
        setStatus(s);
        setReview(null);
      }
    });
  const prepareOpen = () =>
    run("Preparing channel proposal…", async (valid) => {
      const client = await api.conditionPublicKey(
        p.wallet.id,
        p.wallet.meta.address,
        password,
      );
      const c = await api.core("channelAddress", {
        client: client.pubkey,
        server,
      });
      const node = await api.info();
      if (!expiry || BigInt(expiry) <= BigInt(node.height) + 20n)
        throw new Error(
          `Choose an expiry later than block ${BigInt(node.height) + 20n}.`,
        );
      const funding = await api.prepare(
        p.wallet.id,
        [{ address: c.address, amount }],
        Number(rate),
      );
      if (valid()) {
        setPlan(funding);
        setReview({ review: funding.review });
        setAction("open");
        setSelected(null);
      }
    });
  const execute = () =>
    run("Signing approved channel operation…", async (valid) => {
      if (action === "open" && plan) {
        await api.fresh(plan);
        const node = await api.info();
        const checked = await api.core("channelCreate", {
          file: api.wallet(p.wallet.id).file,
          password,
          unsigned: plan.unsigned,
          clientAddress: p.wallet.meta.address,
          server,
          serverAddress,
          expiry,
          height: node.height,
        });
        if (!valid()) return;
        const row = await protocol.putChannel({
          ...checked,
          id: checked.details.funding_txid,
          walletId: p.wallet.id,
        });
        if (valid()) {
          setSelected(row);
          setPlan(null);
          setReview(null);
          setPassword("");
          refreshRows();
        }
        return;
      }
      if (!selected || !review) return;
      const s = await protocol.channelStatus(selected);
      let signed;
      if (action === "fund") {
        if (s.funded || s.closed)
          throw new Error("Channel is already funded or closed.");
        signed = await protocol.channelFunding(
          { ...selected, walletId: p.wallet.id },
          password,
        );
        if (JSON.stringify(signed.review) !== JSON.stringify(review.review))
          throw new Error("Funding changed. Review again.");
      } else {
        if (!s.funded || !s.confirmed)
          throw new Error("Channel deposit must be confirmed and unspent.");
        signed = await api.core(
          action === "close" ? "channelClose" : "channelRefund",
          {
            channel: selected.channel,
            state: stateHex,
            height: s.node.height,
            file: api.wallet(p.wallet.id).file,
            password,
          },
        );
        if (signed.txid !== review.txid)
          throw new Error("Channel transaction changed. Review again.");
      }
      if (!valid()) return;
      await api.broadcast(signed);
      if (valid()) {
        setReview(null);
        setPassword("");
        setStatus(null);
      }
    });
  const prepare = (a: string) =>
    run("Reviewing channel transaction…", async (valid) => {
      if (!selected) return;
      let r;
      if (a === "fund") r = await protocol.channelFunding(selected);
      else {
        const s = await protocol.channelStatus(selected);
        if (!s.funded || !s.confirmed)
          throw new Error("Channel deposit must be confirmed and unspent.");
        r = await api.core(a === "close" ? "channelClose" : "channelRefund", {
          channel: selected.channel,
          state: stateHex,
          height: s.node.height,
          file: api.wallet(p.wallet.id).file,
          password,
        });
      }
      if (valid()) {
        setReview(r);
        setAction(a);
        setPlan(null);
      }
    });
  const invalidate = () => {
    setPlan(null);
    setReview(null);
  };
  return (
    <div className="protocol-workspace">
      {picker.input}
      <section className="panel protocol-intro">
        <div>
          <span className="eyebrow">ONE-WAY PAYMENT CHANNELS</span>
          <h2>Many payments. One deposit.</h2>
          <p className="subtle">
            The server signs your timed refund before you fund. Each payment
            state increases the total paid.
          </p>
        </div>
      </section>
      <div className="protocol-columns">
        <section className="panel">
          <h2>Open a channel</h2>
          <Field
            label="Server public key (64 hex digits)"
            value={server}
            onChange={(v) => {
              setServer(v);
              invalidate();
            }}
          />
          <Field
            label="Server payment address"
            value={serverAddress}
            onChange={(v) => {
              setServerAddress(v);
              invalidate();
            }}
          />
          <div className="conditions-grid">
            <Field
              label="Deposit (RQT)"
              value={amount}
              onChange={(v) => {
                setAmount(v);
                invalidate();
              }}
            />
            <Field
              label="Refund from block height"
              value={expiry}
              onChange={(v) => {
                setExpiry(v);
                invalidate();
              }}
            />
            <Field
              label="Funding fee (atoms/byte)"
              value={rate}
              onChange={(v) => {
                setRate(v);
                invalidate();
              }}
            />
            <Field
              label="Wallet signing password"
              type="password"
              value={password}
              onChange={setPassword}
            />
          </div>
          <div className="action-row">
            <Button
              primary
              disabled={p.busy || !password || p.wallet.meta.watchOnly}
              onClick={prepareOpen}
            >
              Review proposal <ArrowRight size={16} />
            </Button>
            <Button disabled={p.busy} onClick={picker.pick}>
              <FileUp size={16} />
              Import channel / state
            </Button>
          </div>
        </section>
        <section className="panel">
          <h2>Saved channels</h2>
          {rows.length ? (
            rows.map((r) => (
              <button
                className={`protocol-list-row ${selected?.id === r.id ? "selected" : ""}`}
                disabled={p.busy}
                key={r.id}
                onClick={() => choose(r)}
              >
                <span>
                  <strong>{r.details.depositAmount} RQT</strong>
                  <small>
                    {r.details.accepted
                      ? "Refund signed by both sides"
                      : "Waiting for refund signature"}{" "}
                    · paid {r.details.paidAmount}
                  </small>
                </span>
                <ArrowRight size={18} />
              </button>
            ))
          ) : (
            <p className="empty">No channels yet.</p>
          )}
          <p className="subtle">
            Export the proposal for the server. Import its accepted file before
            funding. Keep the latest payment state and channel file.
          </p>
        </section>
      </div>
      {selected && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Channel workspace</h2>
            <Button disabled={p.busy} onClick={refresh}>
              <RefreshCw size={16} />
              Refresh deposit
            </Button>
          </div>
          <Details
            rows={[
              ["Funding transaction", selected.id],
              ["Channel address", selected.details.address],
              ["Deposit", `${selected.details.depositAmount} RQT`],
              ["Paid so far", `${selected.details.paidAmount} RQT`],
              ["Client refund & change", selected.details.client_to],
              ["Server payments", selected.details.server_to],
              ["Refund from block", selected.details.expiry],
              [
                "Refund signatures",
                selected.details.accepted
                  ? "Client and server verified"
                  : "Client only — do not fund",
              ],
              [
                "Live status",
                status
                  ? status.closed
                    ? "Closed"
                    : status.funded
                      ? status.confirmed
                        ? "Open · deposit confirmed"
                        : "Funding unconfirmed"
                      : "Not funded"
                  : null,
              ],
              ["Blocks remaining", status?.blocksLeft?.toString()],
            ]}
          />
          <div className="action-row">
            <Button
              disabled={p.busy}
              onClick={() =>
                run("Saving public channel file…", async () => {
                  await api.download(
                    selected.channel,
                    `requant-channel-${selected.id}.json`,
                  );
                })
              }
            >
              <FileDown size={16} />
              Export channel
            </Button>
            <Button
              disabled={p.busy || !password || selected.details.accepted}
              onClick={() =>
                run("Signing client refund as server…", async (valid) => {
                  const node = await api.info();
                  const checked = await api.core("channelAccept", {
                    channel: selected.channel,
                    file: api.wallet(p.wallet.id).file,
                    password,
                    height: node.height,
                  });
                  if (!valid()) return;
                  const row = await protocol.putChannel({
                    ...selected,
                    ...checked,
                  });
                  if (valid()) {
                    setSelected(row);
                    refreshRows();
                    setReview(null);
                  }
                })
              }
            >
              Accept & sign refund
            </Button>
            <Button
              primary
              disabled={p.busy || !selected.details.accepted}
              onClick={() => prepare("fund")}
            >
              Review deposit funding
            </Button>
          </div>
          <div className="protocol-refund">
            <h3>Incremental payments</h3>
            <p className="subtle">
              Enter the cumulative total, including previous payments. A signed
              state lets the server collect that amount.
            </p>
            <Field
              label="Total paid to server (RQT)"
              value={paid}
              onChange={(v) => {
                setPaid(v);
                setReview(null);
              }}
            />
            <Button
              disabled={p.busy || !password || !selected.details.accepted}
              onClick={() =>
                run("Signing cumulative channel payment…", async (valid) => {
                  const st = await protocol.channelStatus(selected);
                  if (!st.funded || !st.confirmed)
                    throw new Error("Fund and confirm the channel first.");
                  const checked = await api.core("channelPay", {
                    channel: selected.channel,
                    file: api.wallet(p.wallet.id).file,
                    password,
                    height: st.node.height,
                    amount: paid,
                  });
                  if (!valid()) return;
                  const row = await protocol.putChannel({
                    ...selected,
                    ...checked,
                  });
                  if (valid()) {
                    setSelected(row);
                    setStateHex(checked.state);
                    refreshRows();
                    setReview(null);
                  }
                })
              }
            >
              Sign payment state
            </Button>
            <label className="field">
              <span>Latest client-signed payment state (hex)</span>
              <textarea
                value={stateHex}
                onChange={(e) => {
                  setStateHex(e.target.value);
                  setReview(null);
                }}
                rows={3}
                spellCheck={false}
              />
            </label>
            <div className="action-row">
              <Button
                disabled={p.busy || !stateHex}
                onClick={() =>
                  run("Verifying received channel state…", async (valid) => {
                    const checked = await api.core("channelReceive", {
                      channel: selected.channel,
                      state: stateHex,
                    });
                    if (!valid()) return;
                    const row = await protocol.putChannel({
                      ...selected,
                      ...checked,
                    });
                    if (valid()) {
                      setSelected(row);
                      setStateHex(checked.state);
                      refreshRows();
                      setReview(null);
                    }
                  })
                }
              >
                Verify & save received state
              </Button>
              <Button
                disabled={p.busy || !selected.state}
                onClick={() =>
                  run("Exporting latest verified payment state…", async () => {
                    await api.download(
                      selected.state!,
                      `requant-channel-state-${selected.id}.hex`,
                    );
                  })
                }
              >
                <FileDown size={16} />
                Export saved state
              </Button>
              <Button
                disabled={p.busy || !password || !stateHex}
                onClick={() => prepare("close")}
              >
                Review server close
              </Button>
              <Button disabled={p.busy} onClick={() => prepare("refund")}>
                Review client refund
              </Button>
            </div>
          </div>
        </section>
      )}
      {review && (
        <section className="panel">
          <Review review={review.review} />
          <p className="protocol-warning">
            {action === "open"
              ? "This signs a channel proposal and your timed refund. Export it to the server; funding requires its refund signature."
              : "Confirm the full recipients and fee. The transaction will be submitted to Requant testnet."}
          </p>
          <Button
            primary
            disabled={p.busy || (action !== "refund" && !password)}
            onClick={execute}
          >
            {action === "open"
              ? "Confirm & create proposal"
              : "Confirm, sign & send"}
          </Button>
          <Button
            disabled={p.busy}
            onClick={() => {
              setReview(null);
              setPlan(null);
            }}
          >
            Cancel
          </Button>
        </section>
      )}
    </div>
  );
}
