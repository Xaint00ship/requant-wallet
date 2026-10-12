# Requant Telegram Wallet

The Mini App uses the same `web/src/App.tsx`, protocol screens, service and Rust/WASM wallet core as Web Wallet 0.5.0. It adds a Telegram platform adapter; there is no separate signing implementation or reduced feature list. Public UI is English, with the approved Signal / IBM Plex Sans design.

Production bot: `@requant_wallet_bot`. Launch URL: `https://requant.network/telegram-wallet/`. Use the bot's **Open Wallet** menu button, or `/start`. The separate profile-level **Launch app** and `?startapp` link require Main Mini App configuration in BotFather; Bot API menu setup works independently.

## Functions

Create/restore 24-word HD wallets, encrypted/legacy imports, multiple wallets, watch-only, address derivation/recovery scanning, balances/history/UTXOs, multi-recipient send/max, fee selection, consolidation, verified-parent offline signing and broadcast, conditions/cosigning, BTC Signet/Lightning testnet/USDT TRON Nile swaps and refunds, encrypted per-swap backups, payment channels and signed transaction packages. These are the shared wallet operations, using the same gateway and transaction reviews. Chain RPC remains available offline only for operations that do not need current chain state.

The adapter integrates Telegram safe areas, expanded viewport, native back/close confirmation, external links, public address sharing and clipboard fallback. The signing session locks on inactivity/minimize, except while its file-export dialog is active (the normal native file-dialog behavior). Automatic updates use the shared service-worker logic, with a separate `/telegram-wallet/` scope and cache so an older Web Wallet cache cannot intercept Mini App launches. Updates wait for active Mini App sessions to leave protected flows.

## Storage and export

Encrypted wallet files, public metadata and protocol state are stored in IndexedDB, separately for each Telegram account on each device. Telegram identity only names this local database; it is not a wallet password or account recovery method. Clearing client storage loses the local copy. Restore from an encrypted file or recovery phrase. This Mini App does not synchronize private wallets through Telegram CloudStorage or the bot.

File import uses the client's file picker. File export works through an external browser so it is independent of WebView blob-download support:

1. The device encrypts the entire file and its filename using a new AES-256-GCM key/IV per export.
2. A signed Telegram session authorizes upload of only ciphertext. The decryption key and acknowledgment capability travel in the external download URL fragment and never reach the HTTP server.
3. The external page removes the fragment from browser history, fetches ciphertext and decrypts locally. Download the file, choose **I saved the file**, then return to Telegram.
4. Only that confirmation marks the export/backup completed. Cancel/timeout does not. Ciphertext is kept in server memory for at most 10 minutes and deleted on confirmation; no file is written to server disk. A completed status marker remains for two minutes so the original app can acknowledge it.

Uploads are bounded (32 MB per file, 128 MB total including in-flight reservations, eight exports per authenticated user), reject foreign origins and invalid/expired/duplicate initData, and use no-store responses. Bot tokens are mounted as restricted server secrets and never bundled in frontend assets or committed to Git. The bot replies only to explicitly requested private commands; it does not process wallet files, keys or free-form chat messages.

## Build and deploy

`npm run build:web` builds `dist-web/index.html`, `telegram.html`, `export.html`, shared assets, the official vendored Telegram SDK and offline/update manifest. SDK source: [Telegram Web Apps SDK](https://telegram.org/js/telegram-web-app.js?64); SHA256 at initial import: `124bdff7ba3fe86c8ba5143467afec21e020405e74abdb92cfdda6c0ee3b5908`.

Merge `compose.telegram-wallet.yml` with the existing Requant Compose files. Its source is `/opt/requant/wallet/telegram`; mount `/opt/requant/deploy/secrets/telegram-bot-token` readable only by container UID 1000. `node configure.mjs` sets bot commands/descriptions/menu through Bot API and refuses an existing webhook. `server.mjs` runs a private long-poll command bot plus the bounded export API. Reverse proxy `/telegram-wallet-api/*` to `telegram-wallet:3313`.

The Telegram HTML entry permits only Telegram web-client frame ancestors; the Web Wallet/export entry keeps the existing frame restrictions. All scripts, fonts, WASM and SDK assets are self-hosted. No changes to mail, explorer, node, MagnetGate or existing downloadable installers are required.

Validation: `npm test`, TypeScript checks and production build; browser checks with an unfunded fixture cover shared screens, Telegram navigation, persistent account-separated IndexedDB, concurrent-write rejection, export cancel/confirm round trip and offline app identity. Physical Telegram Android/macOS/iOS clients should also be checked before describing client-specific support as verified. No real transfer is performed for QA.
