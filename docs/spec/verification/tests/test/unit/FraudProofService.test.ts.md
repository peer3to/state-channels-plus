# FraudProofService.test.ts

Test file: [test/unit/FraudProofService.test.ts](../../../../../../test/unit/FraudProofService.test.ts)
Exercises: [FraudProofService.ts](../../../../implementation/source/src/stateManager/utils/FraudProofService.ts.md)

## Overview

Starts three participants, lets the leader author its next block off the wire, and moves that
block's predecessor from the observer's history into retained evidence. It then builds the
invalid-transition proof of a forged next block on the observer host and checks that no error is
thrown and that the proof is stored against the forged block's author.

## Tests

- `an invalid block whose predecessor is held only as retained proof evidence → the invalid-transition proof is built from that retained block`: REQ-SP-11-535J0R.T1.P33, UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P6
