# TimeoutStorage.test.ts

Test file: [test/unit/TimeoutStorage.test.ts](../../../../../../test/unit/TimeoutStorage.test.ts)
Exercises: [TimeoutStorage.ts](../../../../implementation/source/src/storage/TimeoutStorage.ts.md)

## Overview

Pure data-structure suite — no harness session. Constructs `TimeoutStorage` directly and drives it
with real `TimeoutStruct` values taken from the `dispute()` factory and real wallet addresses from
`randomAddress()`, so every candidate could have been submitted as-is. The suite covers the
identity-matched drop a posted-calldata refusal performs: the refused candidate is removed, while a
forced candidate stored over the same slot, a candidate at another height, and a candidate for
another participant at the same height all survive. Lowest-height retention itself is exercised by
the producing timeout suites.

## Tests

A row lists only test IDs this test covers **in full** — partial credit is never recorded.

- `deleteTimeout with the stored plain timeout → removed`: REQ-TOSTORE-2-WX7VMH.T1.P1, UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P6
- `a forced timeout stored over the plain one at the same height → survives deleteTimeout`: REQ-TOSTORE-2-WX7VMH.T1.P2, UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P7
- `deleteTimeout at another height → the stored plain timeout stays`: REQ-TOSTORE-2-WX7VMH.T1.P3, UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P8
- `a plain timeout for another participant at the same height → survives deleteTimeout`: REQ-TOSTORE-2-WX7VMH.T1.P4, UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P9
