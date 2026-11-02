# Storage diff service

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

A client that reads chain state through ordinary RPC pays one request per slot, balance or block, and pays it again at every peer. The storage diff service is a shared observer of one chain: it follows the best head of one upstream node, learns once per block which storage slots changed, and serves that to many peers over JSON-RPC 2.0 on a WebSocket, so a peer can keep a local mirror of contract state instead of asking the node. The target deployment is Polkadot Asset Hub (pallet-revive with its Ethereum RPC), but the observable model is chain-neutral. The first phase has no proofs and no gossip: peers trust the service, as they trust their RPC node today.

The service follows one chain level: the upstream's best head, which can roll back. Finality is not the service's concern; the SDK treats a block as final at first inclusion, a temporary assumption it owns. Peers read three kinds of answer: pushed block records for subscribed addresses, a complete snapshot of a subscribed account with each subscription's status (`ready`, `syncing` or `lazy`), and on-demand reads of state, blocks, transactions and receipts for what is retained. A service that cannot keep up, loses its upstream for good, or sees a chain it cannot reconcile, stops rather than invent state.

## Requirements and invariants

**<a id="req-sds-1-txey33"></a>`REQ-SDS-1-TXEY33` — A subscription receives one record per canonical block.** After `scp_subscribeContractStorage` succeeds, the service MUST push to that subscription one record for every later canonical block, in chain order, and only for blocks after the subscription: history is read by catch-up ([`REQ-SDS-2-R1RRCF`](storage-diff-service.md#req-sds-2-r1rrcf)). A record carries the block environment (number, hash, parent hash, timestamp, gas limit, miner, mix hash, and the base fee when the upstream block has one), the `pre` and `post` account maps limited to the subscribed addresses, and the logs of [`REQ-SDS-5-B2V01N`](storage-diff-service.md#req-sds-5-b2v01n). Phase 1 limit: the service has no authentication and listens on loopback by default; anyone who can connect reads everything it retains, and phase 2 proofs are meant to remove the need to trust it. Across the transactions of one block `pre` keeps the earliest value and `post` the latest; a slot cleared to zero is the zero word in `post`. A block that leaves the subscribed addresses untouched, or has no transactions, still yields a record with empty maps. After a reorganization the service MUST drop the orphaned records and push every replacement record once, in chain order; no revert message exists, and a replacement record names the common ancestor as its parent. When the retained history restarts after an outage or a reorganization longer than the window ([`REQ-SDS-11-QV2VPT`](storage-diff-service.md#req-sds-11-qv2vpt)), the records resume at the oldest block of the new window and the skipped blocks get none; no notice is sent. A subscriber MUST therefore treat a record whose parent hash is neither its last block nor an earlier block it holds as a gap and resync: a catch-up over the skipped blocks fails with the pruned error (code `-32001`), and the subscriber reads from the node instead.

**<a id="req-sds-2-r1rrcf"></a>`REQ-SDS-2-R1RRCF` — Catch-up returns the retained history and the head.** `scp_getContractStorageDiffs` MUST return the retained canonical records from `fromBlock` to the head, inclusive and ascending, filtered to the requested addresses, together with the block environment of the best head. A `fromBlock` after the head returns no records. A `fromBlock` older than the oldest retained block MUST fail with the pruned error (code `-32001`); a `fromBlock` equal to the oldest retained block returns the whole window. One answer restores a reconnecting peer.

**<a id="req-sds-3-5jw8ak"></a>`REQ-SDS-3-5JW8AK` — Subscriptions belong to their connection and end on request.** A subscription id MUST be scoped to the connection that created it. `scp_unsubscribe` MUST stop that subscription's pushes at once and return `true`, return `false` for an id the connection does not hold, and leave the connection's other subscriptions unaffected. Closing the connection drops all its subscriptions. A request with malformed parameters MUST fail as invalid params, and a request naming anything that is not a service endpoint MUST fail as method not found, so no internal member is reachable by name. Batch requests and messages over 1 MiB are refused.

**<a id="req-sds-4-zzdevf"></a>`REQ-SDS-4-ZZDEVF` — Reported values are the chain's own, not the tracer's.** For the subscribed addresses a record MUST hold the values the chain holds at the end of the block, whatever the upstream's trace reports. The trace is used for which storage keys and accounts a block touched; its values are used as they are only when no call frame of the block carries an error. For a block with a failed frame, or whose call frames could not be had, the end-of-block values of the touched keys and accounts MUST be read from the upstream pinned to the block hash. A touched key whose value did not change MUST NOT appear in `pre` or `post`. The old values of a multi-block step come from the service's own cache carried forward block by block. A block whose trace values were used keeps them for every account the trace names, so an account first watched later finds its retained history without a read; a block read from the upstream holds only the watched accounts, and an account watched later has its history read for those blocks. Phase 1 limit: state a block changes outside its transactions' traced keys and accounts (system calls, withdrawals) is not seen; the entry-count recount of [`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw) is the accepted guard, and an account it catches drops to lazy reads.

**<a id="req-sds-5-b2v01n"></a>`REQ-SDS-5-B2V01N` — Logs of subscribed addresses travel with their block.** A record MUST carry the event logs of its block for each subscribed address, in log-index order. The service MUST test each subscribed address against the block header's logs bloom and ask the upstream for logs only when at least one address matches, once per block and address; a bloom false positive yields no logs. An address that emits an event without changing storage is found the same way. A block staged before anyone subscribed to an address has its logs fetched once, by the first catch-up that asks for that address. A catch-up MUST fetch the missing logs of its selected blocks outside the service's serialized work, as single requests within the limit of state reads in flight of [`REQ-SDS-7-PZCBQ9`](storage-diff-service.md#req-sds-7-pzcbq9), so a catch-up waiting for the upstream never holds back following the head; inside the serialized work only blocks staged after that fetch have their logs fetched. A rolled back block takes its logs with it and its replacement has its own. A log fetch the upstream answers with an error MUST be retried, and the record then carries the log.

**<a id="req-sds-7-pzcbq9"></a>`REQ-SDS-7-PZCBQ9` — State reads come from one shared cache.** `scp_getState` MUST answer storage slots, balance, nonce and code of any address from a cache shared by all peers. A field the cache lacks is read from the upstream once, pinned to the best head's block hash, and concurrent misses for one field share one fetch. One request MUST name at most 1024 fields (a slot is one, balance and nonce are two, code is one, and an account naming none counts as one); a larger one fails as invalid params and reads nothing. At most 16 state reads for peers MUST be at the upstream at once, so the reads that follow the head keep room. If a block is committed during a fetch its writes MUST be applied to the fetched value. Each committed block's `post` updates the cached fields already held, and a reorganization undoes the orphaned blocks with their `pre` values, newest first. A block hash that names a retained block MUST be answered as of that block, rolling the head value back over later `pre` values; a hash that is unknown, orphaned or older than the window MUST fail with the not-retained error (code `-32002`) so the caller can fall back. A malformed request fails as invalid params. Only the values of watched accounts are cached, and an account dropped from the watched set loses its cached values ([`REQ-SDS-12-JDW71Y`](storage-diff-service.md#req-sds-12-jdw71y)).

**<a id="req-sds-8-fqfntv"></a>`REQ-SDS-8-FQFNTV` — Retained blocks, transactions and receipts are served from the service.** `scp_getBlock`, `scp_getTransaction` and `scp_getTransactionReceipt` MUST answer from the retained blocks exactly as the upstream's `eth_getBlockBy*`, `eth_getTransactionByHash` and `eth_getTransactionReceipt` do, with full or hashed transactions as asked; anything not retained answers `null`, which means only that the caller asks the node. A block's receipts are fetched once, on the first read of any of them, with one `eth_getBlockReceipts` request. Only an answer of method not found (JSON-RPC code `-32601`) switches the read to one `eth_getTransactionReceipt` request per transaction; any other error answer fails that read, and the next read asks `eth_getBlockReceipts` again. An answer that does not hold the receipt of each of the block's transactions (a node that has not indexed the block answers `null`) fails that read the same way, and the next read asks again. A read that names the block its caller already saw MUST wait for the head to reach that block, and answer with what the service holds when the wait ends without it ([`REQ-SDS-12-N40MKR`](storage-diff-service.md#req-sds-12-n40mkr)). The service's per-block upstream budget is one block fetch with full transactions, one more check after the trace of a block with transactions, no parent fetch inside the retained window, and no logs fetch unless [`REQ-SDS-5-B2V01N`](storage-diff-service.md#req-sds-5-b2v01n) requires one.

**<a id="req-sds-9-zrpzzw"></a>`REQ-SDS-9-ZRPZZW` — A subscription is anchored by a complete snapshot, or told none is coming.** The first subscription to an address MUST make the service rebuild that account's complete state: the deploy block is found by bisecting the account's code, the blocks that changed the account since are listed by a block source (by default the blocks with transactions, which are traced; where the operator configures an Asset Hub Substrate node, the blocks after which the account's child trie root changed; that node serves no Ethereum RPC, so it is reached through the same reconnecting node provider as the upstream without ever being asked for a chain id), the touched keys are unioned, and all their values are read pinned to one anchor block; blocks mined meanwhile are included by further rounds, and a reorganization that drops the anchor starts the backfill over. A code probe answered with an error counts as "no code" only when the answer says the runtime API method "is not supported at the queried block" (Asset Hub below its contracts pallet); any other error answer is transient and restarts the backfill, and a failed probe at the head is never taken as an account without code. Every upstream read of a backfill (code probes, block listings, traces, the final value reads, Substrate reads) MUST be a single request that shares the limit of state reads in flight of [`REQ-SDS-7-PZCBQ9`](storage-diff-service.md#req-sds-7-pzcbq9), and at most 8 traces of one backfill are at the upstream at once. Inside that limit a freed place MUST go to a waiting peer read before a waiting backfill read, and at most 2 backfills MUST read at once; another waits, `syncing`, until one ends. A read other than a code probe that is answered with an error or times out MUST be asked again on its own, with backoff, before the backfill starts over. A Substrate read MUST name the hash of the block it is for: a block the Substrate node has not reached yet is asked for again, never read at the node's best block, and one it still lacks after those retries starts the backfill over. The final value reads MUST pass the same validation as peers' state reads, so a malformed word fails the backfill. A backfilled account is complete, so a slot it does not hold reads zero without asking the upstream, and it is kept current from the records. `scp_subscribeContractStorage` MUST answer the status of each address: `ready`, the account is complete and its snapshot is pushed at once as `scp_snapshot`, after the reply that returned the subscription id; `syncing`, a backfill is running or queued and the snapshot follows; `lazy`, no snapshot will come. A later subscription pushes snapshots only for addresses not already complete. A connection that subscribes again to an account none of its open subscriptions follows any more is pushed its snapshot again, since it missed that account's records meanwhile. An account without code is pushed with its balance and nonce, also where the block source counts entries: such an account holds none. When the backfill fails, or the number of entries the chain holds for the account differs from what the history named (checked at the anchor and again for each block whose trace names the account, even where the trace omits the write), the account MUST stay lazy, the service MUST warn (with both counts, or with the reason the backfill failed), and every subscription following it, now and later, is told by an `scp_snapshot` carrying `lazy` so it stops waiting and reads the account on demand; a lazy account is not backfilled again until its cache is cleared. The recount after a block is coalesced per account: at most one count is in flight per account, and the blocks named while it runs are counted once more, at the newest of them. A count that fails is skipped with a warning and leaves the account as it is, and a count of a block a reorganization dropped is ignored.

**<a id="req-sds-11-qv2vpt"></a>`REQ-SDS-11-QV2VPT` — Upstream trouble is retried, then fatal; a lagging peer is told and cut.** A block that changes while it is traced, an upstream error answer and a request timeout MUST be retried, both while loading the initial history and while following the head. A lost upstream connection MUST be reopened, its requests sent again, the head subscription renewed and the chain reconciled from the last canonical record, so subscribers see a continuous chain or a replacement branch; an account first watched meanwhile gets its history once the upstream answers, never an empty one. When the new blocks of an outage or a reorganization outnumber the retention window, only the newest window of them MUST be traced: the retained history restarts at them, the cache is emptied, and they are pushed in chain order, so a subscriber sees the gap by the first one's parent hash ([`REQ-SDS-1-TXEY33`](storage-diff-service.md#req-sds-1-txey33)). An upstream that refuses the first connection fails the start. Anything else, or a failure that outlasts its retries, including an outage longer than the request retries allow and an upstream reset to a chain sharing no ancestor with the retained one, MUST be fatal: the service closes its peers and exits nonzero, and never invents an empty diff, so a supervisor restarts it. An upstream failure that fails a peer's request MUST answer it as an internal error (code `-32603`): the upstream's own code and message never reach a peer, since its codes can collide with the service's own and its message can name the upstream. A peer whose unsent bytes, pushed records and answers alike, pass the configured limit MUST be sent a notice naming the reason (`scp_disconnect`), pushed nothing more, and disconnected, so it recovers by catch-up inside the retention window instead of silently missing records.

**<a id="req-sds-12-jdw71y"></a>`REQ-SDS-12-JDW71Y` — What peers can make the service hold is bounded.** Every limit below is configurable; the defaults are given. A subscription or a catch-up MUST name at most 1,000 addresses, and a state read at most 1,000 accounts; a larger request fails as invalid params. A connection MUST hold at most 64 subscriptions and have at most 32 requests answered at once; a request past either fails with the limit error (code `-32005`) and the connection stays open. At most 256 connections MUST be open at once; one more is refused at the WebSocket upgrade with HTTP 503. An upgrade that carries an `Origin` header MUST be refused with HTTP 403 unless that origin is on the configured allow list, which is empty by default; an upgrade without the header, as node clients send it, is admitted. A request that leaves out `params` is read as having empty params. The service MUST keep the values of at most 10,000 watched accounts, and one connection's subscriptions and requests MUST hold at most 2,000 of them at once; a subscription or request that would take its connection past that share fails with the limit error and holds nothing, while other connections keep theirs. An account is held while a subscription names it, a request reads it or its backfill runs; a subscription releases its accounts when it is unsubscribed or its connection closes. An account nobody holds stays watched, with its cached values, until a new account needs its place: the least recently used account nobody holds is then dropped together with its cached values, and is neither complete nor lazy afterwards, so a later subscription backfills it again. A request that needs more new accounts than can be dropped fails with the limit error and holds nothing. A fetch that ends after its account was dropped MUST leave no value in the cache.

**<a id="req-sds-12-n40mkr"></a>`REQ-SDS-12-N40MKR` — A wait for a late block or snapshot ends at the first event, not at a fixed time.** A read that names a block the head lacks (`minBlock`) MUST wait for the head to reach that block and end at the first of: the head reaching it; the service's tracing of a block it is processing failing or being retried (which holds back every block after it); the service's upstream not having seen the block; the service closing; or a backstop for a silent hang, which is learned from how long new heads took to commit after the upstream announced them (a multiple of the slowest in a short recent window) and never exceeds the callers' RPC deadline, which is also its value until a head has been committed. A wait that ends without the head answers with what the service holds. The service MUST ask the upstream for its block number once for all the waits at a time, within the limit of state reads for peers of [`REQ-SDS-7-PZCBQ9`](storage-diff-service.md#req-sds-7-pzcbq9), and a wait that starts during an ask gets one more ask after it. The service MUST push a named-field notice (`scp_delayed`) to every connection holding a subscription when its tracing of a block fails or is retried (`trace-failed`, with the block's number and hash), and when a caller asked for a block its upstream has not seen (`upstream-behind`, with the requested number and the best head's number and hash), except that an `upstream-behind` equal to the last one pushed, at the same best head, is not pushed again; and MUST push to a connection, per subscription, when a snapshot it promised or sent as `ready` is no longer coming at once because the cache was cleared (`snapshot-delayed`, with the accounts and the best head's number and hash), after which the snapshot follows the rebuild. A notice is an early "no", never a promise that the block or snapshot will arrive. An account no snapshot will ever come for is told by `lazy` ([`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw)), not by this notice.

## Assumptions and constraints

- The upstream node is trusted. It serves new-head notifications over a WebSocket, blocks with full transactions by number and hash, a prestate diff trace and a call-frame trace per block, logs by block hash, and balance, nonce, code and storage reads pinned to a block hash. Receipts by block are used where offered. Where an Asset Hub Substrate node is configured it is trusted too.
- The trace never omits a key that really changed (it is a superset of the truth). A trace that omits a write is detected only through the entry-count recount of [`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw), after which the account is lazy. Asset Hub breaks this for a created contract's slot that its constructor writes twice with the same value (paritytech/polkadot-sdk#13663): such a write is missing from the record, and the recount turns the account lazy.
- State a block changes outside the traced keys and accounts of its transactions (system calls, withdrawals) is not seen. This is an accepted phase 1 limit (engineer, 2026-10-31): the recount of [`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw) is the guard, an account it catches drops to lazy reads, and a cached value can stay wrong until a reorganization clears it or its account is dropped from the watched set.
- History and the cache are kept in memory only, for a bounded retention window of canonical blocks; a restarted service loads the window again. A peer that falls behind the window must read the node.
- The service is a single process without authentication; it binds to loopback by default and any wider binding is the operator's responsibility. Browser pages reach it only from the origins the operator allows. The upstream URL can be given in an environment variable, which keeps its credentials off the process list. This is an accepted phase 1 limit (engineer, 2026-10-31): phase 2 proofs are meant to remove the need to trust the service.
- Phase 1 carries no proofs and no gossip: the service's answers are as trustworthy as the service and its upstream.
- A peer whose first read of a lazy account finds no snapshot reads the account on demand; the service never delays an answer for a snapshot.

## Security considerations

**Protected assets.** The integrity of the state and block data peers mirror, the availability of the service to peers, and the credentials of the upstream.

**Trust boundaries.** Peers are untrusted: their requests are validated (malformed parameters, unknown or non-endpoint member names, batches, oversized messages and state reads over the field cap are refused), their state reads and the reads of a backfill reach the upstream at most 16 at a time, a peer that does not drain its pushes and answers is cut instead of buffering without bound, and the addresses, subscriptions, requests in progress, connections and watched accounts they can make the service hold are capped, the watched accounts in total and per connection ([`REQ-SDS-12-JDW71Y`](storage-diff-service.md#req-sds-12-jdw71y)). A page in a browser can connect only from an allowed origin, so a site the user visits cannot read the service on their machine. The upstream is trusted and so is the operator; errors name the upstream by scheme and host only, never its credentials.

**Threats and defenses.** A reverted sub-call that a tracer reports as applied would feed false values to every peer: values are read from the node whenever a frame failed ([`REQ-SDS-4-ZZDEVF`](storage-diff-service.md#req-sds-4-zzdevf)). A trace that omits a write would make a snapshot silently incomplete: the entry count turns that into a lazy account ([`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw)). An upstream failure is retried and then fatal, so the service never invents an empty diff ([`REQ-SDS-11-QV2VPT`](storage-diff-service.md#req-sds-11-qv2vpt)).

**Residual risk.** Without proofs, a compromised service or upstream can feed peers false state or blocks. An unauthenticated service reachable beyond loopback can be read by anyone. State changed outside traced transaction keys is missed. The engineer accepted these as phase 1 limits (2026-10-31): the service is unauthenticated and loopback by default, the recount of [`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw) is the guard for state changed outside traced keys, and phase 2 proofs are meant to remove the need to trust the service.

## Verification and test plan

### Requirement test matrix

Each entry is a planned black-box test obligation, not an additional specification requirement. The requirement remains the authority. Execute each entry through the service's public WebSocket endpoints against a scripted or real upstream chain; every required permutation has a stable `P1`…`PN` suffix under its plan item.

#### <a id="req-sds-1-txey33.t1"></a>`REQ-SDS-1-TXEY33.T1`

**Requirements / invariants:**

[`REQ-SDS-1-TXEY33`](storage-diff-service.md#req-sds-1-txey33)

**Setup and stimulus:**

Subscribe to one or more addresses of a chain, then mine blocks that write, clear and rewrite slots, leave the addresses untouched, or hold no transactions; replace the branch with a longer one.

**Expected result:**

Each canonical block yields exactly one record with the earliest `pre`, the latest `post` and the full block environment; replaced blocks yield one replacement record each and no revert notice.

**Required permutations:**

<a id="req-sds-1-txey33.t1.p1"></a>`REQ-SDS-1-TXEY33.T1.P1` — a slot a transaction wrote arrives with its pre and post value

<a id="req-sds-1-txey33.t1.p2"></a>`REQ-SDS-1-TXEY33.T1.P2` — a block whose transactions leave the subscribed address untouched arrives as a header with empty maps

<a id="req-sds-1-txey33.t1.p3"></a>`REQ-SDS-1-TXEY33.T1.P3` — a block without transactions arrives as a record

<a id="req-sds-1-txey33.t1.p4"></a>`REQ-SDS-1-TXEY33.T1.P4` — a slot cleared to zero is the zero word in post

<a id="req-sds-1-txey33.t1.p5"></a>`REQ-SDS-1-TXEY33.T1.P5` — two writes in one block merge into the earliest pre and the latest post

<a id="req-sds-1-txey33.t1.p6"></a>`REQ-SDS-1-TXEY33.T1.P6` — every pushed record and the catch-up head carry the block environment

<a id="req-sds-1-txey33.t1.p7"></a>`REQ-SDS-1-TXEY33.T1.P7` — after a reorganization a replacement record is pushed once and names the common ancestor as its parent

<a id="req-sds-1-txey33.t1.p8"></a>`REQ-SDS-1-TXEY33.T1.P8` — after a restart of the retained history the first pushed record's parent is no block the subscriber was sent, and a catch-up over the skipped blocks fails with the pruned error

#### <a id="req-sds-2-r1rrcf.t1"></a>`REQ-SDS-2-R1RRCF.T1`

**Requirements / invariants:**

[`REQ-SDS-2-R1RRCF`](storage-diff-service.md#req-sds-2-r1rrcf)

**Setup and stimulus:**

Mine more blocks than the retention window holds, then request catch-up from the oldest retained block, from inside the window, from after the head, and from before the window.

**Expected result:**

Records are exactly the retained ones from `fromBlock`, ascending; a block after the head gives an empty list; a pruned start gives the pruned error.

**Required permutations:**

<a id="req-sds-2-r1rrcf.t1.p1"></a>`REQ-SDS-2-R1RRCF.T1.P1` — the retained records from fromBlock to the head arrive in chain order

<a id="req-sds-2-r1rrcf.t1.p2"></a>`REQ-SDS-2-R1RRCF.T1.P2` — a fromBlock after the head returns no records

<a id="req-sds-2-r1rrcf.t1.p3"></a>`REQ-SDS-2-R1RRCF.T1.P3` — a fromBlock older than the retention window fails with the pruned error

<a id="req-sds-2-r1rrcf.t1.p4"></a>`REQ-SDS-2-R1RRCF.T1.P4` — a fromBlock equal to the oldest retained block returns the whole window

#### <a id="req-sds-3-5jw8ak.t1"></a>`REQ-SDS-3-5JW8AK.T1`

**Requirements / invariants:**

[`REQ-SDS-3-5JW8AK`](storage-diff-service.md#req-sds-3-5jw8ak)

**Setup and stimulus:**

Hold several subscriptions on one connection, unsubscribe them one by one, unsubscribe an id the connection does not hold, send a malformed address list and malformed block, head and transaction read params, and call a member name that is not an endpoint.

**Expected result:**

Pushes stop for exactly the unsubscribed id; unknown ids answer `false`; malformed or unroutable requests fail with the specified JSON-RPC codes.

**Required permutations:**

<a id="req-sds-3-5jw8ak.t1.p1"></a>`REQ-SDS-3-5JW8AK.T1.P1` — pushes stop once scp_unsubscribe returns true

<a id="req-sds-3-5jw8ak.t1.p2"></a>`REQ-SDS-3-5JW8AK.T1.P2` — an id the connection does not hold answers false

<a id="req-sds-3-5jw8ak.t1.p3"></a>`REQ-SDS-3-5JW8AK.T1.P3` — the connection's other subscriptions keep receiving after one is unsubscribed

<a id="req-sds-3-5jw8ak.t1.p4"></a>`REQ-SDS-3-5JW8AK.T1.P4` — an address list holding a malformed address fails as invalid params

<a id="req-sds-3-5jw8ak.t1.p5"></a>`REQ-SDS-3-5JW8AK.T1.P5` — a request naming a member that is not an endpoint fails as method not found

<a id="req-sds-3-5jw8ak.t1.p6"></a>`REQ-SDS-3-5JW8AK.T1.P6` — scp_getBlock params with a block that is no tag, quantity or hash, a full flag that is not a boolean, more than three params, or a minBlock that is no quantity or too long fail as invalid params

<a id="req-sds-3-5jw8ak.t1.p7"></a>`REQ-SDS-3-5JW8AK.T1.P7` — scp_getHead params with more than one param or a minBlock that is no quantity or too long fail as invalid params

<a id="req-sds-3-5jw8ak.t1.p8"></a>`REQ-SDS-3-5JW8AK.T1.P8` — scp_getTransaction and scp_getTransactionReceipt params with no hash, a malformed hash, more than two params or a minBlock that is too long fail as invalid params

#### <a id="req-sds-4-zzdevf.t1"></a>`REQ-SDS-4-ZZDEVF.T1`

**Requirements / invariants:**

[`REQ-SDS-4-ZZDEVF`](storage-diff-service.md#req-sds-4-zzdevf)

**Setup and stimulus:**

Run contracts whose calls revert in a sub-call, nest and re-enter, and rewrite a slot with its old value; subscribe before and after the blocks; make the call-frame trace unavailable.

**Expected result:**

No slot or transfer of a reverted frame is reported, no unchanged slot is listed, the accumulated diffs equal the chain's state, and values are read only where the trace cannot be trusted.

**Required permutations:**

<a id="req-sds-4-zzdevf.t1.p1"></a>`REQ-SDS-4-ZZDEVF.T1.P1` — the slot and value transfer of a reverted sub-call are left out

<a id="req-sds-4-zzdevf.t1.p2"></a>`REQ-SDS-4-ZZDEVF.T1.P2` — a slot a transaction wrote with the value it already had is not listed

<a id="req-sds-4-zzdevf.t1.p3"></a>`REQ-SDS-4-ZZDEVF.T1.P3` — after calls that nest and re-enter no slot the chain holds is missed and the diffs add up to its state

<a id="req-sds-4-zzdevf.t1.p4"></a>`REQ-SDS-4-ZZDEVF.T1.P4` — the history of an account subscribed after its blocks were retained is filled from reads

<a id="req-sds-4-zzdevf.t1.p5"></a>`REQ-SDS-4-ZZDEVF.T1.P5` — a block in which nothing reverted takes its values from the trace with no read of them

<a id="req-sds-4-zzdevf.t1.p6"></a>`REQ-SDS-4-ZZDEVF.T1.P6` — the history of an account first watched after retained blocks is served from memory with no value read

<a id="req-sds-4-zzdevf.t1.p7"></a>`REQ-SDS-4-ZZDEVF.T1.P7` — the history of an account first watched after blocks whose values were not kept is read

<a id="req-sds-4-zzdevf.t1.p8"></a>`REQ-SDS-4-ZZDEVF.T1.P8` — the values of a block are read when its call frames cannot be had

<a id="req-sds-4-zzdevf.t1.p9"></a>`REQ-SDS-4-ZZDEVF.T1.P9` — the old value of a slot comes from the cache for every block of a multi-block step

<a id="req-sds-4-zzdevf.t1.p10"></a>`REQ-SDS-4-ZZDEVF.T1.P10` — balance, nonce and code of a touched account are read only when the trace shows them change

#### <a id="req-sds-5-b2v01n.t1"></a>`REQ-SDS-5-B2V01N.T1`

**Requirements / invariants:**

[`REQ-SDS-5-B2V01N`](storage-diff-service.md#req-sds-5-b2v01n)

**Setup and stimulus:**

Subscribe to addresses that emit events with and without storage writes, mine blocks with matching and non-matching blooms, subscribe late, reorganize, and make the log fetch fail once, and hold a catch-up's log fetch at the upstream while a block is mined.

**Expected result:**

Each record holds exactly the logs of the subscribed addresses of its block; the upstream sees no log request for a block whose bloom matches no subscribed address; a catch-up waiting for logs never holds back the record of a new block.

**Required permutations:**

<a id="req-sds-5-b2v01n.t1.p1"></a>`REQ-SDS-5-B2V01N.T1.P1` — the log of a subscribed address is attached to the record of the block that emitted it

<a id="req-sds-5-b2v01n.t1.p2"></a>`REQ-SDS-5-B2V01N.T1.P2` — logs are requested once per block whose bloom matches a subscribed address

<a id="req-sds-5-b2v01n.t1.p3"></a>`REQ-SDS-5-B2V01N.T1.P3` — no logs are requested for a block whose bloom matches no subscribed address or that has no transactions

<a id="req-sds-5-b2v01n.t1.p4"></a>`REQ-SDS-5-B2V01N.T1.P4` — no logs are requested for a block whose only log is from an address nobody subscribed to

<a id="req-sds-5-b2v01n.t1.p5"></a>`REQ-SDS-5-B2V01N.T1.P5` — a contract call that emits an event and changes no storage still carries its log

<a id="req-sds-5-b2v01n.t1.p6"></a>`REQ-SDS-5-B2V01N.T1.P6` — missing logs are fetched once when a later catch-up asks for the address

<a id="req-sds-5-b2v01n.t1.p7"></a>`REQ-SDS-5-B2V01N.T1.P7` — the catch-up of a block returns the logs of the requested address

<a id="req-sds-5-b2v01n.t1.p8"></a>`REQ-SDS-5-B2V01N.T1.P8` — the catch-up leaves the logs of other addresses out

<a id="req-sds-5-b2v01n.t1.p9"></a>`REQ-SDS-5-B2V01N.T1.P9` — the logs of a rolled back block are replaced by those of its replacement

<a id="req-sds-5-b2v01n.t1.p10"></a>`REQ-SDS-5-B2V01N.T1.P10` — a log fetch answered with an error is retried and the record carries the log

<a id="req-sds-5-b2v01n.t1.p11"></a>`REQ-SDS-5-B2V01N.T1.P11` — a new block's record is pushed while a catch-up's log fetch is still waiting for the upstream

#### <a id="req-sds-7-pzcbq9.t1"></a>`REQ-SDS-7-PZCBQ9.T1`

**Requirements / invariants:**

[`REQ-SDS-7-PZCBQ9`](storage-diff-service.md#req-sds-7-pzcbq9)

**Setup and stimulus:**

Read slots, balance, nonce and code through two clients, concurrently and after further blocks, reorganizations and transfers; ask for older retained, unknown, orphaned and pruned blocks; ask for more fields than the cap, for many uncached slots, and for the cap while blocks are mined.

**Expected result:**

A second client and a concurrent client cost no extra upstream read; cached values follow commits and reorganizations; unretained blocks fail with the not-retained error; an oversized read is refused before any upstream read, and no more than 16 reads are at the upstream at once.

**Required permutations:**

<a id="req-sds-7-pzcbq9.t1.p1"></a>`REQ-SDS-7-PZCBQ9.T1.P1` — the first read of a slot goes to the upstream pinned to the best head's block hash

<a id="req-sds-7-pzcbq9.t1.p2"></a>`REQ-SDS-7-PZCBQ9.T1.P2` — a second client is answered from the cache with no upstream request

<a id="req-sds-7-pzcbq9.t1.p3"></a>`REQ-SDS-7-PZCBQ9.T1.P3` — concurrent reads of one slot share a single fetch

<a id="req-sds-7-pzcbq9.t1.p4"></a>`REQ-SDS-7-PZCBQ9.T1.P4` — a cached slot follows a block's write with no upstream request

<a id="req-sds-7-pzcbq9.t1.p5"></a>`REQ-SDS-7-PZCBQ9.T1.P5` — a slot cleared to zero reads as the zero word

<a id="req-sds-7-pzcbq9.t1.p6"></a>`REQ-SDS-7-PZCBQ9.T1.P6` — a block mined while a fetch was in flight is applied to the fetched value

<a id="req-sds-7-pzcbq9.t1.p7"></a>`REQ-SDS-7-PZCBQ9.T1.P7` — after a reorganization a cached slot rolls back to its value before the orphaned block

<a id="req-sds-7-pzcbq9.t1.p8"></a>`REQ-SDS-7-PZCBQ9.T1.P8` — a slot at an older retained block reads as that block's value

<a id="req-sds-7-pzcbq9.t1.p9"></a>`REQ-SDS-7-PZCBQ9.T1.P9` — a block older than the window fails with the not-retained error

<a id="req-sds-7-pzcbq9.t1.p10"></a>`REQ-SDS-7-PZCBQ9.T1.P10` — a block hash the service does not know fails with the not-retained error

<a id="req-sds-7-pzcbq9.t1.p11"></a>`REQ-SDS-7-PZCBQ9.T1.P11` — a block a reorganization orphaned fails with the not-retained error

<a id="req-sds-7-pzcbq9.t1.p12"></a>`REQ-SDS-7-PZCBQ9.T1.P12` — a malformed state request fails as invalid params

<a id="req-sds-7-pzcbq9.t1.p13"></a>`REQ-SDS-7-PZCBQ9.T1.P13` — a cached balance follows a transfer with no further fetch

<a id="req-sds-7-pzcbq9.t1.p14"></a>`REQ-SDS-7-PZCBQ9.T1.P14` — a cached nonce follows a transaction the account sent

<a id="req-sds-7-pzcbq9.t1.p15"></a>`REQ-SDS-7-PZCBQ9.T1.P15` — cached code follows a deploy and reads as empty at an earlier block

<a id="req-sds-7-pzcbq9.t1.p16"></a>`REQ-SDS-7-PZCBQ9.T1.P16` — a state read for an older retained block is still answered after the head moved

<a id="req-sds-7-pzcbq9.t1.p18"></a>`REQ-SDS-7-PZCBQ9.T1.P18` — a state read naming more than 1024 fields fails as invalid params and reads nothing

<a id="req-sds-7-pzcbq9.t1.p19"></a>`REQ-SDS-7-PZCBQ9.T1.P19` — at most 16 state reads are at the upstream at once

<a id="req-sds-7-pzcbq9.t1.p20"></a>`REQ-SDS-7-PZCBQ9.T1.P20` — a state read at the field cap is answered while blocks are mined and records keep coming

#### <a id="req-sds-8-fqfntv.t1"></a>`REQ-SDS-8-FQFNTV.T1`

**Requirements / invariants:**

[`REQ-SDS-8-FQFNTV`](storage-diff-service.md#req-sds-8-fqfntv)

**Setup and stimulus:**

Read the head, blocks by hash and number, transactions and receipts of retained and unknown identities; withhold `eth_getBlockReceipts` with a method-not-found answer and with another error answer, and answer a receipt with `null`; ask for a block, a transaction and a receipt ahead of the head; count upstream requests per new block.

**Expected result:**

Answers equal the upstream's own for retained data and `null` otherwise; receipts and block fetches are not repeated; the block wait ends at the head or with the held state.

**Required permutations:**

<a id="req-sds-8-fqfntv.t1.p1"></a>`REQ-SDS-8-FQFNTV.T1.P1` — the best head is served as the upstream returns it, with full and with hashed transactions

<a id="req-sds-8-fqfntv.t1.p2"></a>`REQ-SDS-8-FQFNTV.T1.P2` — a retained block is served by hash and by number and a block that is not retained answers null

<a id="req-sds-8-fqfntv.t1.p3"></a>`REQ-SDS-8-FQFNTV.T1.P3` — a transaction of a retained block is served as the upstream returns it and an unknown hash answers null

<a id="req-sds-8-fqfntv.t1.p4"></a>`REQ-SDS-8-FQFNTV.T1.P4` — a receipt is served as the upstream returns it, fetching the block's receipts once

<a id="req-sds-8-fqfntv.t1.p5"></a>`REQ-SDS-8-FQFNTV.T1.P5` — each receipt is read with its own request where the upstream answers method not found to eth_getBlockReceipts

<a id="req-sds-8-fqfntv.t1.p6"></a>`REQ-SDS-8-FQFNTV.T1.P6` — an empty head costs one block fetch and no parent block by hash

<a id="req-sds-8-fqfntv.t1.p7"></a>`REQ-SDS-8-FQFNTV.T1.P7` — a traced head is fetched once and checked once after its trace

<a id="req-sds-8-fqfntv.t1.p8"></a>`REQ-SDS-8-FQFNTV.T1.P8` — a read naming the block its caller saw waits until the head reaches it

<a id="req-sds-8-fqfntv.t1.p9"></a>`REQ-SDS-8-FQFNTV.T1.P9` — after the head wait the service answers with what it holds when the head never gets there

<a id="req-sds-8-fqfntv.t1.p10"></a>`REQ-SDS-8-FQFNTV.T1.P10` — eth_getBlockReceipts is asked again after an error answer that is not method-not-found

<a id="req-sds-8-fqfntv.t1.p11"></a>`REQ-SDS-8-FQFNTV.T1.P11` — a receipt read fails, and the next read asks again, after the upstream answered null for a receipt of the block

<a id="req-sds-8-fqfntv.t1.p12"></a>`REQ-SDS-8-FQFNTV.T1.P12` — a transaction read naming the block its caller saw waits until the head reaches it

<a id="req-sds-8-fqfntv.t1.p13"></a>`REQ-SDS-8-FQFNTV.T1.P13` — a receipt read naming the block its caller saw waits until the head reaches it

#### <a id="req-sds-9-zrpzzw.t1"></a>`REQ-SDS-9-ZRPZZW.T1`

**Requirements / invariants:**

[`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw)

**Setup and stimulus:**

Subscribe to deployed contracts and externally owned accounts with long histories, with a block mined and a reorganization during the backfill, with a block source whose count disagrees with the cache, with a trace that omits a write, with blocks written while a count runs, with a code probe answered with errors, with a malformed value read, with a failed trace, with a Substrate node that lags the upstream, with a count that fails, with a count of a block a reorganization dropped, with a connection that unsubscribes and subscribes again, with a backfill whose value reads fill the read limit while a peer reads, with three accounts subscribed at once, and with a failing backfill followed by another subscriber.

**Expected result:**

A ready account's snapshot equals the chain's complete state at its block; a lazy account is announced as lazy to each subscriber and never given a snapshot; a complete account costs no read for a slot it does not hold.

**Required permutations:**

<a id="req-sds-9-zrpzzw.t1.p1"></a>`REQ-SDS-9-ZRPZZW.T1.P1` — the first subscription pushes the complete storage of a contract at the head

<a id="req-sds-9-zrpzzw.t1.p2"></a>`REQ-SDS-9-ZRPZZW.T1.P2` — the deploy block is found by bisection and only blocks with transactions since are traced

<a id="req-sds-9-zrpzzw.t1.p3"></a>`REQ-SDS-9-ZRPZZW.T1.P3` — a read of a never-written slot of a complete contract is answered without asking the upstream

<a id="req-sds-9-zrpzzw.t1.p4"></a>`REQ-SDS-9-ZRPZZW.T1.P4` — a complete contract is kept current from the records and its snapshot is not pushed again

<a id="req-sds-9-zrpzzw.t1.p5"></a>`REQ-SDS-9-ZRPZZW.T1.P5` — an account without code is pushed with its balance and nonce

<a id="req-sds-9-zrpzzw.t1.p6"></a>`REQ-SDS-9-ZRPZZW.T1.P6` — a block mined while the history is being traced is included

<a id="req-sds-9-zrpzzw.t1.p7"></a>`REQ-SDS-9-ZRPZZW.T1.P7` — the backfill starts over when a reorganization drops the block its history was read to

<a id="req-sds-9-zrpzzw.t1.p8"></a>`REQ-SDS-9-ZRPZZW.T1.P8` — blocks mined past the retained window during the backfill are read in further rounds

<a id="req-sds-9-zrpzzw.t1.p9"></a>`REQ-SDS-9-ZRPZZW.T1.P9` — the status is syncing for an account still to backfill and ready once it is complete

<a id="req-sds-9-zrpzzw.t1.p10"></a>`REQ-SDS-9-ZRPZZW.T1.P10` — the status is lazy for an account whose backfill found fewer entries than the chain holds

<a id="req-sds-9-zrpzzw.t1.p11"></a>`REQ-SDS-9-ZRPZZW.T1.P11` — an account stays lazy and warns with both counts when the chain holds more entries than the history named

<a id="req-sds-9-zrpzzw.t1.p12"></a>`REQ-SDS-9-ZRPZZW.T1.P12` — a subscriber that arrives after the backfill of a lazy account is told no snapshot is coming

<a id="req-sds-9-zrpzzw.t1.p13"></a>`REQ-SDS-9-ZRPZZW.T1.P13` — a failed backfill tells the subscriber at once

<a id="req-sds-9-zrpzzw.t1.p14"></a>`REQ-SDS-9-ZRPZZW.T1.P14` — a lazy account is not backfilled again when it is subscribed again

<a id="req-sds-9-zrpzzw.t1.p15"></a>`REQ-SDS-9-ZRPZZW.T1.P15` — the snapshot is pushed and every slot answered from the cache when the chain holds just the entries the history named

<a id="req-sds-9-zrpzzw.t1.p16"></a>`REQ-SDS-9-ZRPZZW.T1.P16` — an account stays lazy when a block's trace omits a write the chain holds

<a id="req-sds-9-zrpzzw.t1.p17"></a>`REQ-SDS-9-ZRPZZW.T1.P17` — an account stays complete when the count after a write matches, at the cost of one hash read and one key page

<a id="req-sds-9-zrpzzw.t1.p18"></a>`REQ-SDS-9-ZRPZZW.T1.P18` — a snapshot reaches the peer after the reply that returned its subscription id, even while other requests of the peer are answered

<a id="req-sds-9-zrpzzw.t1.p19"></a>`REQ-SDS-9-ZRPZZW.T1.P19` — the deploy block is found when the upstream answers that reads below its contracts pallet are not supported

<a id="req-sds-9-zrpzzw.t1.p20"></a>`REQ-SDS-9-ZRPZZW.T1.P20` — the backfill starts over, keeping the deploy block, when a code probe below the head is answered with another error

<a id="req-sds-9-zrpzzw.t1.p21"></a>`REQ-SDS-9-ZRPZZW.T1.P21` — an error answer to the code probe at the head is not taken for an account without code

<a id="req-sds-9-zrpzzw.t1.p22"></a>`REQ-SDS-9-ZRPZZW.T1.P22` — a malformed storage word read by the backfill fails it and the account is read lazily

<a id="req-sds-9-zrpzzw.t1.p23"></a>`REQ-SDS-9-ZRPZZW.T1.P23` — a complete account is counted once more, at the newest written block, for the blocks written while a count runs

<a id="req-sds-9-zrpzzw.t1.p24"></a>`REQ-SDS-9-ZRPZZW.T1.P24` — the reads of a backfill share the limit of 16 state reads in flight and at most 8 of its traces are at the upstream at once

<a id="req-sds-9-zrpzzw.t1.p25"></a>`REQ-SDS-9-ZRPZZW.T1.P25` — a connection to a node that serves no Ethereum RPC opens without asking its chain id

<a id="req-sds-9-zrpzzw.t1.p26"></a>`REQ-SDS-9-ZRPZZW.T1.P26` — a connection to a node that serves no Ethereum RPC reopens without asking its chain id

<a id="req-sds-9-zrpzzw.t1.p27"></a>`REQ-SDS-9-ZRPZZW.T1.P27` — the slots written in blocks a lagging Substrate node had not reached yet are in the snapshot of a ready account

<a id="req-sds-9-zrpzzw.t1.p28"></a>`REQ-SDS-9-ZRPZZW.T1.P28` — an account without code is pushed with its balance and nonce where the block source counts entries

<a id="req-sds-9-zrpzzw.t1.p29"></a>`REQ-SDS-9-ZRPZZW.T1.P29` — a later subscriber to an account whose backfill failed is told it is lazy and the account is not backfilled again

<a id="req-sds-9-zrpzzw.t1.p30"></a>`REQ-SDS-9-ZRPZZW.T1.P30` — a connection that subscribes again after it unsubscribed is pushed the snapshot again

<a id="req-sds-9-zrpzzw.t1.p31"></a>`REQ-SDS-9-ZRPZZW.T1.P31` — a failed trace is asked again on its own without starting the backfill over

<a id="req-sds-9-zrpzzw.t1.p32"></a>`REQ-SDS-9-ZRPZZW.T1.P32` — a count after a write that fails warns and leaves the account complete

<a id="req-sds-9-zrpzzw.t1.p33"></a>`REQ-SDS-9-ZRPZZW.T1.P33` — a count that differs for a block a reorganization dropped leaves the account complete

<a id="req-sds-9-zrpzzw.t1.p34"></a>`REQ-SDS-9-ZRPZZW.T1.P34` — a peer's state read gets the first free place ahead of the backfill reads waiting for the upstream

<a id="req-sds-9-zrpzzw.t1.p35"></a>`REQ-SDS-9-ZRPZZW.T1.P35` — at most two accounts are backfilled at once and the next starts once one is done

#### <a id="req-sds-11-qv2vpt.t1"></a>`REQ-SDS-11-QV2VPT.T1`

**Requirements / invariants:**

[`REQ-SDS-11-QV2VPT`](storage-diff-service.md#req-sds-11-qv2vpt)

**Setup and stimulus:**

Make the upstream change a block during its trace, answer with errors, drop its connection while following and while loading, refuse its first connection, stay away past the request retries and past the retention window, watch a new account while it reconnects, reset it to an unrelated chain, answer a peer's read with an error whose code is the service's own, and stop reading from a subscriber and from a requester.

**Expected result:**

Transient failures end in the canonical record being pushed; a refused first connection, exhausted retries and an unrelated chain end the service; an account watched during a reconnect gets its real history; after an outage longer than the window only the retained blocks are traced and pushed; a lagging subscriber or requester receives the notice before its socket closes.

**Required permutations:**

<a id="req-sds-11-qv2vpt.t1.p1"></a>`REQ-SDS-11-QV2VPT.T1.P1` — a block that changed while it was traced is retried and the canonical record pushed

<a id="req-sds-11-qv2vpt.t1.p2"></a>`REQ-SDS-11-QV2VPT.T1.P2` — an upstream error answer is retried and the record pushed

<a id="req-sds-11-qv2vpt.t1.p3"></a>`REQ-SDS-11-QV2VPT.T1.P3` — the service fails once the retries of an upstream error are exhausted

<a id="req-sds-11-qv2vpt.t1.p4"></a>`REQ-SDS-11-QV2VPT.T1.P4` — a transient upstream failure while loading the initial history is retried and the service starts

<a id="req-sds-11-qv2vpt.t1.p5"></a>`REQ-SDS-11-QV2VPT.T1.P5` — the service fails to start once the initial history load exhausts its retries

<a id="req-sds-11-qv2vpt.t1.p6"></a>`REQ-SDS-11-QV2VPT.T1.P6` — an upstream that drops while the initial history loads is reconnected and the service starts

<a id="req-sds-11-qv2vpt.t1.p8"></a>`REQ-SDS-11-QV2VPT.T1.P8` — a lost upstream is reconnected and the blocks mined while it was away are pushed in chain order

<a id="req-sds-11-qv2vpt.t1.p10"></a>`REQ-SDS-11-QV2VPT.T1.P10` — an upstream reset to a chain sharing no ancestor stops the service so a supervisor restarts it

<a id="req-sds-11-qv2vpt.t1.p11"></a>`REQ-SDS-11-QV2VPT.T1.P11` — a lagging subscriber is told why with scp_disconnect before its socket closes

<a id="req-sds-11-qv2vpt.t1.p12"></a>`REQ-SDS-11-QV2VPT.T1.P12` — the service fails to start when the upstream refuses its first connection

<a id="req-sds-11-qv2vpt.t1.p13"></a>`REQ-SDS-11-QV2VPT.T1.P13` — the service fails once an upstream outage outlasts the request retries

<a id="req-sds-11-qv2vpt.t1.p14"></a>`REQ-SDS-11-QV2VPT.T1.P14` — an account first watched while the upstream reconnects gets its history and state from the chain

<a id="req-sds-11-qv2vpt.t1.p15"></a>`REQ-SDS-11-QV2VPT.T1.P15` — after an outage longer than the window only the blocks that stay retained are traced, and they are pushed

<a id="req-sds-11-qv2vpt.t1.p16"></a>`REQ-SDS-11-QV2VPT.T1.P16` — a peer that does not read its answers is told why with scp_disconnect and cut

<a id="req-sds-11-qv2vpt.t1.p17"></a>`REQ-SDS-11-QV2VPT.T1.P17` — an upstream error answer that fails a peer's read reaches the peer as an internal error, without the upstream's code or message

#### <a id="req-sds-12-jdw71y.t1"></a>`REQ-SDS-12-JDW71Y.T1`

**Requirements / invariants:**

[`REQ-SDS-12-JDW71Y`](storage-diff-service.md#req-sds-12-jdw71y)

**Setup and stimulus:**

Start the service with small limits and an allow list, then pass each limit: name too many addresses, open too many subscriptions, requests and connections, connect from browser origins, leave `params` out, read more accounts than the watched limit with and without subscriptions holding them, and hold more accounts on one connection than its share.

**Expected result:**

Each request past a limit gets its error and the connection keeps working; refused upgrades get their HTTP status; the least recently used account nobody holds is dropped with its cached values, and a held one never is.

**Required permutations:**

<a id="req-sds-12-jdw71y.t1.p1"></a>`REQ-SDS-12-JDW71Y.T1.P1` — past the watched limit the least recently used account nobody holds is dropped and read again when asked

<a id="req-sds-12-jdw71y.t1.p2"></a>`REQ-SDS-12-JDW71Y.T1.P2` — a dropped account's value includes a write of a block with a failed frame mined while it was not watched

<a id="req-sds-12-jdw71y.t1.p3"></a>`REQ-SDS-12-JDW71Y.T1.P3` — a new account is refused with the limit error while every watched account is subscribed, and the connection keeps working

<a id="req-sds-12-jdw71y.t1.p4"></a>`REQ-SDS-12-JDW71Y.T1.P4` — an unsubscribe releases its accounts

<a id="req-sds-12-jdw71y.t1.p5"></a>`REQ-SDS-12-JDW71Y.T1.P5` — a closed connection releases its subscriptions' accounts

<a id="req-sds-12-jdw71y.t1.p6"></a>`REQ-SDS-12-JDW71Y.T1.P6` — a subscription past the connection's limit fails with the limit error, and one is taken again after an unsubscribe

<a id="req-sds-12-jdw71y.t1.p7"></a>`REQ-SDS-12-JDW71Y.T1.P7` — a subscription, a catch-up or a state read naming more addresses than the request limit fails as invalid params; one at the limit is taken

<a id="req-sds-12-jdw71y.t1.p8"></a>`REQ-SDS-12-JDW71Y.T1.P8` — a connection past the connection limit is refused at the upgrade with HTTP 503, and one is admitted after a close

<a id="req-sds-12-jdw71y.t1.p9"></a>`REQ-SDS-12-JDW71Y.T1.P9` — a request past the connection's in-flight limit fails with the limit error and the connection keeps working

<a id="req-sds-12-jdw71y.t1.p10"></a>`REQ-SDS-12-JDW71Y.T1.P10` — a browser origin not on the allow list is refused at the upgrade with HTTP 403

<a id="req-sds-12-jdw71y.t1.p11"></a>`REQ-SDS-12-JDW71Y.T1.P11` — a browser origin on the allow list is admitted

<a id="req-sds-12-jdw71y.t1.p12"></a>`REQ-SDS-12-JDW71Y.T1.P12` — a request without `params` is answered as one with empty params

<a id="req-sds-12-jdw71y.t1.p13"></a>`REQ-SDS-12-JDW71Y.T1.P13` — a fetch that ends after its account was dropped leaves no value in the cache

<a id="req-sds-12-jdw71y.t1.p14"></a>`REQ-SDS-12-JDW71Y.T1.P14` — a state read that would take its connection past its share fails with the limit error, while an account the connection holds is answered and another connection reads the refused account

<a id="req-sds-12-jdw71y.t1.p15"></a>`REQ-SDS-12-JDW71Y.T1.P15` — a subscription that would take its connection past its share fails with the limit error, and one within it is taken

<a id="req-sds-12-jdw71y.t1.p16"></a>`REQ-SDS-12-JDW71Y.T1.P16` — an unsubscribe and an answered read free the connection's share

#### <a id="req-sds-12-n40mkr.t1"></a>`REQ-SDS-12-N40MKR.T1`

**Requirements / invariants:**

[`REQ-SDS-12-N40MKR`](storage-diff-service.md#req-sds-12-n40mkr)

**Setup and stimulus:**

Ask for blocks the head lacks while the upstream has not seen them, many at once and the same one twice, while the trace of the block fails, while the head update is held at the upstream, and while it arrives normally; subscribe, read the pushes, and rebuild a ready account's cache with a reorganization past the retained window; observe the backstop before any head was committed and after fast ones, with the clock moved by the test.

**Expected result:**

The wait ends at the head, or at once with the held state and the named notice, or, for a silent hang, at the learned backstop with nothing pushed; the backstop is the deadline until an arrival is observed, a multiple of the slowest recent arrival after, never above the deadline, and forgets arrivals outside its window.

**Required permutations:**

<a id="req-sds-12-n40mkr.t1.p1"></a>`REQ-SDS-12-N40MKR.T1.P1` — a read waits for a block the head lacks and is answered when the head reaches it

<a id="req-sds-12-n40mkr.t1.p2"></a>`REQ-SDS-12-N40MKR.T1.P2` — a block the upstream has not seen ends the wait at once with the held head and an upstream-behind notice

<a id="req-sds-12-n40mkr.t1.p3"></a>`REQ-SDS-12-N40MKR.T1.P3` — a failed trace of the awaited block ends the wait at once with the held head and a trace-failed notice

<a id="req-sds-12-n40mkr.t1.p4"></a>`REQ-SDS-12-N40MKR.T1.P4` — a silent hang ends at the learned backstop with the held head and nothing pushed

<a id="req-sds-12-n40mkr.t1.p5"></a>`REQ-SDS-12-N40MKR.T1.P5` — the backstop is the RPC deadline before any head was committed

<a id="req-sds-12-n40mkr.t1.p6"></a>`REQ-SDS-12-N40MKR.T1.P6` — the backstop is shorter than the deadline after fast heads

<a id="req-sds-12-n40mkr.t1.p7"></a>`REQ-SDS-12-N40MKR.T1.P7` — the backstop is a multiple of the slowest recent arrival and never above the deadline

<a id="req-sds-12-n40mkr.t1.p8"></a>`REQ-SDS-12-N40MKR.T1.P8` — the backstop forgets arrivals older than its window and is the deadline again once all are forgotten

<a id="req-sds-12-n40mkr.t1.p9"></a>`REQ-SDS-12-N40MKR.T1.P9` — a ready snapshot made late by a cache cleared past the retained window is announced per subscription as snapshot-delayed and follows the rebuild

<a id="req-sds-12-n40mkr.t1.p10"></a>`REQ-SDS-12-N40MKR.T1.P10` — many waits for a block the upstream has not seen cost one ask of its block number, and one more for waits that start during it

<a id="req-sds-12-n40mkr.t1.p11"></a>`REQ-SDS-12-N40MKR.T1.P11` — an upstream-behind notice equal to the last one at an unchanged head is not pushed again

### Coverage rule

Every plan item is exercised through the real endpoints with an upstream whose block, trace, log and read answers the test controls, observing both the pushed messages and the requests the upstream receives. Unit-level cases of pure helpers (learned backstop, trace interpretation, the state cache, block sources, command line) belong to the implementation layer.

## Future Work

_Non-normative._ Proofs for the mirrored state and gossip of records between peers, which phase 1 deliberately omits.
