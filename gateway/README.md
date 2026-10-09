# Requant wallet gateway

Node.js 24, no third-party runtime packages. Internal port 3312. Required environment: RPC_URL and RPC_TOKEN. Keep these on the server; do not bundle them with the wallet.

The running Requant deployment uses `/opt/requant/wallet/gateway`, `/opt/requant/deploy/compose.wallet.yml` and the existing protected explorer.env. Launch with both Compose files:

```sh
cd /opt/requant/deploy
docker compose -f compose.yml -f compose.wallet.yml up -d --build --no-deps wallet-gateway
```

Caddy exposes `/wallet-api/*` only on https://requant.network and overwrites X-Real-IP with the client address. Do not publish the gateway container port or accept an untrusted proxy's client-IP header. The authenticated node RPC remains on server loopback/internal Docker networking.

- GET /wallet-api/health: gateway process health (does not assert node synchronization).
- POST /wallet-api/v1/rpc: {method, params}, result/error response.
- Allowed: getinfo []; getblock [0]; gettx/utxos [64-character lowercase hex]; history [owner, 1..100]; sendtx [signed transaction hex <= 100,000 bytes].
- Request <= 256 KiB, response <= 4 MiB, 8 concurrent upstream requests, 240 reads and 10 broadcasts per IP per minute.

Successful node response bytes are preserved to avoid JavaScript rounding uint64 amounts. Upstream errors are normalized and never include the RPC token. There is no key generation, unsigned-transaction signing or administration endpoint.

Run tests with `npm test` from the application root. The test server uses fake RPC data and never broadcasts to testnet.
