# contractSize.ts

> **Source:** [src/utils/contractSize.ts](../../../../../../src/utils/contractSize.ts)

## Requirements

- [`REQ-CONTRACT-SIZE-1-881Q6E` (Deployment size enforcement)](../../../../specification/enforcement/contracts.md#req-contract-size-1-881q6e)
  Missing: the scan checks bytecode sizes only and does not reject a development console import ([`FIND-CONTRACT-DEVLOG-1-S97S2H`](../../../../audit/open-findings.md#find-contract-devlog-1-s97s2h)).

## UNIT-TEST-CONTRACT-SIZE-1-MX797V

Contract-size policy

- Setup: Scan real artifacts and exercise exact synthetic boundaries.
- Oracle: Production artifacts fit, malformed artifacts and oversize values fail with structured details, and exemptions remain exact.

- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P1` — all production artifacts
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P2` — runtime boundary
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P3` — initcode boundary
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P4` — constructor arguments
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P5` — missing required field
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P6` — exact exemption recognition
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P7` — stale exemption rejection
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P8` — structured violation details
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P9` — aggregate runtime and initcode violations in one result
