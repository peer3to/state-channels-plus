# BlockQueueManager.test.ts

Test file: [test/unit/BlockQueueManager.test.ts](../../../../../../test/unit/BlockQueueManager.test.ts)
Exercises: [BlockQueueManager.ts](../../../../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md)

## Overview

Real sessions and domain objects exercise the public component or network boundary. The assertions check the state, counts, side effects and failure outcomes named below. Supporting fixtures trigger production methods; they do not replace protocol logic.

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

## Tests

- `an oversized verified eligibility cache does not expand the N-source allowance`: REQ-QSTORE-2-VYWJAQ.T1.P39, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P14
- `an explicit validation strategy stays outside the queued storage clone boundary`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P16
- `an explicit validation strategy stays outside the stored-copy storage clone boundary`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P17
- `deployment cache separates a small maximum from default and reuses the small deployment`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P21
- `eligible source bypasses refresh and sync before queue retention`: REQ-GOSSIP-4-J5Z4DF.T1.P1, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P23
- `wrong channel is rejected before sender refresh or retention`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P24
- `forged author is rejected before sender refresh or retention`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P25
- `a source absent after a failed refresh follows ordinary sync`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P35
- `a failed unknown copy preserves the existing honest contribution`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P28
- `a failed membership read can retry on the next request`: REQ-GOSSIP-4-J5Z4DF.T1.P31, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P33
- `sync with no sender transport ends intake without queueing the block`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P34
- `Unit: BlockQueueManager > sync succeeds but the sender is still absent: blacklisted with no queue entry`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P36
- `Unit: BlockQueueManager > stopping the manager clears a future queued block and cancels its timeout`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P37
- `a queued copy that merged a gossip copy → the gossip source is cut and a forced check is requested`: REQ-BLOCK-PIPE-3-WW2SB7.T1.P17, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P38, UNIT-TEST-BLOCK-INGEST-1-JV64AS.P5, UNIT-TEST-STATE-MANAGER-7-YRC0N3.P1
- `posted calldata queued above the next height → restored, then judged as calldata once its height is next`: REQ-BLOCK-PIPE-3-WW2SB7.T1.P18, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P39
