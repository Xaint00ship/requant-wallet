import init, { run } from "../../pkg-browser/requant_browser_core.js";
const ready = init();
self.onmessage = async ({ data }) => {
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
