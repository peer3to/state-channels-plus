# LobbyMatchingValidation.test.ts

Test file: [LobbyMatchingValidation.test.ts](../../../../../../../test/rpc/lobbyMatching/LobbyMatchingValidation.test.ts)
Exercises: [LobbyMatchingValidation.ts.md](../../../../../implementation/source/src/rpc/network/services/lobbyMatching/LobbyMatchingValidation.ts.md)

## Overview

Invoke validateMatchTimeout directly; null/omitted and safe positive integers pass, zero/negative/fractional/unsafe/nonfinite values throw the exact existing message.

## Tests

- `accepts omitted timeout`: UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P1
- `accepts null timeout`: UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P2
- `accepts positive integer timeout`: UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P3
- `accepts largest safe timeout`: UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P4
- `rejects zero timeout`: UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P5
- `rejects negative timeout`: UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P6
- `rejects fractional timeout`: UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P7
- `rejects unsafe timeout`: UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P8
- `rejects infinite timeout`: UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P9
- `rejects NaN timeout`: UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P10
