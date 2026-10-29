# ValidationService.test.ts

Test file: [test/unit/ValidationService.test.ts](../../../../../../test/unit/ValidationService.test.ts)
Exercises: [ValidationService.ts](../../../../implementation/source/src/stateManager/ingest/ValidationService.ts.md)

## Overview

The suite runs crafted block confirmations through `validateBlockConfirmation` host-side via the
harness stub `runBlockValidation` with record-only side effects, and asserts the input → result
mapping: the returned status, which strategy hooks fired, which forks were disputed, and the fraud
proof type. Queue-layer behavior is out of scope (owned by `E2E-BlockQueueManager`). The cases walk
the whole predicate chain: channel/open guards, author membership with on-chain fallback,
punishment attribution, conflict classification (double-sign / invalid-transition / wrong-genesis /
unattributable), objective time logic with calldata-recovery retry, the subjective agreement
window, the input envelope, disputed-fork handling, the dispute-strategy divergences, and storage
interleaving races.

The permutation pool has since been atomized into single-scenario IDs, so the per-predicate and
conflict-taxonomy permutations are now assigned to their tests below. Still unassigned:
`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P2` (combination order — no test violates several predicates at
once) and `.P6` (subjective window live-only — demonstrated only by the live-park and
dispute-skip tests together, never by one test alone).
Calldata-recovery staging holds the subscribed `CalldataPosted` delivery on every peer except the posting leader (`holdCalldataPostedEventsExceptLeader`), so the observer learns the post time only by recovering it during validation and no third peer can ingest, sign, and gossip the block to it first.

The normalization case with a contract-rejected confirmation encoding shows that a confirmation
signature follows the author signature's acceptance rule: the rejected confirmation is stripped
and only its supplier is punished
(`INV-MIRROR-1-VAF778.T1.P9`). Block decoding is not a
`ValidationService` concern (it is `Codec` in the `Block` model), so the file has no decoding cases.

## Tests

- `a linked insertion from the wrong leader reaches the SDK deviation without changing state or eligibility`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P22
- `live normalization without source attribution strips bad confirmations without blaming the author`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P23, UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P22
- `a malformed-only copy retains its author envelope and charges the rejected confirmation`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P24, UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P23
- `normalization strips an unrecoverable confirmation and punishes only its supplier`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P25, UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P21, UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P24
- `normalization strips a confirmation in an encoding the contracts reject and punishes only its supplier`: INV-MIRROR-1-VAF778.T1.P9
- `spectating normalization preserves valid confirmations after a malformed first value`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P26, UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P22, UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P35
- `shared malformed confirmation punishes both actual suppliers`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P27, UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P25
- `duplicate malformed bytes use one charged slot and are removed once`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P28, UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P26
- `sourceless replay strips irrelevant malformed confirmations without transport punishment`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P29, UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P23, UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P20
- `calldata strategy strips a merged malformed confirmation as the live strategy does`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P30, UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P24, UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P20
- `observer proof replay aborts on a real double sign without requesting a dispute`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P21, REQ-BLOCK-PIPE-3-WW2SB7.T1.P13
- `participant proof replay records double-sign fraud and requests a dispute`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P22, REQ-BLOCK-PIPE-3-WW2SB7.T1.P14
- `pending participant proof replay records double-sign fraud and stays pending`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P29, REQ-BLOCK-PIPE-3-WW2SB7.T1.P16
- `pending participant records live double-sign fraud and stays pending`: UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P21, REQ-BLOCK-PIPE-3-WW2SB7.T1.P12
- `observer live arrivals abort on double-sign fraud without requesting a dispute`: REQ-BLOCK-PIPE-3-WW2SB7.T1.P15
- `observer wrongGenesisDetected keeps the spectator reaction without submitting a dispute`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P30
- `observer invalidStateTransitionDetected keeps the spectator reaction without submitting a dispute`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P31
- `observer objectiveInvalidTimestampDetected keeps the spectator reaction without submitting a dispute`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P32
- `observer forgedInboundMessageBlockDetected keeps the spectator reaction without submitting a dispute`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P33
- `observer blockForkIsDisputed keeps the spectator reaction without submitting a dispute`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P34
- `open fork (non-zero) → true`: none
- `connected to the channel but not yet synced → channelNotOpened → NOT_READY, requeued`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P7, UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P5
- `block for a different channel → wrongChannel → DISCONNECT`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P1, UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P4
- `author outside the participant set → blockAuthorIsNotParticipant → DISCONNECT`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P8, REQ-BLOCK-PIPE-11-DCHAJ2.T1.P4
- `under CalldataCommittedStrategy an author outside the participant set → blockAuthorIsNotParticipant → DISCONNECT, as the live strategy`: UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P18
- `height above nextHeight → blockIsNotNextAndIsInTheFuture → NOT_READY, requeued`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P10, UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P16, REQ-BLOCK-PIPE-3-WW2SB7.T1.P5
- `next block, wrong previousBlockHash → blockIsNotLinkedAndIsNotFirstBlock → DISCONNECT`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P11
- `height-0 block not linked to genesis → wrongGenesisDetected → DISPUTE + WrongGenesis proof`: UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P13, UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P24
- `linked next block by the wrong leader → invalidStateTransitionDetected → DISPUTE + InvalidStateTransition proof`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P12, UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P11, UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P25
- `outsider author relayed by another peer → relayer and author both cut`: UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P9, REQ-BLOCK-PIPE-3-WW2SB7.T1.P4
- `spectating: missing genesis → supplier and author both cut, spectator keeps spectating`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P13, REQ-BLOCK-PIPE-3-WW2SB7.T1.P10
- `empty local union, author in the on-chain active set → passes the author guard`: none
- `empty local union, author only in the on-chain pending set → passes the author guard`: none
- `second block at a taken height by the same author → doubleSignDetected → DISPUTE + DoubleSign proof`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P3, UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P9, UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P10, REQ-BLOCK-PIPE-3-WW2SB7.T1.P1
- `linked conflict at a taken height by a different author → invalidStateTransitionDetected → DISPUTE`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P15
- `conflict at height 0, not linked, different author → wrongGenesisDetected → DISPUTE + WrongGenesis proof`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P16
- `the peer's own stored block replayed verbatim → no conflict, never a double-sign of its honest author`: none
- `conflict at a taken height, not linked, different author → conflictingButNotLinkedBlockDetected → DISCONNECT`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P18
- `first block with a timestamp before genesis → objectiveInvalidTimestampDetected → DISPUTE + InvalidTimestamp proof`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P13, UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P26
- `non-first block, bad timestamp, previous block not on-chain → DISPUTE + InvalidTimestamp`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P19
- `previous-block calldata recovered, candidate now valid → recursive pass returns SUCCESS and caches the timestamp`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P4
- `previous-block calldata recovered but the candidate is still invalid → objectiveInvalidTimestampDetected`: none
- `block replayed from a synchronization proof outside agreementTime → the subjective window does not apply → SUCCESS`: REQ-BLOCK-PIPE-3-WW2SB7.T1.P11, UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P21, UNIT-TEST-BLOCK-INGEST-1-JV64AS.P1, UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P23
- `on-chain timestamp exactly at the post deadline → ON_TIME → SUCCESS even outside agreementTime`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P5
- `on-chain timestamp one second past the deadline → objectiveInvalidTimestampDetected → DISPUTE + InvalidTimestamp`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P14, UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P19
- `no cached timestamp, calldata recoverable on-chain → recovered, persisted, ON_TIME → SUCCESS`: none
- `height 1 posted one second past the no-grace deadline → TOO_LATE → DISPUTE`: none
- `objectively valid but never posted, received outside agreementTime → subjectiveInvalidTimestampDetected → NOT_ENOUGH_TIME`: REQ-BLOCK-PIPE-8-N529VH.T1.P2, UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P20, REQ-BLOCK-PIPE-3-WW2SB7.T1.P6
- `the same stale unposted block under the dispute strategy → subjective hook accepts history → SUCCESS`: none
- `forged author signature`: none
- `stray confirmation signatures on an otherwise valid block → ignored, still SUCCESS`: REQ-BLOCK-PIPE-11-DCHAJ2.T1.P7
- `a valid next block from the expected leader → SUCCESS, no dispute`: none
- `an undisputed fork (and an unknown forkId) → false, no throw`: none
- `a block on the current fork while it is disputed → blockForkIsDisputed → NOT_READY, discarded`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P27
- `local dispute marker set while the contract still reports false → true, no on-chain query`: none
- `no local marker but the contract reports disputed → true from the contract branch`: none
- `a disputed-fork block supplied by a peer that acknowledged the dispute → supplier disconnected, DISCONNECT`: none
- `a disputed-fork block from a supplier with no acknowledgment on record → discarded, NOT_READY`: REQ-DACK-3-J4Z33Y.T1.P1
- `deviation hooks build dispute evidence (see disputeValidation/*)`: none
- `a block on a disputed fork → blockForkIsDisputed is skipped, validation continues`: none
- `a block above the next height → blockIsNotNextAndIsInTheFuture is skipped, validation continues`: none
- `a valid linked next block by the leader passes the leader check → SUCCESS`: none
- `a linked block authored by the wrong leader in the restored state → invalidStateTransitionDetected`: none
- `repositions the state machine to the block's predecessor before the leader check`: none
- `the same candidate crosses the future→next boundary as storage advances → NOT_READY then DISCONNECT`: none
- `concurrent probes are serialized → every one gets an uncorrupted patch/restore`: none
