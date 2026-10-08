# E2E-JoinSnapshotGuard.test.ts

Test file: [test/e2e/E2E-JoinSnapshotGuard.test.ts](../../../../../../test/e2e/E2E-JoinSnapshotGuard.test.ts)

## Overview

Holds a prepared join across snapshot advancement. Checks admission when its pin matches and abort without membership when the pin becomes stale.

## Tests

- `E42 control: a join prepared against snapshot S with no snapshot update before execution passes the snapshot guard and the joiner is admitted`: REQ-MSG-10-7JS45Q.T2.P1
- `E42: a join prepared against snapshot S and held at its send while a real snapshot update lands reverts with RaceConditionJoinChannelSnapshotMismatch; the joiner aborts and is not admitted`: REQ-MSG-10-7JS45Q.T2.P2
