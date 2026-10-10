# Wallet feature coverage

GUI 0.4.0 pins Requant node 0.16.0 / wallet 0.5.0 (`ef789d4`). Web, Windows, macOS, Linux, Android and the extension full workspace share the same local core and UI. Public testnet only.

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

The CLI maintainer `sign-release` operation is release tooling, not a user wallet screen. Node package fees and replace-by-fee are node policies; this GUI does not add a swap service, payment-channel protocol or fee-bump composer. Revocable conditions and anyone-can-pay activate at height 4700, basic conditions at 1400. A signed condition payment is checked against current unspent outputs and time locks before it is broadcast.

CLI partial files lacking parent bytes can be enriched online, exported, and then reviewed/cosigned offline. Secret-bearing unsigned/partial/signed HTLC files reveal their preimage; the interface calls this out before export and broadcast. Secrets and passwords remain ephemeral; encrypted wallet files and signed broadcast records use existing local storage.

## Updates

Web revisions cache automatically and activate only when all open wallet tabs are safe. Windows/macOS/AppImage/DEB use version-bound signed feeds; automatic installation waits for a locked idle wallet. DEB may request system privileges. Android verifies package identity, signing certificate, version and SHA-256, then uses the OS installer. Unpacked extension ZIPs check updates and offer a new package; automatic extension delivery requires a published browser-store build. Existing pre-updater installations need one manual upgrade.

## Verification

Core tests exercise all condition paths, both 2-of-2 signatures, wrong passwords/keys, tampered parents/conditions/signatures and exact integer amounts. Provider tests retain explicit origin-bound approvals, stale review rejection and spent-input checks. Browser checks use fresh profiles and unfunded fixtures, including desktop/mobile layouts and clearing secrets on lock. No real user keys or actual transfers are used.
