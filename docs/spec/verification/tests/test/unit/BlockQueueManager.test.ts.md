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

Two shutdown cases run host-side on a live peer with a future queued block. In the first, `stop()`
cancels the block's armed queue timeout: past its deadline the timer has not run. In the second, the
peer aborts with its teardown held after the disposal cut-off and before the producers stop; the real
queue timeout then fires and probes its source in the aborted runtime (one `syncBlockSource` call), and
the source's spectate request count stays at zero one second later. Any detached failure fails either
test through the session teardown.

A drain case holds a fresh spectator's sync with the channel tip in its payload, suppresses its
queue timeouts, and ingests a copy of that tip and of the next block authored meanwhile; both queue
on the spectator's unsynced fork. Released, the sync stores the tip and its drain dequeues the stored
copy; the spectator must still apply the next block and hold no queued entry for it.

Four past-block cases (staging in `test/fixtures/PastBlockStaging.ts`) run on an observer that
authored-and-finalized three blocks and then pruned heights 0 and 1, as a compact sync proof leaves
them, so height 1 is empty below the next height 3. The genuine block 1, re-ingested as a network
copy, is dropped at intake: it is not queued or stored, the next height stays 3, no `syncBlockSource` call is
recorded, and no peer is blacklisted or has a fraud proof. A full copy of the stored block 2, whose
stored copy keeps only its author's signature, still merges its confirmation signatures. A crafted
live entry at height 1 run through `onBlockConfirmation` (`runBlockIngest`) is settled before
validation: no deviation hook fires, nothing is restored, disconnected or disputed. The same entry
under the dispute strategy is not settled as past and reaches that strategy's linkage guard, which
throws.

Two more past-block cases cover the queue expiry and the restore. An early requester whose gossip
is dropped holds no block after three final blocks; its queue timeouts, queued-entry executions and
queue drains are held. The genuine block 1, ingested from its author, queues above the next height 0. The requester then installs peer 0's served compact sync proof: the next height is 3 and height
1 holds no block, while the entry is still queued. Run, the held queue timeout drops the entry
itself: no queued execution is scheduled, no `syncBlockSource` call is recorded, the entry is not queued or
stored, and no peer is blacklisted or has a fraud proof. In the second case the entry is dequeued
and handed to the real `restoreQueuedEntry`, as a strategy hook does: it is processed with the
connection kept, it is not queued again, and no second queue timeout is armed. Without the past
check at expiry the entry goes to queued execution; without it at restore the entry is queued
again.

Three probe cases stage a real unreduced window: peer 1 self-removes (neither peer reduces on its
own; peer 0 still applies chain events), gossips peer 0 a junk first block on the window's successor
fork, and answers every sync with its real payload, which proves that fork only through the
unreduced window. Peer 0's queue-timeout probe waits inside `syncBlockSource`; once peer 1 reduces the window
on chain, peer 0 asks it again and blacklists it. Evidence posted by peer 0 during the wait moves the
kill period's end and changes nothing. Disposing peer 0's runtime during the wait resolves the
disposal and peer 1 is never asked again.

One intake case gives the same window to a sender absent from the membership
(`test/fixtures/QueueNetworkRetentionFixture.ts`): a synced spectator gossips peer 0 a block on the
successor fork and answers peer 0's sync with peer 1's real payload. After the kill period, with the
window still unreduced, the intake has not completed, the spectator answered once and is not
blacklisted; after peer 1 reduces the window the spectator answers again, the intake completes and
the still-absent spectator is blacklisted.

## Tests

- `stopping the runtime cancels a future queued block's armed timeout`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P37
- `a queue timeout firing after the runtime aborted sends its source no probe`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P43
- `a junk supplier answering a source probe through a window the chain has not reduced is asked again once the chain reduces it, then excluded`: REQ-SYNC-4-AWHFPA.T1.P8
- `evidence posted into the window while a source probe waits extends the kill period and changes nothing: the supplier is asked again after the reduction, then excluded`: REQ-SYNC-4-AWHFPA.T1.P10
- `disposing the runtime while a source probe waits for the chain's reduction ends the wait: disposal resolves and the supplier is not asked again`: REQ-SYNC-4-AWHFPA.T1.P11
- `an absent sender's gossip whose sync meets a window the chain has not reduced stays pending through the kill period, then the sender is asked again after the reduction and blacklisted`: REQ-SYNC-4-AWHFPA.T1.P19
- `sync succeeds but the sender is still absent: blacklisted with no queue entry`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P36
- `an intake-gate sync whose payload fails validation blacklists the sender through the sync with no queue entry`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P59, REQ-GOSSIP-4-J5Z4DF.T1.P48
- `a drain that dequeues a stored copy still drains the queued next block`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P47
- `an oversized verified eligibility cache does not expand the N-source allowance`: REQ-QSTORE-2-VYWJAQ.T1.P39, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P14
- `an explicit validation strategy stays outside the queued storage clone boundary`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P16
- `an explicit validation strategy stays outside the stored-copy storage clone boundary`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P17
- `deployment cache separates a small maximum from default and reuses the small deployment`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P21
- `eligible source bypasses refresh and sync before queue retention`: REQ-GOSSIP-4-J5Z4DF.T1.P1, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P23
- `wrong channel is rejected before sender refresh or retention`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P24
- `forged author is rejected before sender refresh or retention`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P25
- `a failed unknown copy preserves the existing honest contribution`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P28
- `sync with no sender transport ends intake with a counted close, no blacklist and no queued block`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P34
- `an absent sender still in its own initial sync answers the intake sync that it is still syncing: one counted close, no blacklist and no queued block`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P60, REQ-SPC-3-AZBKR1.T1.P8
- `a queued block's source still in its own initial sync answers the expiry probe that it is still syncing: one counted close and no blacklist`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P61, REQ-SPC-3-AZBKR1.T1.P9
- `a queued copy that merged a gossip copy → the gossip source is cut and a forced check is requested`: REQ-BLOCK-PIPE-3-WW2SB7.T1.P17, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P38, UNIT-TEST-BLOCK-INGEST-1-JV64AS.P5, UNIT-TEST-STATE-MANAGER-7-YRC0N3.P1
- `posted calldata queued above the next height → restored, then judged as calldata once its height is next`: REQ-BLOCK-PIPE-3-WW2SB7.T1.P18, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P39
- `gossip: a genuine block at a free height below the next height → dropped: not queued, stored or executed, no sync probe, no source cut, no fraud proof`: REQ-BLOCK-PIPE-1-SS24D1.T1.P7, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P48
- `gossip: a stored block below the next height carrying signatures the observer lacks → still merges them`: REQ-BLOCK-PIPE-1-SS24D1.T1.P8, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P49
- `pipeline: a live entry at a free height below the next height → settled as past before validation: no deviation hook, restore, disconnect or dispute`: REQ-BLOCK-PIPE-1-SS24D1.T1.P9, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P50
- `dispute replay at a free height below the next height → not past: validation reaches the linkage guard`: REQ-BLOCK-PIPE-1-SS24D1.T1.P10, REQ-BLOCK-PIPE-3-WW2SB7.T2.P1, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P51
- `queue expiry: a queued block whose height became free below the next height → dropped: no sync probe, no queue entry or stored block, no source cut, no fraud proof`: REQ-BLOCK-PIPE-1-SS24D1.T1.P11, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P52
- `restore: a dequeued entry whose height became free below the next height → settled as past: processed, not queued again, no new queue timeout`: REQ-BLOCK-PIPE-1-SS24D1.T1.P12, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P53
