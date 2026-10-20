# EventHandler.ts

> **Source:** [src/eventHandlers/EventHandler.ts](../../../../../../src/eventHandlers/EventHandler.ts)

## Requirements

- [`REQ-SDK-ARCH-1-7H14H6` (Explicit ownership)](../../../../specification/runtime/sdk.md#req-sdk-arch-1-7h14h6)
- [`REQ-DISPUTE-PIPE-1-HRBFP7` (Bound intake)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7)
- [`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)
- [`REQ-MIRROR-2-E9F3TM` (Unconditional replication)](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)
- [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)
- [`REQ-LIF-7-0XZBDM` (A committed dispute suspends off-chain execution on the disputed fork)](../../../../specification/settlement/lifecycle.md#req-lif-7-0xzbdm)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-DISPUTE-PIPE-3-PHE3SQ` (Deterministic reduction)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
- [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)

## UNIT-TEST-EVENT-HANDLER-1-RZ2C7W

Dispute-event branches

- Setup: Deliver committed/killed/slashed/reduced events across final/expired/auditable, relevant/irrelevant, duplicate, and race cases
- Oracle: Branches per the pipeline algorithm; replication precedes action; improvement rule uploads only outcome-changers; challenges fire on mismatched reductions

- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P1` — final branch
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P2` — dedup
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P3` — relevance gate
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P4` — improvement uploads
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P5` — kill→replacement first-wins
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P6` — adopt matching reduction
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P7` — expired branch
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P8` — auditable branch
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P9` — non-improvement skips upload
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P10` — challenge mismatched reduction
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P11` — improvement upload skipped as already initiated: reduction still scheduled
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P12` — A disconnected spectator observes a committed dispute and successor fork without invoking the first local or chain audit predicate or storing a dispute counter, while a participant audits the same dispute
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P18` — A pending joiner whose uncertain join can still land handles a snapshot event that does not list it: it stays PENDING_PARTICIPANT and its join stays pending.
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P19` — a snapshot applied while the local diamond's pending set lists the signer answers the pending check without a chain read
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P20` — a snapshot applied while the local diamond misses the signer's JOIN reads the chain's pending set once
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P21` — a snapshot the local diamond drops as older than the mirrored one updates no membership
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P22` — a non-disputer auditing an invalid dispute builds its state proof once, during the audit, and its kill-and-dispute reuses it and lands
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P23` — the state proof built during the audit fails: the kill-and-dispute builds its own and lands
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P24` — a peer that already disputed audits an invalid dispute: no state proof is built and its kill goes out alone and lands
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P25` — a non-disputer auditing a valid dispute below its own view builds its state proof once, during the audit, and both the evidence comparison and its own upload reuse it
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P26` — a dispute log recovered for a fork the node already left: its confirmation is stored and no audit runs
