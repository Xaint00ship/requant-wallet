import { platform } from "./platform";
const OLD_KEYS = ["requant.web.v1", "requant.web.outbox.v1"];
type Disk = { revision: number; data: Record<string, string> };
let memory: Disk = { revision: 0, data: {} };
let connection: IDBDatabase | undefined;
let queue = Promise.resolve();
export function read(key: string, fallback = "[]") {
  return memory.data[key] ?? fallback;
}
export async function initialize() {
  const adapter = platform();
  if (adapter) {
    memory = await adapter.load();
    return;
  }
  connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("requant-wallet", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("state");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error("Wallet storage unavailable."));
  });
  memory = await new Promise<Disk>((resolve, reject) => {
    const tx = connection!.transaction("state", "readonly"),
      r = tx.objectStore("state").get("disk");
    r.onsuccess = () => resolve(r.result ?? { revision: 0, data: {} });
    r.onerror = () => reject(r.error);
  });
  const legacy = Object.fromEntries(
    OLD_KEYS.map((key) => [key, localStorage.getItem(key)]).filter(
      ([, value]) =>
        value !== null &&
        value !== undefined &&
        !(typeof value === "string" && value.length === 0),
    ),
  ) as Record<string, string>;
  if (Object.keys(memory.data).length === 0 && Object.keys(legacy).length) {
    await new Promise<void>((resolve, reject) => {
      const tx = connection!.transaction("state", "readwrite"),
        store = tx.objectStore("state"),
        request = store.get("disk");
      let next: Disk;
      request.onsuccess = () => {
        next = request.result ?? { revision: 0, data: {} };
        if (Object.keys(next.data).length === 0) {
          next = { revision: next.revision + 1, data: legacy };
          store.put(next, "disk");
        }
      };
      tx.oncomplete = () => {
        memory = next;
        resolve();
      };
      tx.onerror = tx.onabort = () =>
        reject(new Error("Cannot migrate local wallet storage."));
    });
  }
  if (OLD_KEYS.every((key) => !legacy[key] || memory.data[key] === legacy[key]))
    for (const key of OLD_KEYS) localStorage.removeItem(key);
}
export function write(key: string, value: string): Promise<void> {
  const operation = queue.then(async () => {
    const expected = memory.revision;
    const adapter = platform();
    if (adapter) {
      const revision = await adapter.save(expected, key, value);
      memory = { revision, data: { ...memory.data, [key]: value } };
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = connection!.transaction("state", "readwrite"),
        store = tx.objectStore("state"),
        r = store.get("disk");
      let conflict = false;
      r.onsuccess = () => {
        const disk: Disk = r.result ?? { revision: 0, data: {} };
        if (disk.revision !== expected) {
          conflict = true;
          tx.abort();
          return;
        }
        store.put(
          { revision: expected + 1, data: { ...disk.data, [key]: value } },
          "disk",
        );
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(
          new Error(
            conflict
              ? "Wallet changed in another tab. Reload before continuing."
              : "Cannot save wallet. Export a backup before clearing storage.",
          ),
        );
    });
    memory = { revision: expected + 1, data: { ...memory.data, [key]: value } };
  });
  queue = operation.catch(() => {});
  return operation;
}
