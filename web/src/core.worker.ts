import init, { run } from "../../pkg-browser/requant_browser_core.js";
// The page fetches the public binary and transfers it here. Some embedded browser
// clients stall a Worker's own HTTPS streaming fetch. Signing still stays here.
let loaded!: () => void, failed!: (e: Error) => void;
const ready = new Promise<void>((resolve, reject) => {
  loaded = resolve;
  failed = reject;
});
const startup = setTimeout(
  () => failed(new Error("Wallet core startup timed out.")),
  20000,
);
self.postMessage({
  type: "LOAD_CORE",
  url: new URL(
    "../../pkg-browser/requant_browser_core_bg.wasm",
    import.meta.url,
  ).href,
});
// Keep a failed startup handled until the first operation can report it to the UI.
void ready.catch(() => {});
self.onmessage = async ({ data }) => {
  if (data.type === "CORE_BYTES") {
    try {
      await init({ module_or_path: data.bytes });
      clearTimeout(startup);
      loaded();
    } catch {
      clearTimeout(startup);
      failed(new Error("Wallet core could not start."));
    }
    return;
  }
  if (data.type === "CORE_FAILED") {
    clearTimeout(startup);
    failed(new Error("Wallet core unavailable. Reopen the wallet."));
    return;
  }
  try {
    await ready;
    const result = JSON.parse(run(data.op, JSON.stringify(data.args)));
    self.postMessage({ id: data.id, result });
  } catch (e) {
    self.postMessage({
      id: data.id,
      error: typeof e === "string" ? e : "The local wallet operation failed.",
    });
  }
};
