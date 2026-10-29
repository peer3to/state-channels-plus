# errorMessage.test.ts

Test file: [errorMessage.test.ts](../../../../../../test/utils/errorMessage.test.ts)
Exercises: [errorMessage.ts.md](../../../../implementation/source/src/utils/errorMessage.ts.md)

## Overview

Call the leaf helpers with Error and non-Error inputs; compare exact message or String conversion, including empty strings and custom conversion, and a null-prototype object that `String()` cannot convert.

## Tests

- `formats Error`: UNIT-TEST-ERROR-MESSAGE-32-X678KX.P1
- `formats empty Error`: UNIT-TEST-ERROR-MESSAGE-32-X678KX.P2
- `formats string`: UNIT-TEST-ERROR-MESSAGE-32-X678KX.P3
- `formats null`: UNIT-TEST-ERROR-MESSAGE-32-X678KX.P4
- `formats undefined`: UNIT-TEST-ERROR-MESSAGE-32-X678KX.P5
- `formats number`: UNIT-TEST-ERROR-MESSAGE-32-X678KX.P6
- `formats symbol`: UNIT-TEST-ERROR-MESSAGE-32-X678KX.P7
- `formats custom conversion`: UNIT-TEST-ERROR-MESSAGE-32-X678KX.P8
- `valueText converts a value String() converts`: UNIT-TEST-ERROR-MESSAGE-32-X678KX.P9
- `valueText names a value String() cannot convert by its object tag`: UNIT-TEST-ERROR-MESSAGE-32-X678KX.P10
