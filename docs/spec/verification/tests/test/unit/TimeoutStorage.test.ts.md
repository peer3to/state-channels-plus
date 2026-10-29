# TimeoutStorage.test.ts

Test file: [test/unit/TimeoutStorage.test.ts](../../../../../../test/unit/TimeoutStorage.test.ts)
Exercises: [TimeoutStorage.ts](../../../../implementation/source/src/storage/TimeoutStorage.ts.md)

## Overview

Pure data-structure suite — no harness session. Constructs `TimeoutStorage` directly and drives it
with real `TimeoutStruct` values taken from the `dispute()` factory and real wallet addresses from
`randomAddress()`, so every candidate could have been submitted as-is. The suite covers the newest
candidate store: a later store at a higher height replaces a stale lower one, an equal-height store
refreshes the candidate, and forks are independent. It also covers the identity-matched drop a
posted-calldata refusal performs: the refused candidate is removed, while a forced candidate stored
over the same slot, a candidate at another height, and a candidate for another participant at the
same height all survive. The end-to-end case — a stale candidate for a passed height does not block
the next-height timeout dispute — is in
[ParticipantTimeoutService](ParticipantTimeoutService.test.ts.md).

## Tests

- `a store at a higher height → replaces the stale lower timeout`: REQ-TOSTORE-3-H0MH84.T1.P1, UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P1
- `a store at the same height → refreshes the stored timeout`: REQ-TOSTORE-3-H0MH84.T1.P2, UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P2
- `a store on another fork → leaves this fork's timeout`: REQ-TOSTORE-3-H0MH84.T1.P3, UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P3
- `deleteTimeout with the stored plain timeout → removed`: REQ-TOSTORE-2-WX7VMH.T1.P1, UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P4
- `a forced timeout stored over the plain one at the same height → survives deleteTimeout`: REQ-TOSTORE-2-WX7VMH.T1.P2, UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P5
- `deleteTimeout at another height → the stored plain timeout stays`: REQ-TOSTORE-2-WX7VMH.T1.P3, UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P6
- `a plain timeout for another participant at the same height → survives deleteTimeout`: REQ-TOSTORE-2-WX7VMH.T1.P4, UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P7
