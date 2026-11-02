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

The service follows one chain level: the upstream's best head, which can roll back. Finality is not the service's concern; the SDK treats a block as final at first inclusion, a temporary assumption it owns. Peers read two kinds of answer: pushed block records for subscribed addresses, and on-demand reads of account and storage state at a retained block. A service that cannot keep up, loses its upstream for good, or sees a chain it cannot reconcile, stops rather than invent state.

## Requirements and invariants

**<a id="req-sds-1-txey33"></a>`REQ-SDS-1-TXEY33` — A subscription receives one record per canonical block.** After `scp_subscribeContractStorage` succeeds, the service MUST push to that subscription one record for every later canonical block, in chain order, and only for blocks after the subscription: history is read by catch-up ([`REQ-SDS-2-R1RRCF`](storage-diff-service.md#req-sds-2-r1rrcf)). A record carries the block environment (number, hash, parent hash, timestamp, gas limit, miner, mix hash, and the base fee when the upstream block has one), and the `pre` and `post` account maps limited to the subscribed addresses. Phase 1 limit: the service has no authentication and listens on loopback by default; anyone who can connect reads everything it retains, and phase 2 proofs are meant to remove the need to trust it. Across the transactions of one block `pre` keeps the earliest value and `post` the latest; a slot cleared to zero is the zero word in `post`. A block that leaves the subscribed addresses untouched, or has no transactions, still yields a record with empty maps. After a reorganization the service MUST drop the orphaned records and push every replacement record once, in chain order; no revert message exists, and a replacement record names the common ancestor as its parent.

**<a id="req-sds-2-r1rrcf"></a>`REQ-SDS-2-R1RRCF` — Catch-up returns the retained history and the head.** `scp_getContractStorageDiffs` MUST return the retained canonical records from `fromBlock` to the head, inclusive and ascending, filtered to the requested addresses, together with the block environment of the best head. A `fromBlock` after the head returns no records. A `fromBlock` older than the oldest retained block MUST fail with the pruned error (code `-32001`); a `fromBlock` equal to the oldest retained block returns the whole window. One answer restores a reconnecting peer.

**<a id="req-sds-3-5jw8ak"></a>`REQ-SDS-3-5JW8AK` — Subscriptions belong to their connection and end on request.** A subscription id MUST be scoped to the connection that created it. `scp_unsubscribe` MUST stop that subscription's pushes at once and return `true`, return `false` for an id the connection does not hold, and leave the connection's other subscriptions unaffected. Closing the connection drops all its subscriptions. A request with malformed parameters MUST fail as invalid params, and a request naming anything that is not a service endpoint MUST fail as method not found, so no internal member is reachable by name. Batch requests and messages over 1 MiB are refused.

**<a id="req-sds-4-zzdevf"></a>`REQ-SDS-4-ZZDEVF` — Reported values are the chain's own, not the tracer's.** For the subscribed addresses a record MUST hold the values the chain holds at the end of the block, whatever the upstream's trace reports. The trace is used for which storage keys and accounts a block touched; its values are used as they are only when no call frame of the block carries an error. For a block with a failed frame, or whose call frames could not be had, the end-of-block values of the touched keys and accounts MUST be read from the upstream pinned to the block hash. A touched key whose value did not change MUST NOT appear in `pre` or `post`. The old values of a multi-block step come from the service's own cache carried forward block by block. A block whose trace values were used keeps them for every account the trace names, so an account first watched later finds its retained history without a read; a block read from the upstream holds only the watched accounts, and an account watched later has its history read for those blocks. Phase 1 limit: state a block changes outside its transactions' traced keys and accounts (system calls, withdrawals) is not seen.

**<a id="req-sds-7-pzcbq9"></a>`REQ-SDS-7-PZCBQ9` — State reads come from one shared cache.** `scp_getState` MUST answer storage slots, balance, nonce and code of any address from a cache shared by all peers. A field the cache lacks is read from the upstream once, pinned to the best head's block hash, and concurrent misses for one field share one fetch. If a block is committed during a fetch its writes MUST be applied to the fetched value. Each committed block's `post` updates the cached fields already held, and a reorganization undoes the orphaned blocks with their `pre` values, newest first. A block hash that names a retained block MUST be answered as of that block, rolling the head value back over later `pre` values; a hash that is unknown, orphaned or older than the window MUST fail with the not-retained error (code `-32002`) so the caller can fall back. A malformed request fails as invalid params. Phase 1 limit: cached state is never evicted, so the cache grows without bound on a long-running service; eviction is follow-up work.

**<a id="req-sds-11-qv2vpt"></a>`REQ-SDS-11-QV2VPT` — Upstream trouble is retried, then fatal; a lagging peer is told and cut.** A block that changes while it is traced, an upstream error answer and a request timeout MUST be retried, both while loading the initial history and while following the head. A lost upstream connection MUST be reopened, its requests sent again, the head subscription renewed and the chain reconciled from the last canonical record, so subscribers see a continuous chain or a replacement branch; an account first watched meanwhile gets its history once the upstream answers, never an empty one. An upstream that refuses the first connection fails the start. Anything else, or a failure that outlasts its retries, including an outage longer than the request retries allow and an upstream reset to a chain sharing no ancestor with the retained one, MUST be fatal: the service closes its peers and exits nonzero, and never invents an empty diff, so a supervisor restarts it. A peer whose unsent bytes pass the configured limit MUST be sent a notice naming the reason (`scp_disconnect`), pushed nothing more, and disconnected, so it recovers by catch-up inside the retention window instead of silently missing records.

## Assumptions and constraints

- The upstream node is trusted. It serves new-head notifications over a WebSocket, blocks by number and hash, a prestate diff trace and a call-frame trace per block, and balance, nonce, code and storage reads pinned to a block hash.
- The trace is taken to name every key that really changed. Asset Hub breaks this for a created contract's slot that its constructor writes twice with the same value (paritytech/polkadot-sdk#13663): such a write is missing from the record and a cached value for it can be wrong. This is an accepted phase 1 limit until the entry-count guard of the snapshot work returns in the follow-up pull request.
- State a block changes outside the traced keys and accounts of its transactions (system calls, withdrawals) is not seen. This is an accepted phase 1 limit (engineer, 2026-10-31): a cached value can stay wrong until a reorganization clears it. Cached state is never evicted; eviction is follow-up work.
- History and the cache are kept in memory only, for a bounded retention window of canonical blocks; a restarted service loads the window again. A peer that falls behind the window must read the node.
- The service is a single process without authentication; it binds to loopback by default and any wider binding is the operator's responsibility. This is an accepted phase 1 limit (engineer, 2026-10-31): phase 2 proofs are meant to remove the need to trust the service.
- Phase 1 carries no proofs and no gossip: the service's answers are as trustworthy as the service and its upstream.

## Security considerations

**Protected assets.** The integrity of the state data peers mirror, the availability of the service to peers, and the credentials of the upstream.

**Trust boundaries.** Peers are untrusted: their requests are validated (malformed parameters, unknown or non-endpoint member names, batches and oversized messages are refused), and a peer that does not drain its pushes is cut instead of buffering without bound. The upstream is trusted and so is the operator; errors name the upstream by scheme and host only, never its credentials.

**Threats and defenses.** A reverted sub-call that a tracer reports as applied would feed false values to every peer: values are read from the node whenever a frame failed ([`REQ-SDS-4-ZZDEVF`](storage-diff-service.md#req-sds-4-zzdevf)). An upstream failure is retried and then fatal, so the service never invents an empty diff ([`REQ-SDS-11-QV2VPT`](storage-diff-service.md#req-sds-11-qv2vpt)).

**Residual risk.** Without proofs, a compromised service or upstream can feed peers false state. An unauthenticated service reachable beyond loopback can be read by anyone. State changed outside traced transaction keys is missed. The engineer accepted these as phase 1 limits (2026-10-31): the service is unauthenticated and loopback by default, and phase 2 proofs are meant to remove the need to trust the service.

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

#### <a id="req-sds-11-qv2vpt.t1"></a>`REQ-SDS-11-QV2VPT.T1`

**Requirements / invariants:**

[`REQ-SDS-11-QV2VPT`](storage-diff-service.md#req-sds-11-qv2vpt)

**Setup and stimulus:**

Make the upstream change a block during its trace, answer with errors, drop its connection while following and while loading, refuse its first connection, stay away past the request retries, watch a new account while it reconnects, reset it to an unrelated chain, and stop reading from a subscriber.

**Expected result:**

Transient failures end in the canonical record being pushed; a refused first connection, exhausted retries and an unrelated chain end the service; an account watched during a reconnect gets its real history; a lagging subscriber receives the notice before its socket closes.

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

### Coverage rule

Every plan item is exercised through the real endpoints with an upstream whose block, trace and read answers the test controls, observing both the pushed messages and the requests the upstream receives. Unit-level cases of pure helpers (trace interpretation, the state cache, command line) belong to the implementation layer.

## Future Work

_Non-normative._ Proofs for the mirrored state and gossip of records between peers, which phase 1 deliberately omits.
