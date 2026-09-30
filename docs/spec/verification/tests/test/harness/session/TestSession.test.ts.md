# test/harness/session/TestSession.test.ts — Test Report

> **Test file:** [test/harness/session/TestSession.test.ts](../../../../../../../test/harness/session/TestSession.test.ts)  
> **Status:** Authored — engineer verification pending.

## Overview

The tests prove explicit host/orchestrator settlement, ordered detached-error retention, and isolation of one
claimed expected error from an unrelated later rejection. Teardown remains a leak detector and does not cancel,
dispose, or otherwise finish production feature work.

These are harness self-tests of detached settlement; they exercise no connect failure phase, so they assign
no permutation. The related requirement is [`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7).

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`TestSession detached settlement > retains detached errors in arrival order`](../../../../../../../test/harness/session/TestSession.test.ts#L6) (line 6)                                       | —      |
| [`TestSession detached settlement > claiming one expected detached error preserves unrelated failures`](../../../../../../../test/harness/session/TestSession.test.ts#L18) (line 18)            | —      |
| [`TestSession detached settlement > explicit settlement drains host and orchestrator work without terminating it`](../../../../../../../test/harness/session/TestSession.test.ts#L35) (line 35) | —      |
| [`TestSession detached settlement > teardown leak check fails on unresolved work without cancelling it`](../../../../../../../test/harness/session/TestSession.test.ts#L56) (line 56)           | —      |
