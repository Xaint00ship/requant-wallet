import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const files = [];
function walk(dir) {
  for (const entry of readdirSync(`dist-web${dir}`, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path);
    else if (!["/sw.js", "/sw-telegram.js", "/version.json"].includes(path))
      files.push(`/wallet${path}`);
  }
}
walk("");
const revision = createHash("sha256")
  .update(
    files
      .map((path) =>
        readFileSync(`dist-web${path.slice(7)}`).toString("base64"),
      )
      .join(""),
  )
  .digest("hex")
  .slice(0, 16);
writeFileSync(
  "dist-web/sw.js",
  `const CACHE='requant-wallet-${revision}';const FILES=${JSON.stringify(files)};\n` +
    readFileSync("web/service-worker.js", "utf8"),
);
const telegramFiles = files.map((path) =>
  path === "/wallet/telegram.html"
    ? "/telegram-wallet/"
    : path === "/wallet/export.html"
      ? "/telegram-wallet/export.html"
      : path,
);
writeFileSync(
  "dist-web/sw-telegram.js",
  `const CACHE='requant-telegram-wallet-${revision}';const FILES=${JSON.stringify(telegramFiles)};\n` +
    readFileSync("web/service-worker.js", "utf8"),
);
writeFileSync(
  "dist-web/version.json",
  JSON.stringify({
    version: JSON.parse(readFileSync("package.json", "utf8")).version,
    revision,
  }) + "\n",
);
console.log(
  `Packaged web wallet ${revision}; ${files.length} public assets available offline.`,
);
