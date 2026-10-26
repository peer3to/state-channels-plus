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
([StorageDiffService.ts](../../src/utils/node/StorageDiffService.ts)) that
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

Once it is serving, it prints one line to stdout and nothing else:
`{"event":"listening","url":"ws://127.0.0.1:19778"}`. The URL is the bound
address, so `--port 0` reports the real port. `SIGINT` and `SIGTERM` close it
cleanly (exit 0).

The upstream must serve `eth_subscribe` `newHeads`, `eth_getBlockByNumber`,
`eth_getBlockByHash`, and `debug_traceBlockByNumber` with `prestateTracer` in
`diffMode`. Each nonempty block is traced exactly once, with
`[number, {"tracer":"prestateTracer","tracerConfig":{"diffMode":true}}]`; a
block with no transactions gets empty maps and no trace.

### Wire format

- `scp_subscribeContractStorage` with params `[addresses]` returns a string
  subscription id, scoped to the socket. Each later canonical block is pushed as
  `{"jsonrpc":"2.0","method":"scp_subscription","params":{"subscription":id,"result":record}}`.
  A socket may hold many subscriptions; closing it drops them all. A new
  subscription gets **future commits only**: use catch-up for history.
- `scp_getContractStorageDiffs` with params `[addresses, fromBlock]` returns the
  retained canonical records from `fromBlock` (a non-negative integer or a
  canonical hex quantity) up to the head, inclusive and ascending. A
  `fromBlock` above the head returns `[]`. One below the oldest retained block
  fails with code `-32001` and message `Requested block has been pruned`.
- `record` is `{number, hash, parentHash, pre, post}`. `pre` and `post` map
  lower-case account addresses to `{balance?, nonce?, code?, storage?}`, and
  `storage` maps 32-byte slot keys to 32-byte words. They hold only the
  requested addresses; an empty address list is valid and yields headers with
  empty maps. Addresses are matched case-insensitively and deduplicated.
- Across the transactions of one block, `pre` keeps the earliest value of each
  field and slot and `post` the latest. A cleared slot (or a deleted account's
  slot) is an explicit 32-byte zero in `post`. A slot or field that was empty
  before the block (the tracer leaves empty values out of `pre`) reads as zero
  in `pre`, even when a later transaction of the block touches it again.
- Errors follow JSON-RPC: `-32700` invalid JSON, `-32600` invalid request,
  `-32601` unknown method, `-32602` invalid params. Ids may be strings or
  numbers; a request without an id gets no reply. **Batch requests are refused**
  as invalid requests. Messages over 1 MiB close the offending socket.

### Reorgs and retention

Every head notification triggers a lookup of the current best block, so a
height-only notification or a missed one does not matter. Blocks missing between
the retained head and the new best are fetched and traced in order. On a reorg
the orphaned records are dropped from history and **every replacement record is
published once, in chain order**; no "revert" message exists. A rollback to an
ancestor drops the orphans and publishes nothing. The upstream must still serve
old-branch headers by hash for a reorg deeper than the retained window.
Reconciliation, subscriptions and catch-up share one queue, so a catch-up
answered after a block was committed always includes it.

A peer whose send buffer passes 16 MiB is disconnected rather than allowed to
miss records; it recovers with catch-up within the retention window. The check
runs when a block is published and counts the socket's whole send buffer,
including a catch-up reply the peer has not yet drained. A reply of that size
can therefore be cut by the next block; request a narrower window (a later
`fromBlock`, fewer addresses) instead of repeating it.

### Failure policy and trust

Any upstream failure is **fatal**: a lost socket, a 10 second request timeout,
an RPC or per-transaction tracer error, a malformed response, or a block that
changes while it is being traced. The service closes its peers and exits
nonzero; it does not reconnect, retry, or invent an empty diff. Run it under a
supervisor that restarts it; consumers then catch up within the new window.
Errors name the upstream by scheme and host only, never its credentials.

There is no authentication and the upstream is trusted. The default bind is
loopback; binding elsewhere is the operator's responsibility. There are no
proofs and no gossip, and history is in memory only.

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
