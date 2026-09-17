# test/unit/BlockQueueManager.test.ts — Test Report

> **Test file:** [test/unit/BlockQueueManager.test.ts](../../../../../../test/unit/BlockQueueManager.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [BlockQueueManager.ts](../../../../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Harness sessions with real peers, real chain and the real queue: the suite proves that a work item
proved committed on the base layer keeps the chain-committed validation context for as long as it
is in the queue. The first case parks the observer's queue drain, has the next writer post
authentic calldata whose `previousBlockHash` does not link to the head, then injects the same block
as a gossip copy attributed to another peer, so one entry carries both copies. Releasing the drain
must produce both consequences at once: the gossip source is blacklisted (the live consequence for
a malformed link) and a `timeoutParticipantAfterPostedBlockRejected` check is requested for the
poster (the chain-only consequence) — a pair only the merged chain-committed routing can produce.
The second case posts the same kind of calldata for a height above the next one: nothing is
requested while the entry is parked above the head, and after one honest block is authored the
restored entry is judged in the same context and the request appears. Timeout scheduling itself is
recorded rather than run, so no dispute is submitted by either case.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded.

| Test declaration                                                                                                                                                                                                                                                     | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: BlockQueueManager > posted calldata keeps its strategy through the queue > a queued copy that merged a gossip copy → the gossip source is cut and a forced check is requested`](../../../../../../test/unit/BlockQueueManager.test.ts#L14) (line 14)         | [`REQ-BLOCK-PIPE-3-WW2SB7.T1.P17`](../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7.t1.p17), [`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P14`](../../../../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md#unit-test-block-queue-manager-1-yws2d2.p14), [`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P3`](../../../../implementation/source/src/stateManager/ingest/BlockIngestService.ts.md#unit-test-block-ingest-1-jv64as.p3), [`UNIT-TEST-STATE-MANAGER-7-YRC0N3.P1`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-7-yrc0n3.p1) |
| [`Unit: BlockQueueManager > posted calldata keeps its strategy through the queue > posted calldata queued above the next height → restored, then judged as calldata once its height is next`](../../../../../../test/unit/BlockQueueManager.test.ts#L100) (line 100) | [`REQ-BLOCK-PIPE-3-WW2SB7.T1.P18`](../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7.t1.p18), [`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P15`](../../../../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md#unit-test-block-queue-manager-1-yws2d2.p15)                                                                                                                                                                                                                                                                                                                    |
