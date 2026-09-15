# test/e2e/E2E-CrashLogUpload.test.ts — Test Report

> **Test file:** [test/e2e/E2E-CrashLogUpload.test.ts](../../../../../../test/e2e/E2E-CrashLogUpload.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite runs two-peer harness sessions against a real HTTP log receiver, in the fully threaded
topology (main, sdk worker, vm worker per peer) and inline. Every oracle is what the receiver
decoded: which thread streams arrived for which peer, which markers they carry, the sequence ranges
on consecutive rounds, and the stored record of what a round reached. It covers a collection started
from the app's thread reaching the sdk realm's own store; one stream per thread for every peer, all
filed under the channel; a crash inside an sdk worker uploading the sibling peer's realms as well; a
second round carrying only what happened since the first; the stored round record matching the
answer the caller got; and the inline topology filing the same threads with no worker at all.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                 | Covers                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: crash log upload > uploads the host thread's own logs, which today never leave it`](../../../../../../test/e2e/E2E-CrashLogUpload.test.ts#L39) (line 39)                  | —                                                                                                                                                                                                              |
| [`E2E: crash log upload > uploads one stream per thread for every peer`](../../../../../../test/e2e/E2E-CrashLogUpload.test.ts#L74) (line 74)                                    | [`REQ-LOG-6-Q8KY4N.T1.P2`](../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n.t1.p2), [`REQ-LOG-8-B7VN3J.T1.P3`](../../../../specification/runtime/log-collection.md#req-log-8-b7vn3j.t1.p3) |
| [`E2E: crash log upload > a crash inside the SDK thread uploads its connected client and executor roots`](../../../../../../test/e2e/E2E-CrashLogUpload.test.ts#L120) (line 120) | [`INV-LOG-1-P4WT6R.T1.P4`](../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r.t1.p4)                                                                                                         |
| [`E2E: crash log upload > a second flush uploads only what happened since the first`](../../../../../../test/e2e/E2E-CrashLogUpload.test.ts#L162) (line 162)                     | —                                                                                                                                                                                                              |
| [`E2E: crash log upload > returns a local report result without claiming remote completion`](../../../../../../test/e2e/E2E-CrashLogUpload.test.ts#L196) (line 196)              | —                                                                                                                                                                                                              |
| [`E2E: crash log upload > inline mode files the same threads without a worker`](../../../../../../test/e2e/E2E-CrashLogUpload.test.ts#L213) (line 213)                           | [`REQ-LOG-8-B7VN3J.T1.P1`](../../../../specification/runtime/log-collection.md#req-log-8-b7vn3j.t1.p1)                                                                                                         |
