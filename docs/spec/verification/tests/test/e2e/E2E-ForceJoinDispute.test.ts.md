# test/e2e/E2E-ForceJoinDispute.test.ts — Test Report

> **Test file:** [test/e2e/E2E-ForceJoinDispute.test.ts](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The workflows start with a spectator joining a two-peer channel while both members stub pending-inbound
inclusion, so no block carries the JOIN. The block bound counts only blocks the joiner commits after the join's
`agreementTime` grace on its own clock, so the members keep authoring through `keepAuthoringUntilForkDisputed` until the fork is
disputed on chain, instead of a fixed block count. It records the chain time right after the join is
confirmed and asserts that the fork's dispute window was created at least `agreementTime` later. With blocks
every `p2pTime`, that check alone does not prove the grace; the fast-table case below does. Reduction changes the joiner's status from `PENDING_PARTICIPANT` to `PARTICIPATING`, and every peer
reports the same three-player successor participant set. The joiner's join tracking is cleared by the seating
reduction genesis: every join field reads absent, the fired flag is false, and no deadline task is armed. The
test then advances one complete authoring cycle
and checks that the joiner receives a scheduled turn and authors the accepted successor-fork block.
The late-leave case uses the same keep-authoring step and starts leave only after that force-join dispute is
submitted. It proves no parallel dispute starts on the old fork and that leave resumes on the successor when
the joiner remains present.
Oracles are per-peer status and participant queries, the fork-settlement wait, the next-writer
query, and the stored latest block author.
The synced-joiner case opens a three-founder channel, authors three blocks, lets one founder leave (authoring until the leaver is `SYNCED`, not waiting idle), and authors
eight more blocks, so the joiner's sync covers a participant change. A spectator then joins while the remaining
founders stub pending-inbound inclusion; the founders keep authoring until the fork is disputed. The joiner's
first recorded dispute names the joiner as disputer, and its state proof starts at the exit's on-chain snapshot:
`getAnchorSnapshot` can use the on-chain snapshot, no milestone ends below its height, a proof block at that
height commits that snapshot, and `findFirstInvalidBlockStructureInStateProof` finds nothing. The fork then
resolves with the honest founders and the joiner, and the joiner reaches `PARTICIPATING`.
The deadline case joins a spectator to a two-founder channel and lets no transition follow, so no block
includes the join and the block bound can never fire. It records the founder's latest block height before the
join and suppresses the participant-timeout check on both founders and the joiner, so only the joiner's
deadline can start a dispute. The joiner must reach `PARTICIPATING` within four protocol-event timeouts; then
the fork is disputed, the founder's block height is unchanged, and the joiner's own local participant set
includes the joiner.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.

Two exit cases hold a spectator's join unconsumed: both founders stub pending-inbound inclusion, the joiner
submits its join, and then both founders leave and author their exits in `onLeaveTurn`. The exit snapshot cannot
post over the unconsumed join, so the founders must force their exits by dispute. In the first case the joiner
stays online; the leaves settle, the joiner reaches `PARTICIPATING`, the chain lists only the joiner, and the
fork is disputed. In the second case the joiner is disposed before the founders leave; the leaves still settle,
the chain lists only the joiner, and the fork is disputed.
The first case also decodes each founder's first recorded dispute and asserts that the founder is the disputer
and that the dispute declares self-removal.

The fast-table case lets the joiner observe its join (grace start recorded) while both founders stub
pending-inbound inclusion, then authors four blocks at once, all inside the grace: the joiner records no
counting start height and no fired bound. After the founders include the join again and the joiner reaches
`PARTICIPATING`, the fork is not disputed and the joiner submitted nothing.

The refused-join case suppresses founder 0's dispute initiation and records the joiner's submissions. After the
joiner observes its join, its block bound is made due against an answered expired evidence window: the bound
fires as a refusal and nothing is submitted. Founder 1 then leaves (watchdog 50 ms), so its self-removal dispute
is the next observed dispute. The joiner audits it; its more-evidence comparison resolves to `false`, the
founder's decoded dispute names founder 1 as disputer, and after inclusion is restored the joiner reaches
`PARTICIPATING` with still no submission of its own, and the chain lists it.

## Tests and covered test IDs

| Test                                                                                                                                                                                                                                                    | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Force Join Dispute > should force an omitted join into the reduced fork and schedule the joiner as an author`](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts#L10) (line 10)                                                            | [`REQ-DIS-1-XAJ1VA.T1.P3`](../../../../specification/disputes/disputes.md#req-dis-1-xaj1va.t1.p3), [`REQ-MSG-11-VS3ZGC.T2.P2`](../../../../specification/settlement/cross-layer-messages.md#req-msg-11-vs3zgc.t2.p2), [`REQ-MSG-11-VS3ZGC.T2.P3`](../../../../specification/settlement/cross-layer-messages.md#req-msg-11-vs3zgc.t2.p3), [`INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P27`](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75.t1.p27) |
| [`E2E: Force Join Dispute > a joiner that synced past a participant change forces its omitted join with a valid state proof`](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts#L154) (line 154)                                                  | [`REQ-SP-8-9PK9TS.T2.P1`](../../../../specification/disputes/state-proofs.md#req-sp-8-9pk9ts.t2.p1)                                                                                                                                                                                                                                                                                                                                                                                            |
| [`E2E: Force Join Dispute > a joiner whose join no block includes forces it by dispute once its deadline passes`](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts#L249) (line 249)                                                              | [`INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P9`](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75.t1.p9)                                                                                                                                                                                                                                                                                                                                            |
| [`E2E: Force Join Dispute > late leave waits for the submitted force-join dispute before retrying on its successor`](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts#L294) (line 294)                                                           | [`REQ-DISPUTE-PIPE-7-76N72X.T1.P3`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-7-76n72x.t1.p3), [`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P6`](../../../../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9.p6)                                                                                                                                                                            |
| [`E2E: Force Join Dispute > founders whose exits wait on an unconsumed join force them by dispute, which also seats the pending joiner`](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts#L351) (line 351)                                       | [`REQ-LIF-10-QR8NQ9.T1.P14`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p14), [`REQ-DISPUTE-PIPE-7-76N72X.T1.P5`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-7-76n72x.t1.p5)                                                                                                                                                                                                                                                        |
| [`E2E: Force Join Dispute > founders force their exits by dispute when the pending joiner whose join they never consumed is gone`](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts#L428) (line 428)                                             | [`REQ-LIF-10-QR8NQ9.T1.P15`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p15)                                                                                                                                                                                                                                                                                                                                                                                       |
| [`E2E: Force Join Dispute > a fast table that authors the block bound inside the join's grace is not disputed and seats the joiner later`](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts#L505) (line 505)                                     | [`INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P26`](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75.t1.p26)                                                                                                                                                                                                                                                                                                                                          |
| [`E2E: Force Join Dispute > a pending joiner whose force join was refused needs no evidence of its own: the next observed dispute's reduction consumes its join and seats it`](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts#L557) (line 557) | [`INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P28`](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75.t1.p28)                                                                                                                                                                                                                                                                                                                                          |
