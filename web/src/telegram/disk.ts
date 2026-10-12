type Disk = { revision: number; data: Record<string, string> };
// The Telegram id is only a local database namespace. It never grants server access.
// Export endpoints independently verify Telegram's signed initData.
export function deviceDisk(userId: number) {
  let connection: Promise<IDBDatabase> | undefined;
  const open = () =>
    (connection ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(`requant-telegram-v1-${userId}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () =>
        reject(
          new Error(
            "Device storage is unavailable. Reopen Telegram or use the Web Wallet.",
          ),
        );
    }));
  return {
    async load(): Promise<Disk> {
      const db = await open();
      return new Promise((resolve, reject) => {
        const r = db
          .transaction("state", "readonly")
          .objectStore("state")
          .get("disk");
        r.onsuccess = () => {
          const disk = r.result ?? { revision: 0, data: {} };
          if (
            !Number.isSafeInteger(disk.revision) ||
            disk.revision < 0 ||
            !disk.data ||
            typeof disk.data !== "object"
          ) {
            reject(
              new Error(
                "Device storage is unreadable. Restore your encrypted backup.",
              ),
            );
            return;
          }
          resolve(disk);
        };
        r.onerror = () =>
          reject(
            new Error(
              "Cannot read device storage. Restore your encrypted backup.",
            ),
          );
      });
    },
    async save(expected: number, key: string, value: string): Promise<number> {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("state", "readwrite"),
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
        tx.oncomplete = () => resolve(expected + 1);
        tx.onerror = tx.onabort = () =>
          reject(
            new Error(
              conflict
                ? "Wallet changed in another session. Reopen the app before continuing."
                : "Cannot save wallet. Export a backup before clearing Telegram storage.",
            ),
          );
      });
    },
  };
}
