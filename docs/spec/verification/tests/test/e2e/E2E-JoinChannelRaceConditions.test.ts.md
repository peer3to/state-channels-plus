# E2E-JoinChannelRaceConditions.test.ts

Test file: [test/e2e/E2E-JoinChannelRaceConditions.test.ts](../../../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts)

## Overview

The suite races the on-chain join/top-up admission gates of `JoinChannelFacet` against snapshot
advances and disputes, driven end to end through the `MathTestSession` harness. A spectator syncs
and collects a real unanimous join confirmation (`syncSpectatorAndPrepareJoin`), then the chain
state moves before submission. The snapshot cases assert the exact custom reverts
(`RaceConditionJoinChannelSnapshotMismatch`, `RaceConditionPendingInboundNotConsumed`) — the mismatch case also
decodes the revert's two hash operands and matches them against the stale pin the joiner submitted and the newly
posted on-chain snapshot, both derived in the test rather than read back out of the payload — the SDK
stand-down with no on-chain mutation while a JOIN remains unconsumed, and successful same-fork
advancement after the JOIN is consumed. The dispute cases assert the disputed-fork join gate, a
pending join carried into the reduced participant set, one dispute replaying a pending join before
self-removal, top-ups by existing and pending members refused during the window (`topUpBalance` returns
`false`, `totalDeposits` unchanged after reduction, both still `PARTICIPATING`), and stale-pin recovery
without disposing the participant. The omitted-newest-join kill case is an `it.skip` tripwire: upload
refuses a dispute anchored below the inbound head, so no kill is reachable. Oracles combine
decoded revert names, host-side status/storage reads, and on-chain snapshot, participant, pending,
and deposit queries. The removed `forceInboundJoin` disputed-fork case was duplicate evidence: the
named harness helper submits the same `joinChannel` contract entry. Countersignature collection is
owned by `test/rpc/joinChannel/JoinChannelSignatureRequest.test.ts`.

## Tests

- `U115: new on-chain snapshot causes join confirmation to revert with RaceConditionJoinChannelSnapshotMismatch`: none
- `pending inbound unconsumed → postStateSnapshot stands down; on-chain snapshot unchanged`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P8
- `consumed pending join lets the same-fork snapshot advance`: REQ-ENFSNAP-3-VD9T8A.T1.P1
- `pending inbound lands after preparation → raw same-fork calldata reverts with RaceConditionPendingInboundNotConsumed`: REQ-ENFSNAP-3-VD9T8A.T1.P2, REQ-ENFSNAP-3-VD9T8A.T1.P3, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P7
- `join on disputed fork reverts`: REQ-ENFADM-2-K6K9SP.T1.P3, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P5
- `pending joiner participates after dispute reduction`: REQ-MSG-11-VS3ZGC.T2.P1
- `one dispute replays a pending join before self-removing that joiner`: REQ-DISPUTE-PIPE-7-76N72X.T1.P1
- `omitting the newest pending join from a self-removal dispute is killed`: none
- `refuses existing and pending participants' top-ups during a dispute and converges after reduction`: REQ-ENFADM-2-K6K9SP.T1.P7, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P25
- `returns false for a stale top-up guard without aborting participation`: UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P16
