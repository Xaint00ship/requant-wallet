import { createHmac, timingSafeEqual } from "node:crypto";
export function verifyInitData(
  raw,
  token,
  now = Math.floor(Date.now() / 1000),
) {
  if (typeof raw !== "string" || !raw || raw.length > 16384)
    throw new Error("Invalid Telegram session");
  const params = new URLSearchParams(raw);
  const pairs = [...params.entries()];
  if (new Set(pairs.map(([key]) => key)).size !== pairs.length)
    throw new Error("Duplicate Telegram fields");
  const hash = params.get("hash");
  if (!/^[a-f0-9]{64}$/.test(hash ?? ""))
    throw new Error("Invalid Telegram signature");
  const payload = pairs
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", key).update(payload).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex")))
    throw new Error("Invalid Telegram signature");
  const date = Number(params.get("auth_date"));
  if (
    !Number.isSafeInteger(date) ||
    date <= 0 ||
    date > now + 60 ||
    now - date > 24 * 3600
  )
    throw new Error("Expired Telegram session");
  const user = JSON.parse(params.get("user") ?? "null");
  if (!Number.isSafeInteger(user?.id) || user.id < 1)
    throw new Error("Invalid Telegram user");
  return { id: user.id };
}
