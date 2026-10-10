# Requant web wallet

Approved identity: Signal, IBM Plex Sans. Production URL: https://requant.network/wallet/.

This browser target belongs to the private wallet repository. The desktop/Android target remains in `src` and `src-tauri`. Build with `npm run build:web`; output is `dist-web`. Serve only over HTTPS. `npm run dev:web` serves localhost and proxies the constrained testnet gateway.

The browser core vendors the portable library from Requant `f6340819e25d98452a8841e5694c5e29c1c15734` (wallet 0.4). BIP39/SLIP-0010 derivation, Argon2id encryption, XChaCha20-Poly1305 encryption and transaction construction use this library. Its socket backend is excluded. WebAssembly runs in a worker. Browser storage contains encrypted wallet files and public metadata; passwords and phrases are never sent to the gateway. A local password is required for each signing action. Hidden-page and idle locks terminate the worker and clear sensitive UI.

Features: 24-word creation/recovery; encrypted and watch-only imports; legacy encrypted key import and payments; receive/change addresses; recovery scanning with a 20-address gap; exact integer atom amounts; balances, history and UTXOs; multiple recipients; send max and consolidation; review, local signing and broadcast; CLI-compatible unsigned payment files, offline review/signing and signed-file import. No mainnet, fiat prices, swaps or token approvals.

The current deployed node is 0.2.2. The web target queries each address through the bounded gateway for backward compatibility. Source transactions are fetched in bounded batches; exact response bytes are preserved. Fee targets query `estimatefee`; when unsupported, the UI explicitly shows a manual rate. Spend selection uses confirmed, spendable outputs. Restore scans may take additional minutes for wallets with many used addresses due to read limits.

Static shell/code/font assets are cached by a scoped service worker. Open the page online once before offline signing. RPC responses, backups and secrets never enter the service-worker cache. Review full output addresses and amounts on the signing device. Unknown broadcast results remain in a public signed-transaction outbox; check the transaction ID before retrying.

Validation: portable upstream vectors and wallet tests; browser-core tests for recovery compatibility, multiple recipients, watch-only restrictions, exact uint64 values, malicious KDF parameters, source-value and change-path tampering, legacy signatures; gateway tests for method restrictions, limits and exact source-response bytes. UI tests use a public unfunded fixture and do not broadcast.
