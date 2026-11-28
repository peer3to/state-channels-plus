# ChainSignerService.ts

> **Source:** [src/rpc/internal/services/chainSigner/ChainSignerService.ts](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-SDK-ARCH-6-8DE4ER` (Chain spending is observable)](../../../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er)

## UNIT-TEST-GAS-USAGE-READ-SETTLE-1-04CYEA

Settle bound of a gas-usage read that answers a request

- Setup: `Clock.init` on a private chain mined 2 s or 12 s apart, then `gasUsageReadSettleMs` with a 30 s request timeout or none
- Oracle: `GAS_USAGE_SETTLE_BLOCKS` (3) at the measured block time, capped at half the request timeout when there is one

- [x] `UNIT-TEST-GAS-USAGE-READ-SETTLE-1-04CYEA.P1` — three blocks at the measured block time fit half the request timeout
- [x] `UNIT-TEST-GAS-USAGE-READ-SETTLE-1-04CYEA.P2` — three blocks longer than half the request timeout are capped at it
- [x] `UNIT-TEST-GAS-USAGE-READ-SETTLE-1-04CYEA.P3` — a request with no timeout waits the full three blocks
