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
alive through the shared `keepAuthoringUntil` helper until the leaver's `onLeftChannel`, because the exit snapshot lands
seconds after the exit block on a loaded farm and an idle slot would draw a timeout dispute.
The slashed-participant case runs the four-peer invalid-transition dispute and reduction with no leave call and
waits for the slashed peer's `onLeftChannel`; the oracles are the chain's participant set, one `onLeftChannel`,
no `onAbort` and the slashed runtime's `SYNCED` status.
The closed-channel exit-post case stages a member that joined (through spectator sync and a landed join) after an
earlier founder's exit landed on chain, and checks first that this member does not store that exit's outbound
block. A record-only probe parks the member's exit posts before they prepare anything. The member exits first,
then both founders exit and their posts close the channel. Only after the close is the parked post released. The
oracles are the recorded post outcomes (all `no-op`), `onLeftChannel` for every member, the member's
`NOT_OPENED` status and no host error on its runtime.
The two in-flight exit-post cases start three founders. The next writer exits first. Its exit post is prepared
against the open fork and then parked by the stub action `holdSnapshotPostSend`: at the contract send, before
the gas estimate, or with `at: "broadcast"` in the signer after the estimate passed. Both other founders then
exit and their posts close the channel (the chain snapshot's fork ID is zero). Only then is the parked post
released. At the send, the estimate rejects with `RaceConditionSnapshotForkMismatch` and the leaver's chain
nonce does not move. At the broadcast, the transaction is mined and reverts (the nonce moves by one, and the
raw receipt error names no custom error). The post's rejection still decodes to
`RaceConditionSnapshotForkMismatch`, so the revert data was read back from a replay. Both cases check the
recorded post outcomes, one "The chain refused the exit snapshot post" log entry with that refusal,
`onLeftChannel` for every member (once for the leaver), the leaver's `NOT_OPENED` status, no host error and
no detached error.

## Tests

- `slash and removal are idempotent after local leave while the chain snapshot still lists the leaver`: REQ-SM-10-JD8TSF.T1.P3
- `removes a normally closed channel from registry pages and the event-derived live set`: INTEGRATION-TEST-OPEN-CHANNEL-REGISTRY-1-A8M2KP.P1
- `should demote exiting participant to SYNCED when state snapshot is updated on-chain`: UNIT-TEST-STATE-MANAGER-2-WSMPYS.P9
- `a participant slashed by a dispute, with no leave call, gets onLeftChannel and does not abort`: REQ-LIF-10-QR8NQ9.T1.P20
- `exiting participant does not sign blocks authored after its leave`: UNIT-TEST-STATE-MANAGER-2-WSMPYS.P7, REQ-BLOCK-PIPE-10-PHAKE2.T1.P3
- `remaining peers do not blacklist the leaver after its exit and it can be force-joined back`: REQ-GOSSIP-3-HQZNQX.T1.P10
- `a late joiner's exit post that runs after its co-leavers' exits closed the channel posts nothing and does not fail, and its runtime stays alive and leaves`: REQ-LIF-10-QR8NQ9.T1.P26
- `an exit post prepared against the open fork and still unsent when its co-leavers' exits close the channel is rejected at its estimate with RaceConditionSnapshotForkMismatch, logged as a chain refusal, and the leaver's runtime stays alive and leaves`: REQ-LIF-10-QR8NQ9.T1.P27
- `an exit post whose estimate passed before its co-leavers' exits closed the channel and that is mined after the close reverts in its block, its replay recovers RaceConditionSnapshotForkMismatch, it is logged as a chain refusal, and the leaver's runtime stays alive and leaves`: REQ-LIF-10-QR8NQ9.T1.P28
- `public terminal leave settles before disposal and excludes the former signer`: REQ-LIF-10-QR8NQ9.T1.P5
- `should set PENDING_PARTICIPANT on join broadcast, then PARTICIPATING once joiner appears in a block`: UNIT-TEST-STATE-MANAGER-2-WSMPYS.P4
- `pending join fault survives until a failed receipt restores SYNCED`: INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P1, INV-TJOIN-2-H7JSQM.T1.P1, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P8
- `pending join fault preserves the successful on-chain join and inbound message`: INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P2, INV-TJOIN-2-H7JSQM.T1.P2, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P9
- `preserves a landed pending join when the same confirmation is retried`: REQ-ENFADM-2-K6K9SP.T1.P4, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P17
