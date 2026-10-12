import { createRoot } from "react-dom/client";
import type { TelegramApp } from "./types";
import { sealExport } from "./crypto.mjs";
export function fileBridge(tg: TelegramApp) {
  let active = false;
  return {
    active: () => active,
    download: async (text: string, name: string): Promise<boolean> => {
      if (active) throw new Error("Finish the current file export first.");
      active = true;
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      const controller = new AbortController();
      let entry: { id: string; acknowledgment: string } | undefined;
      let finish!: (saved: boolean) => void;
      const completed = new Promise<boolean>((resolve) => {
        finish = resolve;
      });
      const render = (message: string, url?: string) =>
        root.render(
          <div className="modal-backdrop" role="presentation">
            <section
              className="telegram-file panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="export-title"
            >
              <div className="eyebrow">REQUANT / FILE EXPORT</div>
              <h2 id="export-title">Save your file</h2>
              <p>{message}</p>
              <p className="muted">
                Save it in your browser, confirm the download there, then return
                to Telegram. The link expires in 10 minutes.
              </p>
              <div className="action-row">
                {url && (
                  <button
                    className="button primary"
                    onClick={() => tg.openLink(url)}
                  >
                    Open secure download
                  </button>
                )}
                <button
                  className="button"
                  onClick={() => {
                    controller.abort();
                    finish(false);
                  }}
                >
                  Cancel export
                </button>
              </div>
            </section>
          </div>,
        );
      try {
        render("Encrypting this file on your device…");
        const sealed = await sealExport(text, name);
        if (controller.signal.aborted) return false;
        const r = await fetch("/telegram-wallet-api/exports", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Telegram-Init-Data": tg.initData,
          },
          body: sealed.encrypted,
          signal: controller.signal,
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
        });
        if (!r.ok)
          throw new Error(
            r.status === 401
              ? "Telegram session expired. Reopen the Mini App and export again."
              : "File export is unavailable. Try again in a moment.",
          );
        entry = await r.json();
        if (
          !entry ||
          !/^[a-zA-Z0-9_-]{32}$/.test(entry.id) ||
          !/^[a-zA-Z0-9_-]{32}$/.test(entry.acknowledgment)
        )
          throw new Error("Invalid export response.");
        const fragment = new URLSearchParams({
          key: sealed.key,
          iv: sealed.iv,
          ack: entry.acknowledgment,
        });
        const url = `${location.origin}/telegram-wallet/export.html?id=${entry.id}#${fragment}`;
        render(
          `Ready to save ${name}. Waiting for your download confirmation…`,
          url,
        );
        const end = Date.now() + 10 * 60_000;
        void (async () => {
          while (!controller.signal.aborted && Date.now() < end) {
            try {
              const status = await fetch(
                `/telegram-wallet-api/exports/${entry!.id}/status`,
                {
                  headers: { Authorization: `Bearer ${entry!.acknowledgment}` },
                  cache: "no-store",
                  credentials: "omit",
                  redirect: "error",
                  signal: controller.signal,
                },
              );
              if (status.ok && (await status.json()).saved) {
                finish(true);
                return;
              }
              if (status.status === 404) break;
            } catch {
              if (controller.signal.aborted) return;
            }
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
          if (!controller.signal.aborted) {
            render("The link expired. Cancel this export and start a new one.");
          }
        })();
        return await completed;
      } catch (e) {
        if (controller.signal.aborted) return false;
        throw e;
      } finally {
        controller.abort();
        if (entry)
          void fetch(`/telegram-wallet-api/exports/${entry.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${entry.acknowledgment}` },
            credentials: "omit",
            cache: "no-store",
          }).catch(() => {});
        root.unmount();
        host.remove();
        active = false;
      }
    },
  };
}
