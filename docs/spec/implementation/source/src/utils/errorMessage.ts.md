# errorMessage.ts

> **Source:** [errorMessage.ts](../../../../../../src/utils/errorMessage.ts#L1)
>
> **Design views:** [components.md](../../../views/architecture/sdk/components.md)

## Requirements

- [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)

## UNIT-TEST-ERROR-MESSAGE-32-X678KX

Error text coercion

- Setup: Call the leaf helper with Error and non-Error inputs; compare exact message or String conversion, including empty strings and custom conversion.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P1` — formats Error
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P2` — formats empty Error
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P3` — formats string
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P4` — formats null
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P5` — formats undefined
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P6` — formats number
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P7` — formats symbol
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P8` — formats custom conversion
