# errorMessage.ts

> **Source:** [errorMessage.ts](../../../../../../src/utils/errorMessage.ts)

## Requirements

- [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)
- [`REQ-RUNTIME-9-P5VPT5` (An uncaught non-error failure is reported as one error)](../../../../specification/runtime/execution.md#req-runtime-9-p5vpt5)

## UNIT-TEST-ERROR-MESSAGE-32-X678KX

Error text coercion

- Setup: Call the leaf helpers with Error and non-Error inputs; compare exact message or String conversion, including empty strings and custom conversion, and a value String() cannot convert.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P1` — formats Error
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P2` — formats empty Error
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P3` — formats string
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P4` — formats null
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P5` — formats undefined
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P6` — formats number
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P7` — formats symbol
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P8` — formats custom conversion
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P9` — `valueText` converts a value String() converts
- [x] `UNIT-TEST-ERROR-MESSAGE-32-X678KX.P10` — `valueText` names a value String() cannot convert by its object tag
