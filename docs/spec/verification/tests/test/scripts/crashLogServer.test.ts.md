# test/scripts/crashLogServer.test.ts — Test Report

> **Test file:** [test/scripts/crashLogServer.test.ts](../../../../../../test/scripts/crashLogServer.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite exercises the crash-log receiver script: its path-segment sanitizer, its upload body
validation, and the POST and GET routes end to end on a real listening app with a temporary log
directory. Route oracles are HTTP statuses and the decoded merged read. It covers a chunk stored and
read back; two stores with the same sequence range kept apart; eight concurrent uploads for one
channel landing in one directory; a merged read that runs out of inflate budget dropping the oldest
run and announcing the drop on a header; the index listing; and, with a token configured, a send
with no token or the wrong one refused and not stored while a later valid send is accepted.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                               | Covers                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [`crash-log-server sanitizeSegment - path traversal > leaves legitimate hex ids / addresses unchanged`](../../../../../../test/scripts/crashLogServer.test.ts#L32) (line 32)   | [`REQ-LOG-6-Q8KY4N.T1.P5`](../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n.t1.p5) |
| [`crash-log-server sanitizeSegment - path traversal > replaces every disallowed character with _`](../../../../../../test/scripts/crashLogServer.test.ts#L39) (line 39)        | [`REQ-LOG-6-Q8KY4N.T1.P6`](../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n.t1.p6) |
| [`crash-log-server sanitizeSegment - path traversal > keeps a sanitized segment contained under LOG_DIR`](../../../../../../test/scripts/crashLogServer.test.ts#L43) (line 43) | [`REQ-LOG-6-Q8KY4N.T1.P7`](../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n.t1.p7) |
| [`crash-log-server sanitizeSegment - path traversal > keeps a sanitized thread segment under LOG_DIR`](../../../../../../test/scripts/crashLogServer.test.ts#L62) (line 62)    | [`REQ-LOG-6-Q8KY4N.T1.P8`](../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n.t1.p8) |
| [`crash-log-server validateUploadBody > accepts a well-formed chunk upload`](../../../../../../test/scripts/crashLogServer.test.ts#L77) (line 77)                              | [`REQ-LOG-5-ST6S0G.T1.P5`](../../../../specification/runtime/log-collection.md#req-log-5-st6s0g.t1.p5) |
| [`crash-log-server validateUploadBody > rejects a non-integer sequence range`](../../../../../../test/scripts/crashLogServer.test.ts#L81) (line 81)                            | [`REQ-LOG-5-ST6S0G.T1.P6`](../../../../specification/runtime/log-collection.md#req-log-5-st6s0g.t1.p6) |
| [`crash-log-server validateUploadBody > rejects an upload with no store id`](../../../../../../test/scripts/crashLogServer.test.ts#L96) (line 96)                              | [`REQ-LOG-5-ST6S0G.T1.P7`](../../../../specification/runtime/log-collection.md#req-log-5-st6s0g.t1.p7) |
| [`crash-log-server validateUploadBody > rejects a chunk whose entry count disagrees with its range`](../../../../../../test/scripts/crashLogServer.test.ts#L105) (line 105)    | [`REQ-LOG-5-ST6S0G.T1.P8`](../../../../specification/runtime/log-collection.md#req-log-5-st6s0g.t1.p8) |
| [`crash-log-server validateUploadBody > rejects a body with no thread name`](../../../../../../test/scripts/crashLogServer.test.ts#L114) (line 114)                            | [`REQ-LOG-5-ST6S0G.T1.P9`](../../../../specification/runtime/log-collection.md#req-log-5-st6s0g.t1.p9) |
| [`crash-log-server routes > stores an uploaded chunk and reads it back merged`](../../../../../../test/scripts/crashLogServer.test.ts#L148) (line 148)                         | [`REQ-LOG-6-Q8KY4N.T1.P9`](../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n.t1.p9) |
| [`crash-log-server routes > keeps two stores with the same sequence range apart`](../../../../../../test/scripts/crashLogServer.test.ts#L165) (line 165)                       | [`REQ-LOG-6-Q8KY4N.T1.P4`](../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n.t1.p4) |
| [`crash-log-server routes > keeps concurrent uploads for one channel in a single directory`](../../../../../../test/scripts/crashLogServer.test.ts#L191) (line 191)            | [`REQ-LOG-5-ST6S0G.T1.P4`](../../../../specification/runtime/log-collection.md#req-log-5-st6s0g.t1.p4) |
| [`crash-log-server routes > keeps the newest store when a merged read runs out of budget`](../../../../../../test/scripts/crashLogServer.test.ts#L220) (line 220)              | [`REQ-LOG-7-M2RC5W.T1.P2`](../../../../specification/runtime/log-collection.md#req-log-7-m2rc5w.t1.p2) |
| [`crash-log-server routes > lists stored chunks in the index`](../../../../../../test/scripts/crashLogServer.test.ts#L293) (line 293)                                          | [`REQ-LOG-6-Q8KY4N.T1.P10`](../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n.t1.p10) |
| [`crash-log-server bearer token > refuses an upload with no token`](../../../../../../test/scripts/crashLogServer.test.ts#L330) (line 330)                                     | [`REQ-LOG-7-M2RC5W.T1.P4`](../../../../specification/runtime/log-collection.md#req-log-7-m2rc5w.t1.p4) |
| [`crash-log-server bearer token > refuses an upload with the wrong token`](../../../../../../test/scripts/crashLogServer.test.ts#L341) (line 341)                              | [`REQ-LOG-7-M2RC5W.T1.P5`](../../../../specification/runtime/log-collection.md#req-log-7-m2rc5w.t1.p5) |
| [`crash-log-server bearer token > stores an upload with the configured token`](../../../../../../test/scripts/crashLogServer.test.ts#L349) (line 349)                          | [`REQ-LOG-7-M2RC5W.T1.P8`](../../../../specification/runtime/log-collection.md#req-log-7-m2rc5w.t1.p8) |
| [`crash-log-server bearer token > stores a valid upload after a refused one`](../../../../../../test/scripts/crashLogServer.test.ts#L361) (line 361)                           | [`REQ-LOG-7-M2RC5W.T1.P6`](../../../../specification/runtime/log-collection.md#req-log-7-m2rc5w.t1.p6) |
