# Requant Wallet

Private Requant testnet application for Windows, macOS, Linux and Android. English interface with the approved light Requant identity. iOS is outside this milestone.

## Wallet 0.3.0

One interface and Requant wallet 0.4.1 portable core across web, Windows, macOS, Linux, Android and the browser extension's full wallet workspace.

- Create and restore a 24-word HD wallet, encrypted backups, watch-only imports and legacy encrypted/plain key imports (plain keys are encrypted before storage).
- Receive/change addresses, recovery scanning, address counts from 1 to 100,000, paged address lists and deposit-list exports.
- Verified testnet connection, exact integer balances, pending/maturing funds, history, coins and transaction inspection.
- Multiple recipients, estimated/custom fee rates, send max, consolidation, source validation, explicit review and local signing.
- CLI-compatible prepare/sign/broadcast files for offline operation, watch-only preparation and durable signed transaction outbox.
- Local password changes, native file picking/saving, clipboard, Android sharing, native own-node configuration and signed update delivery.

Existing app key wallets are migrated atomically with their IDs, names, addresses, backup flags and signed outbox preserved. Only encrypted wallet files and public metadata are persisted. Mainnet, hardware wallets, camera scanning, swaps, channels and fiat integrations remain outside implemented upstream wallet functionality.

Web uses IndexedDB with revision checks, native apps use an atomic application-data file, and extension storage is restricted to trusted extension pages. Competing writers must reload instead of silently overwriting another window. Updates are described in [UPDATES.md](docs/UPDATES.md).

## Development

Requirements: Node.js 24, Rust 1.99.0 and the Tauri 2 platform prerequisites. Versioned npm/Cargo lockfiles pin dependencies. Use a dedicated test wallet with no funds when developing.

```sh
npm ci
npm run check
cargo test --locked -p requant-wallet-core
cargo test --locked -p requant-wallet-app --lib
npm run tauri -- dev
```

For isolated GUI development, create an unfunded test profile:

```sh
cargo run -p requant-wallet-core --example seed_dev_wallet -- "$PWD/.wallet-test/native"
REQUANT_WALLET_DEV_DATA="$PWD/.wallet-test/native" npm run tauri -- dev
```

Its deliberately public development password is `test-only-no-funds-password`; never fund this wallet. The override is available only in debug builds. Use the separate `network.requant.wallet.qa` identifier if running QA beside the normal app. Desktop launches use one instance per app identifier to prevent competing wallet storage writes.

`npm run dev` serves the native interface, which requires the Tauri runtime. `npm run dev:web` serves the independent web target. Native cryptography runs in Rust; web cryptography runs in a disposable WASM worker.

```sh
npm run tauri -- build --ci --bundles app,dmg          # macOS
npm run tauri -- build --ci --bundles nsis             # Windows
npm run tauri -- build --ci --bundles appimage,deb     # Linux
npm run tauri -- android init --ci
node scripts/prepare-android.mjs
npm run tauri -- android build --ci --apk --target aarch64
```

Android requires Java 21, SDK 36, NDK 28.2, aarch64-linux-android and the signing environment described below. The preparation script applies release signing, Requant icons, disables OS cloud backup of wallet data and prohibits cleartext network traffic.

## Private builds and signing

`.github/workflows/build.yml` checks the wallet core/gateway and builds Windows x64 NSIS, universal macOS DMG, Linux x64 AppImage/Debian and Android ARM64 APK. Artifacts remain in this private repository for 30 days. A successful installer build does not establish device/runtime testing on that platform.

Android signing uses repository secrets `ANDROID_KEY_BASE64` and `ANDROID_KEY_PASSWORD`; the fixed alias is `requant-wallet`. Keep an offline copy of this key and password outside Git. Android updates must use the same signing key.

The current desktop beta has no commercial Windows certificate or Apple Developer notarization. macOS uses an ad-hoc signature. This is a testnet build, not a store release or an audited wallet. Testnet coins have no value.

## Node connection and trust

Default: `https://requant.network/wallet-api/v1/rpc`. HTTPS is required for remote nodes. Desktop HTTP is limited to loopback for a local development node. Android release networking requires HTTPS.

`gateway/` is a small isolated server component for getinfo, genesis getblock, utxos, history, gettx and signed sendtx. It limits request/response size, concurrency and per-IP rates, and keeps node RPC authentication on the server. It never accepts wallet passwords or private keys. See [gateway setup](gateway/README.md).

This is a node-backed wallet. Balances, history, chain membership, confirmation/maturity and unspent status depend on the selected node. Genesis and source-byte checks do not independently verify chain proof of work or the current UTXO set. Signing is local; only public addresses and signed transaction bytes go to the selected endpoint. There is no analytics or crash upload.

A transfer review lasts two minutes. Confirmation refreshes selected inputs, checks the endpoint and verifies parent bytes again. The signed transaction ID/bytes are saved before broadcast. An interrupted response is shown as unknown; check that ID in the explorer before creating another transfer. The saved transaction contains signatures and public data, not private key material.

## Source and design provenance

Consensus/address/transaction rules are pinned to Requant `444da68`, with the portable wallet 0.4.1 library from `a1e89b9`; provenance and Apache-2.0 license are in `vendor/`. Encryption matches its wallet v1 format. The approved Requant mark is SVG, not an image-generated approximation.

- [Desktop concept](design/desktop-overview.png)
- [Android concept](design/android-core-flows.png)
- [Setup and review concept](design/wallet-setup-and-review.png)
- [Design specification](design/SPEC.md)
- [Exact image-generation prompts](design/prompts.json)

The design images contain illustrative data. The application loads actual node responses and shows empty/offline states rather than fabricated funds.
