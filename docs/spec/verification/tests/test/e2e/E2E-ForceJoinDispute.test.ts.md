# E2E-ForceJoinDispute.test.ts

Test file: [test/e2e/E2E-ForceJoinDispute.test.ts](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts)

## Overview

The workflows start with a spectator joining a two-peer channel while both members omit the JOIN for three
produced blocks, and the omission threshold triggers the force-join dispute. Reduction changes the
joiner's status from `PENDING_PARTICIPANT` to `PARTICIPATING`, and every peer reports the same
three-player successor participant set. The test then advances one complete authoring cycle and
checks that the joiner receives a scheduled turn and authors the accepted successor-fork block.
The late-leave case starts leave only after that force-join dispute is submitted. It proves no
parallel dispute starts on the old fork and that leave resumes on the successor when the joiner
remains present.
The early-leave case runs inline, suppresses every participant-timeout check and gives the joiner a
three-second leave watchdog; right after its join lands, before its force-join bound, the joiner
requests its leave through the public `P2pInstance.leaveChannel()`. Its forwarded dispute submission is
recorded: the force-join record shows the dispute started, and the decoded dispute carries the joiner's
self-removal. Record-only instruments on the retained inline host record the answer of each local-state
participants read, the host state right after `onLeftChannel`, and every scheduled task by name. After
the founders resolve the dispute, the joiner emits one `onLeftChannel` and disposes itself with no
`dispose()` call from the test. At `onLeftChannel` its status was `SYNCED`, its tracked join and leave
state were gone and its last local-state read did not list it; neither on-chain set lists it, and no
leave watchdog is scheduled during a window longer than one watchdog period.
Oracles are per-peer status and participant queries, the fork-settlement wait, the next-writer
query, and the stored latest block author.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.

## Tests

- `should force an omitted join into the reduced fork and schedule the joiner as an author`: REQ-DIS-1-XAJ1VA.T1.P3, REQ-MSG-11-VS3ZGC.T2.P2, REQ-MSG-11-VS3ZGC.T2.P3
- `late leave waits for the submitted force-join dispute before retrying on its successor`: REQ-DISPUTE-PIPE-7-76N72X.T1.P3, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P6
- `a leave requested through the public leaveChannel before the joiner's own force-join dispute puts its self-removal into that dispute; once the reduction consumes the join and removes the joiner from the local state and the chain, the join ends: SYNCED, one onLeftChannel, no watchdog re-armed, and the runtime disposes itself`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P80
