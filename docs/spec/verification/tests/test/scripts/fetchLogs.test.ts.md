# test/scripts/fetchLogs.test.ts — Test Report

> **Test file:** [test/scripts/fetchLogs.test.ts](../../../../../../test/scripts/fetchLogs.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite runs the fetch tool's fetch and persist steps against the real crash-log server on a
temporary directory. It uploads a small chunk and a fat one, lowers the server's inflate ceiling so
the fat one is skipped from the merged read, and asserts the fetched result counts the skipped chunk
and that the persisted file says at its top that the read is incomplete; the control case with a
complete read writes no such marker.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                  | Covers                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`fetch-logs > marks a persisted log the server read short`](../../../../../../test/scripts/fetchLogs.test.ts#L41) (line 41)      | [`REQ-LOG-7-M2RC5W.T1.P7`](../../../../specification/runtime/log-collection.md#req-log-7-m2rc5w.t1.p7) |
| [`fetch-logs > writes no marker for a read the server completed`](../../../../../../test/scripts/fetchLogs.test.ts#L82) (line 82) | —                                                                                                      |
