# test/scripts/logChunks.test.ts — Test Report

> **Test file:** [test/scripts/logChunks.test.ts](../../../../../../test/scripts/logChunks.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite calls the chunk helpers the crash-log server shares with its tests: naming, encoding, and
the merge of many stored chunks into one ordered stream. Oracles are the merged messages and the
skipped-chunk count. It covers naming and parsing by sequence range, three threads merged by wall
clock, an overlapping resend merged without duplicates, an undecodable chunk skipped while the rest
survive, a missing chunk leaving its gap, a merged read that stops at the shared inflate budget and
reports it, a single chunk refused when it inflates past the ceiling, and an entry without a wall
clock dropped without shifting the sequence of those after it.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                  | Covers                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`logChunks > names and parses a chunk by its sequence range`](../../../../../../test/scripts/logChunks.test.ts#L56) (line 56)                    | —                                                                                                      |
| [`logChunks > merges three threads into one ordered stream`](../../../../../../test/scripts/logChunks.test.ts#L70) (line 70)                      | —                                                                                                      |
| [`logChunks > merges overlapping chunks without duplicates`](../../../../../../test/scripts/logChunks.test.ts#L90) (line 90)                      | [`REQ-LOG-5-ST6S0G.T1.P3`](../../../../specification/runtime/log-collection.md#req-log-5-st6s0g.t1.p3) |
| [`logChunks > skips an undecodable chunk`](../../../../../../test/scripts/logChunks.test.ts#L107) (line 107)                                      | [`REQ-LOG-7-M2RC5W.T1.P3`](../../../../specification/runtime/log-collection.md#req-log-7-m2rc5w.t1.p3) |
| [`logChunks > keeps the gap when a chunk is missing`](../../../../../../test/scripts/logChunks.test.ts#L118) (line 118)                           | —                                                                                                      |
| [`logChunks > stops a merged read at the shared inflate budget and reports it`](../../../../../../test/scripts/logChunks.test.ts#L135) (line 135) | —                                                                                                      |
| [`logChunks > refuses a chunk that inflates past the configured maximum`](../../../../../../test/scripts/logChunks.test.ts#L167) (line 167)       | [`REQ-LOG-7-M2RC5W.T1.P1`](../../../../specification/runtime/log-collection.md#req-log-7-m2rc5w.t1.p1) |
| [`logChunks > drops an entry with no wall-clock timestamp from the merge`](../../../../../../test/scripts/logChunks.test.ts#L184) (line 184)      | —                                                                                                      |
| [`logChunks > keeps the sequence of entries after a dropped one aligned`](../../../../../../test/scripts/logChunks.test.ts#L199) (line 199)       | —                                                                                                      |
