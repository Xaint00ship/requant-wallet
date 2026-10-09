import test from "node:test";
import assert from "node:assert/strict";
import { atoms, rqt } from "../src/amounts.mjs";
test("RQT formatting preserves atom precision above Number.MAX_SAFE_INTEGER", () => {
  assert.equal(rqt(9223372036854775808n), "92233720368.54775808");
  assert.equal(atoms("92233720368.54775808"), 9223372036854775808n);
  assert.equal(rqt(atoms("12.5") + atoms("0.00001")), "12.50001000");
  assert.equal(rqt(-1n), "-0.00000001");
});
test("amount validation rejects exponent, signs, excess precision and overflow", () => {
  for (const bad of [
    "1e8",
    "-1",
    "+1",
    ".1",
    "1.000000001",
    "92233720368.54775809",
    "NaN",
    "",
  ])
    assert.throws(() => atoms(bad));
});
