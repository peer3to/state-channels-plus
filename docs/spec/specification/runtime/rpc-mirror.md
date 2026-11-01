# RPC mirror

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

A client that asks an RPC node for every contract read pays a round trip each time, and every peer of a table pays it again. The RPC mirror keeps a local copy of the state of the contracts a client reads, kept current by the storage diff service ([storage-diff-service.md](./storage-diff-service.md)), and answers latest-block reads from it with a local EVM. Everything the copy cannot answer correctly still goes to the node. The target chain is Polkadot Asset Hub (pallet-revive with its Ethereum RPC). The first phase has no proofs and no gossip: the client trusts the service as it trusts a node, and a sampled comparison against the node is its only check.

The client is a drop-in for the plain multi-endpoint provider ([chain-observation.md](./chain-observation.md)): the same endpoint set, the same failover and the same events, with latest-block reads served locally when a service is configured.

## Requirements and invariants

**<a id="req-rpcmirror-1-xqnz4j"></a>`REQ-RPCMIRROR-1-XQNZ4J` — Latest-block reads are answered from a local copy of the chain.** When a storage diff service is configured, the client MUST answer `eth_call`, `eth_getStorageAt`, `eth_getCode`, `eth_getBalance` and the latest `eth_getTransactionCount` at the latest block from a local copy of the followed contracts' state, run by a local EVM, without sending the node that request. The copy is fed by the service's snapshots and records ([`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw), [`REQ-SDS-1-TXEY33` (A subscription receives one record per canonical block)](storage-diff-service.md#req-sds-1-txey33)); a field the feed has not pushed is read once from the service at the head block and then held. A local call MUST return, revert and fail as the node does at the same head, MUST discard what it wrote when it ends, and MUST keep a returned sub-call's write out of the frame that reverted it. A custom precompile registered with the runtime runs locally. A pending nonce is never answered locally: the mempool is the node's.

**<a id="req-rpcmirror-2-1p38e2"></a>`REQ-RPCMIRROR-2-1P38E2` — Reads the copy cannot answer correctly go to the node whole.** A request the local copy cannot answer as the chain would MUST go to the node, whole. That covers transactions, `eth_estimateGas` (gas on the target chain is weight based), logs, reads at an older block, every read when no service is configured, and a call that carries an explicit gas limit: the local EVM charges no transaction gas (the base cost and calldata), so only the node can tell the least limit at which the call succeeds. A call that executes PolkaVM code, or reaches an address the chain serves with a precompile of its own that the local EVM does not reproduce (the chain's builtin range above the standard precompiles, its external ranges, and the point evaluation address), MUST go to the node whole; a call that reaches a standard precompile the chain implements runs locally. Reading the code of a PolkaVM contract is still answered locally.

**<a id="req-rpcmirror-3-7mqh88"></a>`REQ-RPCMIRROR-3-7MQH88` — A snapshot is waited for only when the service says it is ready.** The client MUST follow an account it reads for the first time and act on the status the service gives it ([`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw)). For `ready` the read waits for the pushed snapshot and ends the wait at the first of: the snapshot arriving (including one that reaches the client before the reply of the subscription that asked for it, under any subscription id); the service saying the snapshot is delayed ([`REQ-SDS-12-N40MKR`](storage-diff-service.md#req-sds-12-n40mkr)); the connection dropping; or, for a service that is connected but silent, a backstop learned from how long snapshots took to arrive (from the subscribe to the snapshot being applied; a multiple of the slowest in a short recent window), never from how long blocks took, since a snapshot also pays a subscribe round trip, and never longer than the longest wait of [`REQ-RPCMIRROR-4-H35NFC`](rpc-mirror.md#req-rpcmirror-4-h35nfc), which it equals until a snapshot has arrived. A wait that ends without the snapshot because it is delayed, or at the backstop, sends the read to the node. For `syncing` and `lazy` it MUST NOT wait: the missing fields are read at once from the service at the head block, and a syncing account answers locally once its snapshot has come. A notice that no snapshot is coming (the backfill ended without one or failed) ends any wait at once and the read reads the account as needed, and a lost connection ends it at once. When the service later finds a complete account's entries short and announces it lazy, the client MUST drop the account to lazy reads.

**<a id="req-rpcmirror-4-h35nfc"></a>`REQ-RPCMIRROR-4-H35NFC` — A read is never older than a block the peer already saw.** A read MUST NOT be answered from a copy older than a block the peer has seen: its own transaction mined, a new head or a log notification a node pushed. The read waits until the copy has applied that block. The wait ends at the first of: the block's record arriving (the read is then answered locally); the service saying the block will not come soon (its tracing of the block failed or is retried, or its upstream has not seen it: [`REQ-SDS-12-N40MKR`](storage-diff-service.md#req-sds-12-n40mkr)); a node announcing a later block while the copy still lacks the one before (the service is a whole block behind); the service connection dropping; or, for a service connected but silent, a backstop learned from how long records took to arrive after a node announced them (a multiple of the slowest in a short recent window), never longer than the longest wait. The longest wait is the SDK's RPC deadline less the same multiple of the slowest recent round trip of a node, learned from the requests the client forwards to the nodes, so a read that waits the whole backstop still gets the node's answer inside the deadline; until a node round trip has been observed it is the whole deadline, and the backstop equals it until an arrival has been observed. When a wait for a block starts, the client MUST ask the service once for its head at that block, so that a service whose upstream has not seen the block ends the wait at once with its notice; the probe is not repeated by the reads that join the same wait or by the reads that follow it, until the copy has applied that block; a later wait for the same block number after that, as when a node rolled back below a block the copy had reached, asks again. Its normal answer ends nothing, the wait ends when the record is applied. A wait that ends without the block MUST send the read to the node and MUST NOT answer it from the older copy; reads that follow while the copy still lacks the block go to the node at once, and the copy answers again once it has the block. When the service's latest block is behind a block a node announced, the latest-block request MUST go to the node.

**<a id="req-rpcmirror-5-kdrwdz"></a>`REQ-RPCMIRROR-5-KDRWDZ` — The copy follows the chain through gaps and reorganizations.** The client MUST apply each pushed record on its parent block. After a reorganization it MUST hold the replacement branch's values and restore a slot the orphaned block wrote when the replacement does not write it. A record whose parent is not the head makes the client ask the service for the blocks from the next missing one; when the service no longer retains them the client MUST empty its copy and read from the service again. When the service does not retain the head block of a state read (the not-retained error of [`REQ-SDS-7-PZCBQ9` (State reads come from one shared cache)](storage-diff-service.md#req-sds-7-pzcbq9)), the client reads that block's state from the node, at that block's number, only for as long as the service gives that answer. The block environment of local calls comes from the service's records, not from block reads on the node.

**<a id="req-rpcmirror-6-mhv1qd"></a>`REQ-RPCMIRROR-6-MHV1QD` — Chain data comes from the service when it holds it.** The client MUST answer the chain id from its first answer without asking a node again, and answer the block number, blocks, transactions and receipts from the service's retained data exactly as a node would, without asking a node. A transaction, receipt or block the service does not hold MUST be asked of the node. The client MUST record the newest included head the service reports, from a catch-up and from a push.

**<a id="req-rpcmirror-7-4a6njn"></a>`REQ-RPCMIRROR-7-4A6NJN` — A fraction of local answers is checked against the node.** The client MUST re-ask the node, after replying and at the same block hash, a configured fraction of the reads it answered locally (`eth_call`, storage, balance, nonce and code), and compare. A match is counted. A mismatch is counted and logged with what was read, at which block and the call's selector but never the values, and the account MUST be dropped to lazy reads from then on, so its state is read from the node. A node that cannot answer leaves the sample skipped; sampling never delays or fails the peer's read. A fraction of 0 sends the node nothing. The reaction to a mismatch is required behavior; the fraction is a tuning value. A client built without a configured fraction uses the configuration default of 1%.

**<a id="req-rpcmirror-8-1pa83t"></a>`REQ-RPCMIRROR-8-1PA83T` — Trouble with the service degrades reads to the node, never fails them.** A failure of the storage diff service MUST NOT fail a peer's read: a read the copy cannot answer, or a state fill the service cannot complete, is answered by the node. A failed `scp_unsubscribe` of a superseded subscription costs only duplicate pushes the new subscription also carries, so it MUST be logged and MUST keep the service connection.

## Assumptions and constraints

- The storage diff service follows the same chain as the client's RPC nodes and implements [storage-diff-service.md](./storage-diff-service.md).
- The local EVM is an Ethereum EVM. Code the chain runs on another machine (PolkaVM), the chain's own precompiles, and gas accounting beyond EVM execution are not reproduced.
- Reads wait for the copy to reach a block the peer saw only until an event ends the wait, and for a service that hangs silently only until a backstop learned from recent arrivals and capped at the SDK's RPC deadline; the cap is the deadline, so a read that waits the whole cap can be answered by the node only after the deadline. The cap is one constant mirroring the deadline because the provider is built before any channel and its `agreementTime` exists.
- Phase 1 carries no proofs: a service or node that lies is detected only by sampling, and only for the reads sampled.
- The service connection does not reconnect by itself: its owner opens a new one after a loss.
- The copy keeps a bounded number of applied blocks for rollback; a reorganization deeper than that empties it.

## Security considerations

**Protected assets.** The correctness of the contract state a peer acts on, and the peer's ability to read when the service fails.

**Trust boundaries.** The service and the node are trusted equally; the mirror adds the service as a second source and the node as its cross-check. A divergence the sample finds drops the account to the node, and is logged without values.

**Threats and defenses.** A wrong service answer is bounded by the sampling fraction and the node-only rules for code and addresses the local EVM would run differently (PolkaVM code, chain precompiles, gas-limited calls). A stuck or lost service cannot stall a peer: waits end on events or at a learned backstop, and reads fall back to the node.

**Residual risk.** Between samples, a peer can act on a state the service got wrong. The default fraction and the reaction are tuning choices the engineer has not fixed (see the open questions of this layer).

## Verification and test plan

### Requirement test matrix

Each entry is a planned black-box test obligation, not an additional specification requirement. The requirement remains the authority. Every required permutation has a stable `P1`…`PN` suffix under its plan item.

#### <a id="req-rpcmirror-1-xqnz4j.t1"></a>`REQ-RPCMIRROR-1-XQNZ4J.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-1-XQNZ4J`](rpc-mirror.md#req-rpcmirror-1-xqnz4j)

**Setup and stimulus:**

Deploy a contract through the client's provider, read it through the mirrored provider and directly from the node, write on chain, clear a slot, call a reverting function, a nested call that returns and one that reverts, and a registered custom precompile; read the pending and the latest nonce.

**Expected result:**

Every read agrees with the node's answer at the same head and the node receives none of the answered requests; calls leave no write behind; the pending nonce is asked of the node.

**Required permutations:**

<a id="req-rpcmirror-1-xqnz4j.t1.p1"></a>`REQ-RPCMIRROR-1-XQNZ4J.T1.P1` — an eth_call at latest is answered without an eth_call to the node

<a id="req-rpcmirror-1-xqnz4j.t1.p2"></a>`REQ-RPCMIRROR-1-XQNZ4J.T1.P2` — a slot written on chain is read after its block's record arrives without an eth_getStorageAt

<a id="req-rpcmirror-1-xqnz4j.t1.p3"></a>`REQ-RPCMIRROR-1-XQNZ4J.T1.P3` — a second read of the same slot sends neither a state read to the service nor a read to the node

<a id="req-rpcmirror-1-xqnz4j.t1.p4"></a>`REQ-RPCMIRROR-1-XQNZ4J.T1.P4` — a slot cleared on chain reads as zero without an eth_getStorageAt

<a id="req-rpcmirror-1-xqnz4j.t1.p5"></a>`REQ-RPCMIRROR-1-XQNZ4J.T1.P5` — a call, a revert and a read of account state return what the node returns at the same head

<a id="req-rpcmirror-1-xqnz4j.t1.p6"></a>`REQ-RPCMIRROR-1-XQNZ4J.T1.P6` — what a call wrote is discarded when it ends

<a id="req-rpcmirror-1-xqnz4j.t1.p7"></a>`REQ-RPCMIRROR-1-XQNZ4J.T1.P7` — a returned sub-call's write stays out of the frame that reverted it

<a id="req-rpcmirror-1-xqnz4j.t1.p8"></a>`REQ-RPCMIRROR-1-XQNZ4J.T1.P8` — a custom precompile runs locally without an upstream request

<a id="req-rpcmirror-1-xqnz4j.t1.p9"></a>`REQ-RPCMIRROR-1-XQNZ4J.T1.P9` — a pending nonce read goes to the node and the latest one is answered locally

#### <a id="req-rpcmirror-2-1p38e2.t1"></a>`REQ-RPCMIRROR-2-1P38E2.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-2-1P38E2`](rpc-mirror.md#req-rpcmirror-2-1p38e2)

**Setup and stimulus:**

Send each kind of request through the client's provider with a service configured and with none; call contracts holding PolkaVM code, a chain precompile address, a standard precompile address and the point evaluation address; call with and without a gas limit.

**Expected result:**

The node receives exactly the requests listed as node-only and receives none of the locally answerable ones; results equal the node's.

**Required permutations:**

<a id="req-rpcmirror-2-1p38e2.t1.p1"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P1` — estimateGas and reads at an older block go to the node

<a id="req-rpcmirror-2-1p38e2.t1.p2"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P2` — every read goes to the node when no storage diff service is configured

<a id="req-rpcmirror-2-1p38e2.t1.p3"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P3` — a call that carries a gas limit is answered by the node

<a id="req-rpcmirror-2-1p38e2.t1.p4"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P4` — a call to PolkaVM code goes to the node whole

<a id="req-rpcmirror-2-1p38e2.t1.p5"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P5` — the code of PolkaVM contract is still answered and the registered precompile that stands in for it runs

<a id="req-rpcmirror-2-1p38e2.t1.p6"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P6` — a call that reaches a chain precompile the local EVM does not reproduce goes to the node whole

<a id="req-rpcmirror-2-1p38e2.t1.p7"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P7` — a call that reaches a standard precompile runs locally

<a id="req-rpcmirror-2-1p38e2.t1.p8"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P8` — a direct call to the point evaluation address goes to the node

#### <a id="req-rpcmirror-3-7mqh88.t1"></a>`REQ-RPCMIRROR-3-7MQH88.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-3-7MQH88`](rpc-mirror.md#req-rpcmirror-3-7mqh88)

**Setup and stimulus:**

Make the service report ready, syncing and lazy for an account; delay, never deliver, announce as delayed, or lose the snapshot; make the backfill end without a snapshot and fail; push a snapshot before the subscribe reply; announce a complete account lazy after a block.

**Expected result:**

No read waits for a snapshot that is not ready; ready waits end by snapshot, a lazy notice, a delayed notice, lost connection or the backstop learned from snapshot arrivals, the last two sending the read to the node, and fast block arrivals never shorten that backstop; lazy accounts are read from the service for exactly the fields missing, including the slot the history omitted.

**Required permutations:**

<a id="req-rpcmirror-3-7mqh88.t1.p1"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P1` — the first read of a slot of a ready account is answered from the pushed snapshot with no state read and no node read

<a id="req-rpcmirror-3-7mqh88.t1.p2"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P2` — a snapshot that reaches the client before the reply of the subscription that asked for it is applied

<a id="req-rpcmirror-3-7mqh88.t1.p3"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P3` — a read waits for the snapshot of an account the service has ready instead of reading lazily

<a id="req-rpcmirror-3-7mqh88.t1.p4"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P4` — an account the service says is syncing is read at once and answered locally once its snapshot has come

<a id="req-rpcmirror-3-7mqh88.t1.p5"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P5` — an account the service says is lazy is read at once without waiting for a snapshot

<a id="req-rpcmirror-3-7mqh88.t1.p6"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P6` — an account stays lazy when the backfill of a syncing account ends without a snapshot

<a id="req-rpcmirror-3-7mqh88.t1.p7"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P7` — an account stays lazy when the backfill of a syncing account fails

<a id="req-rpcmirror-3-7mqh88.t1.p8"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P8` — a read of a ready snapshot that is never delivered is answered by the node after a backstop learned from snapshot arrivals

<a id="req-rpcmirror-3-7mqh88.t1.p9"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P9` — the wait for a snapshot ends at once when the service connection drops

<a id="req-rpcmirror-3-7mqh88.t1.p10"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P10` — exactly the missing fields of a syncing account are asked of the service, at the head block

<a id="req-rpcmirror-3-7mqh88.t1.p12"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P12` — a read of a ready snapshot the service says is delayed is answered by the node at once

<a id="req-rpcmirror-3-7mqh88.t1.p11"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P11` — a complete account whose cached entries the service finds short after a block drops to lazy reads and the omitted slot is read

<a id="req-rpcmirror-3-7mqh88.t1.p13"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P13` — fast block arrivals do not shorten the wait for a snapshot

#### <a id="req-rpcmirror-4-h35nfc.t1"></a>`REQ-RPCMIRROR-4-H35NFC.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-4-H35NFC`](rpc-mirror.md#req-rpcmirror-4-h35nfc)

**Setup and stimulus:**

Mine the peer's own transaction, or a block a node announces, while the service's pushes are held; read; release the pushes; let the service stay behind a block the node announced; announce a later block while the copy lacks the one before; make the service's tracing fail or its upstream lag, with several reads waiting for the same block; cut the service connection; make a node slow to answer a forwarded request; and let a block never reach the copy after fast arrivals.

**Expected result:**

The read stays pending while the pushes are held and then returns the post-block value without a node call; a service that stays behind is bypassed by the node; every wait that ends without the block ends in an answer equal to the node's, never the older copy's, a wait that learned its backstop ends before the SDK's RPC deadline, and a read that waits the whole longest wait still has the node's answer inside the deadline.

**Required permutations:**

<a id="req-rpcmirror-4-h35nfc.t1.p1"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P1` — a call issued after the peer's own transaction is mined waits until the copy has that block

<a id="req-rpcmirror-4-h35nfc.t1.p2"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P2` — a call waits until the copy reaches a block a node announced

<a id="req-rpcmirror-4-h35nfc.t1.p3"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P3` — a read waits until the copy reaches the block of a log notification a node pushed first

<a id="req-rpcmirror-4-h35nfc.t1.p4"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P4` — the node is asked for the latest block while the service is behind a block the node announced

<a id="req-rpcmirror-4-h35nfc.t1.p8"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P8` — a block that never reaches the copy within the learned backstop is answered with the node's value, not the older copy's, and later reads go to the node until the block arrives

<a id="req-rpcmirror-4-h35nfc.t1.p9"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P9` — the service saying its tracing of the awaited block failed sends the read to the node at once

<a id="req-rpcmirror-4-h35nfc.t1.p10"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P10` — the service saying its upstream has not seen the awaited block sends the read to the node at once

<a id="req-rpcmirror-4-h35nfc.t1.p11"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P11` — a node announcing a later block while the copy lacks the one before sends the read to the node at once

<a id="req-rpcmirror-4-h35nfc.t1.p12"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P12` — a service connection that drops while a call waits for a block sends the call to the node at once

<a id="req-rpcmirror-4-h35nfc.t1.p13"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P13` — the backstop is the longest wait before any record has arrived and shorter after fast arrivals

<a id="req-rpcmirror-4-h35nfc.t1.p14"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P14` — the service is asked once for its head when a wait for a block starts, and a service whose upstream is behind sends the reads waiting for it to the node at once

<a id="req-rpcmirror-4-h35nfc.t1.p15"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P15` — the longest wait shrinks as the node's round trips grow, and a read that waits the whole of it still has the node's answer inside the deadline

<a id="req-rpcmirror-4-h35nfc.t1.p16"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P16` — a later wait for the same block number, after the copy fell below it, asks the service for its head again

#### <a id="req-rpcmirror-5-kdrwdz.t1"></a>`REQ-RPCMIRROR-5-KDRWDZ.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-5-KDRWDZ`](rpc-mirror.md#req-rpcmirror-5-kdrwdz)

**Setup and stimulus:**

Reorganize the chain with and without a write in the replacement block; push a record whose parent is missing; make the service forget the missing blocks; make the service answer not-retained for the head block; run calls that read the block environment.

**Expected result:**

Reads equal the canonical branch's values; gaps are filled from the service; an emptied copy refills from the service; node reads occur only while the service answers not-retained; no block is read from the node for the environment.

**Required permutations:**

<a id="req-rpcmirror-5-kdrwdz.t1.p1"></a>`REQ-RPCMIRROR-5-KDRWDZ.T1.P1` — a read returns the replacement branch's value after a reorganization

<a id="req-rpcmirror-5-kdrwdz.t1.p2"></a>`REQ-RPCMIRROR-5-KDRWDZ.T1.P2` — a slot the orphaned block wrote is restored when the replacement block does not write it

<a id="req-rpcmirror-5-kdrwdz.t1.p3"></a>`REQ-RPCMIRROR-5-KDRWDZ.T1.P3` — the service is asked for the blocks from the next missing one when a record's parent is not the head

<a id="req-rpcmirror-5-kdrwdz.t1.p4"></a>`REQ-RPCMIRROR-5-KDRWDZ.T1.P4` — the copy is emptied when the service no longer retains the missing blocks and the next read goes to the service again

<a id="req-rpcmirror-5-kdrwdz.t1.p5"></a>`REQ-RPCMIRROR-5-KDRWDZ.T1.P5` — state is read from the node at the head block number only while the service answers that the block is not retained

<a id="req-rpcmirror-5-kdrwdz.t1.p6"></a>`REQ-RPCMIRROR-5-KDRWDZ.T1.P6` — the block environment comes from the service without reading blocks from the node

#### <a id="req-rpcmirror-6-mhv1qd.t1"></a>`REQ-RPCMIRROR-6-MHV1QD.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-6-MHV1QD`](rpc-mirror.md#req-rpcmirror-6-mhv1qd)

**Setup and stimulus:**

Ask for the chain id twice, the head, a retained block, a transaction and its receipt, then a transaction, receipt and block the service does not hold; move the included head by catch-up and by push.

**Expected result:**

Retained answers equal the node's and cost the node no request; unheld identities reach the node; the recorded included head is the newest reported.

**Required permutations:**

<a id="req-rpcmirror-6-mhv1qd.t1.p1"></a>`REQ-RPCMIRROR-6-MHV1QD.T1.P1` — the chain id is answered from its first answer without asking a node again

<a id="req-rpcmirror-6-mhv1qd.t1.p2"></a>`REQ-RPCMIRROR-6-MHV1QD.T1.P2` — the block number, blocks, transactions and receipts are answered as the node does, without asking a node

<a id="req-rpcmirror-6-mhv1qd.t1.p3"></a>`REQ-RPCMIRROR-6-MHV1QD.T1.P3` — a transaction, receipt or block the service does not hold is asked of the node

<a id="req-rpcmirror-6-mhv1qd.t1.p4"></a>`REQ-RPCMIRROR-6-MHV1QD.T1.P4` — the included head is recorded from the catch-up and from a push

#### <a id="req-rpcmirror-7-4a6njn.t1"></a>`REQ-RPCMIRROR-7-4A6NJN.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-7-4A6NJN`](rpc-mirror.md#req-rpcmirror-7-4a6njn)

**Setup and stimulus:**

Set the sampling fraction to 1 and to 0, and leave it unset; read storage, balance, nonce, code and call a view function; corrupt a cached value so it differs from the node's.

**Expected result:**

Sampled reads reach the node after the reply with the cached block hash; counters and logs follow the outcome; a differing account is read from the node afterwards.

**Required permutations:**

<a id="req-rpcmirror-7-4a6njn.t1.p1"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P1` — a sampled read is asked of the node after the reply and its match is counted

<a id="req-rpcmirror-7-4a6njn.t1.p2"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P2` — balance, nonce and code reads are sampled as well

<a id="req-rpcmirror-7-4a6njn.t1.p3"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P3` — a sample rate of 0 sends nothing to the node

<a id="req-rpcmirror-7-4a6njn.t1.p4"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P4` — a mismatch between a cached value and the node is counted and the account is read from the node from then on

<a id="req-rpcmirror-7-4a6njn.t1.p5"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P5` — a sampled eth_call is checked against the node and the called account is dropped on a mismatch

<a id="req-rpcmirror-7-4a6njn.t1.p6"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P6` — a client built without a sample rate samples a small fraction of its local answers

#### <a id="req-rpcmirror-8-1pa83t.t1"></a>`REQ-RPCMIRROR-8-1PA83T.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-8-1PA83T`](rpc-mirror.md#req-rpcmirror-8-1pa83t)

**Setup and stimulus:**

Replace a subscription with one covering more accounts and make the old one's unsubscribe fail; make a state fill fail.

**Expected result:**

The connection stays open, a warning is logged, and reads continue from the copy; a failed fill is answered by the node.

**Required permutations:**

<a id="req-rpcmirror-8-1pa83t.t1.p1"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P1` — a failed unsubscribe of a superseded subscription is logged and keeps the service connection

<a id="req-rpcmirror-8-1pa83t.t1.p2"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P2` — a state fill the service cannot complete is answered by the node

### Coverage rule

Every plan item is exercised through the provider's public JSON-RPC surface against a real node and a real service, observing both the answers and the requests each upstream receives. The pure address and code policy has unit cases in the implementation layer.

## Future Work

_Non-normative._ A feed other than the service's socket (for example gossip between peers) behind the same feed interface, and proofs for mirrored state.
