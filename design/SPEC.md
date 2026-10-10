# Requant Wallet / Signal

Status: approved and implemented. Date: 2026-10-10. Targets: Web, Windows, macOS, Linux and Android. The selected reference and typography decision are recorded in `signal-system.json`.

## Visual identity

Use the approved Signal palette: warm ivory `#f4f1e9`, panel white `#ffffff`, graphite `#20231f`, orange `#ff5426`, fine borders `#e4e4df` and muted text `#717786`. Green is reserved for connected/confirmed states and amber for pending/maturing states. Status always includes text and an icon, so color is not the only signal.

Use the existing angular R mark from `design/assets/requant-mark.svg`. The SVG is authoritative. IBM Plex Sans is self-hosted for headings, body and numerical values (tabular figures); addresses and hashes retain a monospace font. Fine dividers and 6px panel corners match the website, explorer and extension. Decorative layered geometry stays away from functional content. Include the IBM SIL Open Font License with every distribution.

Desktop uses a persistent sidebar. Android uses bottom navigation with Wallet, Activity, Tools and Settings. Tools exposes all advanced wallet operations. Each platform uses its native title bar, window controls, safe areas, keyboard, file picker and share sheet; the desktop concept deliberately avoids OS-specific controls.

Use a minimum 44px desktop action target and 48dp Android touch target. Keep visible focus states and sufficient text contrast. Main balance typography must adapt to long values without clipping or dropping significant digits. Long addresses can abbreviate in lists, but show the complete address in transaction review and before copying or sharing.

## Core navigation and screens

| Area         | Desktop                                          | Android                                           |
| ------------ | ------------------------------------------------ | ------------------------------------------------- |
| Overview     | Balance, Send/Receive, activity and receive card | Balance, Send/Receive and recent activity         |
| Activity     | Searchable transaction list and detail view      | Transaction list and detail screen                |
| Receive      | Address, QR, copy and explorer link              | Address, QR, copy, system share and explorer link |
| Send         | Entry, review, local unlock and result           | Entry, review, local unlock and result            |
| Settings     | Backup, password, auto-lock and node connection  | Backup, password, auto-lock and node connection   |
| Wallet setup | Create or restore encrypted backup               | Create or restore encrypted backup                |

All targets use the same full wallet interface and pinned portable Requant wallet 0.4.1 library. The wallet selector supports HD wallets, legacy encrypted key wallets and watch-only files. Every target exposes 24-word creation/restoration, multiple addresses, payment batches, max/consolidation and offline payment files. Native file/share and connection settings use platform adapters.

## Balance and activity

The prominent value is Confirmed balance. Pending and Maturing are distinct secondary amounts. The Send form reports the amount currently eligible under the configured coin-selection policy; immature mining outputs are never spendable. Pending outputs require the node to explicitly mark them spendable before use.

The reference supports eight decimal places: `100,000,000` atoms = `1 RQT`. Keep amounts as integer atoms through calculations. Use deterministic formatting; image-generated raster text may vary in decimal precision. Reference transfer example: amount `12.50000000 RQT`, fee `0.00001000 RQT` and total `12.50001000 RQT`. The fee is an illustrative editable value, not a live fee estimate or universal network requirement.

Activity states include Pending, Confirmed and Maturing. Transaction details expose confirmations, full transaction ID, block height when known, recipient/output amounts and fees, and a link to the matching-network explorer. Reorgs must update balances and confirmations coherently.

## Create, restore, backup and unlock

Creation: name the wallet, choose and confirm its local password, generate and encrypt the key on the device, save an encrypted backup, confirm that the backup was saved, then enter the overview.

Restore: choose the encrypted key file with the system file picker, enter its wallet password, validate the format, show the resulting network address, then synchronize. Legacy plain key imports need a deliberate import flow that encrypts the key before saving it in the app. A successful import does not verify that the wallet has any funds.

Backup: save the encrypted key file with the platform file/save interface. Both the file and the password are needed to restore access. Keep backup reminders in Settings and on unfinished setup. Never send keys or wallet passwords to the website, administrator dashboard or a node service.

Unlock: show wallet name, password field and local unlock action. Auto-lock and explicit Lock wallet clear signing-key material from active UI state. A password change requires a new compatible encrypted backup. Recovery phrases are supported by the new web target. Desktop, Android and the extension also support 24-word recovery.

## Sending and receiving

Sending: select the wallet/network, enter the full recipient address, scan or paste when supported, enter an amount, calculate/select a fee, then Review transfer. Before signing, display the full recipient, amount, fee, total and Testnet badge together. Require a local wallet unlock when needed. Only Confirm and send signs and broadcasts. While broadcasting, disable duplicate submission. The result shows pending status and transaction ID, with a link to the explorer. Network failure must distinguish a rejected transfer from an unknown broadcast result.

Receiving: show a QR derived from the complete validated public address, a selectable full address, Copy address, Share address on Android and a matching-network explorer link. The mockup QR and shortened address are placeholders. The production QR must be generated deterministically and must encode only a supported address/payment format.

## Connection and error states

Keep Testnet visibly separate from Node connected. Show Locked, Connecting, Syncing, Connected, Offline and Error states explicitly. A synchronized-at timestamp accompanies stale/offline balances. Disable sending when necessary data cannot be validated. Distinguish insufficient funds, malformed/wrong-network address, wrong wallet password, unsupported/corrupt backup and a node rejecting a transfer. Empty activity has its own clean empty state.

The wallet app needs a purpose-built connection path for reads and signed transaction broadcast. Website/explorer administration and node RPC credentials are unrelated to the user's wallet password and must not be distributed inside the app.

## Presentation and evidence

All visible copy is English. Public testnet copy: Testnet coins have no value. No fiat prices, token portfolios, exchange actions, staking, yield, NFTs or unsupported release/audit claims are included in this concept.

The generated PNGs are design concepts with illustrative data. The source baseline is `danifest751/requant@aad4772`; the visual identity comes from the approved Requant website concept. Prompts and the reused brand SVG are versioned alongside the PNGs. The Signal layout adapts to all five targets, with native file and sharing behavior preserved.
