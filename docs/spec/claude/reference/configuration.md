# Configuration & Operations

> **Status:** Draft.
> **Scope:** Runtime configuration of an SDK instance (sources, precedence, full field reference)
> and the build/test/format workflow. Verified against
> [src/utils/config.ts](../../../../src/utils/config.ts) and
> [package.json](../../../../package.json).

Configuration is resolved once per process, during `p2pSetup`
([../sdk/architecture.md](../sdk/architecture.md)), by `createConfig` in
[src/utils/config.ts](../../../../src/utils/config.ts). The result is a process-lifespan singleton
(`config`) that every component reads; only the config module itself mutates it.

## 1. The configuration file

Create a `peer3.config.json` or `peer3.config.ts` in the root of your project, next to
`package.json`. The SDK imports it statically in
[src/utils/config.ts](../../../../src/utils/config.ts)
(`import peer3Config from "../../peer3.config"`); this repository ships a
[peer3.config.ts](../../../../peer3.config.ts) at its root. A minimal file only needs the provider
URL; every other field falls back to a built-in default:

```json
{
    "PROVIDER_URL": "http://localhost:8545"
}
```

`createConfig` also accepts a `configFileOverride` argument that replaces the file's contents at
the same (file-level) precedence — the test harness uses this to supply its own base config while
still letting environment variables and explicit overrides win.

## 2. Precedence and environment coercion

`createConfig` merges four sources; later sources override earlier ones:

> defaults ≺ `peer3.config` file ≺ `process.env` ≺ explicit overrides (the `config` option of
> `p2pSetup`)

Environment variables are only applied in a Node runtime (`isNodeRuntime()`); in the browser they
are ignored. Only keys present in the default config are read from the environment, and values are
coerced by the type of the field's default:

- **Booleans** accept `true`/`1`/`yes`/`y`/`on` and `false`/`0`/`no`/`n`/`off`
  (case-insensitive, trimmed). Anything else is ignored.
- **Arrays** (string arrays) accept a JSON array of strings
  (`HOLEPUNCH_RELAYER_URLS='["wss://a","wss://b"]'`) or a comma/space-separated list.
- **Numbers** must parse to a finite number.
- **Strings** are taken as-is.

An unparseable value is ignored, so the lower-precedence source's value stays in effect — it is
not an error.

## 3. Configuration reference

All fields with their defaults, from `DEFAULT_CONFIG` in
[src/utils/config.ts](../../../../src/utils/config.ts):

| Field                                      | Type       | Default                 | Purpose                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROVIDER_URL`                             | `string`   | `http://localhost:8545` | JSON-RPC endpoint of the chain hosting the `StateChannelManager`. **This endpoint is a trust dependency**: the client observes chain state and events through it, and correct operation is not guaranteed if every available endpoint is unavailable or dishonest — see [../security/trust-model.md](../security/trust-model.md). |
| `DEBUG_STATE_MANAGER`                      | `boolean`  | `false`                 | Verbose logging for the StateManager.                                                                                                                                                                                                                                                                                             |
| `DEBUG_DISPUTE_HANDLER`                    | `boolean`  | `false`                 | Verbose logging for the dispute/fraud-proof path.                                                                                                                                                                                                                                                                                 |
| `DEBUG_P2P_MANAGER`                        | `boolean`  | `false`                 | Verbose logging for the P2PManager and peer connections.                                                                                                                                                                                                                                                                          |
| `DEBUG_RPC`                                | `boolean`  | `false`                 | Verbose logging for the RPC layer.                                                                                                                                                                                                                                                                                                |
| `DEBUG_CHANNEL_CONTRACT`                   | `boolean`  | `false`                 | Verbose logging for on-chain contract interactions.                                                                                                                                                                                                                                                                               |
| `DEBUG_LOCAL_TRANSPORT`                    | `boolean`  | `false`                 | Verbose logging for the local (WebSocket) test transport.                                                                                                                                                                                                                                                                         |
| `LOG_LEVEL`                                | `string`   | `info`                  | Global log verbosity (`warn`, `info`, `debug`, `verbose`).                                                                                                                                                                                                                                                                        |
| `LOG_SKIP_WRITING`                         | `boolean`  | `false`                 | Suppress writing logs to disk.                                                                                                                                                                                                                                                                                                    |
| `LOG_EXCLUDE_TAGS`                         | `string`   | `""`                    | Comma-separated log tags to exclude.                                                                                                                                                                                                                                                                                              |
| `EXCLUDE_LOG_TAGS`                         | `string`   | `""`                    | Alias field with the same purpose as `LOG_EXCLUDE_TAGS`; both exist as separate config keys.                                                                                                                                                                                                                                      |
| `HOLEPUNCH_RELAYER_URLS`                   | `string[]` | `[]`                    | Relayer endpoints for the Holepunch transport.                                                                                                                                                                                                                                                                                    |
| `LOCAL_DISCOVERY_REGISTRY_URL`             | `string`   | `""`                    | URL of a local peer-discovery registry, used for local/test discovery instead of Holepunch.                                                                                                                                                                                                                                       |
| `VM_DEDICATED_THREAD`                      | `boolean`  | `false`                 | Run the local EVM in a dedicated thread.                                                                                                                                                                                                                                                                                          |
| `RUN_SDK_IN_THREAD`                        | `boolean`  | `false`                 | Run the SDK runtime host in a dedicated worker thread ([../sdk/architecture.md](../sdk/architecture.md)).                                                                                                                                                                                                                         |
| `EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS` | `number`   | `0`                     | `>0` enables the logger event-loop monitor (throws past this many seconds) and, as a side effect, the `##E2E_TIMING##` diagnostics the parallel runner parses. Tests set `1`; `0` disables it.                                                                                                                                    |
| `SIGNER_RECOVERY_CACHE_MAX`                | `number`   | `100000`                | Max entries in the per-thread signer-recovery cache (message + signature → address); bounds memory, evicts oldest.                                                                                                                                                                                                                |
| `CRASH_LOG_UPLOAD_ENDPOINT`                | `string`   | `""`                    | Non-empty enables crash-log upload to this endpoint.                                                                                                                                                                                                                                                                              |
| `CRASH_LOG_API_TOKEN`                      | `string`   | `""`                    | Auth token for crash-log upload.                                                                                                                                                                                                                                                                                                  |
| `CRASH_LOG_MAX_SIZE_MB`                    | `number`   | `10`                    | Cap on crash-log upload size.                                                                                                                                                                                                                                                                                                     |

> **Secrets.** `CRASH_LOG_API_TOKEN` and any credentials embedded in `PROVIDER_URL` are secrets.
> Supply them via environment variables (§2); they MUST NOT be committed in a checked-in
> `peer3.config.json`/`.ts`.

## 4. Choosing a transport

Connectivity is pluggable behind [ATransport](../../../../src/transport/ATransport.ts); the
components involved are described in [../sdk/components.md](../sdk/components.md). The
`TransportType` enum ([src/transport/TransportType.ts](../../../../src/transport/TransportType.ts))
has three values — `HOLEPUNCH`, `WEBRTC`, `LOOPBACK` — and the P2PManager defaults to preferring
`HOLEPUNCH`; peers negotiate a common transport during the handshake.

| Transport           | Select for                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Holepunch (default) | NAT-traversing p2p between independent hosts. Configure relayers via `HOLEPUNCH_RELAYER_URLS`.                                                                                                                                              |
| WebRTC              | Browser-to-browser connectivity.                                                                                                                                                                                                            |
| Loopback            | Trusted in-process "send to self" delivery (a node calling its own RPC); never tracked as a peer.                                                                                                                                           |
| Local transport     | WebSocket-based transport for local/test runs between processes on one machine ([src/transport/LocalTransport.ts](../../../../src/transport/LocalTransport.ts)); paired with the local discovery registry (`LOCAL_DISCOVERY_REGISTRY_URL`). |

Note that any transport only affects the p2p path; the topology is a full mesh either way, with
the partition-size limits described in [../security/trust-model.md](../security/trust-model.md).

## 5. Local vs. networked operation

- **Local / test.** Point `PROVIDER_URL` at a local chain (the Hardhat node started by
  `yarn infra:hardhat-node`, default `http://localhost:8545`), use the local transport, and start
  the local discovery registry with `yarn infra:local-discovery`. This is how the test suite runs
  and the fastest way to exercise the full lifecycle on one machine.
- **Networked.** Point `PROVIDER_URL` at the chain hosting your deployed `StateChannelManager` and
  use a real transport (Holepunch or WebRTC). Each participant runs its own SDK instance; only
  opening, disputes, and settlement touch the chain
  ([../protocol/lifecycle.md](../protocol/lifecycle.md)).

## 6. Build, test, and format workflow

Script names verified against [package.json](../../../../package.json):

| Command                                                  | Does                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `yarn && yarn build`                                     | Install dependencies, then compile contracts + TypeChain and build the SDK and browser bundle (`compile` → `tsc` + `tsc-alias` → test-runtime utils → browser build → `npm pack`). Required before running examples or tests — they use this local build, not the npm package. |
| `yarn compile`                                           | Clean and compile contracts, generate TypeChain types, enums, and artifacts.                                                                                                                                                                                                   |
| `yarn test:parallel`                                     | **The canonical full test gate.** Runs all Mocha tests across parallel local worker processes; pass `--e2e-only` to limit discovery to `test/e2e`. Each run writes to a fresh `./logs/run-N/`.                                                                                 |
| `yarn test:parallel:distributed`                         | The same suite across distributed workers coordinated by a test server.                                                                                                                                                                                                        |
| `yarn test:parallel:server`                              | Start the distributed coordination server.                                                                                                                                                                                                                                     |
| `yarn test:parallel:prepare`                             | Compile and build everything a parallel/distributed run needs.                                                                                                                                                                                                                 |
| `yarn test`                                              | Legacy in-process run of the non-e2e tests (`--no-compile`, excludes `test/e2e`). Only for rare focused compatibility checks.                                                                                                                                                  |
| `yarn test:compile`                                      | `yarn compile` then `yarn test`.                                                                                                                                                                                                                                               |
| `yarn test:e2e`                                          | In-process end-to-end suite (`E2E_INTERVAL_MINING=1`, `LOG_LEVEL=warn`).                                                                                                                                                                                                       |
| `yarn test:unit`                                         | In-process run scoped to `test/unit` via `TEST_DIR`.                                                                                                                                                                                                                           |
| `yarn infra:hardhat-node` / `yarn infra:local-discovery` | Start the local chain / the local peer-discovery registry used by parallel runs.                                                                                                                                                                                               |
| `yarn format` / `yarn format:check`                      | Apply / verify Prettier formatting (also enforced by a Husky pre-commit hook).                                                                                                                                                                                                 |
| `yarn lint:fix`                                          | ESLint with autofix over `src` and `test`.                                                                                                                                                                                                                                     |

The parallel and distributed runners rely on the runtime host/client split
([../sdk/architecture.md](../sdk/architecture.md)) and the local infrastructure above. The
repository's `AGENTS.md` files carry the binding workflow rules (canonical gate, log-directory
behavior, test-timeout policy) for contributors and agents.

## Future Work

_Non-normative._

- Schema-validate `peer3.config` at load time and warn on unknown keys instead of silently
  ignoring them.
- Collapse the `LOG_EXCLUDE_TAGS` / `EXCLUDE_LOG_TAGS` duplication into one field with a
  deprecation path.
- Support multiple `PROVIDER_URL` endpoints with failover to reduce single-RPC availability risk
  (the trust question itself stays with
  [../security/trust-model.md](../security/trust-model.md)).
- Generate the field-reference table from the `Config` type so defaults cannot drift from code.
