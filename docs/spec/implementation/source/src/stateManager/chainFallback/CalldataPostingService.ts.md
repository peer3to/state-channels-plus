# CalldataPostingService.ts

> **Source:** [src/stateManager/chainFallback/CalldataPostingService.ts](../../../../../../../src/stateManager/chainFallback/CalldataPostingService.ts)
>
> **Design views:** [Block confirmation pipeline](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-DA-1-NVV85Z` (Block data whose calldata commitment is posted MUST be recoverable from the…)](../../../../../specification/security/data-availability.md#req-da-1-nvv85z)

## UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419

Conditional publication and receipt recovery

- Setup: Real session; invoke maybePostBlockOnChain with stored or absent block
- Oracle: Post only when signatures are incomplete; handled receipt failures do not escape through diagnostic collection

- [x] `UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P1` — fully signed block posts nothing
- [x] `UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P2` — missing block is a no-op
- [x] `UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P3` — incomplete agreement publishes calldata
- [x] `UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P4` — expired deadline at the mined receipt is handled before detached collection
