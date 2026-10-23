# retry.test.ts

Test file: [test/utils/retry.test.ts](../../../../../../test/utils/retry.test.ts)
Exercises: [retry.ts](../../../../implementation/source/src/utils/retry.ts.md)

## Overview

A direct call drives `retry` with a function that always rejects and a 5 s delay. The test aborts once `onRetry` reports the first failure, so the abort lands inside the delay; the call must reject with the function's own error within 1 s, after exactly one attempt.

## Tests

- `an abort during the retry delay rejects at once with the last error, after one attempt`: UNIT-TEST-RETRY-1-19CEJ1.P1
