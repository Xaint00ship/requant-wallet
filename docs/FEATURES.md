# Wallet feature coverage

GUI 0.5.0 pins Requant node 0.17.0 / wallet 0.10.0 (`845d0e9`). Web, Windows, macOS, Linux, Android and the extension full workspace share the same local core and UI. Public testnet only.

| Core wallet operation | All wallet interfaces |
| --- | --- |
| create / restore / phrase | 24-word HD create/restore, phrase backup, address count and recovery scan |
| keygen / encrypt / address | Encrypted HD creation, legacy encrypted/plain-key import, password changes, receive addresses |
| newaddress / addresses | Receive batches, receive/change lists, deposit list export |
| watchonly | Export/import public watch-only file, balance and unsigned preparation |
| balance / history / coins / tx | Wallet overview, activity, unspent outputs, verified transaction details |
| send / consolidate | Multi-recipient payment, max, consolidation, fee targets/custom rate |
| prepare / sign / broadcast | Verified-parent offline payment files, local signing, reviewed signed-file broadcast |
| secret / pubkey | Local 32-byte HTLC secret and SHA-256, public key of a wallet address |
| condition | 2-of-2, HTLC, delayed revocation and revocable HTLC builders/import/export |
| spend-condition | Claim/refund/revoke selection, anyone-can-pay, confirmed-source verification and lock review |
| cosign | CLI-compatible partial files, first-signature verification, local second signature |
| swap buy / buy-ln / buy-usdt | Verified BTC Signet / Lightning testnet / USDT TRON Nile offers, encrypted per-swap backups, funding details after backup export |
| swap status / claim | Live maker status, independently checked HTLC and amount, verified RQT parents, local signing and explicit secret-revealing claim review |
| swap lock / refund / withdraw | Local TRON approval/lock/refund/withdraw signing, known Nile contract/token, irreversible allowance checks and maker fee requests; BTC refund exported as signed hex |
| swap fees | Request maker energy/TRX support and explicitly return unused lent TRX |
| channel open / accept / fund | Public proposal files, pre-signed timed refunds, server acceptance and verified-source funding with explicit review |
| channel pay / receive / close / refund / show | Increasing cumulative payment states, CLI-compatible state files, local second signature, maturity checks, live deposit status and rollback rejection |
| broadcast FILE FILE... | Verified signed package import/review/export, parent-first order, source-owner/value checks, duplicate-spend rejection, package relay (2–25 transactions, max 200 kB) |

The CLI maintainer `sign-release` and maker staking/liquidity commands are operator tooling. The wallet exposes the taker's implemented swap protocol and one-way payment channels; it does not add unsupported mainnet markets, reverse swaps, custodial BTC balances or yield products. A Bitcoin refund is exported for submission through a Bitcoin Signet node, matching the upstream CLI. The package tool accepts already-signed parents and children; it does not invent a fee-bump composer.

Basic conditions activate at height 1400, revocable conditions and anyone-can-pay at 4700. RQT claims require matching amounts, verified parent bytes and adequate time before the maker's refund. New protocol screens block automatic update activation while open. Swap backups contain an authenticated encrypted payload with a separately password-wrapped random key; swap secrets are not derived from the wallet recovery phrase. Channel files contain no private keys, and stored cumulative payment totals cannot move backwards.

CLI partial files lacking parent bytes can be enriched online, exported, and then reviewed/cosigned offline. Secret-bearing unsigned/partial/signed HTLC files reveal their preimage; the interface calls this out before export and broadcast. Secrets and passwords remain ephemeral; encrypted wallet files and signed broadcast records use existing local storage.

## Updates

Web revisions cache automatically and activate only when all open wallet tabs are safe. Windows/macOS/AppImage/DEB use version-bound signed feeds; automatic installation waits for a locked idle wallet. DEB may request system privileges. Android verifies package identity, signing certificate, version and SHA-256, then uses the OS installer. Unpacked extension ZIPs check updates and offer a new package; automatic extension delivery requires a published browser-store build. Existing pre-updater installations need one manual upgrade.

## Verification

Core tests exercise all condition paths, both 2-of-2 signatures, wrong passwords/keys, tampered parents/conditions/signatures and exact integer amounts. Provider tests retain explicit origin-bound approvals, stale review rejection and spent-input checks. Browser checks use fresh profiles and unfunded fixtures, including desktop/mobile layouts and clearing secrets on lock. No real user keys or actual transfers are used.
