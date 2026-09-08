pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import "../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol";

contract DisputeWindowAdmissionHarness is DisputeManagerFacet {
    constructor() {
        evidenceTime = 10;
        utilityFacetAddress = address(new UtilityFacet());
    }

    function seedChannel(bytes32 channelId, address disputer, address other) external {
        stateSnapshots[channelId].snapshotData.participants.push(disputer);
        stateSnapshots[channelId].snapshotData.participants.push(other);
    }

    function seedWindow(bytes32 channelId, bytes32 forkId, uint256 created, bool populated, bool finalized) external {
        DisputeWindow storage window = disputeData[channelId].disputeWindowMap[forkId];
        window.forkId = forkId;
        window.evidence.creationTimestamp = created;
        window.evidence.lastEvidenceSubmissionTimestamp = created;
        if (populated) window.evidence.disputeCommitments.push(keccak256("prior commitment"));
        if (finalized) window.reducedResult.forkId = keccak256("reduced fork");
    }

    function seedInboundJoin(bytes32 channelId, bytes32 hash, bytes32 previous, address participant) external {
        MessageBlock storage inbound = inboundMessageBlockMap[channelId][hash];
        inbound.timestamp = block.timestamp;
        inbound.previousBlockHash = previous;
        Balance memory balance = Balance({amount: 0, data: ""});
        inbound.messages.push(
            Message({
                messageType: MESSAGE_TYPE_JOIN,
                participant: participant,
                balance: balance,
                data: abi.encode(
                    JoinChannel({channelId: channelId, participant: participant, deadlineTimestamp: 0, balance: balance})
                )
            })
        );
        channelBalances[channelId].latestInboundMessageBlockHash = hash;
    }

    function setInboundBoundary(bytes32 channelId, bytes32 hash) external {
        stateSnapshots[channelId].snapshotData.latestInboundMessageBlockHash = hash;
    }

    function slash(bytes32 channelId, address participant) external {
        disputeData[channelId].onChainSlashes.push(OnChainSlash({participant: participant, timestamp: block.timestamp}));
    }

    function clearSnapshotParticipants(bytes32 channelId) external {
        delete stateSnapshots[channelId].snapshotData.participants;
    }

    function finalizeWindow(bytes32 channelId, bytes32 forkId) external {
        _commitToDisputeReducedResult(
            channelId, disputeData[channelId].disputeWindowMap[forkId], keccak256("reduced fork"), block.timestamp
        );
    }

    function readAdmissionState(bytes32 channelId, bytes32 forkId, address disputer)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256)
    {
        DisputeWindow storage window = disputeData[channelId].disputeWindowMap[forkId];
        return (
            window.evidence.creationTimestamp,
            window.evidence.lastEvidenceSubmissionTimestamp,
            window.evidence.disputeCommitments.length,
            window.evidence.hasPosted.length,
            disputerThrottle[channelId][disputer]
        );
    }
}

contract DisputeWindowAdmissionTest is Test {
    DisputeWindowAdmissionHarness internal target;
    bytes32 internal constant CHANNEL = keccak256("channel");
    bytes32 internal constant FORK = keccak256("fork");
    uint256 internal constant KEY = 12345;
    address internal disputer;

    function setUp() public {
        vm.warp(100);
        disputer = vm.addr(KEY);
        target = new DisputeWindowAdmissionHarness();
        target.seedChannel(CHANNEL, disputer, vm.addr(67890));
    }

    function _confirmation(bool required, bool withCalldata)
        internal
        returns (DisputeConfirmation memory confirmation, DisputeAuditingData memory auditing)
    {
        Dispute memory dispute;
        dispute.input.channelId = CHANNEL;
        dispute.input.forkId = FORK;
        dispute.input.disputer = disputer;
        dispute.input.requireExistingDisputeWindow = required;
        dispute.postedAuditingData = withCalldata;
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditing));
        confirmation.signedDispute.encodedDispute = abi.encode(dispute);
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encode(dispute))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, digest);
        confirmation.signedDispute.signature = abi.encodePacked(r, s, v);
    }

    function _upload(bool required, bool withCalldata) internal {
        (DisputeConfirmation memory confirmation, DisputeAuditingData memory auditing) =
            _confirmation(required, withCalldata);
        vm.prank(disputer);
        if (withCalldata) target.uploadDisputeWithCalldata(confirmation, auditing);
        else target.uploadDispute(confirmation);
    }

    function _state() internal view returns (bytes32) {
        (uint256 created, uint256 last, uint256 count, uint256 posted, uint256 throttle) =
            target.readAdmissionState(CHANNEL, FORK, disputer);
        return keccak256(abi.encode(created, last, count, posted, throttle));
    }

    function _refused(bool withCalldata) internal {
        bytes32 beforeState = _state();
        vm.expectRevert(abi.encodeWithSelector(RaceConditionDisputeWindowNotOpen.selector, CHANNEL, FORK));
        _upload(true, withCalldata);
        assertEq(_state(), beforeState, "refusal changes no admission state");
    }

    function testFuzz_trueAbsentWindowRefused(bool withCalldata) public {
        _refused(withCalldata);
    }

    function testFuzz_trueWindowInAnotherForkRefused(bool withCalldata) public {
        target.seedWindow(CHANNEL, keccak256("other fork"), 100, true, false);
        _refused(withCalldata);
    }

    function testFuzz_trueWindowInAnotherChannelRefused(bool withCalldata) public {
        target.seedWindow(keccak256("other channel"), FORK, 100, true, false);
        _refused(withCalldata);
    }

    function testFuzz_trueBeforeDeadlineAccepted(bool withCalldata, bool populated) public {
        target.seedWindow(CHANNEL, FORK, 100, populated, false);
        vm.warp(109);
        _upload(true, withCalldata);
        (uint256 created, uint256 last, uint256 count, uint256 posted,) =
            target.readAdmissionState(CHANNEL, FORK, disputer);
        assertEq(created, 100);
        assertEq(last, 109);
        assertEq(count, populated ? 2 : 1);
        assertEq(posted, 1);
    }

    function testFuzz_trueAtDeadlineRefused(bool withCalldata, bool populated) public {
        target.seedWindow(CHANNEL, FORK, 100, populated, false);
        vm.warp(110);
        _refused(withCalldata);
    }

    function testFuzz_trueAfterDeadlineRefused(bool withCalldata, bool populated) public {
        target.seedWindow(CHANNEL, FORK, 100, populated, false);
        vm.warp(111);
        _refused(withCalldata);
    }

    function testFuzz_trueFinalizedWindowRefused(bool withCalldata) public {
        _upload(false, withCalldata);
        vm.warp(111);
        target.finalizeWindow(CHANNEL, FORK);
        _refused(withCalldata);
    }

    function testFuzz_falseAbsentWindowKeepsAdmission(bool withCalldata) public {
        _upload(false, withCalldata);
        (uint256 created,, uint256 count,,) = target.readAdmissionState(CHANNEL, FORK, disputer);
        assertEq(created, 100);
        assertEq(count, 1);
    }

    function testFuzz_falseFullyKilledExpiredWindowKeepsAdmission(bool withCalldata) public {
        target.seedWindow(CHANNEL, FORK, 100, false, false);
        vm.warp(111);
        _upload(false, withCalldata);
        (uint256 created, uint256 last, uint256 count,,) = target.readAdmissionState(CHANNEL, FORK, disputer);
        assertEq(created, 100);
        assertEq(last, 111);
        assertEq(count, 1);
    }

    function testFuzz_currentSnapshotParticipantWithOldJoinCanUpload(bool withCalldata) public {
        target.seedInboundJoin(CHANNEL, keccak256("old"), bytes32(0), disputer);
        target.seedInboundJoin(CHANNEL, keccak256("boundary"), keccak256("old"), vm.addr(67890));
        target.setInboundBoundary(CHANNEL, keccak256("boundary"));
        _upload(false, withCalldata);
    }

    function testFuzz_joinAtLatestInboundHeadCanUpload(bool withCalldata) public {
        target.clearSnapshotParticipants(CHANNEL);
        target.seedInboundJoin(CHANNEL, keccak256("boundary"), bytes32(0), vm.addr(67890));
        target.setInboundBoundary(CHANNEL, keccak256("boundary"));
        target.seedInboundJoin(CHANNEL, keccak256("head"), keccak256("boundary"), disputer);
        _upload(false, withCalldata);
    }

    function testFuzz_joinInsideInboundIntervalCanUpload(bool withCalldata) public {
        target.clearSnapshotParticipants(CHANNEL);
        target.seedInboundJoin(CHANNEL, keccak256("boundary"), bytes32(0), vm.addr(67890));
        target.setInboundBoundary(CHANNEL, keccak256("boundary"));
        target.seedInboundJoin(CHANNEL, keccak256("middle"), keccak256("boundary"), disputer);
        target.seedInboundJoin(CHANNEL, keccak256("head"), keccak256("middle"), vm.addr(98765));
        _upload(false, withCalldata);
    }

    function testFuzz_joinAtConsumedBoundaryCannotUpload(bool withCalldata) public {
        target.clearSnapshotParticipants(CHANNEL);
        target.seedInboundJoin(CHANNEL, keccak256("boundary"), bytes32(0), disputer);
        target.setInboundBoundary(CHANNEL, keccak256("boundary"));
        vm.expectRevert(abi.encodeWithSelector(ErrorCantParticipateInDispute.selector, CHANNEL, disputer));
        _upload(false, withCalldata);
    }

    function testFuzz_olderNonparticipantCannotUpload(bool withCalldata) public {
        target.clearSnapshotParticipants(CHANNEL);
        target.seedInboundJoin(CHANNEL, keccak256("old"), bytes32(0), disputer);
        target.seedInboundJoin(CHANNEL, keccak256("boundary"), keccak256("old"), vm.addr(67890));
        target.setInboundBoundary(CHANNEL, keccak256("boundary"));
        vm.expectRevert(abi.encodeWithSelector(ErrorCantParticipateInDispute.selector, CHANNEL, disputer));
        _upload(false, withCalldata);
    }

    function testFuzz_slashedSnapshotParticipantCannotUpload(bool withCalldata) public {
        target.slash(CHANNEL, disputer);
        vm.expectRevert(abi.encodeWithSelector(ErrorCantParticipateInDispute.selector, CHANNEL, disputer));
        _upload(false, withCalldata);
    }

    function testFuzz_slashedPendingJoinCannotUpload(bool withCalldata) public {
        target.clearSnapshotParticipants(CHANNEL);
        target.seedInboundJoin(CHANNEL, keccak256("head"), bytes32(0), disputer);
        target.slash(CHANNEL, disputer);
        vm.expectRevert(abi.encodeWithSelector(ErrorCantParticipateInDispute.selector, CHANNEL, disputer));
        _upload(false, withCalldata);
    }
}
