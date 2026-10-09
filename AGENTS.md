# Requant Wallet

- Keep Windows, macOS, Linux and Android in this one private repository. iOS is outside the current milestone.
- Public UI, error messages, accessibility text and project branding are English. Preserve the original Requant identity and avoid Russian geographic branding or MagnetGate assets.
- Read design/SPEC.md and inspect the approved concept images before UI implementation. Keep conceptual and approved states explicit.
- Follow the pinned Requant wallet format and transaction rules. Use CodeGraph for structural exploration of indexed codebases.
- Keep private keys, key files, wallet backups, passwords, API secrets and release-signing credentials outside Git.
- Sign transactions on the user's device. The wallet password is local; it is unrelated to website-administrator or server credentials.
- Derive displayed balances and states from verified wallet data. Preserve unsigned integer amounts and eight-decimal RQT precision. Validate the complete address for the selected network before signing.
- The first milestone is testnet. Keep its badge visible, and review recipient, amount, fee and total before broadcasting a transfer.
- Match restore and backup UI to the actual key format. The current reference uses encrypted key-file backups; do not invent mnemonic compatibility.
- Do not claim audits, useful AI work, ASIC resistance, financial returns or an exchange price. Use source evidence for network claims.
- Verify wallet-state and signing changes with meaningful tests. Never use real user keys or perform a real transfer as a UI test.
