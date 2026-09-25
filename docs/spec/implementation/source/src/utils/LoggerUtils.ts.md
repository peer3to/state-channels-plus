# LoggerUtils.ts

> **Source:** [src/utils/LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts)
>
> **Design views:** [architecture/sdk/components.md](../../../views/architecture/sdk/components.md)

No specified behavior: Structured-log formatting helpers (dispute/auditing metadata projections, hash formatting).

## UNIT-TEST-LOGGER-UTILS-32-WMBBZA

Enum and failed time metadata

- Setup: Use a real logger store and captured time; inspect exact enum output, severity, message and metadata including optional prior timestamps.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P1` — formats known and unknown numeric enum members without changing strings
- [x] `UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P2` — logs objective time failure using captured time and previous timestamps
- [x] `UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P3` — omits previous timestamp fields for subjective time failures

## UNIT-TEST-LOGGER-UTILS-33-A11YBZ

Contract-call metadata names its selector

- Setup: Call `getContractCallMetadata` with calldata for a function the SDK contract surface declares, for one it does not, and for data too short to hold a selector at all.
- Oracle: The returned selector, function name and calldata length; no other metadata field changes, and no input throws.

- [x] `UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P1` — undeclared selector is reported as its own hex
- [x] `UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P2` — declared selector is reported by name
- [x] `UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P3` — calldata shorter than a selector is returned unchanged and does not throw
