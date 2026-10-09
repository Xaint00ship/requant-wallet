export function atoms(text) {
  if (!/^\d+(?:\.\d{0,8})?$/.test(text))
    throw new Error("Enter an RQT amount with up to eight decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const value = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  if (value > 2n ** 63n) throw new Error("Amount exceeds the consensus limit.");
  return value;
}
export function rqt(value) {
  const n = BigInt(value);
  const sign = n < 0n ? "-" : "";
  const absolute = n < 0n ? -n : n;
  return `${sign}${absolute / 100000000n}.${String(absolute % 100000000n).padStart(8, "0")}`;
}
export function short(value, start = 10, end = 8) {
  return value.length <= start + end + 3
    ? value
    : `${value.slice(0, start)}…${value.slice(-end)}`;
}
