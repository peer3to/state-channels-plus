# testTimeConfig.test.ts

Test file: [test/harness/testTimeConfig.test.ts](../../../../../../test/harness/testTimeConfig.test.ts)

## Overview

The suite exercises the test-harness helper `test/harness/core/testTimeConfig.ts` directly — it
tests support code for other suites, not production sources under `src/`. It asserts that
`resolveTestTimeConfig()` returns the minimum-safe baseline (`p2pTime: 2`, `agreementTime: 3`,
`chainFallbackTime: 3`, `evidenceTime: 6`), that partial overrides produce a copy without mutating
`MIN_TEST_TIME_CONFIG`, and that the derived-wait arithmetic is exact:
`participantTimeoutWaitMs` includes the first-block grace only at height 0, and
`evidencePeriodWaitMs`/`protocolEventTimeoutMs` produce the expected millisecond totals, including
the `withFirstBlockGrace` and `settlementMarginSeconds` options. Oracles are literal expected
values, pinning the timing contract that E2E suites rely on when waiting for protocol events.
Because this is harness support with no implementation source report, no test IDs from the pool
apply to it.

## Tests

- `resolves the minimum-safe baseline`: none
- `applies partial overrides without mutating the baseline`: none
- `includes first-block grace only at height zero`: none
