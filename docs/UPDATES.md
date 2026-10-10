# Wallet updates

Version 0.3.0 bootstraps updates. Earlier desktop/Android/ZIP builds must be replaced once; they have no updater to receive this release.

- Web checks on startup, return to the tab and every 15 minutes. A new bundle is cached in the background. Activation waits until every open wallet tab reports that no payment, recovery, backup or offline-signing flow is active. It refreshes after 60 seconds idle or an explicit Update wallet action. Closing all wallet tabs also activates the next version normally. Local encrypted wallets and the signed-transaction outbox remain intact.
- Windows, macOS and Linux AppImage check hourly and on return to the app, download in the background, verify the pinned signature and signed version, and install when all wallets are locked and idle. Install update applies it sooner after locking. macOS/Windows may show their native permission dialog.
- Linux DEB uses the same signed feed and downloader. Install update invokes the package installer, which may require administrator permission. No wallet password is sent to the installer.
- Android downloads only an APK from the fixed HTTPS Requant release path. It verifies byte count, SHA-256, package identity, version code/name and the installed app's signing certificate, then uses Android's installer. Android requires permission to install updates from this app and confirmation for each installation. Keep the existing Android signing key.
- Store/managed browser installations use the browser's update service. Ready updates wait until the wallet is locked, approval requests are finished and wallet pages are closed. A ZIP loaded with Load unpacked can only check and offer the new package. Replace files in the same folder and Reload; do not remove the installed extension or change its directory. Chrome Web Store publication is needed for consumer Chrome updates on Windows/macOS. Store migration requires a verified encrypted backup and restore because the extension ID changes.

## Release operation

Run `.github/workflows/build.yml` and extension checks for the release commits. Download artifacts from these exact successful runs into a fresh directory (including `requant-web-wallet` and the extension ZIP). Inspect the builds and run their tests before signing.

```
node scripts/prepare-update-release.mjs --input=/absolute/artifacts --output=/absolute/new-release --key=/absolute/private-wallet-updater.key
```

The private updater key is outside Git and remains local. CI does not receive it. Keep a secure backup; changing it breaks the installed updater trust chain. The public verification key is in `src-tauri/tauri.conf.json`; version binding is required. Never embed GitHub credentials in clients or make the repositories public for updates.

Upload the immutable release artifacts to `/downloads/wallet/v0.3.0-testnet/` (substitute the actual version), then publish `desktop.json`, `android.json` and `extension.json` atomically under `/updates/wallet/`. Update feeds must use `Cache-Control: no-store`, JSON content type and HTTPS. Do not serve them with immutable installer caching. Verify public artifact hashes and signatures before switching the feeds. Failed/incomplete builds must never replace a live feed.

Deploy the matching web bundle without removing the downloads or updates directories. Keep its `sw.js`, `version.json` and HTML uncached at the HTTP layer. The worker caches only its fixed public asset list, with a complete revision kept together; RPC responses, encrypted backups and user keys are excluded. Never reuse a version path for different artifacts. Keep the app-data identifier and encrypted storage formats unchanged.
