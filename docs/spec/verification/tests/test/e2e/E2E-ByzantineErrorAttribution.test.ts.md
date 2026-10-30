# E2E-ByzantineErrorAttribution.test.ts

Test file: [test/e2e/E2E-ByzantineErrorAttribution.test.ts](../../../../../../test/e2e/E2E-ByzantineErrorAttribution.test.ts)

## Overview

Two tests for the test session's detached-error attribution, not for a protocol component: a
stray rejected promise raised on a peer marked malicious is suppressed (no detached error is
recorded within the wait window), while the identical rejection from an honest peer must surface
through `expectFirstDetachedError`. Both run against a real three-peer channel so the error path
is the production host wiring, but the behavior under test is harness/session infrastructure —
the error-to-peer attribution every other e2e suite relies on to ignore expected byzantine
failures without hiding honest-peer bugs. There is no matching specification or implementation
permutation for this infrastructure, so no test IDs are assigned.

## Tests

- `suppresses a stray detached error originating on a malicious peer`: none
- `does not suppress the same error when it comes from an honest peer`: none
