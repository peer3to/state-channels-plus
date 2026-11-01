# Local infrastructure scripts

- `local-discovery-registry.js` (`yarn infra:local-discovery`): the local
  peer discovery registry. It listens on `127.0.0.1:19777` by default
  (`LOCAL_DISCOVERY_HOST`, `LOCAL_DISCOVERY_PORT`).
- `storage-diff-service.js` (`yarn infra:storage-diff`): the storage diff
  service, described [below](#storage-diff-service).
- `run-e2e-worker.js`: runs the end-to-end suite in worker mode
  (`RUN_SDK_IN_THREAD=true`) against an external test node.
- `start-hardhat-node.js`: starts that test node, the pinned anvil
  (`anvilNode.js`), on `127.0.0.1:18545` by default.

## Storage diff service

A standalone, node-only service
([StorageDiffService.ts](../../src/utils/node/storageDiff/StorageDiffService.ts)) that
follows the best head of one Ethereum upstream, traces each new block once, and
serves which storage slots changed over JSON-RPC 2.0 on a WebSocket. It is not
exported from the SDK.

```sh
yarn infra:storage-diff --upstream ws://127.0.0.1:8546
```

| Flag          | Default     | Meaning                                              |
| ------------- | ----------- | ---------------------------------------------------- |
| `--upstream`  | (required)  | `ws://` or `wss://` upstream. HTTP cannot supply `newHeads`, so it is rejected. |
| `--host`      | `127.0.0.1` | Bind address.                                        |
| `--port`      | `19778`     | Bind port; `0` takes an OS-assigned port.            |
| `--retention` | `128`       | Canonical blocks kept for catch-up (integer >= 1).   |
| `--max-peer-buffered-bytes` | `16777216` | A peer whose unsent bytes pass this is told why and cut (integer >= 1). |
| `--cache-dir` | (none) | Directory for the persisted cache (`state.json`). Without it the cache lives in memory only. |
| `--included-relay-url` | (none) | `ws://` or `wss://` relay chain node for the Asset Hub inclusion strategy, e.g. `wss://rpc.polkadot.io`. Needs `--included-asset-hub-url`. |
| `--included-asset-hub-url` | (none) | `ws://` or `wss://` Asset Hub **Substrate** node (not eth-rpc), e.g. `wss://polkadot-asset-hub-rpc.polkadot.io`. |
| `--included-para-id` | `1000` | Relay chain id of the parachain (1000 is Polkadot Asset Hub). |
| `--included-dev-depth` | (none) | Dev and test strategy: the block this many behind the best head counts as included. Excludes the three flags above. |

Without any `--included-*` flag there is no included head: nothing is pushed
and catch-up reports `null`.

Once it is serving, it prints one line to stdout and nothing else:
`{"event":"listening","url":"ws://127.0.0.1:19778"}`. The URL is the bound
address, so `--port 0` reports the real port. `SIGINT` and `SIGTERM` close it
cleanly (exit 0).

The upstream must serve `eth_subscribe` `newHeads`, `eth_getBlockByNumber`,
`eth_getBlockByHash`, and `debug_traceBlockByNumber` with `prestateTracer` in
`diffMode`. Each nonempty block is traced exactly once, with
`[number, {"tracer":"prestateTracer","tracerConfig":{"diffMode":true}}]`; a
block with no transactions gets empty maps and no trace.

### What it serves

The methods are `scp_subscribeContractStorage`, `scp_unsubscribe`,
`scp_getContractStorageDiffs`, `scp_getState`, `scp_getBlock`, `scp_getHead`,
`scp_getTransaction` and `scp_getTransactionReceipt`; it pushes
`scp_subscription`, `scp_snapshot`, `scp_includedHead`, `scp_delayed` and
`scp_disconnect`. Their parameters, answers, errors and ordering are specified
in [the storage diff service specification](../../docs/spec/specification/runtime/storage-diff-service.md);
this file does not repeat them. Batch requests are refused.

### Operating it

- **Inclusion.** `--included-relay-url` and `--included-asset-hub-url` follow
  `Paras::Heads(paraId)` on the relay chain and read `Revive::BlockHash` on
  the Asset Hub node. They also select `ChildTrieBlockSource` for backfills,
  which needs an archive Substrate node. `--included-dev-depth` is for dev
  and tests.
- **Asset Hub tracer.** Its `prestateTracer` in `diffMode` reports the writes
  of reverted sub-calls in `post`, so the service reads the values of such a
  block instead of using the trace. It also leaves out a created contract's
  slot that the constructor writes twice with the same value
  (paritytech/polkadot-sdk#13663); the service counts a contract's child trie
  entries after a backfill and keeps an account whose counts differ lazy,
  with a warning that names both counts.
- **Failure.** The upstream is trusted and there is no authentication; the
  default bind is loopback. A failure that outlasts its retries is fatal: the
  service closes its peers and exits nonzero, so run it under a supervisor.
  Errors name the upstream by scheme and host only, never its credentials.

## Open security questions

**A malformed registration can stop the local discovery registry** (Codex
Security scan `b16b8056-1a2e-47ad-b510-34ef96ce1d0b`, finding
`csf_638ea73947731f98d7f29fdf`; needs review, low). A JSON `null` message
parses successfully, then `Number(parsed.port)` throws outside the `try`
([local-discovery-registry.js:26-36](./local-discovery-registry.js#L26-L36)).
The registry listens on loopback by default and has no Origin check
([local-discovery-registry.js:5-10](./local-discovery-registry.js#L5-L10)).
A trusted same-user caller can already stop its own development process, so
this is a security issue only if an untrusted browser can connect, or if an
externally bound deployment is supported.

- Open question: is an untrusted browser origin that reaches the registry a
  supported threat?
- Whatever the answer: reject a message that is not a JSON object before
  reading its fields. This is a plain robustness fix.
