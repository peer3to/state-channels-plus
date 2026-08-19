# test/cache/SignerRecoveryCache.test.ts — Test Report

> **Test file:** [test/cache/SignerRecoveryCache.test.ts](../../../../../../test/cache/SignerRecoveryCache.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite exercises the signer-recovery cache directly. It checks recovered addresses against
both the signing wallet and `ethers.verifyMessage`, proves repeated `(message, signature)` pairs
reuse one cache entry, proves the message is part of the cache key, and verifies the configured
size bound and oldest-entry eviction while the newest entries still recover correctly. The cache
is reset before each test, and the eviction test restores the global size setting in `finally`.

No implementation source report currently defines test permutations for
`src/cache/SignerRecoveryCache.ts`. The declarations therefore remain unassigned here. This keeps
the missing source-report and test-plan work visible instead of creating verification IDs in the
test report.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full**. Each test ID may be assigned to at most one
test across the whole tree. These declarations have no assignable test IDs until the cache source
report defines its verification plan.

| Test declaration | Covers |
| --- | --- |
| [`SignerRecoveryCache > recovers the correct signer (matches verifyMessage)`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L22) (line 22) | — |
| [`SignerRecoveryCache > memoizes by (message, signature) — repeats add no entries`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L30) (line 30) | — |
| [`SignerRecoveryCache > keys on the message too — same signer, different message, distinct entries`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L42) (line 42) | — |
| [`SignerRecoveryCache > bounds size and evicts oldest past SIGNER_RECOVERY_CACHE_MAX`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L53) (line 53) | — |
