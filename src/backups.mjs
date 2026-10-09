// Bound file reads before the IPC bridge allocates the complete document.
export async function readBackup(file) {
  try {
    const bytes = new Uint8Array(4097);
    let used = 0;
    while (used < bytes.length) {
      const count = await file.read(bytes.subarray(used));
      if (!count) break;
      used += count;
    }
    if (used > 4096) throw new Error("The backup file is too large.");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, used),
      );
    } catch {
      throw new Error("The backup is not a valid Requant key file.");
    }
  } finally {
    await file.close();
  }
}
