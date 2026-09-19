# test/stateManager/StateManagerChannelReset.test.ts — Test Report

> **Test file:** [test/stateManager/StateManagerChannelReset.test.ts](../../../../../../test/stateManager/StateManagerChannelReset.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateManager.ts](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Thirteen direct literal cases drive the non-terminal channel release. Three of
them start a three-peer channel on the `MathTestSession` harness, author the exit during `onLeaveTurn`, and
await the public `leaveChannel`, so the reset is reached the way an application reaches it — as the second
half of a settled departure — rather than by calling `resetChannel()` directly. The first case's oracle is
one host-side `runtimeState` projection of the live `StateManager`, shipped to the host by `execOnHost`:
channel id, fork id, status, `isDisposed`, the leave service's pending flag, the force-exit marker, open
connections, the signer address, and direct reads of the channel-scoped stores (block height watermark,
fork genesis, queued entries, the self-dispute marker). It is read once while the leave is still settling
and once after, and both projections are compared as one structure, so a passing assertion cannot come from
an empty pre-state. Two cases take the boundaries around the release: channel work is still refused while
the leave is pending, and another channel is selectable once it settled — the latter without `autoOpen`, so
selection alone is the subject. One case releases the leave operation on the success side: on an unbound runtime, which owes no departure and so
settles and resets at once, it awaits two consecutive `leaveChannelService.leaveChannel()` calls on the host and
asserts in one structure that the two promises differ and that `isLeaving` is false between and after them; a
reset that kept the settled operation would hand the first promise back. One case targets the window before the reset's first yield, which is the
only place an old-channel chain-log handler can resume into: on a started channel it calls `resetChannel()`
on the host and, in the same host turn, reads `isActiveFork` for the old fork and awaits
`reductionManager.tryReduce` on it before awaiting the reset, then asserts one structure — the fork already
inactive and no reduction started. It calls the reset directly because a public leave cannot be interleaved
at that point; a retirement moved back behind the first await turns it red. The last case uses two unopened in-thread runtimes (the harness minimum) to
dispose one first and prove the reset is refused afterwards. Seven later cases take the fences and the failure mode the earlier six left to prose. The failure case
replaces the peer's `stateChannelEventListener.drain` with a single-use stub that answers `false` — the exact
signal a chain-feed drain gives when its bound ran out with work still running — and then asserts two things
about one public `leaveChannel`: it rejects with "cannot be reused", and the runtime reads disposed
afterwards. Both halves are needed: a rejection alone would also be produced by a reset that threw and left
the instance alive, which is the outcome the abort exists to prevent. The pending-operation case starts the
join collector's private `waitForThresholdReachability` against a participant address that no peer owns, so
nothing but the wait's own timer — far longer than the case's bound — or the reset can settle it; it then
resets and races the wait against a 5-second sleep, so time itself is the oracle and "still pending" is a
distinct, reportable outcome rather than a timeout. The exclusion case bans one peer of a started
three-peer channel, records that a second peer is known, resets, and compares one structure: the ban
survives, the other peer is forgotten, and the pre-reset read proves the second peer was there to forget. The
reduction case parks a real `submitDetached` on its gas-limit read — its last await before the chain write —
by replacing `getGasLimit` with a promise the test releases, lands the reset while it waits there, then
releases it and waits a further second; the oracle is a count of `multicall` invocations, so a write that
lands late still fails the case.

Three of those seven are the second round's, and each one names an operation that was begun for the
channel being left and had to be stopped from reaching the next one. The late-join case is the only one whose
effect would have been on-chain: it brings a third peer to `SYNCED`, replaces
`prepareJoinChannelConfirmation` with a single-use hold so the signature round trip parks exactly where a
leave can settle underneath it, starts `connectToChannel(..., { shouldJoin: true })`, waits for the hold to
signal that it has been entered rather than sleeping, resets, and only then releases it. The signal is what
keeps the case honest: the reset has to land after the join's last round trip, or the join would fail on a cut
transport and pass for the wrong reason. Its oracle is one structure over the connect's answer and a count of
`membershipService.joinChannel` calls, so a submission that happens after the case's assertion would still
have been counted; both halves are needed, because a `false` alone could come from a join that was attempted
and reverted. The acknowledgement case starts a real `requestDisputeAcknowledgment` round for a fork nobody
disputed, resets immediately, and then waits two seconds — longer than the requests take to fail once the
reset has cut the transports — before reading a count of ban calls and the blacklist itself; without the
failure-branch fence every one of those failures bans its peer. The verdict case is the one that needs the
reset held open: it replaces `stateChannelEventListener.drain` with a promise the test releases, so the reset
is parked inside its release body, calls `disconnectAndBlacklistPeerByEvmAddress` there, and reads the
blacklist both during the reset and after it, in one structure — a suppression that merely deferred the
verdict would fail the second read.

Out of scope here: what `Storage.clear()` does
per module (`StorageClear.test.ts`) and the end-to-end reuse of the runtime on a second real channel
(`E2E-TargetedChannelJoin.test.ts`, `E2E-ChannelReuse.test.ts`).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree.

| Test declaration                                                                                                                                                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`StateManager.resetChannel > returns a participating runtime to its pre-channel state`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L31) (line 31)                             | [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P1`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p1), [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P2`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p2)                                                                                                                                                                                                                                          |
| [`StateManager.resetChannel > keeps rejecting channel work while the leave is still pending`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L80) (line 80)                        | [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P3`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p3)                                                                                                                                                                                                                                                                                                                                                                                                          |
| [`StateManager.resetChannel > accepts another channel selection once the leave has settled`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L103) (line 103)                       | [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P4`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p4), [`REQ-SDK-ARCH-2-QBZAT8.T1.P6`](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8.t1.p6)                                                                                                                                                                                                                                                                                                   |
| [`StateManager.resetChannel > releases the leave operation once the reset completes`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L122) (line 122)                              | [`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P23`](../../../../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9.p23)                                                                                                                                                                                                                                                                                                                                                                                  |
| [`StateManager.resetChannel > retires the old fork before the reset first yields`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L148) (line 148)                                 | [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P8`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p8), [`REQ-LIF-10-QR8NQ9.T1.P18`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p18)                                                                                                                                                                                                                                                                                                |
| [`StateManager.resetChannel > shuts the runtime down and rejects the leave when the reset cannot drain`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L172) (line 172)           | [`REQ-LIF-10-QR8NQ9.T1.P19`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p19), [`REQ-SDK-ARCH-2-QBZAT8.T1.P8`](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8.t1.p8), [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P9`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p9), [`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P25`](../../../../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9.p25) |
| [`StateManager.resetChannel > fails a pending join wait instead of leaving it hanging across the reset`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L190) (line 190)           | [`REQ-SDK-ARCH-2-QBZAT8.T1.P9`](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8.t1.p9), [`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P12`](../../../../implementation/source/src/rpc/network/services/joinChannel/JoinChannelService.ts.md#unit-test-join-channel-service-1-32gsqs.p12)                                                                                                                                                                                                                                                                     |
| [`StateManager.resetChannel > keeps blacklist verdicts across the reset and forgets every other peer`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L222) (line 222)             | [`REQ-AUTH-4-JWCF71.T1.P4`](../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71.t1.p4), [`UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P8`](../../../../implementation/source/src/ProfileManager.ts.md#unit-test-profile-manager-1-ptvsz5.p8)                                                                                                                                                                                                                                                                                                             |
| [`StateManager.resetChannel > stops a reduction submit already in flight from reaching the chain after the reset`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L254) (line 254) | [`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P14`](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p14)                                                                                                                                                                                                                                                                                                                                                                                           |
| [`StateManager.resetChannel > does not join the channel it is leaving when the signatures arrive late`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L297) (line 297)            | [`REQ-LIF-10-QR8NQ9.T1.P22`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p22), [`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P6`](../../../../implementation/source/src/evm/signer/LocalP2pSigner.ts.md#unit-test-local-p2p-signer-1-q80vpw.p6)                                                                                                                                                                                                                                                                                                      |
| [`StateManager.resetChannel > does not penalise a peer for an acknowledgement that outlived its channel`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L356) (line 356)          | [`REQ-LIF-10-QR8NQ9.T1.P24`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p24), [`UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P9`](../../../../implementation/source/src/rpc/network/services/isForkDisputedService/IsForkDisputedService.ts.md#unit-test-is-fork-disputed-service-1-8dqfce.p9)                                                                                                                                                                                                                                               |
| [`StateManager.resetChannel > records no verdict while the channel is being released`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L394) (line 394)                             | [`REQ-LIF-10-QR8NQ9.T1.P23`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p23), [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P10`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p10), [`UNIT-TEST-P2P-MANAGER-3-0FEPCH.P5`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2p-manager-3-0fepch.p5)                                                                                                                                                             |
| [`StateManager.resetChannel > rejects a channel reset on a disposed runtime`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L433) (line 433)                                      | [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P5`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p5), [`REQ-SDK-ARCH-2-QBZAT8.T1.P7`](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8.t1.p7)                                                                                                                                                                                                                                                                                                   |
