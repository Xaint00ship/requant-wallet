const MAX = 32 * 1024 * 1024;
export const validName = (name) =>
  typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name);
export function encode(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function decode(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("Invalid file link.");
  return Uint8Array.from(
    atob(text.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
export async function sealExport(text, name) {
  if (!validName(name) || typeof text !== "string")
    throw new Error("Invalid file export.");
  const input = new TextEncoder().encode(JSON.stringify({ name, text }));
  if (input.byteLength > MAX) throw new Error("File export exceeds 32 MB.");
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "encrypt",
  ]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aes,
    input,
  );
  return { encrypted, key: encode(key), iv: encode(iv) };
}
export async function openExport(encrypted, keyText, ivText) {
  const key = decode(keyText),
    iv = decode(ivText);
  if (key.length !== 32 || iv.length !== 12 || encrypted.byteLength > MAX + 16)
    throw new Error("Invalid file link.");
  const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "decrypt",
  ]);
  const decoded = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aes,
    encrypted,
  );
  const file = JSON.parse(new TextDecoder().decode(decoded));
  if (!validName(file.name) || typeof file.text !== "string")
    throw new Error("Invalid file export.");
  return file;
}
