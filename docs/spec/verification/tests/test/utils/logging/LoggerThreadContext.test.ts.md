# test/utils/logging/LoggerThreadContext.test.ts — Test Report

> **Test file:** [test/utils/logging/LoggerThreadContext.test.ts](../../../../../../../test/utils/logging/LoggerThreadContext.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [Logger.ts](../../../../../implementation/source/src/utils/logging/Logger.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite creates real loggers through the public factory and the uploader fixture against a real
receiver. It asserts the default thread name, and that lines written before the channel was known are
filed under it once it is: both when an earlier upload already stored them under the placeholder
(the watermark starts over, so the second body begins at sequence zero again) and when they were
still buffered.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                        | Covers                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Logger thread context > defaults the thread name to main`](../../../../../../../test/utils/logging/LoggerThreadContext.test.ts#L25) (line 25)                                         | [`UNIT-TEST-LOGGER-1-4MNRMD.P1`](../../../../../implementation/source/src/utils/logging/Logger.ts.md#unit-test-logger-1-4mnrmd.p1)                                                                                                                                                                                                                                                |
| [`Logger thread context > re-uploads earlier entries under the channel set later`](../../../../../../../test/utils/logging/LoggerThreadContext.test.ts#L39) (line 39)                   | [`REQ-LOG-4-W5XR7Q.T1.P3`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q.t1.p3)                                                                                                                                                                                                                                                                         |
| [`Logger thread context > uploads buffered entries under the channel set later`](../../../../../../../test/utils/logging/LoggerThreadContext.test.ts#L63) (line 63)                     | —                                                                                                                                                                                                                                                                                                                                                                                 |
| [`Logger thread context > reparents children to the surviving grandparent on disposal`](../../../../../../../test/utils/logging/LoggerThreadContext.test.ts#L83) (line 83)              | [`UNIT-TEST-LOGGER-1-4MNRMD.P5`](../../../../../implementation/source/src/utils/logging/Logger.ts.md#unit-test-logger-1-4mnrmd.p5); [`REQ-LOG-1-H2VQ8X.T2.P1`](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x.t2.p1)                                                                                                                                     |
| [`Logger thread context > keeps one shared store registered after its parent logger is disposed`](../../../../../../../test/utils/logging/LoggerThreadContext.test.ts#L112) (line 112)  | [`UNIT-TEST-LOGGER-1-4MNRMD.P6`](../../../../../implementation/source/src/utils/logging/Logger.ts.md#unit-test-logger-1-4mnrmd.p6); [`UNIT-TEST-LOGGER-1-4MNRMD.P2`](../../../../../implementation/source/src/utils/logging/Logger.ts.md#unit-test-logger-1-4mnrmd.p2); [`REQ-LOG-1-H2VQ8X.T2.P2`](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x.t2.p2) |
| [`Logger thread context > releases shared crash listeners only after the last logger is disposed`](../../../../../../../test/utils/logging/LoggerThreadContext.test.ts#L150) (line 150) | [`UNIT-TEST-LOGGER-1-4MNRMD.P7`](../../../../../implementation/source/src/utils/logging/Logger.ts.md#unit-test-logger-1-4mnrmd.p7); [`REQ-LOG-1-H2VQ8X.T2.P3`](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x.t2.p3)                                                                                                                                     |
| [`Logger thread context > cascades through grandchildren reparented by an earlier disposal`](../../../../../../../test/utils/logging/LoggerThreadContext.test.ts#L182) (line 182)       | [`UNIT-TEST-LOGGER-1-4MNRMD.P8`](../../../../../implementation/source/src/utils/logging/Logger.ts.md#unit-test-logger-1-4mnrmd.p8)                                                                                                                                                                                                                                                |
| [`Logger thread context > throws on every log level and replay after disposal even when filtered`](../../../../../../../test/utils/logging/LoggerThreadContext.test.ts#L199) (line 199) | [`UNIT-TEST-LOGGER-1-4MNRMD.P10`](../../../../../implementation/source/src/utils/logging/Logger.ts.md#unit-test-logger-1-4mnrmd.p10); [`REQ-LOG-1-H2VQ8X.T2.P5`](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x.t2.p5)                                                                                                                                   |
