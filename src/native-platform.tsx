import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { open as openFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type Platform, type UpdateProps } from "../web/src/platform";
import useWalletUpdates from "./WalletUpdates";
import { native } from "./api";
let dialog = false;
async function withDialog<T>(fn: () => Promise<T>) {
  dialog = true;
  try {
    return await fn();
  } finally {
    dialog = false;
  }
}
function Updates(props: UpdateProps) {
  const value = useWalletUpdates({
    locked: props.locked,
    blocked: props.blocked,
    beforeInstall: async () => props.clear(),
    onInstalling: props.installing,
    showDetails: props.details,
  });
  return value;
}
export function installNativePlatform() {
  if (!native) throw new Error("Start the native Requant Wallet application.");
  const adapter: Platform = {
    kind: "native",
    load: () => invoke("full_state_load"),
    save: (revision, key, value) =>
      invoke("full_state_save", { revision, key, value }),
    core: async (op, args) =>
      JSON.parse(
        await invoke<string>("portable_wallet", {
          op,
          input: JSON.stringify(args),
        }),
      ),
    rpc: (method, params) => invoke("full_wallet_rpc", { method, params }),
    protocol: (method, params) =>
      invoke("full_wallet_protocol", { method, params }),
    lock: () => {
      void invoke("lock_wallet").catch(() => {});
    },
    copy: writeText,
    share: /Android/i.test(navigator.userAgent)
      ? (address) => invoke("share_full_address", { address })
      : undefined,
    fileDialogOpen: () => dialog,
    download: async (text, name) =>
      withDialog(async () => {
        const path = await save({
          title: "Save Requant wallet file",
          defaultPath: name,
        });
        if (!path) return false;
        await writeTextFile(path, text + "\n");
        return true;
      }),
    pick: async (max) =>
      withDialog(async () => {
        const path = await open({
          title: "Open Requant wallet file",
          multiple: false,
          directory: false,
        });
        if (!path || Array.isArray(path)) return null;
        const file = await openFile(path, { read: true });
        const parts: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const chunk = new Uint8Array(65536);
            const n = await file.read(chunk);
            if (!n) break;
            length += n;
            if (length > max)
              throw new Error("File exceeds the supported size.");
            parts.push(chunk.slice(0, n));
          }
        } finally {
          await file.close();
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        return {
          text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          name: path.split(/[\/]/).at(-1) ?? "wallet-file",
        };
      }),
    updates: (props) => <Updates {...props} />,
    settings: () => invoke("get_settings"),
    configure: async (endpoint) => {
      const settings = await invoke<{
        endpoint: string;
        autoLockMinutes: number;
      }>("get_settings");
      await invoke("save_settings", { settings: { ...settings, endpoint } });
    },
  };
  window.__REQUANT_PLATFORM__ = adapter;
  document.addEventListener("click", (e) => {
    const link = (e.target as Element).closest?.("a");
    if (link?.href.startsWith("https://requant.network/")) {
      e.preventDefault();
      void openUrl(link.href);
    }
  });
}
