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
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P11` — console libraries reached through an import are reported once per contract and console source; a non-console source under a `console` directory is not reported
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P12` — a console import in an explicitly exempt local-only contract is accepted
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P13` — forge-std console is reported under its library-path and package source names
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P14` — a console name nested under another path or extended past `.sol` is not reported
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P15` — the real compiler metadata of a compiled contract that reaches the console library through an import is reported once its exemption is removed
- [x] `UNIT-TEST-CONTRACT-SIZE-1-MX797V.P16` — an exempt compiled contract whose real compiler metadata lists the console library is skipped
