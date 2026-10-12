# Security policy

Requant Wallet is pre-alpha software for the Requant test network. It has not had an external audit. Test RQT
and the test assets used in swaps have no value.

## How to report

Email [dev@requant.network](mailto:dev@requant.network?subject=%5BSecurity%5D%20Requant%20Wallet%20vulnerability) with
**[Security]** in the subject, or use the repository's private security advisory form once it is
available. Do not open public issues for vulnerabilities. Include the version or commit, the platform,
a minimal reproduction and the expected versus observed result. Never send a real recovery phrase,
private key or password; reproduce with a new test wallet.

## Most valuable findings

- the wallet signs something other than what its review shows (recipients, amounts, fee, time locks,
  anyone-can-pay, secret disclosure);
- a recovery phrase, private key, password, swap secret or decrypted wallet file leaving the device, or
  readable by another website, extension, app or Telegram account;
- accepting a forged source transaction, swap offer, HTLC, TRON contract or token, channel state or
  package that it should reject;
- bypassing update-signature checks or installing an update during a protected flow;
- in the Telegram Mini App: an export key or plaintext reaching the server, or one Telegram account
  reading another account's wallets;

## Scope notes

Balances and history come from the selected node or the public wallet gateway, which the wallet trusts
for chain state (there is no light client). Swap and channel protocols run against the test-network
maker and services; their design is in
[SWAPS.md](https://github.com/requant-network/requant/blob/main/SWAPS.md).
