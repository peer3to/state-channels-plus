# DisputeFraudProofStorage.test.ts

Test file: [test/storage/DisputeFraudProofStorage.test.ts](../../../../../../test/storage/DisputeFraudProofStorage.test.ts)
Exercises: [DisputeFraudProofStorage.ts](../../../../implementation/source/src/storage/DisputeFraudProofStorage.ts.md)

## Overview

The test drives a `DisputeFraudProofStorage` without a disk medium directly with a factory-built
dispute: it stores one proof, then a second proof of another type for the same dispute, and checks
that the second store returns the first proof's hash and that the lookup by dispute returns the
first proof. The same first-write-wins cases are already assigned to the dispute-fraud-proof test in
[FraudProofStorage.test.ts](../unit/FraudProofStorage.test.ts.md), so this declaration carries none.

## Tests

- `keeps the first proof stored for a dispute`: none
