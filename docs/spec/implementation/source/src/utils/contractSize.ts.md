# contractSize.ts

> **Source:** [src/utils/contractSize.ts](../../../../../../src/utils/contractSize.ts)

## Requirements

- [`REQ-CONTRACT-SIZE-1-881Q6E` (Deployment size enforcement)](../../../../specification/enforcement/contracts.md#req-contract-size-1-881q6e)

## UNIT-TEST-CONTRACT-SIZE-1-MX797V

Contract-size policy

- Setup: Scan real artifacts, including the source files each contract's compiler metadata lists, and exercise exact synthetic boundaries and synthetic source lists.
- Oracle: Production artifacts fit and compile in no development console library, malformed artifacts, oversize values and console imports fail with structured details, and exemptions remain exact.

- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P1` — all production artifacts
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P2` — runtime boundary
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P3` — initcode boundary
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P4` — constructor arguments
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P5` — missing required field
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P6` — exact exemption recognition
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P7` — stale exemption rejection
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P8` — structured violation details
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P9` — aggregate runtime and initcode violations in one result
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P10` — no production artifact compiles in a development console library
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P11` — Hardhat and forge-std console libraries reached through an import are reported per contract; a non-console source under a `console` directory is not
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P12` — a console import in an explicitly exempt local-only contract is accepted
