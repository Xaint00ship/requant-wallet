import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const env = { ...process.env };
const localTools = resolve(".build-tools");
if (!env.CARGO_HOME && existsSync(`${localTools}/cargo/bin/cargo`)) {
  env.CARGO_HOME = `${localTools}/cargo`;
  env.RUSTUP_HOME = `${localTools}/rustup`;
  env.PATH = `${env.CARGO_HOME}/bin:${env.PATH}`;
}
if (process.platform === "darwin") {
  env.DEVELOPER_DIR = "/Library/Developer/CommandLineTools";
  if (
    !env.CC_wasm32_unknown_unknown &&
    existsSync("/opt/homebrew/opt/llvm/bin/clang")
  )
    env.CC_wasm32_unknown_unknown = "/opt/homebrew/opt/llvm/bin/clang";
}
for (const [command, args] of [
  [
    "cargo",
    [
      "build",
      "--locked",
      "-p",
      "requant-browser-core",
      "--release",
      "--target",
      "wasm32-unknown-unknown",
    ],
  ],
  [
    "wasm-bindgen",
    [
      "target/wasm32-unknown-unknown/release/requant_browser_core.wasm",
      "--target",
      "web",
      "--out-dir",
      "pkg-browser",
    ],
  ],
]) {
  mkdirSync("pkg-browser", { recursive: true });
  const r = spawnSync(command, args, { env, stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}
