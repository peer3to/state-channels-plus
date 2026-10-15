# BlockIngestService.ts

> **Source:** [src/stateManager/ingest/BlockIngestService.ts](../../../../../../../src/stateManager/ingest/BlockIngestService.ts)

## Requirements

- [`REQ-BLOCK-PIPE-1-SS24D1` (Unified work item)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-1-ss24d1)
- [`REQ-BLOCK-PIPE-4-CF52J6` (Recovery without bypass)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6)
- [`REQ-BLOCK-PIPE-3-WW2SB7` (Strategy-complete deviations)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)
- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
- [`REQ-MSGSTORE-1-6ME9D7` (Content-addressed store with tip tracking)](../../../../../specification/storage/message-blocks.md#req-msgstore-1-6me9d7)

## UNIT-TEST-BLOCK-INGEST-1-JV64AS

Origin-aware execution

- Setup: Hand confirmations to the boundary from the network path and as a synchronization replay
- Oracle: The replayed entry carries its origin and the subjective window is skipped for it; the live entry parks

- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P1` — a confirmation replayed from a verified proof outside the agreement window applies while the same live arrival parks
- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P2` — a confirmation carrying an on-chain timestamp is recorded on the stored block, observed once the store holds the timestamp
- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P3` — fresh signer validation reads the resulting participant union before persisting the snapshot
- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P4` — the same confirmation ingested twice → accepted, signatures unchanged
- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P5` — the validation context is resolved from the work item after the state mutex is held, so a chain-committed entry is judged in the chain-committed context
- [ ] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P6` — `onBlockConfirmationStruct` with bytes `Codec` cannot decode returns the strategy's `authenticateBlockFailed` verdict without throwing, executes nothing, and cuts no peer
- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P8` — under the dispute strategy, a replayed block whose bytes do not decode and whose state-proof structure is valid returns `true` with no proof, without throwing
- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P9` — a block one peer's local EVM refuses to run (call gas below the transition's requirement) throws out of that peer's ingest with no invalid-transition hook, no fraud proof, no dispute, no cut sender, and the turn and height unchanged, while a peer whose local EVM funds the transition commits it
- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P10` — A tail with forged resulting snapshot fails replay; the audit stores the wrapped transition counter at its last-milestone index, stores neither failed block nor snapshot, and a second audit rejects again with one counter
- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P11` — A failing tail block also appearing as earlier milestone support still fails actual tail replay at its last-milestone position; the wrapped counter is stored and the failed block is absent
- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P12` — An injected internal failure on the second dispute-replay tail block throws without a counter; the failed block is absent while the earlier successful block and its full state remain stored

## UNIT-TEST-BLOCK-INGEST-2-8ZE5Z8

Carried inbound run storage

- Setup: Commit blocks whose carried inbound run is anchored at the store's tip, at an unheld hash, and at a held hash that sits above a gap
- Oracle: Every carried run is persisted; the store tip moves with the snapshot only when the run's anchor is the store's tip

- [x] `UNIT-TEST-BLOCK-INGEST-2-8ZE5Z8.P1` — a committed block's carried inbound run, anchored at the previous snapshot's inbound hash, moves the store tip with the snapshot when that hash is the store's tip
- [x] `UNIT-TEST-BLOCK-INGEST-2-8ZE5Z8.P2` — a committed block's carried inbound run whose anchor is not the store's tip, first unheld and then held above a gap, is persisted each time and sets no tip
