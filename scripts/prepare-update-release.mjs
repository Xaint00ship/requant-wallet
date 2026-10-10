import {
  readdirSync,
  readFileSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

// Input is the artifacts from ONE successful, reviewed GitHub Actions run.
// Private signing material is read only by the local Tauri signer, never uploaded.
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const i = arg.indexOf("=");
    return [arg.slice(0, i), arg.slice(i + 1)];
  }),
);
if (!args["--input"] || !args["--output"] || !args["--key"])
  throw new Error("Use --input=DIR --output=DIR --key=PRIVATE_KEY_PATH");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const input = resolve(args["--input"]),
  output = resolve(args["--output"]);
if (existsSync(output))
  throw new Error(
    "Use a fresh release output directory to avoid mixed builds.",
  );
const all = [];
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else all.push(file);
  }
}
walk(input);
function one(predicate) {
  const found = all.filter(predicate);
  if (found.length !== 1)
    throw new Error(`Expected exactly one artifact; found ${found.length}.`);
  return found[0];
}
mkdirSync(output, { recursive: true });
const files = [];
function copy(source, name, signed = false) {
  const file = join(output, name);
  copyFileSync(source, file);
  files.push(file);
  if (signed) {
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/@tauri-apps/cli/tauri.js",
        "signer",
        "sign",
        "--private-key-path",
        resolve(args["--key"]),
        "--app-version",
        version,
        file,
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0)
      throw new Error(
        "Local artifact signing failed. No feed has been published.",
      );
    if (!existsSync(`${file}.sig`))
      throw new Error("Missing update signature.");
    files.push(`${file}.sig`);
  }
  const bytes = readFileSync(file);
  return {
    url: `https://requant.network/downloads/wallet/v${version}-testnet/${name}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    ...(signed
      ? { signature: readFileSync(`${file}.sig`, "utf8").trim() }
      : {}),
  };
}
const win = copy(
  one((f) => f.endsWith(".exe")),
  `Requant-Wallet_${version}_windows-x64.exe`,
  true,
);
const mac = copy(
  one((f) => f.endsWith(".app.tar.gz")),
  `Requant-Wallet_${version}_macos-universal.app.tar.gz`,
  true,
);
copy(
  one((f) => f.endsWith(".dmg")),
  `Requant-Wallet_${version}_macos-universal.dmg`,
);
const linux = copy(
  one((f) => f.endsWith(".AppImage")),
  `Requant-Wallet_${version}_linux-x64.AppImage`,
  true,
);
const deb = copy(
  one((f) => f.endsWith(".deb")),
  `Requant-Wallet_${version}_linux-x64.deb`,
  true,
);
const androidSource = one((f) => f.endsWith(".apk"));
const metadata = readFileSync(`${androidSource}.metadata.txt`, "utf8");
if (
  !metadata.includes("name='network.requant.wallet'") ||
  !metadata.includes(`versionName='${version}'`)
)
  throw new Error("Android package identity/version mismatch.");
const versionCode = Number(metadata.match(/versionCode='([0-9]+)'/)?.[1]);
if (!Number.isSafeInteger(versionCode) || versionCode <= 0)
  throw new Error("Invalid Android version code.");
const android = {
  version,
  versionCode,
  ...copy(androidSource, `Requant-Wallet_${version}_android-arm64.apk`),
};
const extension = {
  version,
  ...copy(
    one(
      (f) =>
        basename(f) ===
        `Requant-Wallet-Extension_${version}_chromium-testnet.zip`,
    ),
    `Requant-Wallet-Extension_${version}_chromium-testnet.zip`,
  ),
};
const webDir = one((f) => f.endsWith("/requant-web-wallet/index.html"));
const webZip = join(output, `Requant-Web-Wallet_${version}_testnet.zip`);
const zip = spawnSync("zip", ["-q", "-r", webZip, "."], {
  cwd: resolve(webDir, ".."),
  stdio: "inherit",
});
if (zip.status !== 0) throw new Error("Cannot package web wallet.");
files.push(webZip);
const platform = (entry) => ({ url: entry.url, signature: entry.signature });
const desktop = {
  version,
  notes:
    "Signed wallet updates, safe web refresh, Android installer updates and browser update notifications. Compatible with testnet v2 transaction sources.",
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": platform(win),
    "darwin-aarch64": platform(mac),
    "darwin-x86_64": platform(mac),
    "linux-x86_64": platform(linux),
    "linux-x86_64-appimage": platform(linux),
    "linux-x86_64-deb": platform(deb),
  },
};
for (const [name, data] of Object.entries({ desktop, android, extension }))
  writeFileSync(
    join(output, `${name}.json`),
    JSON.stringify(data, null, 2) + "\n",
  );
writeFileSync(
  join(output, "SHA256SUMS.txt"),
  files
    .map(
      (f) =>
        `${createHash("sha256").update(readFileSync(f)).digest("hex")}  ${basename(f)}`,
    )
    .join("\n") + "\n",
);
console.log(
  `Prepared signed wallet ${version}: ${files.length} artifacts. Publish immutable files before atomically replacing the three update feeds.`,
);
