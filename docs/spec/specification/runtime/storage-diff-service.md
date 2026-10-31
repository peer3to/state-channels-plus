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

The service has two chain levels. The **latest** level is the upstream's best head and can roll back. The **included** level is the newest block the chain treats as final for events and irreversible actions; it only advances. Peers read three kinds of answer: pushed block records for subscribed addresses, a complete snapshot of a subscribed account with each subscription's status (`ready`, `syncing` or `lazy`), and on-demand reads of state, blocks, transactions and receipts for what is retained. A service that cannot keep up, loses its upstream for good, or sees a chain it cannot reconcile, stops rather than invent state.

## Requirements and invariants

**<a id="req-sds-1-txey33"></a>`REQ-SDS-1-TXEY33` — A subscription receives one record per canonical block.** After `scp_subscribeContractStorage` succeeds, the service MUST push to that subscription one record for every later canonical block, in chain order, and only for blocks after the subscription: history is read by catch-up ([`REQ-SDS-2-R1RRCF`](storage-diff-service.md#req-sds-2-r1rrcf)). A record carries the block environment (number, hash, parent hash, timestamp, gas limit, miner, mix hash, and the base fee when the upstream block has one), the `pre` and `post` account maps limited to the subscribed addresses, and the logs of [`REQ-SDS-5-B2V01N`](storage-diff-service.md#req-sds-5-b2v01n). Phase 1 limit: the service has no authentication and listens on loopback by default; anyone who can connect reads everything it retains, and phase 2 proofs are meant to remove the need to trust it. Across the transactions of one block `pre` keeps the earliest value and `post` the latest; a slot cleared to zero is the zero word in `post`. A block that leaves the subscribed addresses untouched, or has no transactions, still yields a record with empty maps. After a reorganization the service MUST drop the orphaned records and push every replacement record once, in chain order; no revert message exists, and a replacement record names the common ancestor as its parent.

**<a id="req-sds-2-r1rrcf"></a>`REQ-SDS-2-R1RRCF` — Catch-up returns the retained history and the current levels.** `scp_getContractStorageDiffs` MUST return the retained canonical records from `fromBlock` to the head, inclusive and ascending, filtered to the requested addresses, together with the included head ([`REQ-SDS-6-SH7DKR`](storage-diff-service.md#req-sds-6-sh7dkr)) or `null` while there is none, and the block environment of the best head. A `fromBlock` after the head returns no records. A `fromBlock` older than the oldest retained block MUST fail with the pruned error (code `-32001`); a `fromBlock` equal to the oldest retained block returns the whole window. One answer restores both levels for a reconnecting peer.

**<a id="req-sds-3-5jw8ak"></a>`REQ-SDS-3-5JW8AK` — Subscriptions belong to their connection and end on request.** A subscription id MUST be scoped to the connection that created it. `scp_unsubscribe` MUST stop that subscription's pushes at once and return `true`, return `false` for an id the connection does not hold, and leave the connection's other subscriptions unaffected. Closing the connection drops all its subscriptions. A request with malformed parameters MUST fail as invalid params, and a request naming anything that is not a service endpoint MUST fail as method not found, so no internal member is reachable by name. Batch requests and messages over 1 MiB are refused.

**<a id="req-sds-4-zzdevf"></a>`REQ-SDS-4-ZZDEVF` — Reported values are the chain's own, not the tracer's.** For the subscribed addresses a record MUST hold the values the chain holds at the end of the block, whatever the upstream's trace reports. The trace is used for which storage keys and accounts a block touched; its values are used as they are only when no call frame of the block carries an error. For a block with a failed frame, or whose call frames could not be had, the end-of-block values of the touched keys and accounts MUST be read from the upstream pinned to the block hash. A touched key whose value did not change MUST NOT appear in `pre` or `post`. The old values of a multi-block step come from the service's own cache carried forward block by block. A block whose trace values were used keeps them for every account the trace names, so an account first watched later finds its retained history without a read; a block read from the upstream holds only the watched accounts, and an account watched later has its history read for those blocks. Phase 1 limit: state a block changes outside its transactions' traced keys and accounts (system calls, withdrawals) is not seen; the entry-count recount of [`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw) is the accepted guard, and an account it catches drops to lazy reads.

**<a id="req-sds-5-b2v01n"></a>`REQ-SDS-5-B2V01N` — Logs of subscribed addresses travel with their block.** A record MUST carry the event logs of its block for each subscribed address, in log-index order. The service MUST test each subscribed address against the block header's logs bloom and ask the upstream for logs only when at least one address matches, once per block and address; a bloom false positive yields no logs. An address that emits an event without changing storage is found the same way. A block staged before anyone subscribed to an address has its logs fetched once, by the first catch-up that asks for that address. A rolled back block takes its logs with it and its replacement has its own. A log fetch the upstream answers with an error MUST be retried, and the record then carries the log.

**<a id="req-sds-6-sh7dkr"></a>`REQ-SDS-6-SH7DKR` — The included head is a second, final level.** Besides the latest level the service MUST report an included head: the newest block the chain treats as final for events and irreversible actions, from a pluggable inclusion source. The service MUST push it as `scp_includedHead` to every connection holding at least one subscription, only when it advances, and return it (or `null` while there is none) with every catch-up. If the included head is not on the retained best chain, the service MUST log a warning and do nothing else; a head outside the retained window or ahead of the best head is not judged. The Asset Hub source reads one relay chain subscription for the parachain head and one Asset Hub read per inclusion, reconnects both on loss, and polls nothing. A development source treats the block a fixed depth behind the best head as included.

**<a id="req-sds-7-pzcbq9"></a>`REQ-SDS-7-PZCBQ9` — State reads come from one shared cache.** `scp_getState` MUST answer storage slots, balance, nonce and code of any address from a cache shared by all peers. A field the cache lacks is read from the upstream once, pinned to the best head's block hash, concurrent misses for one field share one fetch, and the fields of one request go out as one batch. If a block is committed during a fetch its writes MUST be applied to the fetched value. Each committed block's `post` updates the cached fields already held, and a reorganization undoes the orphaned blocks with their `pre` values, newest first. A block hash that names a retained block MUST be answered as of that block, rolling the head value back over later `pre` values; a hash that is unknown, orphaned or older than the window MUST fail with the not-retained error (code `-32002`) so the caller can fall back. A malformed request fails as invalid params. Phase 1 limit: cached state is never evicted, so the cache grows without bound on a long-running service; eviction is follow-up work.

**<a id="req-sds-8-fqfntv"></a>`REQ-SDS-8-FQFNTV` — Retained blocks, transactions and receipts are served from the service.** `scp_getBlock`, `scp_getTransaction` and `scp_getTransactionReceipt` MUST answer from the retained blocks exactly as the upstream's `eth_getBlockBy*`, `eth_getTransactionByHash` and `eth_getTransactionReceipt` do, with full or hashed transactions as asked; anything not retained answers `null`, which means only that the caller asks the node. A block's receipts are fetched once, on the first read of any of them, with `eth_getBlockReceipts`, or as one batch of receipt reads where the upstream lacks it. A read that names the block its caller already saw MUST wait for the head to reach that block, and answer with what the service holds when the wait ends without it ([`REQ-SDS-12-N40MKR`](storage-diff-service.md#req-sds-12-n40mkr)). The service's per-block upstream budget is one block fetch with full transactions, one more check after the trace of a block with transactions, no parent fetch inside the retained window, and no logs fetch unless [`REQ-SDS-5-B2V01N`](storage-diff-service.md#req-sds-5-b2v01n) requires one.

**<a id="req-sds-9-zrpzzw"></a>`REQ-SDS-9-ZRPZZW` — A subscription is anchored by a complete snapshot, or told none is coming.** The first subscription to an address MUST make the service rebuild that account's complete state: the deploy block is found by bisecting `eth_getCode`, only blocks with transactions are traced since, the touched keys are unioned, and all their values are read pinned to one anchor block; blocks mined meanwhile are included by further rounds, and a reorganization that drops the anchor starts the backfill over. A backfilled account is complete, so a slot it does not hold reads zero without asking the upstream, and it is kept current from the records. `scp_subscribeContractStorage` MUST answer the status of each address: `ready`, the account is complete and its snapshot is pushed at once as `scp_snapshot`; `syncing`, a backfill is running or queued and the snapshot follows; `lazy`, no snapshot will come. A later subscription pushes snapshots only for addresses not already complete. An account without code is pushed with its balance and nonce. When the backfill fails, or the number of entries the chain holds for the account differs from what the history named (checked at the anchor and again after each block that writes it), the account MUST stay lazy, the service MUST warn with both counts, and every subscription following it, now and later, is told by an `scp_snapshot` carrying `lazy` so it stops waiting and reads the account on demand; a lazy account is not backfilled again until its cache is cleared.

**<a id="req-sds-10-f01bma"></a>`REQ-SDS-10-F01BMA` — The cache survives a restart when a cache directory is configured.** With a cache directory the service MUST persist its head, its cache and the hashes of its last 64 blocks, written whole and renamed into place. On start it MUST load them, roll the cache back over `pre` values if the saved head is no longer canonical, and catch up the blocks mined while it was down. A complete contract MUST resume from disk without its history being read again. Without a cache directory the cache lives in memory only.

**<a id="req-sds-11-qv2vpt"></a>`REQ-SDS-11-QV2VPT` — Upstream trouble is retried, then fatal; a lagging peer is told and cut.** A block that changes while it is traced, an upstream error answer and a request timeout MUST be retried, both while loading the initial history and while following the head. A lost upstream connection MUST be reopened with a bounded retry, the head subscription renewed and the chain reconciled from the last canonical record, so subscribers see a continuous chain or a replacement branch. Anything else, or a failure that outlasts its retries, including an upstream reset to a chain sharing no ancestor with the retained one, MUST be fatal: the service closes its peers and exits nonzero, and never invents an empty diff, so a supervisor restarts it. A peer whose unsent bytes pass the configured limit MUST be sent a notice naming the reason (`scp_disconnect`), pushed nothing more, and disconnected, so it recovers by catch-up inside the retention window instead of silently missing records.

**<a id="req-sds-12-n40mkr"></a>`REQ-SDS-12-N40MKR` — A wait for a late block or snapshot ends at the first event, not at a fixed time.** A read that names a block the head lacks (`minBlock`) MUST wait for the head to reach that block and end at the first of: the head reaching it; the service's tracing of a block it is processing failing or being retried (which holds back every block after it); the service's upstream not having seen the block; the service closing; or a backstop for a silent hang, which is learned from how long new heads took to commit after the upstream announced them (a multiple of the slowest in a short recent window) and never exceeds the callers' RPC deadline, which is also its value until a head has been committed. A wait that ends without the head answers with what the service holds. The service MUST push a named-field notice (`scp_delayed`) to every connection holding a subscription when its tracing of a block fails or is retried (`trace-failed`, with the block's number and hash), and when a caller asked for a block its upstream has not seen (`upstream-behind`, with the requested number and the best head's number and hash); and MUST push to a connection, per subscription, when a snapshot it promised or sent as `ready` is no longer coming at once because the cache was cleared (`snapshot-delayed`, with the accounts and the best head's number and hash), after which the snapshot follows the rebuild. A notice is an early "no", never a promise that the block or snapshot will arrive. An account no snapshot will ever come for is told by `lazy` ([`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw)), not by this notice.

## Assumptions and constraints

- The upstream node is trusted. It serves new-head notifications over a WebSocket, blocks with full transactions by number and hash, a prestate diff trace and a call-frame trace per block, logs by block hash, and balance, nonce, code and storage reads pinned to a block hash. Receipts by block are used where offered.
- The trace never omits a key that really changed (it is a superset of the truth). A trace that omits a write is detected only through the entry count of [`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw), after which the account is lazy.
- State a block changes outside the traced keys and accounts of its transactions (system calls, withdrawals) is not seen. This is an accepted phase 1 limit (engineer, 2026-10-31): the recount of [`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw) is the guard, an account it catches drops to lazy reads, and a cached value can stay wrong until a reorganization clears it. Cached state is never evicted; eviction is follow-up work.
- History is kept in memory for a bounded retention window of canonical blocks; only the cache can be persisted ([`REQ-SDS-10-F01BMA`](storage-diff-service.md#req-sds-10-f01bma)). A peer that falls behind the window must read the node.
- The service is a single process without authentication; it binds to loopback by default and any wider binding is the operator's responsibility. This is an accepted phase 1 limit (engineer, 2026-10-31): phase 2 proofs are meant to remove the need to trust the service.
- Phase 1 carries no proofs and no gossip: the service's answers are as trustworthy as the service and its upstream.
- A peer whose first read of a lazy account finds no snapshot reads the account on demand; the service never delays an answer for a snapshot.

## Security considerations

**Protected assets.** The integrity of the state and block data peers mirror, the availability of the service to peers, and the credentials of the upstream.

**Trust boundaries.** Peers are untrusted: their requests are validated (malformed parameters, unknown or non-endpoint member names, batches and oversized messages are refused), and a peer that does not drain its pushes is cut instead of buffering without bound. The upstream is trusted and so is the operator; errors name the upstream by scheme and host only, never its credentials.

**Threats and defenses.** A reverted sub-call that a tracer reports as applied would feed false values to every peer: values are read from the node whenever a frame failed ([`REQ-SDS-4-ZZDEVF`](storage-diff-service.md#req-sds-4-zzdevf)). A trace that omits a write would make a snapshot silently incomplete: the entry count turns that into a lazy account ([`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw)). An upstream failure is retried and then fatal, so the service never invents an empty diff ([`REQ-SDS-11-QV2VPT`](storage-diff-service.md#req-sds-11-qv2vpt)).

**Residual risk.** Without proofs, a compromised service or upstream can feed peers false state, blocks or inclusion levels. An unauthenticated service reachable beyond loopback can be read by anyone. State changed outside traced transaction keys is missed. The engineer accepted these as phase 1 limits (2026-10-31): the service is unauthenticated and loopback by default, the recount of [`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw) is the guard for state changed outside traced keys, and phase 2 proofs are meant to remove the need to trust the service.

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

Hold several subscriptions on one connection, unsubscribe them one by one, unsubscribe an id the connection does not hold, send a malformed address list, and call a member name that is not an endpoint.

**Expected result:**

Pushes stop for exactly the unsubscribed id; unknown ids answer `false`; malformed or unroutable requests fail with the specified JSON-RPC codes.

**Required permutations:**

<a id="req-sds-3-5jw8ak.t1.p1"></a>`REQ-SDS-3-5JW8AK.T1.P1` — pushes stop once scp_unsubscribe returns true

<a id="req-sds-3-5jw8ak.t1.p2"></a>`REQ-SDS-3-5JW8AK.T1.P2` — an id the connection does not hold answers false

<a id="req-sds-3-5jw8ak.t1.p3"></a>`REQ-SDS-3-5JW8AK.T1.P3` — the connection's other subscriptions keep receiving after one is unsubscribed

<a id="req-sds-3-5jw8ak.t1.p4"></a>`REQ-SDS-3-5JW8AK.T1.P4` — an address list holding a malformed address fails as invalid params

<a id="req-sds-3-5jw8ak.t1.p5"></a>`REQ-SDS-3-5JW8AK.T1.P5` — a request naming a member that is not an endpoint fails as method not found

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

Subscribe to addresses that emit events with and without storage writes, mine blocks with matching and non-matching blooms, subscribe late, reorganize, and make the log fetch fail once.

**Expected result:**

Each record holds exactly the logs of the subscribed addresses of its block; the upstream sees no log request for a block whose bloom matches no subscribed address.

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

#### <a id="req-sds-6-sh7dkr.t1"></a>`REQ-SDS-6-SH7DKR.T1`

**Requirements / invariants:**

[`REQ-SDS-6-SH7DKR`](storage-diff-service.md#req-sds-6-sh7dkr)

**Setup and stimulus:**

Run the service with the depth source and with the relay source, subscribe and not, reconnect a peer, reorganize shallowly and deeply, and drop the relay connection.

**Expected result:**

The included head reaches subscribers once per advance and every catch-up; a head off the best chain warns; the relay source maps each inclusion to its eth block with one read.

**Required permutations:**

<a id="req-sds-6-sh7dkr.t1.p1"></a>`REQ-SDS-6-SH7DKR.T1.P1` — the block a fixed depth behind the best head is pushed to a subscriber as the included head

<a id="req-sds-6-sh7dkr.t1.p2"></a>`REQ-SDS-6-SH7DKR.T1.P2` — the catch-up of a reconnecting peer returns the included head

<a id="req-sds-6-sh7dkr.t1.p3"></a>`REQ-SDS-6-SH7DKR.T1.P3` — a catch-up starting after the best head still returns the included head

<a id="req-sds-6-sh7dkr.t1.p4"></a>`REQ-SDS-6-SH7DKR.T1.P4` — a service with no inclusion source returns a null included head

<a id="req-sds-6-sh7dkr.t1.p5"></a>`REQ-SDS-6-SH7DKR.T1.P5` — a peer holding no subscription is pushed no included head

<a id="req-sds-6-sh7dkr.t1.p6"></a>`REQ-SDS-6-SH7DKR.T1.P6` — an included head off the best chain after a reorganization is logged as a warning

<a id="req-sds-6-sh7dkr.t1.p7"></a>`REQ-SDS-6-SH7DKR.T1.P7` — an included head that stays on the best chain through a shallow reorganization logs no warning

<a id="req-sds-6-sh7dkr.t1.p8"></a>`REQ-SDS-6-SH7DKR.T1.P8` — the eth block of each relay-included Asset Hub block is pushed, its hash read once per inclusion

<a id="req-sds-6-sh7dkr.t1.p9"></a>`REQ-SDS-6-SH7DKR.T1.P9` — the relay subscription is opened again after the connection drops and pushes continue

#### <a id="req-sds-7-pzcbq9.t1"></a>`REQ-SDS-7-PZCBQ9.T1`

**Requirements / invariants:**

[`REQ-SDS-7-PZCBQ9`](storage-diff-service.md#req-sds-7-pzcbq9)

**Setup and stimulus:**

Read slots, balance, nonce and code through two clients, concurrently and after further blocks, reorganizations and transfers; ask for older retained, unknown, orphaned and pruned blocks.

**Expected result:**

A second client and a concurrent client cost no extra upstream read; cached values follow commits and reorganizations; unretained blocks fail with the not-retained error.

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

<a id="req-sds-7-pzcbq9.t1.p17"></a>`REQ-SDS-7-PZCBQ9.T1.P17` — the fields of one state read go to the upstream as one batch

#### <a id="req-sds-8-fqfntv.t1"></a>`REQ-SDS-8-FQFNTV.T1`

**Requirements / invariants:**

[`REQ-SDS-8-FQFNTV`](storage-diff-service.md#req-sds-8-fqfntv)

**Setup and stimulus:**

Read the head, blocks by hash and number, transactions and receipts of retained and unknown identities; withhold `eth_getBlockReceipts`; ask for a block ahead of the head; count upstream requests per new block.

**Expected result:**

Answers equal the upstream's own for retained data and `null` otherwise; receipts and block fetches are not repeated; the block wait ends at the head or with the held state.

**Required permutations:**

<a id="req-sds-8-fqfntv.t1.p1"></a>`REQ-SDS-8-FQFNTV.T1.P1` — the best head is served as the upstream returns it, with full and with hashed transactions

<a id="req-sds-8-fqfntv.t1.p2"></a>`REQ-SDS-8-FQFNTV.T1.P2` — a retained block is served by hash and by number and a block that is not retained answers null

<a id="req-sds-8-fqfntv.t1.p3"></a>`REQ-SDS-8-FQFNTV.T1.P3` — a transaction of a retained block is served as the upstream returns it and an unknown hash answers null

<a id="req-sds-8-fqfntv.t1.p4"></a>`REQ-SDS-8-FQFNTV.T1.P4` — a receipt is served as the upstream returns it, fetching the block's receipts once

<a id="req-sds-8-fqfntv.t1.p5"></a>`REQ-SDS-8-FQFNTV.T1.P5` — receipts are read as one batch where the upstream lacks eth_getBlockReceipts

<a id="req-sds-8-fqfntv.t1.p6"></a>`REQ-SDS-8-FQFNTV.T1.P6` — an empty head costs one block fetch and no parent block by hash

<a id="req-sds-8-fqfntv.t1.p7"></a>`REQ-SDS-8-FQFNTV.T1.P7` — a traced head is fetched once and checked once after its trace

<a id="req-sds-8-fqfntv.t1.p8"></a>`REQ-SDS-8-FQFNTV.T1.P8` — a read naming the block its caller saw waits until the head reaches it

<a id="req-sds-8-fqfntv.t1.p9"></a>`REQ-SDS-8-FQFNTV.T1.P9` — after the head wait the service answers with what it holds when the head never gets there

#### <a id="req-sds-9-zrpzzw.t1"></a>`REQ-SDS-9-ZRPZZW.T1`

**Requirements / invariants:**

[`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw)

**Setup and stimulus:**

Subscribe to deployed contracts and externally owned accounts with long histories, with a block mined and a reorganization during the backfill, with a block source whose count disagrees with the cache, with a trace that omits a write, and with a failing backfill.

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

#### <a id="req-sds-10-f01bma.t1"></a>`REQ-SDS-10-F01BMA.T1`

**Requirements / invariants:**

[`REQ-SDS-10-F01BMA`](storage-diff-service.md#req-sds-10-f01bma)

**Setup and stimulus:**

Backfill a contract with a cache directory, stop the service, mine blocks (and optionally replace the saved head's branch), and start it again.

**Expected result:**

The restarted service serves the same complete state, with no history reads, rolled back and caught up to the canonical chain.

**Required permutations:**

<a id="req-sds-10-f01bma.t1.p1"></a>`REQ-SDS-10-F01BMA.T1.P1` — a complete contract resumes from disk without its history being read again

<a id="req-sds-10-f01bma.t1.p2"></a>`REQ-SDS-10-F01BMA.T1.P2` — the saved cache is rolled back when the saved head is no longer on the chain, then caught up

<a id="req-sds-10-f01bma.t1.p3"></a>`REQ-SDS-10-F01BMA.T1.P3` — the blocks mined while the service was down are applied

#### <a id="req-sds-11-qv2vpt.t1"></a>`REQ-SDS-11-QV2VPT.T1`

**Requirements / invariants:**

[`REQ-SDS-11-QV2VPT`](storage-diff-service.md#req-sds-11-qv2vpt)

**Setup and stimulus:**

Make the upstream change a block during its trace, answer with errors, drop its connection while following and while loading, reset it to an unrelated chain, and stop reading from a subscriber.

**Expected result:**

Transient failures end in the canonical record being pushed; exhausted retries and an unrelated chain end the service; a lagging subscriber receives the notice before its socket closes.

**Required permutations:**

<a id="req-sds-11-qv2vpt.t1.p1"></a>`REQ-SDS-11-QV2VPT.T1.P1` — a block that changed while it was traced is retried and the canonical record pushed

<a id="req-sds-11-qv2vpt.t1.p2"></a>`REQ-SDS-11-QV2VPT.T1.P2` — an upstream error answer is retried and the record pushed

<a id="req-sds-11-qv2vpt.t1.p3"></a>`REQ-SDS-11-QV2VPT.T1.P3` — the service fails once the retries of an upstream error are exhausted

<a id="req-sds-11-qv2vpt.t1.p4"></a>`REQ-SDS-11-QV2VPT.T1.P4` — a transient upstream failure while loading the initial history is retried and the service starts

<a id="req-sds-11-qv2vpt.t1.p5"></a>`REQ-SDS-11-QV2VPT.T1.P5` — the service fails to start once the initial history load exhausts its retries

<a id="req-sds-11-qv2vpt.t1.p6"></a>`REQ-SDS-11-QV2VPT.T1.P6` — an upstream that drops while the initial history loads is reconnected and the service starts

<a id="req-sds-11-qv2vpt.t1.p7"></a>`REQ-SDS-11-QV2VPT.T1.P7` — the service fails to start once the upstream keeps dropping during the initial history load

<a id="req-sds-11-qv2vpt.t1.p8"></a>`REQ-SDS-11-QV2VPT.T1.P8` — a lost upstream is reconnected and the blocks mined while it was away are pushed in chain order

<a id="req-sds-11-qv2vpt.t1.p9"></a>`REQ-SDS-11-QV2VPT.T1.P9` — the service fails once the reconnect retries are exhausted

<a id="req-sds-11-qv2vpt.t1.p10"></a>`REQ-SDS-11-QV2VPT.T1.P10` — an upstream reset to a chain sharing no ancestor stops the service so a supervisor restarts it

<a id="req-sds-11-qv2vpt.t1.p11"></a>`REQ-SDS-11-QV2VPT.T1.P11` — a lagging subscriber is told why with scp_disconnect before its socket closes

#### <a id="req-sds-12-n40mkr.t1"></a>`REQ-SDS-12-N40MKR.T1`

**Requirements / invariants:**

[`REQ-SDS-12-N40MKR`](storage-diff-service.md#req-sds-12-n40mkr)

**Setup and stimulus:**

Ask for blocks the head lacks while the upstream has not seen them, while the trace of the block fails, while the head update is held at the upstream, and while it arrives normally; subscribe, read the pushes, and rebuild a ready account's cache with a reorganization past the retained window; observe the backstop before any head was committed and after fast ones, with the clock moved by the test.

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

### Coverage rule

Every plan item is exercised through the real endpoints with an upstream whose block, trace, log and read answers the test controls, observing both the pushed messages and the requests the upstream receives. Unit-level cases of pure helpers (key derivation, hashing, trace interpretation, block sources, command line) belong to the implementation layer.

## Future Work

_Non-normative._ Proofs for the mirrored state and gossip of records between peers, which phase 1 deliberately omits.
