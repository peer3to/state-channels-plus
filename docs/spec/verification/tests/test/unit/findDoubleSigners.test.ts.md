# findDoubleSigners.test.ts

Test file: [test/unit/findDoubleSigners.test.ts](../../../../../../test/unit/findDoubleSigners.test.ts)
Exercises: [findDoubleSigners.ts](../../../../implementation/source/src/stateManager/utils/findDoubleSigners.ts.md)

## Overview

Builds real blocks signed by random wallets and calls `findDoubleSigners` on pairs of them. Checks that only the signers of both of two different blocks at one height are returned, never the own address, none for two heights or one block met twice, and that a rejected confirmation names nobody.

## Tests

- `two different blocks at one height → exactly the signers of both, author or co-signer; a signer of one block only is not one`: UNIT-TEST-FIND-DOUBLE-SIGNERS-1-0C2TWH.P1
- `the own address signed both blocks → it is not returned`: UNIT-TEST-FIND-DOUBLE-SIGNERS-1-0C2TWH.P2
- `the same signers on blocks at two heights → none`: UNIT-TEST-FIND-DOUBLE-SIGNERS-1-0C2TWH.P3
- `one block met twice, with more confirmations on one copy → none`: UNIT-TEST-FIND-DOUBLE-SIGNERS-1-0C2TWH.P4
- `a confirmation that recovers no signer on one block → it names nobody and the real signers of both are still found`: UNIT-TEST-FIND-DOUBLE-SIGNERS-1-0C2TWH.P5
