import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { openExport } from "./crypto.mjs";
import "../signal.css";
import "./telegram.css";
const id = new URLSearchParams(location.search).get("id") ?? "";
const secret = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, "", location.pathname + location.search);
function Export() {
  const [file, setFile] = useState<{ text: string; name: string } | null>(null),
    [error, setError] = useState(""),
    [downloaded, setDownloaded] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        if (
          !/^[a-zA-Z0-9_-]{32}$/.test(id) ||
          !secret.get("key") ||
          !secret.get("iv") ||
          !secret.get("ack")
        )
          throw new Error(
            "This download link is incomplete. Start a new export in Telegram.",
          );
        const r = await fetch(`/telegram-wallet-api/exports/${id}`, {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
        });
        if (!r.ok)
          throw new Error(
            "The download expired. Start a new export in Telegram.",
          );
        setFile(
          await openExport(
            await r.arrayBuffer(),
            secret.get("key")!,
            secret.get("iv")!,
          ),
        );
      } catch {
        setError(
          "This file cannot be opened. The link may have expired or been changed. Export it again from Telegram.",
        );
      }
    })();
  }, []);
  function download() {
    if (!file) return;
    const url = URL.createObjectURL(
      new Blob([file.text + "\n"], { type: "application/octet-stream" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setDownloaded(true);
  }
  async function confirm() {
    try {
      const r = await fetch(`/telegram-wallet-api/exports/${id}/saved`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret.get("ack")}` },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
      if (!r.ok) throw new Error();
      setFile(null);
      secret.delete("key");
      secret.delete("iv");
      secret.delete("ack");
      setSaved(true);
    } catch {
      setError(
        "Could not confirm this download. Return to Telegram and try again.",
      );
    }
  }
  return (
    <main className="telegram-start panel">
      <img src="/wallet/requant-mark.svg" width="48" alt="Requant" />
      <div className="eyebrow">REQUANT / SECURE FILE EXPORT</div>
      <h1>{saved ? "File saved." : "Save your file."}</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {saved ? (
        <p>Return to Telegram. Your wallet will finish the export there.</p>
      ) : file ? (
        <>
          <p>{file.name}</p>
          <p>
            The file was decrypted in this browser. Save it somewhere private
            before confirming.
          </p>
          <div className="action-row">
            <button className="button primary" onClick={download}>
              Download file
            </button>
            <button
              className="button"
              disabled={!downloaded}
              onClick={() => void confirm()}
            >
              I saved the file
            </button>
          </div>
        </>
      ) : (
        !error && <p>Decrypting the file locally…</p>
      )}
      <p className="muted">
        The temporary encrypted copy expires after 10 minutes and is deleted
        when you confirm. Keep your recovery phrase offline.
      </p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Export />);
