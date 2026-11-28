# ChannelCleanClose.t.sol

Test file: [test/V1/StateChannelDiamondProxy/ChannelCleanClose.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/ChannelCleanClose.t.sol)
Exercises: [StateChannelCommon.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol.md), [StateSnapshotFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md)

## Overview

The Foundry harness deploys the real diamond, opens channels through the proxy's `open` and closes them with
threshold-signed zero-participant snapshots through the routed `updateStateSnapshotSameFork`. The final close
emits exactly one `StateSnapshotUpdated` with no participants for that channel ID and leaves a balance tracker that
reads zero, an empty snapshot and a pruned closing head. One close pays a deposit out through an exit block, so it
writes a withdrawal total and an outbound height before the delete; both read zero after it. A repeated
close reverts with `RaceConditionSnapshotForkMismatch` at the zeroed chain fork and the channel stays empty.

The clean-close cases record a state diff over a whole lifecycle at two and six seats: open, a fallback
`postBlockCalldata`, a `topUpBalance`, two real `uploadDispute` calls on another fork, a same-fork snapshot update
that clears the dispute data mid-life, a later upload and the final close. Every diamond slot the lifecycle wrote is
then read: all are zero except one, whose value is the posted calldata commitment. The throttle cases show the
first disputer refused with `ErrorDisputeThrottled` and its exact expiry, then uploading again at once, still inside
that expiry, after the mid-life clear; and a disputer throttled before the final close uploading at once into the
reopened channel, which starts from inbound height 1 and none of the old deposit. One case lands a deposit above the open's inbound block, closes and checks that exactly one
`ChannelStorageCleared` names the snapshot head and both inbound blocks are gone.

The fork-adoption case etches a consumer facet that also stages what a finished dispute game leaves, through the
production writers: a slash record and a committed reduced result on the current fork's window. After a top-up and two real uploads on the current fork, the routed
`updateStateSnapshotFork` adopts a zero-participant genesis whose inbound head is the open block. Every diamond slot
written across the lifecycle reads zero except slots the top-up wrote; the top-up's inbound block stays, while the
window, the slash record, both throttles, the snapshot and the balance tracker are gone.

## Tests

- `test_finalClose_emitsOneZeroParticipantSnapshotEvent`: REQ-LIF-8-2HDG3A.T1.P1, REQ-LOBBY-1-PZTPKD.T1.P4
- `test_finalClose_repeatedCloseReverts_channelStaysEmpty`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P17, REQ-ENFSNAP-4-ESP98F.T1.P3, REQ-LIF-13-0MH9JW.T1.P3
- `test_updateStateSnapshotSameFork_finalClosePrunesTheInboundHeadWithOneStorageClear`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P53
- `test_cleanClose_twoSeats_leavesNoChannelSlotButCalldataCommitments`: REQ-LIF-13-0MH9JW.T1.P1
- `test_cleanClose_sixSeats_leavesNoChannelSlotButCalldataCommitments`: REQ-LIF-13-0MH9JW.T1.P2
- `test_forkAdoptionClose_leavesNoChannelSlotButTheInboundBlockAboveTheAdoptedHead`: REQ-LIF-13-0MH9JW.T1.P7
- `test_midLifeClear_endsAnUnexpiredThrottle_disputerUploadsAgainAtOnce`: REQ-DIS-2-PKVZ7E.T1.P33, REQ-DIS-2-PKVZ7E.T1.P34
- `test_finalClose_endsEveryThrottle_reopenedChannelAcceptsTheOldDisputerAtOnce`: REQ-LIF-13-0MH9JW.T1.P4, REQ-LIF-13-0MH9JW.T1.P5, UNIT-TEST-MANAGER-PROXY-1-NTYR71.P30
