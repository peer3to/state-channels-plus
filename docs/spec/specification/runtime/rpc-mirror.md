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

The client is a drop-in for the plain multi-endpoint provider ([chain-observation.md](./chain-observation.md)): the same endpoint set and the same failover, with latest-block reads served locally and the runtime's own contract events taken from the service's records. The storage diff service is required: the client does not run without one.

## Requirements and invariants

**<a id="req-rpcmirror-1-xqnz4j"></a>`REQ-RPCMIRROR-1-XQNZ4J` — Latest-block reads are answered from a local copy of the chain.** The client MUST answer `eth_call`, `eth_getStorageAt`, `eth_getCode`, `eth_getBalance` and the latest `eth_getTransactionCount` at the latest block from a local copy of the followed contracts' state, run by a local EVM, without sending the node that request. The copy is fed by the service's snapshots and records ([`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw), [`REQ-SDS-1-TXEY33` (A subscription receives one record per canonical block)](storage-diff-service.md#req-sds-1-txey33)); a field the feed has not pushed is read once from the service at the head block and then held. A local call MUST return and revert as the node does at the same head, MUST discard what it wrote when it ends, and MUST keep a returned sub-call's write out of the frame that reverted it. `BLOCKHASH` reads the hash of a block the copy applied, as the service's records give it; a call whose `BLOCKHASH` names an older block MUST go to the node whole. A custom precompile registered with the runtime runs locally. A pending nonce is never answered locally: the mempool is the node's.

**<a id="req-rpcmirror-2-1p38e2"></a>`REQ-RPCMIRROR-2-1P38E2` — Reads the copy cannot answer correctly go to the node whole.** A request the local copy cannot answer as the chain would MUST go to the node, whole. That covers transactions, `eth_estimateGas` (gas on the target chain is weight based), logs, reads at an older block, a call that carries an explicit gas limit: the local EVM charges no transaction gas (the base cost and calldata), so only the node can tell the least limit at which the call succeeds; a call that sets the EIP-1559 fee fields, whose gas price is the node's to work out against its base fee; and a call that fails locally without reverting (out of gas, an invalid opcode), since the local EVM keeps no gas accounting of the chain's. A call that executes PolkaVM code, or reaches an address the chain serves with a precompile of its own that the local EVM does not reproduce (the chain's builtin range above the standard precompiles, its external ranges, and the point evaluation address), MUST go to the node whole, and so MUST a read of such an address's storage or balance; a call that reaches a standard precompile the chain implements runs locally. Reading the code of a PolkaVM contract is still answered locally.

**<a id="req-rpcmirror-3-7mqh88"></a>`REQ-RPCMIRROR-3-7MQH88` — A snapshot is waited for only when the service says it is ready.** The client MUST follow a contract it reads for the first time and act on the status the service gives it ([`REQ-SDS-9-ZRPZZW`](storage-diff-service.md#req-sds-9-zrpzzw)). An account it finds without code is not followed: what a read needs of it is read from the service at the head block, kept until the head moves, and read again at the next head. The client follows at most a configured number of contracts (`MIRROR_MAX_FOLLOWED_CONTRACTS`, 1,000 by default, the service's default limit of addresses per request, since every subscribe names them all; an operator who lowers the service's limit lowers it to match); a new one past that bound makes it stop following the contract read least recently that the running read does not use, forgetting its cached state. For `ready` the read waits for the pushed snapshot and ends the wait at the first of: the snapshot arriving (including one that reaches the client before the reply of the subscription that asked for it, under any subscription id); the service saying the snapshot is delayed ([`REQ-SDS-12-N40MKR`](storage-diff-service.md#req-sds-12-n40mkr)); the connection dropping; or, for a service that is connected but silent, a backstop learned from how long snapshots took to arrive (from the subscribe to the snapshot being applied; a multiple of the slowest in a short recent window), never from how long blocks took, since a snapshot also pays a subscribe round trip, and never longer than the longest wait of [`REQ-RPCMIRROR-4-H35NFC`](rpc-mirror.md#req-rpcmirror-4-h35nfc), which it equals until a snapshot has arrived. A wait that ends without the snapshot because it is delayed, or at the backstop, sends the read to the node. For `syncing` and `lazy` it MUST NOT wait: the missing fields are read at once from the service at the head block, and a syncing account answers locally once its snapshot has come. A notice that no snapshot is coming (the backfill ended without one or failed) ends any wait at once and the read reads the account as needed, and a lost connection ends it at once. When the service later finds a complete account's entries short and announces it lazy, the client MUST drop the account to lazy reads. A read's waits for snapshots end with that read, so a read that fails while following an account leaves no wait behind for a later snapshot of it; a read whose wait ends while a snapshot for it is still being placed ends only once that snapshot is placed, so the next read does not run under a head that is still moving.

**<a id="req-rpcmirror-4-h35nfc"></a>`REQ-RPCMIRROR-4-H35NFC` — A read is never older than a block the peer already saw.** A read MUST NOT be answered from a copy older than a block the peer has seen: its own transaction mined, a new head or a log notification a node pushed, or a block whose events the service's records handed on. The client MUST keep a head subscription on every connected node for as long as it runs, so that a node's new head is seen even when nothing else listens for blocks. A node's announced block is its newest head, or a later block one of its log notifications named since; only a new head below the node's previous head, a reorganization to a shorter branch, lowers it, a head that arrives late, after a later block's log, does not, and a removed log (one of an orphaned block) announces nothing. When it lowers, reads already waiting look at the copy again, and the orphaned heights' announcements teach the backstop nothing. A block whose events the service's records handed on is waited for as that block, by its hash, as the peer's own transaction's block is. Reads wait for the newest announced block over all nodes, so a node that lags behind another never lowers it ([`OQ-SPEC-RPCMIRROR-3-GSZMRE`](../open-questions.md#oq-spec-rpcmirror-3-gszmre)). The read waits until the copy has applied that block. The wait ends at the first of: the block's record arriving (the read is then answered locally); the service saying the block will not come soon (its tracing of the block failed or is retried, or its upstream has not seen it: [`REQ-SDS-12-N40MKR`](storage-diff-service.md#req-sds-12-n40mkr)); a node announcing a later block while the copy still lacks the one before (the service is a whole block behind); the service connection dropping; or, for a service connected but silent, a backstop learned from how long records took to arrive after a node announced them (a multiple of the slowest in a short recent window), never longer than the longest wait. The longest wait is the SDK's RPC deadline less the same multiple of the slowest recent round trip of a node, learned from the node's answers to the reads a wait can fall back to (state reads, calls, and block, transaction and receipt reads); other requests the client forwards, such as log queries and transaction sends, teach it nothing, except the chain id the client asks for when it starts, which is the first sample, so a read that waits the whole backstop still gets the node's answer inside the deadline; until a node round trip has been observed it is the whole deadline, and the backstop equals it until an arrival has been observed. When a wait for a block starts, the client MUST ask the service once for its head at that block, so that a service whose upstream has not seen the block ends the wait at once with its notice; the probe is not repeated by the reads that join the same wait or by the reads that follow it, until the copy has applied that block; a later wait for the same block number after that, as when a node rolled back below a block the copy had reached, asks again. Its normal answer ends nothing, the wait ends when the record is applied. A wait that ends without the block MUST send the read to the node and MUST NOT answer it from the older copy; reads that follow while the copy still lacks the block go to the node at once, and the copy answers again once it has the block. When the service's latest block is behind a block a node announced, the latest-block request MUST go to the node.

**<a id="req-rpcmirror-5-kdrwdz"></a>`REQ-RPCMIRROR-5-KDRWDZ` — The copy follows the chain through gaps and reorganizations.** The client MUST apply each pushed record on its parent block. After a reorganization it MUST hold the replacement branch's values and restore a slot the orphaned block wrote when the replacement does not write it. A record whose parent is not the head makes the client ask the service for the blocks from the next missing one; when the service no longer retains them the client MUST empty its copy and read from the service again. A record older than the blocks the copy keeps, or one that catch-up does not join to them, means the service's chain left the copy's below what it can roll back: the client MUST empty its copy and read from the service again. When the service does not retain the head block of a state read (the not-retained error of [`REQ-SDS-7-PZCBQ9` (State reads come from one shared cache)](storage-diff-service.md#req-sds-7-pzcbq9)), the client reads that block's state from the node, pinned to that block's hash, only for as long as the service gives that answer. The block environment of local calls comes from the service's records, not from block reads on the node.

**<a id="req-rpcmirror-6-mhv1qd"></a>`REQ-RPCMIRROR-6-MHV1QD` — Chain data comes from the service when it holds it.** The client MUST answer the chain id from its first answer without asking a node again, and answer the block number, blocks, transactions and receipts from the service's retained data exactly as a node would, without asking a node. A transaction, receipt or block the service does not hold MUST be asked of the node.

**<a id="req-rpcmirror-7-4a6njn"></a>`REQ-RPCMIRROR-7-4A6NJN` — A fraction of local answers is checked against the node.** The client MUST re-ask the node, after replying and at the same block hash, a configured fraction of the reads it answered locally (`eth_call`, storage, balance, nonce and code), and compare. A mismatch is logged with what was read, at which block and the call's selector but never the values, and every account the read used, a callee's as well as the called one, MUST be dropped to lazy reads from then on, so its state is read from the node: what later records and snapshots of the service say of it is not kept. A revert is an answer: a call the copy returned that the node reverts, or the other way round, is a mismatch. A node that cannot answer leaves the sample skipped; sampling never delays or fails the peer's read. A fraction of 0 sends the node nothing. The reaction to a mismatch is required behavior; the fraction is a tuning value. A client built without a configured fraction uses the configuration default of 1%.

**<a id="req-rpcmirror-8-1pa83t"></a>`REQ-RPCMIRROR-8-1PA83T` — Trouble with the service degrades reads to the node, never fails them.** A failure of the storage diff service MUST NOT fail a peer's read, and a local EVM that fails to start MUST be started again by the next call: a read the copy cannot answer, or a state fill the service cannot complete, is answered by the node. A failed `scp_unsubscribe` of a superseded subscription costs only duplicate pushes the new subscription also carries, so it MUST be logged and MUST keep the service connection. A request the service refuses past one of its limits, or for naming more addresses than it allows ([`REQ-SDS-12-JDW71Y` (What peers can make the service hold is bounded)](storage-diff-service.md#req-sds-12-jdw71y)), changed nothing on the service: the client MUST keep its copy and the connection, the read is answered by the node, and a pushed record whose catch-up was refused waits for a later record to catch up. A refused catch-up of accounts the client has just followed is the exception: the records after the head may lack them, so the connection starts over. A service that is connected but silent MUST NOT stall a read: a read's wait for the copy and every request it makes of the service end within the longest wait of [`REQ-RPCMIRROR-4-H35NFC`](rpc-mirror.md#req-rpcmirror-4-h35nfc), after which the node answers it, and a request the copy's own following makes (a pushed record's catch-up) ends within the SDK's RPC deadline. A request that runs out of time while the copy is being changed drops the service connection; one that only reads the service's head, blocks, transactions or receipts does not.

**<a id="req-rpcmirror-9-5vd1gg"></a>`REQ-RPCMIRROR-9-5VD1GG` — The storage diff service is required.** The client MUST refuse to build its provider, through its constructor or the exported chain-access factory, and to start its runtime chain context, without the URL of a storage diff service, and MUST do so before any RPC node is asked, so a missing service leaves nothing running and the failure names the missing setting. There is no mode in which the client runs without the service.

## Assumptions and constraints

- The storage diff service follows the same chain as the client's RPC nodes and implements [storage-diff-service.md](./storage-diff-service.md).
- The local EVM is an Ethereum EVM. Code the chain runs on another machine (PolkaVM), the chain's own precompiles, and gas accounting beyond EVM execution are not reproduced.
- Reads wait for the copy to reach a block the peer saw only until an event ends the wait, and for a service that hangs silently only until a backstop learned from recent arrivals and capped at the longest wait of [`REQ-RPCMIRROR-4-H35NFC`](rpc-mirror.md#req-rpcmirror-4-h35nfc): the SDK's RPC deadline less a multiple of the slowest recent node round trip, never below zero, and the whole deadline until a round trip has been observed. A read that waits the whole cap therefore still gets the node's answer inside the deadline. The deadline is one constant mirroring the SDK's because the provider is built before any channel and its `agreementTime` exists.
- Phase 1 carries no proofs: a service or node that lies is detected only by sampling, and only for the reads sampled.
- The service connection does not reconnect by itself: its owner opens a new one after a loss.
- The copy keeps a bounded number of applied blocks for rollback; a reorganization deeper than that empties it.

## Security considerations

**Protected assets.** The correctness of the contract state a peer acts on, and the peer's ability to read when the service fails.

**Trust boundaries.** The service and the node are trusted equally; the mirror adds the service as a second source and the node as its cross-check. A divergence the sample finds drops the account to the node, and is logged without values.

**Threats and defenses.** A wrong service answer is bounded by the sampling fraction and the node-only rules for code and addresses the local EVM would run differently (PolkaVM code, chain precompiles, gas-limited calls). A stuck or lost service cannot stall a peer: waits end on events or at a learned backstop, a read's requests to the service and its wait for the copy end within its share of the deadline, and reads fall back to the node.

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

<a id="req-rpcmirror-1-xqnz4j.t1.p10"></a>`REQ-RPCMIRROR-1-XQNZ4J.T1.P10` — BLOCKHASH of a block the copy applied is answered locally as the node answers it

#### <a id="req-rpcmirror-2-1p38e2.t1"></a>`REQ-RPCMIRROR-2-1P38E2.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-2-1P38E2`](rpc-mirror.md#req-rpcmirror-2-1p38e2)

**Setup and stimulus:**

Send each kind of request through the client's provider, including one only nodes answer while the first node is cut; call contracts holding PolkaVM code, a chain precompile address, a standard precompile address and the point evaluation address; call with and without a gas limit.

**Expected result:**

The node receives exactly the requests listed as node-only and receives none of the locally answerable ones; node-only requests fail over to the next node; results equal the node's.

**Required permutations:**

<a id="req-rpcmirror-2-1p38e2.t1.p1"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P1` — estimateGas and reads at an older block go to the node

<a id="req-rpcmirror-2-1p38e2.t1.p3"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P3` — a call that carries a gas limit is answered by the node

<a id="req-rpcmirror-2-1p38e2.t1.p4"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P4` — a call to PolkaVM code goes to the node whole

<a id="req-rpcmirror-2-1p38e2.t1.p5"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P5` — the code of PolkaVM contract is still answered and the registered precompile that stands in for it runs

<a id="req-rpcmirror-2-1p38e2.t1.p6"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P6` — a call that reaches a chain precompile the local EVM does not reproduce goes to the node whole

<a id="req-rpcmirror-2-1p38e2.t1.p7"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P7` — a call that reaches a standard precompile runs locally

<a id="req-rpcmirror-2-1p38e2.t1.p8"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P8` — a direct call to the point evaluation address goes to the node

<a id="req-rpcmirror-2-1p38e2.t1.p9"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P9` — a call that sets EIP-1559 fee fields goes to the node whole

<a id="req-rpcmirror-2-1p38e2.t1.p10"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P10` — a call that fails locally without reverting goes to the node whole

<a id="req-rpcmirror-2-1p38e2.t1.p11"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P11` — a call whose BLOCKHASH names a block older than the copy keeps goes to the node whole

<a id="req-rpcmirror-2-1p38e2.t1.p12"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P12` — the storage and balance of an address the chain serves with its own precompile are read from the node

<a id="req-rpcmirror-2-1p38e2.t1.p13"></a>`REQ-RPCMIRROR-2-1P38E2.T1.P13` — a request only nodes answer is sent through the second node when the first is cut, with the service on

#### <a id="req-rpcmirror-3-7mqh88.t1"></a>`REQ-RPCMIRROR-3-7MQH88.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-3-7MQH88`](rpc-mirror.md#req-rpcmirror-3-7mqh88)

**Setup and stimulus:**

Make the service report ready, syncing and lazy for an account; delay, never deliver, announce as delayed, or lose the snapshot; make the backfill end without a snapshot and fail; push a snapshot before the subscribe reply; announce a complete account lazy after a block; fail the catch-up of a read that follows a ready account, then reconnect; hold the catch-up a snapshot ahead of the head needs past the backstop.

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

<a id="req-rpcmirror-3-7mqh88.t1.p14"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P14` — a snapshot pushed after a reconnect is applied when the read that followed the account failed its catch-up

<a id="req-rpcmirror-3-7mqh88.t1.p15"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P15` — a read whose snapshot wait ends at the backstop while the snapshot is still being placed ends only once it is placed

<a id="req-rpcmirror-3-7mqh88.t1.p16"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P16` — an awaited snapshot whose catch-up cleared the copy is not placed, and the read is answered

<a id="req-rpcmirror-3-7mqh88.t1.p17"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P17` — past the bound the contract read least recently is no longer followed, and the others stay answered locally

<a id="req-rpcmirror-3-7mqh88.t1.p18"></a>`REQ-RPCMIRROR-3-7MQH88.T1.P18` — an account without code is not followed and is read again at a new head

#### <a id="req-rpcmirror-4-h35nfc.t1"></a>`REQ-RPCMIRROR-4-H35NFC.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-4-H35NFC`](rpc-mirror.md#req-rpcmirror-4-h35nfc)

**Setup and stimulus:**

Mine the peer's own transaction, or a block a node announces (one with Asset Hub eth-rpc's head subscriptions too), while the service's pushes are held; read; release the pushes; let the service stay behind a block the node announced; announce a later block while the copy lacks the one before; make the service's tracing fail or its upstream lag, with several reads waiting for the same block; cut the service connection; make a node slow to answer a forwarded request; and let a block never reach the copy after fast arrivals. Wait for an announced block before any record has arrived, and after a slow log query. Reorganize the chain to a branch shorter than the head a node announced; have a second node announce an older head after the first node's newer one; have a node report an orphaned block's log as removed after a reorganization; deliver a node's log of a block after its newer head, and a node's head of a block after the next block's log; let the copy follow a shorter replacement branch while a read waits for an orphaned block, before the node's lower head arrives. Read from an event listener while the service's pushes and the node's head pushes are held; build the client with no block listener.

**Expected result:**

The read stays pending while the pushes are held and then returns the post-block value without a node call; a service that stays behind is bypassed by the node; every wait that ends without the block ends in an answer equal to the node's, never the older copy's, a wait that learned its backstop ends before the SDK's RPC deadline, and a read that waits the whole longest wait still has the node's answer inside the deadline; after a reorganization to a shorter branch, a removed log, a lagging node's older head or a node's older log, reads are answered from the copy once it holds the newest head any node still reports, and never from before it.

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

<a id="req-rpcmirror-4-h35nfc.t1.p13"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P13` — the backstop is shorter than the longest wait after fast arrivals

<a id="req-rpcmirror-4-h35nfc.t1.p14"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P14` — the service is asked once for its head when a wait for a block starts, and a service whose upstream is behind sends the reads waiting for it to the node at once

<a id="req-rpcmirror-4-h35nfc.t1.p15"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P15` — the longest wait shrinks as the node's round trips grow, and a read that waits the whole of it still has the node's answer inside the deadline

<a id="req-rpcmirror-4-h35nfc.t1.p16"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P16` — a later wait for the same block number, after the copy fell below it, asks the service for its head again

<a id="req-rpcmirror-4-h35nfc.t1.p17"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P17` — a node announcement older than the learning window, or cleared with the cache, teaches the backstop nothing and is not kept

<a id="req-rpcmirror-4-h35nfc.t1.p18"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P18` — before any record has arrived the backstop is the whole longest wait, and the node then answers inside the deadline

<a id="req-rpcmirror-4-h35nfc.t1.p19"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P19` — a slow node answer to a request no wait falls back to (a log query) leaves the longest wait as it was

<a id="req-rpcmirror-4-h35nfc.t1.p20"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P20` — the chain id answer from the client's start is a learned round trip, so a read that falls back first still has the node's answer inside the deadline

<a id="req-rpcmirror-4-h35nfc.t1.p21"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P21` — a node's new head lower than the block it announced before, as after a reorganization to a shorter branch, lowers the block reads wait for, and the copy answers again once it holds the replacement branch

<a id="req-rpcmirror-4-h35nfc.t1.p22"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P22` — a node announcing an older head after another node's newer one keeps the read waiting for the newer head

<a id="req-rpcmirror-4-h35nfc.t1.p23"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P23` — a removed log of an orphaned block above the replacement branch's head announces nothing, and the copy answers at once

<a id="req-rpcmirror-4-h35nfc.t1.p24"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P24` — a node's log of a block before its newer head, arriving after that head, keeps the read waiting for the newer head

<a id="req-rpcmirror-4-h35nfc.t1.p25"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P25` — a node's head of a block, arriving after its log of the next block, keeps the read waiting for the log's block

<a id="req-rpcmirror-4-h35nfc.t1.p26"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P26` — a read already waiting for a block a reorganization orphaned is answered from the copy once the node's lower head arrives, without waiting out the backstop

<a id="req-rpcmirror-4-h35nfc.t1.p27"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P27` — the announcements of the heights a reorganization orphaned are forgotten, so a block announced again at such a height is timed from its own announcement

<a id="req-rpcmirror-4-h35nfc.t1.p28"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P28` — a read waits for a block announced by a node that refuses `newHeads` and offers `newBlockHeaders`

<a id="req-rpcmirror-4-h35nfc.t1.p29"></a>`REQ-RPCMIRROR-4-H35NFC.T1.P29` — the block of a `newBlockHeaders` push as Asset Hub's eth-rpc sends it is announced

[`REQ-RPCMIRROR-4-H35NFC.T1.P23`](rpc-mirror.md#req-rpcmirror-4-h35nfc.t1.p23) — a read issued from the listener of an event the service handed on sees the event's block

[`REQ-RPCMIRROR-4-H35NFC.T1.P24`](rpc-mirror.md#req-rpcmirror-4-h35nfc.t1.p24) — a client with no block listener subscribes to every connected node's heads

[`REQ-RPCMIRROR-4-H35NFC.T1.P25`](rpc-mirror.md#req-rpcmirror-4-h35nfc.t1.p25) — a client whose only node refuses every subscription warns once, leaves no unhandled rejection and keeps answering reads from the copy

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

<a id="req-rpcmirror-5-kdrwdz.t1.p5"></a>`REQ-RPCMIRROR-5-KDRWDZ.T1.P5` — state is read from the node at the head block hash only while the service answers that the block is not retained

<a id="req-rpcmirror-5-kdrwdz.t1.p6"></a>`REQ-RPCMIRROR-5-KDRWDZ.T1.P6` — the block environment comes from the service without reading blocks from the node

<a id="req-rpcmirror-5-kdrwdz.t1.p7"></a>`REQ-RPCMIRROR-5-KDRWDZ.T1.P7` — after a reorganization that replaces the block the copy began following at, the copy follows the replacement branch

<a id="req-rpcmirror-5-kdrwdz.t1.p8"></a>`REQ-RPCMIRROR-5-KDRWDZ.T1.P8` — after a reorganization deeper than the blocks the copy keeps, the copy follows the replacement branch

#### <a id="req-rpcmirror-6-mhv1qd.t1"></a>`REQ-RPCMIRROR-6-MHV1QD.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-6-MHV1QD`](rpc-mirror.md#req-rpcmirror-6-mhv1qd)

**Setup and stimulus:**

Ask for the chain id twice, the head, a retained block, a transaction and its receipt, then a transaction, receipt and block the service does not hold.

**Expected result:**

Retained answers equal the node's and cost the node no request; unheld identities reach the node.

**Required permutations:**

<a id="req-rpcmirror-6-mhv1qd.t1.p1"></a>`REQ-RPCMIRROR-6-MHV1QD.T1.P1` — the chain id is answered from its first answer without asking a node again

<a id="req-rpcmirror-6-mhv1qd.t1.p2"></a>`REQ-RPCMIRROR-6-MHV1QD.T1.P2` — the block number, blocks, transactions and receipts are answered as the node does, without asking a node

<a id="req-rpcmirror-6-mhv1qd.t1.p3"></a>`REQ-RPCMIRROR-6-MHV1QD.T1.P3` — a transaction, receipt or block the service does not hold is asked of the node

#### <a id="req-rpcmirror-7-4a6njn.t1"></a>`REQ-RPCMIRROR-7-4A6NJN.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-7-4A6NJN`](rpc-mirror.md#req-rpcmirror-7-4a6njn)

**Setup and stimulus:**

Set the sampling fraction to 1 and to 0, and leave it unset; read storage, balance, nonce, code and call a view function; corrupt a cached value so it differs from the node's. After a mismatch, write the account on chain and drop and restore the service connection; read the logged mismatch.

**Expected result:**

Sampled reads reach the node after the reply with the cached block hash; a mismatch is logged without values; a differing account is read from the node afterwards.

**Required permutations:**

<a id="req-rpcmirror-7-4a6njn.t1.p1"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P1` — a sampled read is asked of the node after the reply and a match keeps the account

<a id="req-rpcmirror-7-4a6njn.t1.p2"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P2` — balance, nonce and code reads are sampled as well

<a id="req-rpcmirror-7-4a6njn.t1.p3"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P3` — a sample rate of 0 sends nothing to the node

<a id="req-rpcmirror-7-4a6njn.t1.p4"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P4` — after a mismatch between a cached value and the node the account is read from the node from then on

<a id="req-rpcmirror-7-4a6njn.t1.p5"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P5` — a sampled eth_call is checked against the node and the called account is dropped on a mismatch

<a id="req-rpcmirror-7-4a6njn.t1.p6"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P6` — a client built without a sample rate samples a small fraction of its local answers

<a id="req-rpcmirror-7-4a6njn.t1.p7"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P7` — a dropped account is read from the node after a block writes it and after the service connection comes back

<a id="req-rpcmirror-7-4a6njn.t1.p8"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P8` — a storage read's mismatch is logged with the method, the block hash, the account and the slot, and never with a value

<a id="req-rpcmirror-7-4a6njn.t1.p9"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P9` — a call's mismatch is logged with the call's selector, and never with a value

<a id="req-rpcmirror-7-4a6njn.t1.p10"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P10` — a sampled call the copy returned and the node reverts drops the called account

<a id="req-rpcmirror-7-4a6njn.t1.p11"></a>`REQ-RPCMIRROR-7-4A6NJN.T1.P11` — a mismatch of a sampled call drops the callee it used as well as the called account

#### <a id="req-rpcmirror-8-1pa83t.t1"></a>`REQ-RPCMIRROR-8-1PA83T.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-8-1PA83T`](rpc-mirror.md#req-rpcmirror-8-1pa83t)

**Setup and stimulus:**

Replace a subscription with one covering more accounts and make the old one's unsubscribe fail; make a state fill fail; make the node fail a state read the copy needed. Make the service swallow the replies to each kind of request a read makes, go silent while two reads run, and swallow a pushed record's catch-up while a read waits for the copy; spend half a read's deadline waiting for a block, then withhold the snapshot it waits for.

**Expected result:**

The connection stays open, a warning is logged, and reads continue from the copy; a failed fill is answered by the node; a node that fails a state read ends only that read.

**Required permutations:**

<a id="req-rpcmirror-8-1pa83t.t1.p1"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P1` — a failed unsubscribe of a superseded subscription is logged and keeps the service connection

<a id="req-rpcmirror-8-1pa83t.t1.p2"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P2` — a state fill the service cannot complete is answered by the node

<a id="req-rpcmirror-8-1pa83t.t1.p3"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P3` — a node that fails a state read ends only that read and keeps the service connection and the cache

<a id="req-rpcmirror-8-1pa83t.t1.p4"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P4` — a state read the service never answers is answered by the node within the deadline

<a id="req-rpcmirror-8-1pa83t.t1.p5"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P5` — a subscribe for a newly followed account the service never answers sends the read to the node within the deadline

<a id="req-rpcmirror-8-1pa83t.t1.p6"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P6` — a catch-up that starts following and the service never answers sends the read to the node within the deadline

<a id="req-rpcmirror-8-1pa83t.t1.p7"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P7` — a head read the service never answers is answered by the node within the deadline

<a id="req-rpcmirror-8-1pa83t.t1.p8"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P8` — two concurrent reads while the service is silent are both answered by the node within the deadline

<a id="req-rpcmirror-8-1pa83t.t1.p9"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P9` — a read while a pushed record's catch-up waits on a silent service is answered by the node within its own deadline

<a id="req-rpcmirror-8-1pa83t.t1.p10"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P10` — a read that spent part of its deadline waiting for a block, then waits for a snapshot the service never pushes, is answered by the node within the deadline

<a id="req-rpcmirror-8-1pa83t.t1.p11"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P11` — a local EVM whose start failed is started again by the next call

<a id="req-rpcmirror-8-1pa83t.t1.p12"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P12` — a subscribe refused with the limit error keeps the copy and the connection, and the node answers the read

<a id="req-rpcmirror-8-1pa83t.t1.p13"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P13` — a subscribe refused for naming too many accounts keeps the copy and the connection

<a id="req-rpcmirror-8-1pa83t.t1.p14"></a>`REQ-RPCMIRROR-8-1PA83T.T1.P14` — a pushed record's refused catch-up keeps the copy and the connection, and a later record catches up

#### <a id="req-rpcmirror-9-5vd1gg.t1"></a>`REQ-RPCMIRROR-9-5VD1GG.T1`

**Requirements / invariants:**

[`REQ-RPCMIRROR-9-5VD1GG`](rpc-mirror.md#req-rpcmirror-9-5vd1gg)

**Setup and stimulus:**

Build the provider with an empty service URL; build the exported chain access with an empty service URL and a reachable node behind a proxy; start the runtime chain context with an empty service URL and an unreachable node.

**Expected result:**

Each fails with the missing-setting message. The chain access leaves no socket open at the proxy, and the chain context fails with the message rather than the unreachable node's refusal: no node was opened.

**Required permutations:**

<a id="req-rpcmirror-9-5vd1gg.t1.p1"></a>`REQ-RPCMIRROR-9-5VD1GG.T1.P1` — building the provider without a service URL is refused

<a id="req-rpcmirror-9-5vd1gg.t1.p2"></a>`REQ-RPCMIRROR-9-5VD1GG.T1.P2` — starting the runtime chain context without a service URL is refused before any node is asked

<a id="req-rpcmirror-9-5vd1gg.t1.p3"></a>`REQ-RPCMIRROR-9-5VD1GG.T1.P3` — building the exported chain access without a service URL is refused before any node is asked

### Coverage rule

Every plan item is exercised through the provider's public JSON-RPC surface against a real node and a real service, observing both the answers and the requests each upstream receives. The pure address and code policy has unit cases in the implementation layer.

## Future Work

_Non-normative._ A feed other than the service's socket (for example gossip between peers) and proofs for mirrored state.
