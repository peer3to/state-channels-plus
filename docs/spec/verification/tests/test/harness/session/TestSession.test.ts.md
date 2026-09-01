# test/harness/session/TestSession.test.ts — Test Report

> **Test file:** [test/harness/session/TestSession.test.ts](../../../../../../../test/harness/session/TestSession.test.ts)  
> **Status:** Authored — engineer verification pending.

## Overview

The tests prove explicit host/orchestrator settlement, ordered detached-error retention, and isolation of one
claimed expected error from an unrelated later rejection. Teardown remains a leak detector and does not cancel,
dispose, or otherwise finish production feature work.

This evidence supports [`REQ-TJOIN-5-Q795M7`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7).

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                | Covers                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`TestSession detached settlement > retains detached errors in arrival order`](../../../../../../../test/harness/session/TestSession.test.ts#L7) (line 7)                                       | [`REQ-TJOIN-5-Q795M7.T1.P1`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7.t1.p1) |
| [`TestSession detached settlement > claiming one expected detached error preserves unrelated failures`](../../../../../../../test/harness/session/TestSession.test.ts#L19) (line 19)            | [`REQ-TJOIN-5-Q795M7.T1.P5`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7.t1.p5) |
| [`TestSession detached settlement > explicit settlement drains host and orchestrator work without terminating it`](../../../../../../../test/harness/session/TestSession.test.ts#L36) (line 36) | [`REQ-TJOIN-5-Q795M7.T1.P3`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7.t1.p3) |
| [`TestSession detached settlement > teardown leak check fails on unresolved work without cancelling it`](../../../../../../../test/harness/session/TestSession.test.ts#L57) (line 57)           | [`REQ-TJOIN-5-Q795M7.T1.P4`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7.t1.p4) |
