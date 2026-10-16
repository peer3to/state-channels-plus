# SnapshotUpdateService.ts

> **Source:** [src/stateManager/snapshotUpdate/SnapshotUpdateService.ts](../../../../../../../src/stateManager/snapshotUpdate/SnapshotUpdateService.ts)

## Requirements

- [`REQ-DIS-9-64WHCD` (The on-chain snapshot advances to a successor fork only along committed…)](../../../../../specification/disputes/disputes.md#req-dis-9-64whcd)
- [`REQ-ENFSNAP-3-VD9T8A` (Inbound-consumption gate)](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-3-vd9t8a)
- [`REQ-IX-6-A4Y7KB` (Snapshot adoption and outbound processing)](../../../../../specification/interactions.md#req-ix-6-a4y7kb)
- [`REQ-MSG-5-5XB7DB` (Catch-up MUST be batchable into smaller ranges with identical results)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-5-5xb7db)
- [`REQ-MSG-7-Q40Q3R` (Same-fork advance MUST consume all pending inbound messages)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-7-q40q3r)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
- [`REQ-SP-8-9ZCCEJ` (Construct proofs from the mirrored chain anchor, which may lag the chain but…)](../../../../../specification/disputes/state-proofs.md#req-sp-8-9zccej)

## UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N

Walk, gates, and submission

- Setup: Advance across zero/one/multiple generations, unresolved disputes, and consumed/unconsumed inbound heads
- Oracle: Correct link chains and ranges; a fork walk that waits for a reduction (on chain, or a final reduced fork this node has not installed yet) produces no transaction; an admissible submission lands and the post resolves with the snapshot it posted; a post with nothing admissible to send resolves undefined; a closed channel (no chain snapshot) prepares nothing and reads no local history; a chain revert rejects the post with its custom error and changes no snapshot

- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P1` — multi-generation walk
- [ ] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P2` — range boundary at processed tip
- [ ] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P3` — same-fork chain
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P4` — already-current no-op
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P5` — admissible prepared snapshot is submitted
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P6` — unresolved current dispute blocks fork calldata and submission
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P7` — an unconsumed inbound head makes the same-fork post revert with `RaceConditionPendingInboundNotConsumed`; the service runs no inbound pre-check
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P8` — a post while inbound remains unconsumed rejects and does not change the on-chain snapshot
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P9` — a dispute committed between preparation and send makes the chain refuse the post on the disputed fork and `postStateSnapshotWait` reject with `RaceConditionSnapshotUpdateDisputedFork`
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P10` — Unconsumed inbound messages make postStateSnapshotWait reject with `RaceConditionPendingInboundNotConsumed` and leave the chain snapshot unchanged
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P12` — A final first block with later unfinalized tail yields update calldata only for that finalized snapshot; posting sends updateStateSnapshotSameFork and chain adopts it
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P13` — Sufficient direct finality at the last milestone first block yields update calldata and chain adoption of that snapshot
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P14` — With no finalized block, finalized-only evidence is empty genesis, snapshot preparation has no calldata/target, and posting resolves without a send or anchor change
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P15` — A threshold-final block zero yields one-block update evidence and replaces genesis with its resulting snapshot even though both have numeric height zero
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P16` — An unfinalized block zero yields no update target/calldata; posting resolves with zero sends and unchanged genesis anchor
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P17` — When the only final point is the current anchor and all later blocks are unfinalized, snapshot preparation has no target/calldata and posting sends nothing or changes no anchor
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P18` — Overlapping join support and a later finalized point remain separate milestones in finalized-only update evidence; the submitted update adopts the later point, not the join block
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P19` — a mined post resolves with the snapshot it posted: its hash is the chain's new snapshot hash and its participants are the chain snapshot's participants
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P20` — a post with no admissible calldata resolves with `undefined`, not a snapshot
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P21` — a walk that reaches a final reduced fork whose genesis this node has not installed yet waits for its own reduction: no fork calldata, and the post resolves `undefined` without throwing
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P22` — after that reduction installs, the next post sends one fork update and the chain snapshot moves to the reduced fork
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P23` — once a zero-participant close deleted the chain snapshot, the same-fork preparation returns no calldata with `canPost` false, builds no state proof and reads no local outbound block, and the post resolves `undefined`
