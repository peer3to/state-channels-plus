# DisputeWindowAdmission.t.sol

Test file: [test/V1/StateChannelDiamondProxy/DisputeWindowAdmission.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeWindowAdmission.t.sol)

## Overview

Exercises the public component behavior listed below with real contract or runtime state. Every seeded JOIN moves the chain's inbound head hash and advances its height by one, and every upload anchors at that hash and height. The anchor cases seed a head block whose predecessor is `consumed` and upload in both modes anchored at each: `consumed` reverts `RaceConditionDisputeInboundNotLatest(head, consumed)` with no admission-state change, the head creates the window with one commitment. A fuzzed anchor naming the head hash with any height other than the head's reverts `RaceConditionDisputeInboundNotLatest(head, head)` in both modes with no admission-state change.

## Tests

- `testFuzz_trueAbsentWindowRefused`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P7, UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P1
- `testFuzz_trueWindowInAnotherForkRefused`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P8, UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P2
- `testFuzz_trueWindowInAnotherChannelRefused`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P9, UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P3
- `testFuzz_trueBeforeDeadlineAccepted`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P10, UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P4
- `testFuzz_trueAtDeadlineRefused`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P11, UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P5
- `testFuzz_trueAfterDeadlineRefused`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P12, UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P6, REQ-ENFDIS-1-8CSA6B.T1.P9
- `testFuzz_trueFinalizedWindowRefused`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P13, UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P7
- `testFuzz_falseAbsentWindowKeepsAdmission`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P14, UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P8
- `testFuzz_falseFullyKilledExpiredWindowKeepsAdmission`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P15, UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P9
- `testFuzz_currentSnapshotParticipantWithOldJoinCanUpload`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P9, REQ-DIS-2-PKVZ7E.T1.P17
- `testFuzz_joinAtLatestInboundHeadCanUpload`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P10, REQ-DIS-2-PKVZ7E.T1.P18
- `testFuzz_joinInsideInboundIntervalCanUpload`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P11, REQ-DIS-2-PKVZ7E.T1.P19
- `testFuzz_joinAtConsumedBoundaryCannotUpload`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P12, REQ-DIS-2-PKVZ7E.T1.P20
- `testFuzz_olderNonparticipantCannotUpload`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P13, REQ-DIS-2-PKVZ7E.T1.P21
- `testFuzz_slashedSnapshotParticipantCannotUpload`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P14, REQ-DIS-2-PKVZ7E.T1.P22
- `testFuzz_slashedPendingJoinCannotUpload`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P15, REQ-DIS-2-PKVZ7E.T1.P23
- `testFuzz_anchorBelowInboundHeadRefused`: UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P18, REQ-DIS-2-PKVZ7E.T1.P28
- `testFuzz_anchorAtInboundHeadAccepted`: UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P19, REQ-DIS-2-PKVZ7E.T1.P29
- `testFuzz_anchorAtInboundHeadWrongHeightRefused`: REQ-DIS-2-PKVZ7E.T1.P32
