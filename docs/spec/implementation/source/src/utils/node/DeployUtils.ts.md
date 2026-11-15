# DeployUtils.ts

> **Source:** [src/utils/node/DeployUtils.ts](../../../../../../../src/utils/node/DeployUtils.ts)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-DEPLOY-UTILS-1-YZSHSA

`deployAsync` deploys within the chain's per-transaction gas cap and records the deploy

- Setup: `deployAsync` on the test chain for the largest routed facet (`DisputeFraudProofFacet`) into a contracts file that does not exist yet, and for `UtilityFacet` into a contracts file that already holds another entry
- Oracle: The deploy is mined with a gas limit at or below `MAX_TX_GAS` and code at the returned address; the contracts file holds the contract's address and ABI under its name, beside every entry it held before

- [x] `UNIT-TEST-DEPLOY-UTILS-1-YZSHSA.P1` — the largest facet deploys within the per-transaction cap and a new contracts file records it
- [x] `UNIT-TEST-DEPLOY-UTILS-1-YZSHSA.P2` — an existing contracts file keeps its entries beside the new deploy
