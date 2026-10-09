# Requant Wallet

Private application repository owned by Xaint00ship. Planned targets: Windows, macOS, Linux and Android, with a shared wallet core and visual identity.

Current phase: design concepts. The application has not been implemented or released. iOS is outside this milestone.

## Design concepts

- [Desktop overview](design/desktop-overview.png): balance, activity, receiving address, network status and lock action.
- [Android core flows](design/android-core-flows.png): overview, send and receive.
- [Wallet setup and review](design/wallet-setup-and-review.png): creation, encrypted backup and final transfer review.
- [Design specification](design/SPEC.md): visual system, navigation, flows and states.
- [Image-generation prompts](design/prompts.json): exact prompts, inputs and provenance, generated with the built-in image_gen.imagegen tool.

The concepts use the approved light Requant identity. All UI copy is English. Amounts, addresses, QR images and network status in the mockups are illustrative. They are not connected to a live wallet or the public explorer. The specification governs exact amounts and address validation during implementation.

## Reference implementation

Wallet capabilities were inspected in danifest751/requant at commit `aad4772`:

- `crates/wallet/src/main.rs`: key generation, address, balances, history, transaction details and sending through a node.
- `crates/wallet/src/lib.rs`: Ed25519 transfer signing and passphrase-encrypted key files using Argon2id and XChaCha20-Poly1305.
- `crates/consensus/src/address.rs`: network-specific bech32m addresses.

The initial restore design uses an encrypted key file and its wallet password, matching the current reference implementation. Multi-key wallets, mnemonic recovery and hardware wallets require separate implementation decisions.
