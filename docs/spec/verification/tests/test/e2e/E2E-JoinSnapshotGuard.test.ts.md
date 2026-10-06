# E2E-JoinSnapshotGuard.test.ts — Test report

> **Test file:** [test/e2e/E2E-JoinSnapshotGuard.test.ts](../../../../../../test/e2e/E2E-JoinSnapshotGuard.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Holds a prepared join across snapshot advancement. Checks admission when its pin matches and abort without membership when the pin becomes stale.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                                                                                    | Covers                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`E2E: join snapshot guard > E42 control: a join prepared against snapshot S with no snapshot update before execution passes the snapshot guard and the joiner is admitted`](../../../../../../test/e2e/E2E-JoinSnapshotGuard.test.ts#L15) (line 15)                                                | [`REQ-MSG-10-7JS45Q.T2.P1`](../../../../specification/settlement/cross-layer-messages.md#req-msg-10-7js45q.t2.p1) |
| [`E2E: join snapshot guard > E42: a join prepared against snapshot S and held at its send while a real snapshot update lands reverts with RaceConditionJoinChannelSnapshotMismatch; the joiner aborts and is not admitted`](../../../../../../test/e2e/E2E-JoinSnapshotGuard.test.ts#L62) (line 62) | [`REQ-MSG-10-7JS45Q.T2.P2`](../../../../specification/settlement/cross-layer-messages.md#req-msg-10-7js45q.t2.p2) |
