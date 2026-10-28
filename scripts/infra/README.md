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
| `--cache-dir` | (none) | Directory for the persisted cache (`state.json`). Without it the cache lives in memory only. See [Backfill, snapshots and persistence](#backfill-snapshots-and-persistence). |
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

### Wire format

- `scp_subscribeContractStorage` with params `[addresses]` returns a string
  subscription id, scoped to the socket. Each later canonical block is pushed as
  `{"jsonrpc":"2.0","method":"scp_subscription","params":{"subscription":id,"result":record}}`.
  A socket may hold many subscriptions; closing it drops them all. A new
  subscription gets **future commits only**: use catch-up for history.
- `scp_unsubscribe` with params `[subscriptionId]` returns `true` and stops
  that subscription's pushes at once, or `false` for an id this socket does
  not hold. The socket's other subscriptions are unaffected.
- `scp_getContractStorageDiffs` with params `[addresses, fromBlock]` returns
  `{records, includedHead, head}`: the retained canonical records from `fromBlock` (a
  non-negative integer or a canonical hex quantity) up to the head, inclusive
  and ascending, and the current included head (`{number, hash}`, or `null`
  while there is none). A `fromBlock` above the head returns `records: []`. One
  below the oldest retained block fails with code `-32001` and message
  `Requested block has been pruned`. A peer that reconnects restores both
  levels from this one answer. `head` is the block environment of the best
  head (below), so a caller can run against it even when `records` is empty.
- `record` is `{number, hash, parentHash, timestamp, baseFeePerGas?, gasLimit,
  miner, mixHash, pre, post, logs}`. The block environment fields are
  the quantities and hashes as the upstream's block has them (lower case);
  `baseFeePerGas` is absent when the upstream block has none. `pre` and `post` map
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

### Two levels: latest and included

Records are the **latest** level: the upstream's best head, about 2-4 s old on
Asset Hub, and it can roll back (see below). The **included** level is the
newest block the chain treats as final for events and irreversible actions; on
Asset Hub it is the newest block the Polkadot relay chain has included (about
15 s, and no included block was ever orphaned in a 14 h measurement). The
service pushes it to every socket that holds at least one subscription as
`{"jsonrpc":"2.0","method":"scp_includedHead","params":{"number":"0x..","hash":"0x.."}}`,
only when it advances (a lower or equal number is ignored). `number` and `hash`
are the eth block. If the included head is not on the retained best chain (a
retained block of that number has another hash), the service logs a warning
and does nothing else: it is an early reorg signal. A head outside the retained
window, or ahead of the best head, cannot be judged and is not reported.

Inclusion is an `AIncludedHeadStrategy`; the service never asks it for more
than the head:

- **Asset Hub relay strategy** (`--included-relay-url`). One
  `state_subscribeStorage` subscription on the relay chain for
  `Paras::Heads(paraId)`: a change per inclusion (about every 6 s) carries the
  SCALE parachain header, whose blake2-256 is the included Substrate hash and
  whose number follows the parent hash. One `state_getStorage` read of
  `Revive::BlockHash(number)` on the Asset Hub node, at that Substrate hash,
  gives the eth hash. That is the whole RPC budget: nothing is polled. Both
  connections are reconnected with the policy below; the new subscription
  announces the current head again. A read that fails or finds no entry is
  retried 3 times, then the service fails.
- **Depth strategy** (`--included-dev-depth`). Dev and tests only: after each
  best head it reads the block `depth` behind it, one upstream request per head.

### Logs

For an address with a subscription, a record carries `logs`: the address's event
logs of that block, in `logIndex` order, each
`{address, topics, data, logIndex, transactionIndex, transactionHash}`. The
service tests each subscribed address against the block header's `logsBloom`
(standard Ethereum bloom: three bits of `keccak256(address)`), using the header
it already fetched, so the test costs no request. It calls
`eth_getLogs({blockHash, address: [matching addresses]})` **only** when at least
one address matches, once per block and address, and not at all otherwise. A
bloom match can be a false positive: the call then returns no logs. An address
that emits an event without changing storage is found the same way. A block
staged before anyone subscribed to an address has its logs fetched, once, by
the first catch-up that asks for that address. A rolled back block takes its
logs with it; its replacement has its own.

### Shared state cache and `scp_getState`

Peers read state from the service, not from the upstream node. The service
keeps a cache of storage slots and of account balance, nonce and code, for any
address a peer asks about:

- **Fill.** `scp_getState` with params
  `[blockHash, [{address, slots?, account?, code?}]]` (`slots`: 32-byte slot
  keys; `account`: balance and nonce; `code`: contract code) returns
  `{number, hash, accounts}`, where `accounts` maps lower-case addresses to
  `{balance?, nonce?, code?, storage?}` like a record's `post`. Balances are hex
  quantities, nonces numbers, words 32-byte hex. A field the cache lacks is read
  from the upstream once: `eth_getStorageAt`, `eth_getBalance`,
  `eth_getTransactionCount` or `eth_getCode` with an EIP-1898 `{blockHash}` of
  the best head, so the value belongs to the chain the service follows (anvil
  and Asset Hub eth-rpc both accept it; the latter answers "Ethereum block not
  found" for an unknown hash). Concurrent misses for one field share a single
  fetch. If a block is committed during the fetch, its writes are applied to the
  fetched value; if the pinned block was dropped, the fetch is repeated.
- **Keep current.** Each committed block's `post` is applied to the cached
  fields (only those already cached), and a reorg undoes the orphaned blocks
  with their `pre` values, newest first. An account that appears only in `post`
  did not exist before, so its balance, nonce, code and cached slots were
  empty. A reorg whose common ancestor is older than the retained window clears
  the cache.
- **Older blocks.** `blockHash` may be any retained block: the value at the best
  head is rolled back over the later blocks' `pre` values. A block that is
  unknown, orphaned or older than the window fails with code `-32002` and
  message `Block is not retained`, so a caller can fall back.
- **Not covered.** State a block changes outside its transactions' traced
  keys and accounts (system calls, withdrawals) is not seen. The cache is not
  evicted.

### Serving blocks, transactions and receipts

The service keeps each retained block as the upstream returned it (full
transactions), so a peer can read chain data from it instead of the node:

- `scp_getBlock` with params `[block, full?]`, `block` being `"latest"`, a hex
  quantity or a 32-byte hash, returns the block exactly as the upstream's
  `eth_getBlockBy*` does, with full or hashed transactions (`full`, default
  false). A block that is not retained answers `null`.
- `scp_getTransaction` with `[hash]` returns a transaction of a retained block
  as `eth_getTransactionByHash` does, or `null`.
- `scp_getTransactionReceipt` with `[hash]` returns its receipt as
  `eth_getTransactionReceipt` does, or `null`. A block's receipts are fetched
  once, on the first read of any of them, with `eth_getBlockReceipts` (anvil and
  Asset Hub eth-rpc both serve it); an upstream that refuses it gets one batch
  of `eth_getTransactionReceipt`.

A `null` does not mean the chain lacks the block or transaction: it may be newer
than the service's head or older than its window, so a caller asks the node then.

### Upstream round trips

Fields a `scp_getState` has to read from the upstream go out as one JSON-RPC
batch array (anvil and Asset Hub eth-rpc both accept arrays), so a read of many
fields is one round trip. Per new block the service makes one block fetch (with
full transactions), plus one more after the trace of a block with transactions,
to check that the trace was of the block still at that number. A parent inside
the retained window is not fetched.

### Block environment

Every record, and `head` of the catch-up, carries the block fields a local EVM
needs: `number`, `hash`, `timestamp`, `baseFeePerGas`, `gasLimit`, `miner` and
`mixHash` (prevRandao). They come from the block fetch the service already
makes for each block.

### Upstream request budget

Per block the service makes the trace (`debug_traceBlockByNumber`, none for an
empty block), the block fetches it needs to follow the chain, and
`eth_getLogs` when a subscribed address matches the header bloom. State reads
add on-demand requests only: one per slot, and one each for an account's
balance, nonce and code, at most once per deployment while the service runs and
the reorgs it sees stay inside the retained window. A cleared cache (a reorg
below the window, or a restart) is filled again by the next reads. The relay
inclusion strategy adds one relay subscription and one `state_getStorage` per
inclusion.

### Values come from reads, not from the trace

The trace says **which** storage keys and accounts a block touched, never their
values. For each block the service takes the union of touched keys, and of the
balance, nonce and code of touched accounts, and reads their end-of-block
values with `eth_getStorageAt`, `eth_getBalance`, `eth_getTransactionCount` and
`eth_getCode` pinned to `{blockHash}`, in one JSON-RPC batch. Pre values come
from the service's own cache when it is at the parent block, else from reads at
the parent hash. A touched key whose value did not change produces no entry in
`pre` or `post`. Only subscribed addresses are read. A block therefore costs
one extra batch round trip when it touches a subscribed address, and none
otherwise.

This is required by an Asset Hub bug: its `prestateTracer` in `diffMode`
reports storage writes (and value transfers) of **reverted sub-call frames** in
`post`. The reproduction is a contract whose `f()` sets `a = 1` and calls
`this.g()`, where `g()` sets `b = 5`, `flag = true` and reverts: the trace
shows slot 0 = 1, slot 1 = 5 and slot 2 = 1, but only slot 0 is really 1.
Anvil's tracer is correct, which is why runs against anvil never showed it.
The service assumes the trace never omits a key that really changed (the trace
is a superset of the truth); the test "misses no slot anvil holds after calls
that nest and re-enter" checks this on nested and re-entered frames against
`anvil_dumpState`.

### Backfill, snapshots and persistence

- **Backfill.** The first subscription to an address makes the service
  rebuild its complete state: it finds the deploy block by bisecting
  `eth_getCode` (about log2(chain height) probes; an error answer counts as no
  code), lists the blocks since that have transactions in batches of 100
  `eth_getBlockByNumber`, traces only those (batches of 8 traces), unions the
  touched keys, and reads all their values in batches of 200 pinned to the
  backfill's anchor block. The listing is linear in the blocks since deploy
  (about 130 blocks/s on Asset Hub eth-rpc), so a contract deployed millions of
  blocks ago is slow to backfill. Blocks mined meanwhile are included by
  further rounds (at most 5 restarts if a reorg drops the anchor). The cost of
  each backfill is logged (`codeProbes`, `blockReads`, `traces`, `stateReads`,
  `roundTrips`, `blocks`, `tracedBlocks`, `slots`, `milliseconds`,
  `deployBlock`). `contracts/` do not emit an event for every write, so logs
  cannot list the writing blocks.
- **Block source.** Which blocks to trace is a strategy
  ([ABackfillBlockSource](../../src/utils/node/storageDiff/backfillBlocks/ABackfillBlockSource.ts)).
  `ListedBlockSource` (the default) lists every block of the range, as above.
  `ChildTrieBlockSource` is selected by the `--included-relay-url` and
  `--included-asset-hub-url` flags: it bisects the root of the contract's child
  trie on the Asset Hub Substrate node (an archive node), about log2(range)
  root reads per changed block, and names only the blocks that changed the
  contract's storage. It does not check that the chain stayed one chain
  between reads beyond the tip block.
- **Complete accounts.** A backfilled account is complete: a slot it does not
  hold reads zero without asking the upstream.
- **Snapshot.** After backfill the service pushes `scp_snapshot` with
  `{subscription, result: {block: {number, hash}, accounts}}` holding the
  full state at that block, then per-block records. A peer applies the snapshot
  and the records after it, and reads nothing else from the service on the
  normal path. A later subscribe pushes snapshots only for addresses not
  already complete.
- **Lazy path.** A read of anything not held still goes through `scp_getState`
  (which reads the upstream once); the peer falls back to its node on `-32002`.
- **Persistence.** With `--cache-dir` the service writes `state.json`
  (atomic rename, debounced 500 ms) with the head, the cache and the last 64
  blocks' hashes. On start it loads it, rolls the cache back over `pre` values
  if the saved head is no longer canonical, and catches up the missed blocks.

### Checking a backfill against Asset Hub

`scripts/infra/storage-diff-asset-hub-check.js --address 0x... [--progress-file f]`
reads only. It backfills one contract with the service's own code (deploy
bisect, `ChildTrieBlockSource`, `traceKeys`, `readState`) at a block 10 behind
the head of Asset Hub eth-rpc, then reads the contract's whole child trie from
the Substrate node at the same block (`Revive.AccountInfoOf` gives the
`trie_id`; `childstate_getKeysPaged` lists the keys, `blake2_256(slot)` each)
and compares keys and values with the cache. `--progress-file` saves after
every 64 traced blocks, so a killed run resumes. Exit 1 when they differ.

Measured on mainnet contract `0x99ee73298423dcf5da3059a5e48bda20bfbcd01b`
(deployed at block 19,760,180, 2,649,917 blocks before the check): 93 s,
25 code probes, 15,413 child root reads, 3,125 traces, 351 state reads, 468
round trips. 317 non-zero cached slots matched the node's values exactly,
but the child trie holds 320 entries: slots 0x16, 0x1e and 0x1f (values 5, 25,
100, written in the deploy block) are missing from Asset Hub's
`prestateTracer` trace of that block, so the trace named a key set that was
not a superset. The cache is therefore not complete for this contract.

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
miss records; it recovers with catch-up within the retention window. Before
the cut the service queues one notification,
`{"jsonrpc":"2.0","method":"scp_disconnect","params":{"reason":"send-buffer-overflow","bufferedBytes":n,"limitBytes":n}}`,
pushes nothing more, and closes the socket with code `1008` and reason
`send-buffer-overflow`. The notice sits behind the backlog: a peer that resumes
reading gets every queued record, then the notice, then the close. A peer that
has not drained within 10 seconds is dropped without the close handshake. The check
runs when a block is published and counts the socket's whole send buffer,
including a catch-up reply the peer has not yet drained. A reply of that size
can therefore be cut by the next block; request a narrower window (a later
`fromBlock`, fewer addresses) instead of repeating it.

### Failure policy and trust

A block that changes while it is being traced, an upstream error answer and a
10 second request timeout are retried, both while loading the initial history
and while following the head: the service re-resolves the best head up to 3
more times, waiting 250 ms, then 500 ms, then 1 s.

A lost upstream socket (or one that sends a malformed message) is reconnected
up to 5 times, waiting 200 ms and doubling, and the head subscription is
opened again. The service then reconciles from its last canonical record, the
same way it handles a gap or a reorg, so subscribers see a continuous chain or
a replacement branch. Startup uses the same policy, for its first connection
and for a socket that drops while the initial history loads.

Anything else is **fatal**: a per-transaction tracer error, a malformed block
or trace, or a failure that outlasts its retries. The service then closes its
peers and exits nonzero; it never invents an empty diff. Run it under a
supervisor that restarts it; consumers then catch up within the new window.
Errors name the upstream by scheme and host only, never its credentials.

There is no authentication and the upstream is trusted. The default bind is
loopback; binding elsewhere is the operator's responsibility. There are no
proofs and no gossip, and history is in memory only (the cache alone can be persisted, see
below).

### Phase-2 openings

The wire already carries what proofs need, with no proof code: snapshots and
records are anchored to a `{number, hash}` block (records also carry
`parentHash`); notifications are objects with named fields; slot keys are raw
32-byte keys; and the mirror takes its feed through one replaceable interface
(`MirrorFeed`), so a verifying client can replace the plain one.

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
