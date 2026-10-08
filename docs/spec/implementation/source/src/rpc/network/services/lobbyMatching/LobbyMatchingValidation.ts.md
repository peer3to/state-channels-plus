# LobbyMatchingValidation.ts

> **Source:** [LobbyMatchingValidation.ts](../../../../../../../../../src/rpc/network/services/lobbyMatching/LobbyMatchingValidation.ts#L1)
>
> **Design views:** [components.md](../../../../../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-LOBBY-9-N894C0` (Bounded inactive ingress and cleanup)](../../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)

## UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R

Match timeout validation

- Setup: Invoke validateMatchTimeout directly; null/omitted and safe positive integers pass, zero/negative/fractional/unsafe/nonfinite values throw the exact existing message.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P1` — accepts omitted timeout
- [x] `UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P2` — accepts null timeout
- [x] `UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P3` — accepts positive integer timeout
- [x] `UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P4` — accepts largest safe timeout
- [x] `UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P5` — rejects zero timeout
- [x] `UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P6` — rejects negative timeout
- [x] `UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P7` — rejects fractional timeout
- [x] `UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P8` — rejects unsafe timeout
- [x] `UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P9` — rejects infinite timeout
- [x] `UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P10` — rejects NaN timeout
