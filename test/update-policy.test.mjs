import test from "node:test";
import assert from "node:assert/strict";
import { canAutoApply } from "../src/update-policy.mjs";
test("automatic restart waits for a locked idle visible wallet and never interrupts a protected flow", () => {
  const idle = { locked: true, blocked: false, idleMs: 60_000, visible: true };
  assert.equal(canAutoApply(idle), true);
  for (const override of [
    { locked: false },
    { blocked: true },
    { idleMs: 59_999 },
    { visible: false },
  ])
    assert.equal(canAutoApply({ ...idle, ...override }), false);
});
