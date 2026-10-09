import { test } from "node:test";
import assert from "node:assert/strict";
import { readBackup } from "../src/backups.mjs";
function file(bytes, chunk = bytes.length) {
  let offset = 0;
  return {
    closed: false,
    async read(buffer) {
      const count = Math.min(chunk, buffer.length, bytes.length - offset);
      if (!count) return null;
      buffer.set(bytes.subarray(offset, offset + count));
      offset += count;
      return count;
    },
    async close() {
      this.closed = true;
    },
  };
}
test("backup reader handles short reads and always closes its selected file", async () => {
  const input = file(new TextEncoder().encode("requant-key:1:example\n"), 3);
  assert.equal(await readBackup(input), "requant-key:1:example\n");
  assert.equal(input.closed, true);
});
test("backup reader stops after 4097 bytes and rejects malformed encoding", async () => {
  const huge = {
    reads: 0,
    closed: false,
    async read(buffer) {
      this.reads++;
      buffer.fill(65);
      return buffer.length;
    },
    async close() {
      this.closed = true;
    },
  };
  await assert.rejects(() => readBackup(huge), /too large/);
  assert.equal(huge.reads, 1);
  assert.equal(huge.closed, true);
  const invalid = file(new Uint8Array([255]));
  await assert.rejects(() => readBackup(invalid), /not a valid/);
  assert.equal(invalid.closed, true);
});
