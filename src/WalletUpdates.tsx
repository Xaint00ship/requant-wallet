import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { command, native, fileDialogOpen } from "./api";
import { canAutoApply } from "./update-policy.mjs";

type Info = { platform: string; version: string };
type AndroidUpdate = { version: string; available: boolean; ready?: boolean };
export default function useWalletUpdates({
  locked,
  blocked,
  beforeInstall,
  onInstalling,
  showDetails,
}: {
  locked: boolean;
  blocked: boolean;
  beforeInstall: () => Promise<void>;
  onInstalling: (value: boolean) => void;
  showDetails: boolean;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [status, setStatus] = useState("Checking for updates…");
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState("");
  const [working, setWorking] = useState(false);
  const pending = useRef<Update | null>(null);
  const checking = useRef(false),
    installing = useRef(false);
  const lastTouch = useRef(Date.now());
  const state = useRef({ locked, blocked, beforeInstall });
  state.current = { locked, blocked, beforeInstall };

  async function install() {
    if (!ready || installing.current || state.current.blocked || fileDialogOpen)
      return;
    installing.current = true;
    setWorking(true);
    onInstalling(true);
    try {
      await state.current.beforeInstall();
      if (info?.platform === "android") {
        const result = await command<{ permissionRequired: boolean }>(
          "install_app_update",
        );
        setStatus(
          result.permissionRequired
            ? "Allow updates from Requant Wallet in Android Settings, then tap Install update again."
            : "Confirm the update in the Android installer.",
        );
      } else {
        setStatus("Installing the verified update…");
        await pending.current!.install();
        await relaunch();
      }
    } catch (error) {
      setStatus(`Update not installed: ${String(error)}`);
    } finally {
      installing.current = false;
      setWorking(false);
      onInstalling(false);
    }
  }

  async function refresh() {
    if (!native || checking.current || pending.current || ready) return;
    checking.current = true;
    setWorking(true);
    setStatus("Checking for updates…");
    try {
      const details = info || (await command<Info>("app_update_info"));
      setInfo(details);
      if (details.platform === "android") {
        setStatus("Checking and downloading verified updates…");
        const update = await command<AndroidUpdate>("check_app_update");
        if (update.available && update.ready) {
          setVersion(update.version);
          setReady(true);
          setStatus(
            "Update downloaded. Android requires confirmation to install.",
          );
        } else setStatus("You are up to date. Automatic checks are enabled.");
      } else {
        const update = await check({ timeout: 20_000 });
        if (!update) {
          setStatus("You are up to date. Automatic checks are enabled.");
          return;
        }
        setVersion(update.version);
        try {
          setStatus("Downloading and verifying the update…");
          await update.download();
          pending.current = update;
          setReady(true);
          setStatus(
            details.platform === "linux-package"
              ? "Verified update ready. Confirm installation; Linux may request administrator permission."
              : "Verified update ready. Installs automatically when the wallet is locked and idle.",
          );
        } catch (error) {
          await update.close();
          throw error;
        }
      }
    } catch {
      setStatus(
        "Cannot check for updates. Will retry automatically; your wallet is unchanged.",
      );
    } finally {
      checking.current = false;
      setWorking(false);
    }
  }

  const actions = useRef({ refresh, install });
  actions.current = { refresh, install };
  useEffect(() => {
    if (!native) return;
    void actions.current.refresh();
    const timer = setInterval(
      () => void actions.current.refresh(),
      60 * 60_000,
    );
    const wake = () => {
      if (!document.hidden) void actions.current.refresh();
    };
    const touch = () => {
      lastTouch.current = Date.now();
    };
    document.addEventListener("visibilitychange", wake);
    document.addEventListener("pointerdown", touch);
    document.addEventListener("keydown", touch);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      document.removeEventListener("pointerdown", touch);
      document.removeEventListener("keydown", touch);
    };
  }, []);
  useEffect(() => {
    if (
      !ready ||
      info?.platform === "android" ||
      info?.platform === "linux-package"
    )
      return;
    const timer = setInterval(() => {
      if (
        canAutoApply({
          ...state.current,
          idleMs: Date.now() - lastTouch.current,
          visible: !document.hidden,
        }) &&
        !fileDialogOpen
      )
        void actions.current.install();
    }, 5_000);
    return () => clearInterval(timer);
  }, [ready, info?.platform]);

  if (!native || (!showDetails && !ready)) return null;
  return (
    <section className="card wallet-updates" aria-live="polite">
      <h2>Wallet updates {info && <small>v{info.version}</small>}</h2>
      <p className="muted small">{status}</p>
      <div className="actions">
        {ready && (
          <button
            className="button primary"
            disabled={working || blocked}
            onClick={() => void install()}
          >
            Install update {version}
          </button>
        )}
        {!ready && (
          <button
            className="button"
            disabled={working}
            onClick={() => void refresh()}
          >
            Check for updates
          </button>
        )}
        {info?.platform === "linux-package" && version && (
          <a
            className="button"
            href="https://requant.network/docs/wallet#download-wallet"
            onClick={(e) => {
              e.preventDefault();
              void command("open_wallet_downloads");
            }}
          >
            Download Linux update
          </a>
        )}
      </div>
    </section>
  );
}
