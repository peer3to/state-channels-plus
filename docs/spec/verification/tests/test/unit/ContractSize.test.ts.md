# ContractSize.test.ts

Test file: [test/unit/ContractSize.test.ts](../../../../../../test/unit/ContractSize.test.ts)
Exercises: [contractSize.ts](../../../../implementation/source/src/utils/contractSize.ts.md)

## Overview

Nine direct cases scan all compiled production artifacts, exercise both exact EIP boundaries,
count constructor data, reject a missing required field, and keep the local/test exemption list
exact. A synthetic two-contract case proves runtime and initcode violations are returned together
so one oversize contract cannot hide another.

## Tests

- `keeps every compiled production artifact within both deployment limits`: UNIT-TEST-CONTRACT-SIZE-1-MX797V.P1, REQ-CONTRACT-SIZE-1-881Q6E.T1.P1
- `reports every production violation in one result`: UNIT-TEST-CONTRACT-SIZE-1-MX797V.P9
- `accepts 24,576 runtime bytes and rejects 24,577`: UNIT-TEST-CONTRACT-SIZE-1-MX797V.P2, REQ-CONTRACT-SIZE-1-881Q6E.T1.P2
- `accepts 49,152 initcode bytes and rejects 49,153`: UNIT-TEST-CONTRACT-SIZE-1-MX797V.P3, REQ-CONTRACT-SIZE-1-881Q6E.T1.P3
- `counts constructor arguments in full deployment initcode`: UNIT-TEST-CONTRACT-SIZE-1-MX797V.P4, REQ-CONTRACT-SIZE-1-881Q6E.T1.P4
- `rejects an artifact missing deployedBytecode as invalid`: UNIT-TEST-CONTRACT-SIZE-1-MX797V.P5, REQ-CONTRACT-SIZE-1-881Q6E.T1.P5
- `recognizes every explicit local or test-only exemption`: UNIT-TEST-CONTRACT-SIZE-1-MX797V.P6, REQ-CONTRACT-SIZE-1-881Q6E.T1.P6
- `rejects stale contract-size exemptions`: UNIT-TEST-CONTRACT-SIZE-1-MX797V.P7, REQ-CONTRACT-SIZE-1-881Q6E.T1.P7
- `reports contract name, measured bytes, limit, and excess`: UNIT-TEST-CONTRACT-SIZE-1-MX797V.P8, REQ-CONTRACT-SIZE-1-881Q6E.T1.P8
