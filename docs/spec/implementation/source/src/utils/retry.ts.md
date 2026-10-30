# retry.ts

> **Source:** [src/utils/retry.ts](../../../../../../src/utils/retry.ts)

## Requirements

- [`REQ-LOG-1-H2VQ8X` (Logging cleanup preserves surviving owners)](../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)

## UNIT-TEST-RETRY-1-19CEJ1

An abort ends a pending retry delay at once and starts no further attempt.

- Setup: Call `retry` with a function that always rejects, `maxRetries: 3`, a 5 s `delayMs` and an abort signal; abort once `onRetry` reports the first failure, so the abort lands inside the delay.
- Oracle: The call rejects with the function's own error within 1 s of the abort, well before the 5 s delay, and the function ran exactly once.

- [x] `UNIT-TEST-RETRY-1-19CEJ1.P1` — an abort during the retry delay rejects at once with the last error, after one attempt
