# planKillDelivery.ts

> **Source:** [src/disputeManager/planKillDelivery.ts](../../../../../../src/disputeManager/planKillDelivery.ts)

## Requirements

- [`REQ-FP-7-4DD0D7` (A valid dispute fraud proof applied within the kill period kills the committed…)](../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7)

## UNIT-TEST-PLAN-KILL-DELIVERY-1-CRTBS6

The kill-delivery plan follows the calldata sizes of the kill alone and of the kill-and-upload multicall against the per-transaction limit.

- Setup: Call `planKillDelivery` with kill and multicall sizes below, exactly at, and one byte over a 65,536-byte limit
- Oracle: The returned `KillDelivery` value: `InMulticall`, `Alone`, or `NotSent`

- [x] `UNIT-TEST-PLAN-KILL-DELIVERY-1-CRTBS6.P1` — kill and multicall both below the limit: `InMulticall`
- [x] `UNIT-TEST-PLAN-KILL-DELIVERY-1-CRTBS6.P2` — multicall exactly at the limit: still `InMulticall`
- [x] `UNIT-TEST-PLAN-KILL-DELIVERY-1-CRTBS6.P3` — multicall one byte over the limit, kill below it: `Alone`
- [x] `UNIT-TEST-PLAN-KILL-DELIVERY-1-CRTBS6.P4` — kill alone exactly at the limit, multicall over it: `Alone`
- [x] `UNIT-TEST-PLAN-KILL-DELIVERY-1-CRTBS6.P5` — kill alone one byte over the limit: `NotSent`
