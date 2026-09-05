# test/e2e/E2E-ForceJoinDispute.test.ts — Test Report

> **Test file:** [test/e2e/E2E-ForceJoinDispute.test.ts](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The workflows start with a spectator joining a two-peer channel while both members omit the JOIN for three
produced blocks, and the omission threshold triggers the force-join dispute. Reduction changes the
joiner's status from `PENDING_PARTICIPANT` to `PARTICIPATING`, and every peer reports the same
three-player successor participant set. The test then advances one complete authoring cycle and
checks that the joiner receives a scheduled turn and authors the accepted successor-fork block.
The late-leave case starts leave only after that force-join dispute is submitted. It proves no
parallel dispute starts on the old fork and that leave resumes on the successor when the joiner
remains present.
Oracles are per-peer status and participant queries, the fork-settlement wait, the next-writer
query, and the stored latest block author.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                              | Covers                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Force Join Dispute > should force an omitted join into the reduced fork and schedule the joiner as an author`](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts#L7) (line 7)    | [`REQ-DIS-1-XAJ1VA.T1.P3`](../../../../specification/disputes/disputes.md#req-dis-1-xaj1va.t1.p3), [`REQ-MSG-11-VS3ZGC.T2.P2`](../../../../specification/settlement/cross-layer-messages.md#req-msg-11-vs3zgc.t2.p2), [`REQ-MSG-11-VS3ZGC.T2.P3`](../../../../specification/settlement/cross-layer-messages.md#req-msg-11-vs3zgc.t2.p3) |
| [`E2E: Force Join Dispute > late leave waits for the submitted force-join dispute before retrying on its successor`](../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts#L103) (line 103) | [`REQ-DISPUTE-PIPE-7-76N72X.T1.P3`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-7-76n72x.t1.p3), [`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P6`](../../../../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9.p6)                     |
