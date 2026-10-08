# BlockIngestService.ts

> **Source:** [src/stateManager/ingest/BlockIngestService.ts](../../../../../../../src/stateManager/ingest/BlockIngestService.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-BLOCK-PIPE-4-CF52J6` (Recovery without bypass)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6)
- [`REQ-BLOCK-PIPE-3-WW2SB7` (Strategy-complete deviations)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)
- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
  Partial: The block is decoded client-side with `Codec`, not at parity with the contracts' decoder ([`FIND-DECODE-1-FD1V6V`](../../../../../audit/open-findings.md#find-decode-1-fd1v6v)).

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
