# ObjectChecks.test.ts

Test file: [test/utils/ObjectChecks.test.ts](../../../../../../test/utils/ObjectChecks.test.ts)
Exercises: [ObjectChecks.ts](../../../../implementation/source/src/utils/ObjectChecks.ts.md)

## Overview

The suite drives every public predicate directly. It covers own, application-inherited, and
Object-prototype properties and methods; callable accessors; accessor and proxy-trap error
propagation; missing, non-callable, null, primitive, and function-valued boundaries; every required
RPC-service member and value kind; and every ethers Result array/method branch. Cross-module
constructor independence stays in `CrossModuleValues.test.ts`, so compatible cross-graph
permutations remain assigned there without duplicate evidence.

## Tests

- `recognizes own and inherited properties on object values`: UNIT-TEST-OBJECT-CHECKS-2-VMPCB5.P1
- `rejects missing properties and non-object values`: UNIT-TEST-OBJECT-CHECKS-2-VMPCB5.P2
- `recognizes callable own properties`: UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P1
- `recognizes callable inherited properties`: UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P2
- `recognizes Object prototype methods as structural methods`: UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P9
- `evaluates callable accessors during method checks`: UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P10
- `propagates accessor and proxy trap failures`: UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P11, UNIT-TEST-OBJECT-CHECKS-2-VMPCB5.P3
- `rejects non-functions, missing methods, and non-object values`: UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P3
- `accepts a complete RPC service shape`: none
- `rejects a missing, null, primitive, or function-valued RPC service`: UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P1
- `rejects missing and non-callable createRPCMethods members`: UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P2
- `rejects missing, null, primitive, and function router members`: UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P3
- `rejects missing and non-callable runRPC members`: UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P4
- `accepts an array with the complete ethers Result API`: none
- `rejects non-array values even when they expose Result methods`: UNIT-TEST-OBJECT-CHECKS-4-NVX8KE.P1
- `rejects arrays missing each required Result method`: UNIT-TEST-OBJECT-CHECKS-4-NVX8KE.P2
- `rejects arrays with non-callable Result methods`: UNIT-TEST-OBJECT-CHECKS-4-NVX8KE.P3
