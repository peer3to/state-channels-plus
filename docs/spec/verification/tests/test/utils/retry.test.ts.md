# retry.test.ts

Test file: [test/utils/retry.test.ts](../../../../../../test/utils/retry.test.ts)
Exercises: [retry.ts](../../../../implementation/source/src/utils/retry.ts.md)

## Overview

A direct call drives `retry` with a function that always rejects and a 5 s delay. The test aborts once `onRetry` reports the first failure, so the abort lands inside the delay; the call must reject with the function's own error within 1 s, after exactly one attempt. Two more cases pass `shouldRetry`: one refuses the thrown error and the call must reject with it after one attempt; one accepts every error and the call must retry until the third attempt succeeds.

## Tests

- `an abort during the retry delay rejects at once with the last error, after one attempt`: UNIT-TEST-RETRY-1-19CEJ1.P1
- `an error shouldRetry refuses rejects at once, after one attempt`: UNIT-TEST-RETRY-1-19CEJ1.P2
- `an error shouldRetry accepts is retried until an attempt succeeds`: UNIT-TEST-RETRY-1-19CEJ1.P3
