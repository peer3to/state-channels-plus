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
