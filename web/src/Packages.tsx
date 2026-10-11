import { useState } from "react";
import { FileUp, FileDown, Layers } from "lucide-react";
import * as api from "./service";
import * as protocol from "./protocols";
import {
  Button,
  Details,
  Review,
  usePicker,
  useRunner,
  type Props,
} from "./ProtocolUI";
export default function Packages(p: Props) {
  const [file, setFile] = useState(""),
    [review, setReview] = useState<any>(null),
    [sent, setSent] = useState(false);
  const run = useRunner(p, () => {
    setFile("");
    setReview(null);
    setSent(false);
  });
  const picker = usePicker(run, async (text, valid) => {
    const checked = await protocol.inspectPackage(text);
    if (valid()) {
      setFile(text);
      setReview(checked);
      setSent(false);
    }
  });
  return (
    <div className="protocol-workspace">
      {picker.input}
      <section className="panel protocol-intro">
        <div>
          <span className="eyebrow">PACKAGE RELAY</span>
          <h2>Submit connected transactions.</h2>
          <p className="subtle">
            Send signed parents and children together. The child's fee can cover
            its parent. Keys remain on your signing device.
          </p>
        </div>
        <Layers size={32} />
      </section>
      <section className="panel">
        <h2>Signed transaction package</h2>
        <p className="subtle">
          Import or paste a JSON array of transaction hex strings, parents
          first. Maximum 25 transactions and 200 kB in total.
        </p>
        <Button disabled={p.busy} onClick={picker.pick}>
          <FileUp size={16} />
          Import package
        </Button>
        <label className="field">
          <span>Package JSON</span>
          <textarea
            rows={8}
            value={file}
            spellCheck={false}
            onChange={(e) => {
              setFile(e.target.value);
              setReview(null);
              setSent(false);
            }}
            placeholder={'["parent transaction hex", "child transaction hex"]'}
          />
        </label>
        <Button
          primary
          disabled={p.busy || !file}
          onClick={() =>
            run(
              "Checking package signatures, amounts and source outputs…",
              async (valid) => {
                const checked = await protocol.inspectPackage(file);
                if (valid()) {
                  setReview(checked);
                  setSent(false);
                }
              },
            )
          }
        >
          Verify & review package
        </Button>
      </section>
      {review && (
        <section className="panel">
          <Details
            rows={[
              ["Transactions", review.txids.length],
              ["Combined fee", `${review.fee} RQT`],
              ["Encoded size", `${review.bytes} bytes`],
            ]}
          />
          {review.reviews.map((r: any, i: number) => (
            <div key={review.txids[i]}>
              <h3>Transaction {i + 1}</h3>
              <Details rows={[["Transaction ID", review.txids[i]]]} />
              <Review review={r} />
            </div>
          ))}
          <div className="action-row">
            <Button
              primary
              disabled={p.busy || sent}
              onClick={() =>
                run(
                  "Submitting approved transaction package…",
                  async (valid) => {
                    await protocol.sendPackage(file, review);
                    if (valid()) setSent(true);
                  },
                )
              }
            >
              {sent ? "Package submitted" : "Confirm & submit package"}
            </Button>
            <Button
              disabled={p.busy}
              onClick={() =>
                run("Saving signed package…", async () => {
                  await api.download(
                    JSON.stringify(
                      {
                        requant_package: 1,
                        network: "test",
                        transactions: review.transactions,
                      },
                      null,
                      2,
                    ),
                    "requant-testnet-package.json",
                  );
                })
              }
            >
              <FileDown size={16} />
              Export package
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
