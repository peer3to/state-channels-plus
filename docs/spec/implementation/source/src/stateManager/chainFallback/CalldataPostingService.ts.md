# CalldataPostingService.ts

> **Source:** [src/stateManager/chainFallback/CalldataPostingService.ts](../../../../../../../src/stateManager/chainFallback/CalldataPostingService.ts)

## Requirements

- [`REQ-DA-1-NVV85Z` (Block data whose calldata commitment is posted MUST be recoverable from the…)](../../../../../specification/security/data-availability.md#req-da-1-nvv85z)
- [`REQ-PROOFSTORE-8-R38KY5` (History pruning)](../../../../../specification/storage/proof-store.md#req-proofstore-8-r38ky5)

## UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419

Conditional publication and receipt recovery

- Setup: Real session; invoke maybePostBlockOnChain with stored or absent block, also, with pruning on, the author's final-point block whose block below is deleted
- Oracle: Post only when signatures are incomplete and the block below is held; handled receipt failures do not escape through diagnostic collection; no call fails

- [x] `UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P1` — fully signed block posts nothing
- [x] `UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P2` — missing block is a no-op
- [x] `UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P3` — incomplete agreement publishes calldata
- [x] `UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P4` — expired deadline at the mined receipt is handled before detached collection
- [x] `UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P5` — pruning on, a fully signed final-point block whose block below is deleted: nothing posted, no failure
- [x] `UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P6` — pruning on, a final-point block one signature short whose block below is deleted: nothing posted, no failure
