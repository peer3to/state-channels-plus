pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import "../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol";
import "../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol";
import {InboundSeeding} from "../harness/InboundSeeding.sol";

contract ThresholdShortcutChainSlashesHarness is DisputeManagerFacet, DisputeVerificationFacet, InboundSeeding {
    constructor() {
        evidenceTime = 10;
        utilityFacetAddress = address(new UtilityFacet());
        maxDisputeUploadBytes = type(uint256).max;
    }

    function seedParticipants(bytes32 channelId, address[] memory participants) external {
        stateSnapshots[channelId].snapshotData.participants = participants;
    }

    /// records a chain slash through the production writer
    function slash(bytes32 channelId, address participant) external {
        addOnChainSlashedParticipant(channelId, participant);
    }

    function readWindow(bytes32 channelId, bytes32 forkId)
        external
        view
        returns (uint256 created, uint256 lastEvidence, uint256 commitments, bytes32 reducedForkId)
    {
        DisputeWindow storage window = disputeData[channelId].disputeWindowMap[forkId];
        return (
            window.evidence.creationTimestamp,
            window.evidence.lastEvidenceSubmissionTimestamp,
            window.evidence.disputeCommitments.length,
            window.reducedResult.forkId
        );
    }
}

/// The threshold-final shortcut commits a dispute's own output at upload and skips `reduce`, which folds the chain
/// slashes. The channel seats the disputer, Bob and Carol; slashing Bob and Carol leaves the disputer as the whole
/// threshold set, so the disputer's own signature reaches it.
// test naming: test_<targetFunction>_<property>
contract ThresholdShortcutChainSlashesTest is Test {
    ThresholdShortcutChainSlashesHarness internal target;
    bytes32 internal constant CHANNEL = keccak256("threshold-shortcut-channel");
    bytes32 internal constant FORK = keccak256("threshold-shortcut-fork");
    bytes32 internal constant CLAIMED_OUTPUT = keccak256("the dispute's claimed output");
    uint256 internal constant DISPUTER_KEY = 0xD15;
    uint256 internal constant UPLOAD_TIME = 100;
    uint256 internal constant EVIDENCE_TIME = 10;
    address internal disputer;
    address internal bob;
    address internal carol;
    address internal outsider;
    bytes32 internal inboundHead;
    uint256 internal inboundHeight;

    function setUp() public {
        vm.warp(UPLOAD_TIME);
        disputer = vm.addr(DISPUTER_KEY);
        bob = vm.addr(0xB0B);
        carol = vm.addr(0xCA401);
        outsider = vm.addr(0x0B5E);
        target = new ThresholdShortcutChainSlashesHarness();
        address[] memory seated = new address[](3);
        seated[0] = disputer;
        seated[1] = bob;
        seated[2] = carol;
        target.seedParticipants(CHANNEL, seated);
    }

    function test_uploadDispute_listingEveryChainSlashedMember_finalizesAtUpload() public {
        target.slash(CHANNEL, bob);
        target.slash(CHANNEL, carol);

        _upload(_pair(bob, carol));

        _assertFinalizedAtUpload();
    }

    function test_uploadDispute_omittingOneChainSlashedMember_takesTheNormalWindowAndReduceFoldsTheSlash() public {
        target.slash(CHANNEL, bob);
        target.slash(CHANNEL, carol);

        Dispute memory dispute = _upload(_one(bob));

        _assertNormalWindow();
        vm.warp(UPLOAD_TIME + EVIDENCE_TIME);
        Dispute[] memory committed = new Dispute[](1);
        committed[0] = dispute;
        ReduceOutput memory reduced = target.reduce(committed);
        assertEq(
            abi.encode(reduced.slashedParticipants),
            abi.encode(_pair(bob, carol)),
            "the window-end reduction removes both chain-slashed members"
        );
    }

    function test_uploadDispute_chainSlashedNonMemberUnlisted_stillFinalizesAtUpload() public {
        target.slash(CHANNEL, bob);
        target.slash(CHANNEL, carol);
        target.slash(CHANNEL, outsider);

        _upload(_pair(bob, carol));

        _assertFinalizedAtUpload();
    }

    function test_uploadDispute_omittingAChainSlashedPendingJoiner_takesTheNormalWindow() public {
        address joiner = vm.addr(0x701E);
        target.seedInboundJoins(CHANNEL, keccak256("joiner's JOIN"), bytes32(0), 1, UPLOAD_TIME, _one(joiner));
        inboundHead = keccak256("joiner's JOIN");
        inboundHeight = 1;
        target.slash(CHANNEL, bob);
        target.slash(CHANNEL, carol);
        target.slash(CHANNEL, joiner);

        _upload(_pair(bob, carol));

        _assertNormalWindow();
    }

    function _upload(address[] memory listedSlashes) internal returns (Dispute memory dispute) {
        dispute.input.channelId = CHANNEL;
        dispute.input.forkId = FORK;
        dispute.input.disputer = disputer;
        dispute.input.latestInboundMessageBlockHash = inboundHead;
        dispute.input.lastInboundMessageBlockHeight = inboundHeight;
        dispute.input.onChainSlashes = listedSlashes;
        dispute.outputSnapshotDataHash = CLAIMED_OUTPUT;
        DisputeConfirmation memory confirmation;
        confirmation.signedDispute.encodedDispute = abi.encode(dispute);
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encode(dispute))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(DISPUTER_KEY, digest);
        confirmation.signedDispute.signature = abi.encodePacked(r, s, v);
        vm.prank(disputer);
        target.uploadDispute(confirmation);
    }

    function _assertFinalizedAtUpload() internal view {
        (uint256 created, uint256 lastEvidence, uint256 commitments, bytes32 reducedForkId) =
            target.readWindow(CHANNEL, FORK);
        assertEq(reducedForkId, CLAIMED_OUTPUT, "the dispute's own output is the reduced result");
        assertEq(created, UPLOAD_TIME - EVIDENCE_TIME, "the evidence period is back-dated");
        assertEq(lastEvidence, UPLOAD_TIME - EVIDENCE_TIME, "the kill period is back-dated");
        assertEq(commitments, 1);
    }

    function _assertNormalWindow() internal view {
        (uint256 created, uint256 lastEvidence, uint256 commitments, bytes32 reducedForkId) =
            target.readWindow(CHANNEL, FORK);
        assertEq(reducedForkId, bytes32(0), "no reduced result at upload");
        assertEq(created, UPLOAD_TIME, "the evidence period starts at upload");
        assertEq(lastEvidence, UPLOAD_TIME, "the kill period runs from upload");
        assertEq(commitments, 1);
    }

    function _one(address account) internal pure returns (address[] memory accounts) {
        accounts = new address[](1);
        accounts[0] = account;
    }

    function _pair(address first, address second) internal pure returns (address[] memory accounts) {
        accounts = new address[](2);
        accounts[0] = first;
        accounts[1] = second;
    }
}
