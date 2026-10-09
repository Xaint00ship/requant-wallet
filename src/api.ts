import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { open as openFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readBackup } from "./backups.mjs";
export const native = isTauri();
export const android = /Android/i.test(navigator.userAgent);
export let fileDialogOpen = false;
async function fileDialog<T>(fn: () => Promise<T>): Promise<T> {
  fileDialogOpen = true;
  try {
    return await fn();
  } finally {
    fileDialogOpen = false;
    document.dispatchEvent(new Event("visibilitychange"));
  }
}
export async function command<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!native)
    throw new Error(
      "Open the native Requant Wallet application to use this feature.",
    );
  return invoke<T>(name, args);
}
export async function pickBackup() {
  const path = await fileDialog(() =>
    open({
      multiple: false,
      directory: false,
      title: "Restore Requant wallet",
      filters: [
        {
          name: "Requant key backup",
          extensions: android ? ["*/*"] : ["key", "txt"],
        },
      ],
    }),
  );
  if (!path || Array.isArray(path)) return null;
  return readBackup(await openFile(path, { read: true }));
}
export async function saveBackup(id: string, password: string) {
  const data = await command<string>("export_backup", { id, password });
  const path = await fileDialog(() =>
    save({
      title: "Save encrypted wallet backup",
      defaultPath: "requant-wallet.key",
      filters: [
        {
          name: "Requant key backup",
          extensions: android ? ["application/octet-stream"] : ["key"],
        },
      ],
    }),
  );
  if (!path) return false;
  await writeTextFile(path, data + "\n", { mode: 0o600 });
  await command("confirm_backup", { id, password });
  return true;
}
export async function copyAddress(address: string) {
  if (native) await writeText(address);
  else await navigator.clipboard.writeText(address);
}
export async function explorer(path: string) {
  const url = `https://requant.network/explorer/${path}`;
  if (native) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
