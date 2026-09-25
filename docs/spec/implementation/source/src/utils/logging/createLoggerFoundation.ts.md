# createLoggerFoundation.ts

> **Source:** [createLoggerFoundation.ts](../../../../../../../src/utils/logging/createLoggerFoundation.ts#L1)
>
> **Design views:** [components.md](../../../../views/architecture/sdk/components.md)

## Requirements

- [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)

## UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC

Logger foundation options

- Setup: Build real stores under temporary config values; inspect defaults, explicit false, uploader options, disabled storage, fallback size and distinct instances.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P1` — uses config defaults and allocates a distinct store per call
- [x] `UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P2` — preserves explicit false and uploader options
- [x] `UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P3` — disables storage when upload is disabled
- [x] `UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P4` — uses the default store size for zero configuration
