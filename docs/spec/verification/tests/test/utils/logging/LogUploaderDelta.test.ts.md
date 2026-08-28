# test/utils/logging/LogUploaderDelta.test.ts — Test Report

> **Test file:** [test/utils/logging/LogUploaderDelta.test.ts](../../../../../../../test/utils/logging/LogUploaderDelta.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [LogUploader.ts](../../../../../implementation/source/src/utils/logging/LogUploader.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the real `LogUploader` through the uploader fixture against a real HTTP receiver
that can hold a response open or refuse. The oracles are the bodies the receiver captured, their
sequence ranges, and the outcomes returned: the first upload sends the whole store; a later one only
what was added; nothing new means no POST, and no jitter sleep either; a refused POST leaves the
watermark so its entries ride along with the next; the body names the thread, identity and range;
and an upload requested while one is in flight resolves only after its own POST.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                              | Covers                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`LogUploader delta uploads > an idle store resolves without paying the jitter`](../../../../../../../test/utils/logging/LogUploaderDelta.test.ts#L30) (line 30)                              | [`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P4`](../../../../../implementation/source/src/utils/logging/LogUploader.ts.md#unit-test-log-uploader-1-tbrv7k.p4)                                                                                                            |
| [`LogUploader delta uploads > sends the whole store on the first upload`](../../../../../../../test/utils/logging/LogUploaderDelta.test.ts#L48) (line 48)                                     | [`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P1`](../../../../../implementation/source/src/utils/logging/LogUploader.ts.md#unit-test-log-uploader-1-tbrv7k.p1)                                                                                                            |
| [`LogUploader delta uploads > sends only entries added since the last upload`](../../../../../../../test/utils/logging/LogUploaderDelta.test.ts#L62) (line 62)                                | [`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P2`](../../../../../implementation/source/src/utils/logging/LogUploader.ts.md#unit-test-log-uploader-1-tbrv7k.p2)                                                                                                            |
| [`LogUploader delta uploads > does not POST when there is nothing new`](../../../../../../../test/utils/logging/LogUploaderDelta.test.ts#L77) (line 77)                                       | [`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P3`](../../../../../implementation/source/src/utils/logging/LogUploader.ts.md#unit-test-log-uploader-1-tbrv7k.p3), [`REQ-LOG-3-T9FM2K.T1.P2`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k.t1.p2) |
| [`LogUploader delta uploads > re-sends the delta after a failed upload`](../../../../../../../test/utils/logging/LogUploaderDelta.test.ts#L90) (line 90)                                      | [`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P5`](../../../../../implementation/source/src/utils/logging/LogUploader.ts.md#unit-test-log-uploader-1-tbrv7k.p5), [`REQ-LOG-5-ST6S0G.T1.P2`](../../../../../specification/runtime/log-collection.md#req-log-5-st6s0g.t1.p2) |
| [`LogUploader delta uploads > sends threadName and the sequence range`](../../../../../../../test/utils/logging/LogUploaderDelta.test.ts#L117) (line 117)                                     | [`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P6`](../../../../../implementation/source/src/utils/logging/LogUploader.ts.md#unit-test-log-uploader-1-tbrv7k.p6), [`REQ-LOG-4-W5XR7Q.T1.P1`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q.t1.p1) |
| [`LogUploader delta uploads > a flush requested during an in-flight upload resolves after the second POST`](../../../../../../../test/utils/logging/LogUploaderDelta.test.ts#L137) (line 137) | [`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P7`](../../../../../implementation/source/src/utils/logging/LogUploader.ts.md#unit-test-log-uploader-1-tbrv7k.p7)                                                                                                            |
