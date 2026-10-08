# E2E-ParticipantLifecycle.test.ts

Test file: [test/e2e/E2E-ParticipantLifecycle.test.ts](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts)

## Overview

The suite walks both participant-set transitions end to end through the `MathTestSession` harness.
It also opens several channels, closes one through the normal zero-participant snapshot path, and
compares the lifecycle-event live set with paged manager enumeration. The participant cases cover
the exit path (`leaveChannel` → N/N snapshot → on-chain snapshot update demotes the exiter to
SYNCED while the rest stay PARTICIPATING) and the join path (a synced spectator broadcasts a real
join confirmation, flips to PENDING_PARTICIPANT before the transaction is mined, and is promoted
to PARTICIPATING once the first block whose resulting participant set includes it is processed).
It also proves two guards: a detached leaver whose process stays connected never signs a
post-leave block (checked against the actual confirmation-signature set of the next finalized
block, with no honest peer blacklisted). A separate public terminal-leave case proves the same
post-departure behavior after the outer runtime has disposed the leaver. Retrying an already-landed join confirmation rejects
with `ErrorJoinChannelParticipantAlreadyExists` while the host keeps PENDING_PARTICIPANT and the
recorded join-submission height, so the pending join still completes. Two fault interleavings hold
the join receipt after submission and inject an exact-sync failure while local status is pending.
Neither fault aborts: a failed transaction restores `SYNCED`, while a successful transaction leaves
on-chain pending membership and delivers the inbound join message. Oracles are host-side
status/storage reads over the control port and decoded block bundles. The `shouldSignBlock` and
admission permutations are now atomized per condition, so the join-promotion, signer-outside-union,
and pending-join-rejection scenarios each map to a single test here. The remaining conditions
(forfeit rule, blacklisted author, forced-join arming) belong to other suites.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.
The public terminal-leave case marks the leaver AFK once its exit block is authored and keeps the writer slot
alive through the shared `keepAuthoringUntil` helper until the leave settles, because the exit snapshot lands
seconds after the exit block on a loaded farm and an idle slot would draw a timeout dispute.

## Tests

- `slash and removal are idempotent after local leave while the chain snapshot still lists the leaver`: REQ-SM-10-JD8TSF.T1.P3
- `removes a normally closed channel from registry pages and the event-derived live set`: INTEGRATION-TEST-OPEN-CHANNEL-REGISTRY-1-A8M2KP.P1
- `should demote exiting participant to SYNCED when state snapshot is updated on-chain`: UNIT-TEST-STATE-MANAGER-2-WSMPYS.P9
- `exiting participant does not sign blocks authored after its leave`: UNIT-TEST-STATE-MANAGER-2-WSMPYS.P7, REQ-BLOCK-PIPE-10-PHAKE2.T1.P3
- `remaining peers do not blacklist the leaver after its exit and it can be force-joined back`: REQ-GOSSIP-3-HQZNQX.T1.P10
- `public terminal leave settles before disposal and excludes the former signer`: REQ-LIF-10-QR8NQ9.T1.P5
- `should set PENDING_PARTICIPANT on join broadcast, then PARTICIPATING once joiner appears in a block`: UNIT-TEST-STATE-MANAGER-2-WSMPYS.P4
- `pending join fault survives until a failed receipt restores SYNCED`: INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P1, INV-TJOIN-2-H7JSQM.T1.P1, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P8
- `pending join fault preserves the successful on-chain join and inbound message`: INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P2, INV-TJOIN-2-H7JSQM.T1.P2, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P9
- `preserves a landed pending join when the same confirmation is retried`: REQ-ENFADM-2-K6K9SP.T1.P4, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P17
