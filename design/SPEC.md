# Requant Wallet design concept / v1

Status: initial concept for review. Date: 2026-10-10. Targets: Windows, macOS, Linux and Android.

## Visual identity

Use the approved light Requant palette: warm ivory `#f2efe8`, panel white `#fbfaf7`, graphite `#171717`, orange `#ff5426`. Green is reserved for connected/confirmed states and amber for pending/maturing states. Status always includes text and an icon, so color is not the only signal.

Use the existing angular R mark from `design/assets/requant-mark.svg`. The raster reference may approximate it; the SVG is authoritative. Headings are bold modern sans, body text is clear and compact, and numerical values and abbreviated hashes use a monospaced font. Fine dividers, restrained shadows and 12px panel corners give the wallet a calm utility feel. The subtle eight-layer grid motif appears only as decoration, away from functional content.

Desktop uses a persistent sidebar. Android uses bottom navigation with Home, Activity and Settings, and back navigation for transfers and receipt. Each platform uses its native title bar, window controls, safe areas, keyboard, file picker and share sheet; the desktop concept deliberately avoids OS-specific controls.

Use a minimum 44px desktop action target and 48dp Android touch target. Keep visible focus states and sufficient text contrast. Main balance typography must adapt to long values without clipping or dropping significant digits. Long addresses can abbreviate in lists, but show the complete address in transaction review and before copying or sharing.

## Core navigation and screens

| Area | Desktop | Android |
| --- | --- | --- |
| Overview | Balance, Send/Receive, activity and receive card | Balance, Send/Receive and recent activity |
| Activity | Searchable transaction list and detail view | Transaction list and detail screen |
| Receive | Address, QR, copy and explorer link | Address, QR, copy, system share and explorer link |
| Send | Entry, review, local unlock and result | Entry, review, local unlock and result |
| Settings | Backup, password, auto-lock and node connection | Backup, password, auto-lock and node connection |
| Wallet setup | Create or restore encrypted backup | Create or restore encrypted backup |

The first wallet represents one key and one native asset, RQT. A visible wallet selector may switch between separate saved wallet files; it does not imply a multi-key/HD wallet inside one file.

## Balance and activity

The prominent value is Confirmed balance. Pending and Maturing are distinct secondary amounts. The Send form reports the amount currently eligible under the configured coin-selection policy; immature mining outputs are never spendable. Pending outputs require the node to explicitly mark them spendable before use.

The reference supports eight decimal places: `100,000,000` atoms = `1 RQT`. Keep amounts as integer atoms through calculations. Use deterministic formatting; image-generated raster text may vary in decimal precision. Reference transfer example: amount `12.50000000 RQT`, fee `0.00001000 RQT` and total `12.50001000 RQT`. The fee is an illustrative editable value, not a live fee estimate or universal network requirement.

Activity states include Pending, Confirmed and Maturing. Transaction details expose confirmations, full transaction ID, block height when known, recipient/output amounts and fees, and a link to the matching-network explorer. Reorgs must update balances and confirmations coherently.

## Create, restore, backup and unlock

Creation: name the wallet, choose and confirm its local password, generate and encrypt the key on the device, save an encrypted backup, confirm that the backup was saved, then enter the overview.

Restore: choose the encrypted key file with the system file picker, enter its wallet password, validate the format, show the resulting network address, then synchronize. Legacy plain key imports need a deliberate import flow that encrypts the key before saving it in the app. A successful import does not verify that the wallet has any funds.

Backup: save the encrypted key file with the platform file/save interface. Both the file and the password are needed to restore access. Keep backup reminders in Settings and on unfinished setup. Never send keys or wallet passwords to the website, administrator dashboard or a node service.

Unlock: show wallet name, password field and local unlock action. Auto-lock and explicit Lock wallet clear signing-key material from active UI state. A password change requires a new compatible encrypted backup. Recovery phrases are not part of this initial concept because the reference wallet does not implement them.

## Sending and receiving

Sending: select the wallet/network, enter the full recipient address, scan or paste when supported, enter an amount, calculate/select a fee, then Review transfer. Before signing, display the full recipient, amount, fee, total and Testnet badge together. Require a local wallet unlock when needed. Only Confirm and send signs and broadcasts. While broadcasting, disable duplicate submission. The result shows pending status and transaction ID, with a link to the explorer. Network failure must distinguish a rejected transfer from an unknown broadcast result.

Receiving: show a QR derived from the complete validated public address, a selectable full address, Copy address, Share address on Android and a matching-network explorer link. The mockup QR and shortened address are placeholders. The production QR must be generated deterministically and must encode only a supported address/payment format.

## Connection and error states

Keep Testnet visibly separate from Node connected. Show Locked, Connecting, Syncing, Connected, Offline and Error states explicitly. A synchronized-at timestamp accompanies stale/offline balances. Disable sending when necessary data cannot be validated. Distinguish insufficient funds, malformed/wrong-network address, wrong wallet password, unsupported/corrupt backup and a node rejecting a transfer. Empty activity has its own clean empty state.

The wallet app needs a purpose-built connection path for reads and signed transaction broadcast. Website/explorer administration and node RPC credentials are unrelated to the user's wallet password and must not be distributed inside the app.

## Presentation and evidence

All visible copy is English. Public testnet copy: Testnet coins have no value. No fiat prices, token portfolios, exchange actions, staking, yield, NFTs or unsupported release/audit claims are included in this concept.

The generated PNGs are design concepts with illustrative data. The source baseline is `danifest751/requant@aad4772`; the visual identity comes from the approved Requant website concept. Prompts and the reused brand SVG are versioned alongside the PNGs. The layout is shared across the four requested platforms, with native behavior adapted during implementation.
