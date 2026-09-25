# BlockIngestService.ts

> **Source:** [src/stateManager/ingest/BlockIngestService.ts](../../../../../../../src/stateManager/ingest/BlockIngestService.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-BLOCK-PIPE-4-CF52J6` (Recovery without bypass)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6)
- [`REQ-BLOCK-PIPE-3-WW2SB7` (Strategy-complete deviations)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)

## UNIT-TEST-BLOCK-INGEST-1-JV64AS

Origin-aware execution

- Setup: Hand confirmations to the boundary from the network path and as a synchronization replay
- Oracle: The replayed entry carries its origin and the subjective window is skipped for it; the live entry parks

- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P1` — a confirmation replayed from a verified proof outside the agreement window applies while the same live arrival parks
- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P2` — a confirmation carrying an on-chain timestamp is recorded on the stored block, observed once the store holds the timestamp
- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P3` — fresh signer validation reads the resulting participant union before persisting the snapshot
- [x] `UNIT-TEST-BLOCK-INGEST-1-JV64AS.P4` — the same confirmation ingested twice → accepted, signatures unchanged
