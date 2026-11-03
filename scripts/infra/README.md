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
| `--upstream`  | `$STORAGE_DIFF_UPSTREAM_URL` | `ws://` or `wss://` upstream; one of the two is required. HTTP cannot supply `newHeads`, so it is rejected. The variable keeps credentials in the URL off the process list. |
| `--host`      | `127.0.0.1` | Bind address.                                        |
| `--port`      | `19778`     | Bind port; `0` takes an OS-assigned port.            |
| `--retention` | `128`       | Canonical blocks kept for catch-up (integer >= 1).   |
| `--max-peer-buffered-bytes` | `16777216` | A peer whose unsent pushes and answers pass this is told why and cut (integer >= 1). |
| `--max-addresses-per-request` | `1000` | Addresses a subscription or catch-up, and accounts a state read, may name. |
| `--max-subscriptions-per-connection` | `64` | Subscriptions one connection may hold open. |
| `--max-connections` | `256` | Connections open at once; one more is refused with HTTP 503. |
| `--max-in-flight-requests` | `32` | Requests of one connection answered at once. |
| `--max-watched-addresses` | `10000` | Accounts whose values the service keeps (see below). |
| `--allow-origin` | (none) | A browser origin that may connect; repeat it for more. Connections without an `Origin` header (node clients) are always admitted, browser origins not listed get HTTP 403. |

A request past the address limit fails as invalid params; one past a
subscription, in-flight or watched limit fails with code `-32005`. The
connection stays open either way.

The cache lives in memory only: a restarted service loads the last
`retention` blocks again and refills the cache on reads. Only watched
accounts are cached. An account is watched while a subscription names it or a
request reads it, and stays watched afterwards until its place is needed: past
`--max-watched-addresses` the least recently used account that no
subscription or request holds is dropped together with its cached values.
After an outage longer than the retention window only the newest `retention`
blocks are traced, and the history restarts at them.

Once it is serving, it prints one line to stdout and nothing else:
`{"event":"listening","url":"ws://127.0.0.1:19778"}`. The URL is the bound
address, so `--port 0` reports the real port. `SIGINT` and `SIGTERM` close it
cleanly (exit 0).

The upstream must serve `eth_subscribe` `newHeads`, `eth_getBlockByNumber`,
`eth_getBlockByHash`, and `debug_traceBlockByNumber` with `prestateTracer` in
`diffMode` and with `callTracer`. Each nonempty block is traced exactly once
with each tracer; a block with no transactions gets empty maps and no trace.

### What it serves

The methods are `scp_subscribeContractStorage`, `scp_unsubscribe`,
`scp_getContractStorageDiffs`, `scp_getState` and `scp_getHead`; it pushes
`scp_subscription` and `scp_disconnect`. Their parameters, answers, errors and ordering are specified
in [the storage diff service specification](../../docs/spec/specification/runtime/storage-diff-service.md);
this file does not repeat them. Batch requests are refused.

### Operating it

- **Finality.** Records follow the best head and roll back with it on a
  reorg; there is no separate final level.
- **Asset Hub tracer.** Its `prestateTracer` in `diffMode` reports the writes
  of reverted sub-calls in `post`, so the service reads the values of such a
  block instead of using the trace.
- **Failure.** The upstream is trusted and there is no authentication; the
  default bind is loopback. A lost upstream socket is reconnected; an outage
  or failure that outlasts the request retries is fatal: the service closes
  its peers and exits nonzero, so run it under a supervisor. Errors name the
  upstream by scheme and host only, never its credentials.

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
