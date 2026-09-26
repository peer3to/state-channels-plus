pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {DisputeFraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol";
import {DisputeVerificationFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol";
import {StateProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol";
import {StateSnapshotFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {_delegatecall} from "../../../contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol";
import {MathStateMachine} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {
    DisputeInvalidStateProof,
    DisputeLastMilestoneNotFinalAndNoAuditingData
} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import {MESSAGE_TYPE_JOIN} from "../../../contracts/V1/types/MessageTypeHashes.sol";
import "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

uint256 constant PK_A = 0xA11CE;
uint256 constant PK_B = 0xB0B;
uint256 constant PK_C = 0xC0FFEE;

function _keys(uint256 first) pure returns (uint256[] memory keys) {
    keys = new uint256[](1);
    keys[0] = first;
}

function _keys(uint256 first, uint256 second) pure returns (uint256[] memory keys) {
    keys = new uint256[](2);
    keys[0] = first;
    keys[1] = second;
}

function _keys(uint256 first, uint256 second, uint256 third) pure returns (uint256[] memory keys) {
    keys = new uint256[](3);
    keys[0] = first;
    keys[1] = second;
    keys[2] = third;
}

function _addresses(address first) pure returns (address[] memory addresses) {
    addresses = new address[](1);
    addresses[0] = first;
}

function _addresses(address first, address second) pure returns (address[] memory addresses) {
    addresses = new address[](2);
    addresses[0] = first;
    addresses[1] = second;
}

function _addresses(address first, address second, address third) pure returns (address[] memory addresses) {
    addresses = new address[](3);
    addresses[0] = first;
    addresses[1] = second;
    addresses[2] = third;
}

/// StateProofFacet and StateSnapshotFacet both declare `_verifyMilestones`, so the
/// predicate's `isMilestoneFinal` self-call is routed like the proxy fallback does.
contract MilestoneFinalityFreezeHarness is DisputeFraudProofFacet, DisputeVerificationFacet, StateSnapshotFacet {
    constructor() {
        evidenceTime = 10;
        utilityFacetAddress = address(new UtilityFacet());
        stateProofFacetAddress = address(new StateProofFacet());
        disputeVerificationFacetAddress = address(this);
        stateMachineImplementation = new MathStateMachine(3_000_000, 32);
    }

    fallback() external {
        bytes memory result = _delegatecall(stateProofFacetAddress, msg.data);
        assembly ("memory-safe") {
            return(add(result, 32), mload(result))
        }
    }

    /// seeds the committed dispute window the way uploadDispute leaves it
    function seedWindow(bytes32 channelId, bytes32 forkId, Dispute memory dispute) external {
        DisputeWindow storage window = disputeData[channelId].disputeWindowMap[forkId];
        window.forkId = forkId;
        window.evidence.creationTimestamp = block.timestamp;
        window.evidence.lastEvidenceSubmissionTimestamp = block.timestamp;
        window.evidence.disputeCommitments.push(keccak256(abi.encode(dispute)));
        window.evidence.hasPosted.push(dispute.input.disputer);
        disputeData[channelId].disputedForks.push(forkId);
    }

    /// the chain snapshot sits on `fromForkId`, whose window expired and reduced to `toForkId` a challenge period ago
    function seedReducedFork(bytes32 channelId, bytes32 fromForkId, bytes32 toForkId)
        external
        returns (uint256 genesisTimestamp)
    {
        stateSnapshots[channelId].forkId = fromForkId;
        DisputeWindow storage window = disputeData[channelId].disputeWindowMap[fromForkId];
        window.forkId = fromForkId;
        window.evidence.creationTimestamp = block.timestamp - 2 * evidenceTime;
        window.evidence.lastEvidenceSubmissionTimestamp = block.timestamp - 2 * evidenceTime;
        window.reducedResult.forkId = toForkId;
        window.reducedResult.timestamp = block.timestamp - evidenceTime;
        disputeData[channelId].disputedForks.push(fromForkId);
        return block.timestamp - evidenceTime;
    }

    /// `forkId`'s window expired and reduced to `toForkId` a challenge period ago; the chain snapshot stays put
    function seedExpiredReducedWindow(bytes32 channelId, bytes32 forkId, bytes32 toForkId) external {
        DisputeWindow storage window = disputeData[channelId].disputeWindowMap[forkId];
        window.forkId = forkId;
        window.evidence.creationTimestamp = block.timestamp - 2 * evidenceTime;
        window.evidence.lastEvidenceSubmissionTimestamp = block.timestamp - 2 * evidenceTime;
        window.reducedResult.forkId = toForkId;
        window.reducedResult.timestamp = block.timestamp - evidenceTime;
        disputeData[channelId].disputedForks.push(forkId);
    }

    /// `forkId`'s window expired and was reduced to `toForkId` just now: its challenge period is still open
    function seedPendingReducedWindow(bytes32 channelId, bytes32 forkId, bytes32 toForkId) external {
        DisputeWindow storage window = disputeData[channelId].disputeWindowMap[forkId];
        window.forkId = forkId;
        window.evidence.creationTimestamp = block.timestamp - 2 * evidenceTime;
        window.evidence.lastEvidenceSubmissionTimestamp = block.timestamp - 2 * evidenceTime;
        window.reducedResult.forkId = toForkId;
        window.reducedResult.timestamp = block.timestamp;
        disputeData[channelId].disputedForks.push(forkId);
    }

    function commitmentCount(bytes32 channelId, bytes32 forkId) external view returns (uint256) {
        return disputeData[channelId].disputeWindowMap[forkId].evidence.disputeCommitments.length;
    }

    function isSlashed(bytes32 channelId, address participant) external view returns (bool) {
        return _isParticipantSlashedOnChain(channelId, participant);
    }

    /// what a landed `_updateStateSnapshot` writes for the participant set and inbound head
    function landSnapshot(bytes32 channelId, address[] memory participants, bytes32 inboundHash, uint256 inboundHeight)
        external
    {
        SnapshotData storage data = stateSnapshots[channelId].snapshotData;
        delete data.participants;
        for (uint256 i = 0; i < participants.length; i++) {
            data.participants.push(participants[i]);
        }
        data.latestInboundMessageBlockHash = inboundHash;
        data.latestInboundMessageBlockHeight = inboundHeight;
    }

    function seedInboundJoin(bytes32 channelId, bytes32 hash, bytes32 previous, uint256 height, address participant)
        external
    {
        MessageBlock storage inbound = inboundMessageBlockMap[channelId][hash];
        inbound.timestamp = block.timestamp;
        inbound.previousBlockHash = previous;
        inbound.blockHeight = height;
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
        channelBalances[channelId].latestInboundMessageBlockHeight = height;
    }

    function chainForkId(bytes32 channelId) external view returns (bytes32) {
        return stateSnapshots[channelId].forkId;
    }

    function clearOldInboundMessageBlocks(bytes32 channelId, bytes32 head) external {
        _clearOldInboundMessageBlocks(channelId, head);
    }

    function slash(bytes32 channelId, address participant) external {
        disputeData[channelId].onChainSlashes.push(OnChainSlash({participant: participant, timestamp: block.timestamp}));
    }
}

contract MilestoneFinalityFreezeTest is DiamondHarness {
    MilestoneFinalityFreezeHarness internal harness;

    bytes32 internal constant CHANNEL_ID = keccak256("freeze-channel");
    bytes32 internal constant FORK_ID = keccak256("freeze-fork");
    bytes32 internal constant E_FORK_ID = keccak256("fork E");
    bytes32 internal constant H0 = keccak256("open block");
    bytes32 internal constant H1 = keccak256("inbound 1");

    address internal a = vm.addr(PK_A);
    address internal b = vm.addr(PK_B);
    address internal c = vm.addr(PK_C);

    function setUp() public {
        vm.warp(1_000_000);
        harness = new MilestoneFinalityFreezeHarness();
        // the open block holds both members' joins and is the snapshot's inbound head
        harness.seedInboundJoin(CHANNEL_ID, H0, bytes32(0), 1, a);
        harness.seedInboundJoin(CHANNEL_ID, H0, bytes32(0), 1, b);
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b), H0, 1);
    }

    function test_isFinal_topUpAboveAnchor_openBlockPruned_memberStaysExpected() public {
        Dispute memory dispute = _dispute(H0, 1, new address[](0), _milestone(CHANNEL_ID, FORK_ID, _keys(PK_A)));
        harness.clearOldInboundMessageBlocks(CHANNEL_ID, H0);
        // a top-up is recorded as a JOIN, above the dispute's anchor
        harness.seedInboundJoin(CHANNEL_ID, H1, H0, 2, b);
        assertFalse(harness.isLastMilestoneFinalByEveryone(dispute), "B unsigned -> not final");

        harness.landSnapshot(CHANNEL_ID, _addresses(a, b), H1, 2);
        assertFalse(harness.isLastMilestoneFinalByEveryone(dispute), "B stays expected after the top-up");
    }

    /// forge-config: default.fuzz.runs = 64
    function testFuzz_isFinal_joinsAboveAnchor_oracle(uint8 joinCountSeed, uint8 anchorSeed, uint8 signerSeed) public {
        uint256 joinCount = bound(joinCountSeed, 1, type(uint8).max);
        uint256 anchorIndex = bound(anchorSeed, 0, joinCount);
        uint256 signerCount = bound(signerSeed, 0, joinCount);

        bytes32[] memory heads = new bytes32[](joinCount + 1);
        address[] memory joiners = new address[](joinCount);
        heads[0] = H0;
        for (uint256 i = 1; i <= joinCount; i++) {
            heads[i] = keccak256(abi.encode("inbound", i));
            joiners[i - 1] = vm.addr(0x1000 + i);
            harness.seedInboundJoin(CHANNEL_ID, heads[i], heads[i - 1], i + 1, joiners[i - 1]);
        }

        uint256[] memory signerKeys = new uint256[](signerCount + 2);
        signerKeys[0] = PK_A;
        signerKeys[1] = PK_B;
        for (uint256 i = 0; i < signerCount; i++) {
            signerKeys[i + 2] = 0x1001 + i;
        }
        Dispute memory dispute =
            _dispute(heads[anchorIndex], anchorIndex + 1, new address[](0), _milestone(CHANNEL_ID, FORK_ID, signerKeys));

        // expected = {A, B} plus every join at or below the anchor, computed from the seed
        bool expectedFinal = signerCount >= anchorIndex;
        assertEq(harness.isLastMilestoneFinalByEveryone(dispute), expectedFinal, "pending joins above the anchor");

        address[] memory adopted = new address[](anchorIndex + 2);
        adopted[0] = a;
        adopted[1] = b;
        for (uint256 i = 0; i < anchorIndex; i++) {
            adopted[i + 2] = joiners[i];
        }
        harness.landSnapshot(CHANNEL_ID, adopted, heads[anchorIndex], anchorIndex + 1);
        assertEq(harness.isLastMilestoneFinalByEveryone(dispute), expectedFinal, "adopted at the anchor");
    }

    function test_isFinal_joinAtAnchor_expectedBeforeAndAfterConsumption() public {
        harness.seedInboundJoin(CHANNEL_ID, H1, H0, 2, c);
        Dispute memory signedByAB =
            _dispute(H1, 2, new address[](0), _milestone(CHANNEL_ID, FORK_ID, _keys(PK_A, PK_B)));
        Dispute memory signedByABC =
            _dispute(H1, 2, new address[](0), _milestone(CHANNEL_ID, FORK_ID, _keys(PK_A, PK_B, PK_C)));

        assertFalse(harness.isLastMilestoneFinalByEveryone(signedByAB), "pending C expected");
        assertTrue(harness.isLastMilestoneFinalByEveryone(signedByABC), "C signed");

        harness.landSnapshot(CHANNEL_ID, _addresses(a, b, c), H1, 2);
        assertFalse(harness.isLastMilestoneFinalByEveryone(signedByAB), "consumed C expected");
        assertTrue(harness.isLastMilestoneFinalByEveryone(signedByABC), "C signed after consumption");
    }

    function test_isFinal_slashAfterCommit_cannotFlipFalseToTrue() public {
        Dispute memory dispute = _dispute(H0, 1, new address[](0), _milestone(CHANNEL_ID, FORK_ID, _keys(PK_A)));
        assertFalse(harness.isLastMilestoneFinalByEveryone(dispute), "B unsigned -> not final");
        harness.seedWindow(CHANNEL_ID, FORK_ID, dispute);

        vm.warp(block.timestamp + 1);
        harness.slash(CHANNEL_ID, b);
        assertFalse(
            harness.isLastMilestoneFinalByEveryone(dispute), "a slash the dispute does not list changes nothing"
        );

        Dispute memory listsSlash = _dispute(H0, 1, _addresses(b), _milestone(CHANNEL_ID, FORK_ID, _keys(PK_A)));
        assertTrue(harness.isLastMilestoneFinalByEveryone(listsSlash), "the committed slash list decides");
    }

    function test_isFinal_memberSlashedOnEarlierFork_expectedUnlessListed() public {
        // B was slashed before this fork's window existed
        harness.slash(CHANNEL_ID, b);
        vm.warp(block.timestamp + 1);
        Dispute memory unlisted = _dispute(H0, 1, new address[](0), _milestone(CHANNEL_ID, FORK_ID, _keys(PK_A)));
        Dispute memory listed = _dispute(H0, 1, _addresses(b), _milestone(CHANNEL_ID, FORK_ID, _keys(PK_A)));
        assertFalse(harness.isLastMilestoneFinalByEveryone(unlisted), "construction expects the unlisted B");
        assertTrue(harness.isLastMilestoneFinalByEveryone(listed), "construction drops the listed B");

        harness.seedWindow(CHANNEL_ID, FORK_ID, unlisted);
        vm.warp(block.timestamp + 1);
        assertFalse(harness.isLastMilestoneFinalByEveryone(unlisted), "the proof expects the unlisted B");
        assertTrue(harness.isLastMilestoneFinalByEveryone(listed), "the proof drops the listed B");
    }

    function test_forgedSelfSignedMilestone_selfServingLatestState_disputerSlashed() public {
        // A forges a milestone only A signed and pins a latest state whose participants are only A
        StateSnapshot memory forgedState;
        forgedState.snapshotData.participants = _addresses(a);
        forgedState.snapshotData.latestInboundMessageBlockHash = H0;
        forgedState.snapshotData.latestInboundMessageBlockHeight = 1;
        forgedState.forkId = FORK_ID;
        forgedState.blockHeight = 1;
        Dispute memory dispute = _dispute(H0, 1, new address[](0), _milestone(CHANNEL_ID, FORK_ID, _keys(PK_A)));
        dispute.input.latestStateSnapshotHash = keccak256(abi.encode(forgedState));
        _assertNotFinalProofSlashesDisputer(dispute);
    }

    function test_forgedSelfSignedMilestone_withheldLatestState_disputerSlashed() public {
        // the committed latest state has a preimage nobody holds; the kill needs none
        Dispute memory dispute = _dispute(H0, 1, new address[](0), _milestone(CHANNEL_ID, FORK_ID, _keys(PK_A)));
        dispute.input.latestStateSnapshotHash = keccak256("withheld latest state");
        _assertNotFinalProofSlashesDisputer(dispute);
    }

    /// the chain set {A, B} decides, whatever the dispute claims as its latest state
    function _assertNotFinalProofSlashesDisputer(Dispute memory dispute) internal {
        harness.seedWindow(CHANNEL_ID, FORK_ID, dispute);
        assertFalse(harness.isLastMilestoneFinalByEveryone(dispute), "B unsigned on the chain set -> not final");
        DisputeLastMilestoneNotFinalAndNoAuditingData memory payload;
        vm.prank(b);
        harness.applyDisputeFraudProofs(
            _proof(DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData, abi.encode(payload), dispute)
        );
        assertTrue(harness.isSlashed(CHANNEL_ID, a), "the disputer owed auditing data -> slashed");
        assertFalse(harness.isSlashed(CHANNEL_ID, b), "the honest prover keeps its seat");
    }

    function test_applyDisputeFraudProofs_participantSetUnchanged_submitterSlashedNotDisputer() public {
        Dispute memory dispute = _dispute(H0, 1, new address[](0), _milestone(CHANNEL_ID, FORK_ID, _keys(PK_A, PK_B)));
        harness.seedWindow(CHANNEL_ID, FORK_ID, dispute);

        DisputeLastMilestoneNotFinalAndNoAuditingData memory payload;
        vm.prank(b);
        harness.applyDisputeFraudProofs(
            _proof(DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData, abi.encode(payload), dispute)
        );

        assertFalse(harness.isSlashed(CHANNEL_ID, a), "honest disputer not slashed");
        assertTrue(harness.isSlashed(CHANNEL_ID, b), "invalid proof slashes the submitter");
        assertEq(harness.commitmentCount(CHANNEL_ID, FORK_ID), 1, "dispute stays committed");
    }

    function test_disputeInvalidStateProof_noCalldata_frozenSet_slashesDisputer() public {
        SnapshotData memory genesis;
        genesis.participants = _addresses(a, b);
        genesis.latestInboundMessageBlockHash = H0;
        genesis.latestInboundMessageBlockHeight = 1;
        bytes32 genesisForkId = keccak256(abi.encode(genesis));

        Dispute memory dispute =
            _dispute(H0, 1, new address[](0), _milestone(CHANNEL_ID, genesisForkId, _keys(PK_A, PK_B)));
        dispute.input.forkId = genesisForkId;
        SignedBlock[] memory signedBlocks = new SignedBlock[](2);
        signedBlocks[0] = _makeSignedGenesisBlock(PK_A, CHANNEL_ID, genesisForkId, 1, bytes32(0));
        signedBlocks[1] = _makeSignedBlock(PK_A, CHANNEL_ID, genesisForkId, 1, 2, keccak256("not the genesis block"));
        dispute.input.stateProof.signedBlocks = signedBlocks;
        assertTrue(harness.isLastMilestoneFinalByEveryone(dispute), "final against the frozen set");
        harness.seedWindow(CHANNEL_ID, genesisForkId, dispute);

        DisputeInvalidStateProof memory payload;
        payload.auditingData.genesisStateSnapshotData = genesis;
        vm.prank(b);
        harness.applyDisputeFraudProofs(
            _proof(DisputeFraudProofType.DisputeInvalidStateProof, abi.encode(payload), dispute)
        );

        assertTrue(harness.isSlashed(CHANNEL_ID, a), "unlinked signed blocks slash the disputer");
        assertFalse(harness.isSlashed(CHANNEL_ID, b), "valid proof keeps the submitter");
    }

    function test_forkUpdate_refusedOntoDisputedTarget_verdictUnchanged() public {
        // the chain still holds fork E; E reduced to F2 = {A, B}, and F2 already has a dispute whose
        // committed set still holds C
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b, c), H0, 1);
        StateSnapshot memory genesis = _reducedGenesis(E_FORK_ID, _addresses(a, b));
        genesis.timestamp = harness.seedReducedFork(CHANNEL_ID, E_FORK_ID, genesis.forkId);
        Dispute memory dispute =
            _dispute(H0, 1, new address[](0), _milestone(CHANNEL_ID, genesis.forkId, _keys(PK_A, PK_B)));
        dispute.input.forkId = genesis.forkId;
        harness.seedWindow(CHANNEL_ID, genesis.forkId, dispute);
        assertFalse(harness.isLastMilestoneFinalByEveryone(dispute), "C unsigned -> not final");

        // F2 is the latest fork but disputed -> the adoption is refused, the chain stays on E
        vm.expectRevert(
            abi.encodeWithSelector(RaceConditionSnapshotUpdateDisputedFork.selector, CHANNEL_ID, genesis.forkId)
        );
        harness.updateStateSnapshotFork(CHANNEL_ID, genesis, new MessageBlock[](0));
        assertEq(harness.chainForkId(CHANNEL_ID), E_FORK_ID, "the chain stays on E");
        assertFalse(harness.isLastMilestoneFinalByEveryone(dispute), "the verdict is unchanged");

        DisputeLastMilestoneNotFinalAndNoAuditingData memory payload;
        vm.prank(b);
        harness.applyDisputeFraudProofs(
            _proof(DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData, abi.encode(payload), dispute)
        );
        assertTrue(harness.isSlashed(CHANNEL_ID, a), "the disputer owed auditing data -> slashed");
        assertFalse(harness.isSlashed(CHANNEL_ID, b), "the honest challenger keeps its seat");
    }

    function test_forkUpdate_unlinkedTarget_revertsStateSnapshotNotValid() public {
        StateSnapshot memory genesis = _reducedGenesis(E_FORK_ID, _addresses(a, b));
        genesis.timestamp = harness.seedReducedFork(CHANNEL_ID, E_FORK_ID, keccak256("another fork"));
        Dispute memory dispute =
            _dispute(H0, 1, new address[](0), _milestone(CHANNEL_ID, genesis.forkId, _keys(PK_A, PK_B)));
        harness.seedWindow(CHANNEL_ID, genesis.forkId, dispute);

        vm.expectRevert(abi.encodeWithSelector(ErrorStateSnapshotNotValid.selector, E_FORK_ID, genesis.forkId));
        harness.updateStateSnapshotFork(CHANNEL_ID, genesis, new MessageBlock[](0));
    }

    function test_forkUpdate_ancestorAdoptionRefusedNotLatest_honestChallengerNotSlashed() public {
        (StateSnapshot memory forkF, Dispute memory dispute) = _stageDescendantKillPeriod();

        // the disputer tries to shrink the chain set to {A, B} before the challenge lands -> F is not the latest fork
        vm.expectRevert(
            abi.encodeWithSelector(
                RaceConditionSnapshotUpdateNotLatestFork.selector, forkF.forkId, dispute.input.forkId
            )
        );
        vm.prank(a);
        harness.updateStateSnapshotFork(CHANNEL_ID, forkF, new MessageBlock[](0));
        assertEq(harness.chainForkId(CHANNEL_ID), E_FORK_ID, "the chain stays on E");
        assertFalse(harness.isLastMilestoneFinalByEveryone(dispute), "G's verdict unchanged");

        DisputeLastMilestoneNotFinalAndNoAuditingData memory payload;
        vm.prank(b);
        harness.applyDisputeFraudProofs(
            _proof(DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData, abi.encode(payload), dispute)
        );
        assertTrue(harness.isSlashed(CHANNEL_ID, a), "the disputer owed auditing data -> slashed");
        assertFalse(harness.isSlashed(CHANNEL_ID, b), "the honest challenger keeps its seat");
    }

    function test_forkUpdate_intermediateTargetRefused_latestLands() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b, c), H0, 1);
        StateSnapshot memory forkF = _reducedGenesis(E_FORK_ID, _addresses(a, b));
        forkF.timestamp = harness.seedReducedFork(CHANNEL_ID, E_FORK_ID, forkF.forkId);
        StateSnapshot memory forkG = _reducedGenesis(forkF.forkId, _addresses(a));
        // F's window is seeded with the same timing as E's, so G's genesis time equals F's
        forkG.timestamp = forkF.timestamp;
        harness.seedExpiredReducedWindow(CHANNEL_ID, forkF.forkId, forkG.forkId);

        vm.expectRevert(
            abi.encodeWithSelector(RaceConditionSnapshotUpdateNotLatestFork.selector, forkF.forkId, forkG.forkId)
        );
        harness.updateStateSnapshotFork(CHANNEL_ID, forkF, new MessageBlock[](0));
        assertEq(harness.chainForkId(CHANNEL_ID), E_FORK_ID, "the intermediate fork is refused");

        harness.updateStateSnapshotFork(CHANNEL_ID, forkG, new MessageBlock[](0));
        assertEq(harness.chainForkId(CHANNEL_ID), forkG.forkId, "the latest fork lands");
    }

    function test_forkUpdate_walkStopsAtUnexpiredLink_beyondIsUnreachable() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b, c), H0, 1);
        StateSnapshot memory forkF = _reducedGenesis(E_FORK_ID, _addresses(a, b));
        forkF.timestamp = harness.seedReducedFork(CHANNEL_ID, E_FORK_ID, forkF.forkId);
        StateSnapshot memory forkG = _reducedGenesis(forkF.forkId, _addresses(a));
        forkG.timestamp = forkF.timestamp;
        // F reduced to G just now -> that link's challenge period is still open
        harness.seedPendingReducedWindow(CHANNEL_ID, forkF.forkId, forkG.forkId);

        vm.expectRevert(abi.encodeWithSelector(ErrorStateSnapshotNotValid.selector, E_FORK_ID, forkG.forkId));
        harness.updateStateSnapshotFork(CHANNEL_ID, forkG, new MessageBlock[](0));
        assertEq(harness.chainForkId(CHANNEL_ID), E_FORK_ID, "G is past an unexpired link");
    }

    function test_forkUpdate_walkStopsAtUnexpiredLink_disputedLatestRefused() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b, c), H0, 1);
        StateSnapshot memory forkF = _reducedGenesis(E_FORK_ID, _addresses(a, b));
        forkF.timestamp = harness.seedReducedFork(CHANNEL_ID, E_FORK_ID, forkF.forkId);
        harness.seedPendingReducedWindow(CHANNEL_ID, forkF.forkId, keccak256("fork G"));

        // the walk ends at F, which is disputed
        vm.expectRevert(
            abi.encodeWithSelector(RaceConditionSnapshotUpdateDisputedFork.selector, CHANNEL_ID, forkF.forkId)
        );
        harness.updateStateSnapshotFork(CHANNEL_ID, forkF, new MessageBlock[](0));
        assertEq(harness.chainForkId(CHANNEL_ID), E_FORK_ID, "the disputed latest fork is refused");
    }

    /// chain on E = {A, B, C}; E reduced to F = {A, B} (expired, reduced to G); G holds A's committed dispute whose
    /// last milestone C never signed, inside G's kill period
    function _stageDescendantKillPeriod() internal returns (StateSnapshot memory forkF, Dispute memory dispute) {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b, c), H0, 1);
        forkF = _reducedGenesis(E_FORK_ID, _addresses(a, b));
        forkF.timestamp = harness.seedReducedFork(CHANNEL_ID, E_FORK_ID, forkF.forkId);
        bytes32 forkG = keccak256("fork G");
        harness.seedExpiredReducedWindow(CHANNEL_ID, forkF.forkId, forkG);
        dispute = _dispute(H0, 1, new address[](0), _milestone(CHANNEL_ID, forkG, _keys(PK_A, PK_B)));
        dispute.input.forkId = forkG;
        harness.seedWindow(CHANNEL_ID, forkG, dispute);
        assertFalse(harness.isLastMilestoneFinalByEveryone(dispute), "C unsigned -> not final");
    }

    function _reducedGenesis(bytes32 originForkId, address[] memory participants)
        internal
        pure
        returns (StateSnapshot memory genesis)
    {
        genesis.snapshotData.participants = participants;
        genesis.snapshotData.latestInboundMessageBlockHash = H0;
        genesis.snapshotData.latestInboundMessageBlockHeight = 1;
        genesis.snapshotData.originForkId = originForkId;
        genesis.forkId = keccak256(abi.encode(genesis.snapshotData));
    }

    function _dispute(
        bytes32 anchorHash,
        uint256 anchorHeight,
        address[] memory onChainSlashes,
        MilestoneProof memory lastMilestone
    ) internal view returns (Dispute memory dispute) {
        dispute.input.channelId = CHANNEL_ID;
        dispute.input.forkId = FORK_ID;
        dispute.input.disputer = a;
        dispute.input.latestInboundMessageBlockHash = anchorHash;
        dispute.input.lastInboundMessageBlockHeight = anchorHeight;
        dispute.input.onChainSlashes = onChainSlashes;
        dispute.input.stateProof.milestones = new MilestoneProof[](1);
        dispute.input.stateProof.milestones[0] = lastMilestone;
    }

    function _proof(DisputeFraudProofType proofType, bytes memory encodedProof, Dispute memory dispute)
        internal
        view
        returns (DisputeFraudProof[] memory proofs)
    {
        proofs = new DisputeFraudProof[](1);
        proofs[0] =
            DisputeFraudProof({proofType: proofType, participant: a, encodedProof: encodedProof, dispute: dispute});
    }
}

/// the real routed diamond: a window opened by a real upload, adoptions through `updateStateSnapshotSameFork`
contract SameForkSnapshotKillPeriodTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    bytes32 internal constant CHANNEL = keccak256("kill-period-channel");
    bytes32 internal constant LEAVE_CHANNEL = keccak256("leave-channel");
    uint256 internal constant PK_D = 0xDA7E;
    uint256 internal constant PK_E = 0xE7E;

    function setUp() public {
        vm.warp(1_000_000);
        diamond = deployDiamond();
        _openChannel(CHANNEL, _keys(PK_A, PK_B));
    }

    function test_sameFork_refusedWhileKillPeriodOpen() public {
        _openWindow(CHANNEL, diamond.getStateSnapshot(CHANNEL).forkId, PK_A);
        vm.warp(block.timestamp + diamond.getEvidenceTime() - 1);
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshot(CHANNEL, new address[](0), _keys(PK_A, PK_B));
        bytes32 snapshotBefore = keccak256(abi.encode(diamond.getStateSnapshot(CHANNEL)));

        _expectDisputedForkRefusal(CHANNEL);
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, snapshots, new MessageBlock[](0));

        assertEq(keccak256(abi.encode(diamond.getStateSnapshot(CHANNEL))), snapshotBefore, "snapshot unchanged");
        assertEq(diamond.getOpenChannelCount(), 1, "registry unchanged");
    }

    function test_sameFork_refusedAfterKillPeriodExpiry() public {
        _openWindow(CHANNEL, diamond.getStateSnapshot(CHANNEL).forkId, PK_A);
        vm.warp(block.timestamp + diamond.getEvidenceTime());
        (, bool killPeriodExpired,,) = diamond.isKillPeriodExpired(CHANNEL, diamond.getStateSnapshot(CHANNEL).forkId);
        assertTrue(killPeriodExpired, "kill period over");
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshot(CHANNEL, new address[](0), _keys(PK_A, PK_B));

        // a disputed fork only advances by reduction, however long ago it was disputed
        _expectDisputedForkRefusal(CHANNEL);
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, snapshots, new MessageBlock[](0));
        (bool open,) = diamond.isChannelOpen(CHANNEL);
        assertTrue(open, "the close advance did not land");
    }

    function test_sameFork_windowOnOtherForkDoesNotBlock() public {
        _openWindow(CHANNEL, keccak256("other fork"), PK_A);
        _assertCloseLands();
    }

    function test_sameFork_invalidProofOnDisputedFork_revertsInvalidStateProof() public {
        bytes32 forkId = diamond.getStateSnapshot(CHANNEL).forkId;
        _openWindow(CHANNEL, forkId, PK_A);
        (, StateSnapshot[] memory snapshots) = _makeSameForkSnapshot(CHANNEL, new address[](0), _keys(PK_A, PK_B));

        vm.expectRevert(abi.encodeWithSelector(ErrorInvalidStateProof.selector, forkId, 0, snapshots.length));
        diamond.updateStateSnapshotSameFork(CHANNEL, new MilestoneProof[](0), snapshots, new MessageBlock[](0));
    }

    /// a dispute blind to a pending join is refused at upload, so it is never judged against a set it didn't see
    function test_joinPendingAtUpload_disputeBelowInboundHeadRefused() public {
        StateSnapshot memory current = diamond.getStateSnapshot(CHANNEL);

        // step 1 - dave's join lands on chain, pending above the snapshot's consumed inbound
        _join(current);
        ChannelBalance memory head = diamond.getChannelBalance(CHANNEL);

        // step 2 - alice's dispute names the snapshot's inbound, not the chain head -> refused
        (, DisputeConfirmation memory stale) = _signedDispute(
            CHANNEL,
            current.forkId,
            PK_A,
            current.snapshotData.latestInboundMessageBlockHash,
            current.snapshotData.latestInboundMessageBlockHeight
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                RaceConditionDisputeInboundNotLatest.selector,
                head.latestInboundMessageBlockHash,
                current.snapshotData.latestInboundMessageBlockHash
            )
        );
        vm.prank(vm.addr(PK_A));
        diamond.uploadDispute(stale);

        // step 3 - no window opened -> dave's adoption lands
        (MilestoneProof[] memory adoptProofs, StateSnapshot[] memory adoptSnapshots) = _makeSameForkSnapshot(
            CHANNEL, _addresses(vm.addr(PK_A), vm.addr(PK_B), vm.addr(PK_D)), _keys(PK_B, PK_A, PK_D)
        );
        diamond.updateStateSnapshotSameFork(CHANNEL, adoptProofs, adoptSnapshots, new MessageBlock[](0));
        assertEq(diamond.getStateSnapshot(CHANNEL).snapshotData.participants.length, 3, "dave adopted");
    }

    /// a leaver's signed exit posted while a dispute can still be killed
    function test_leaverExitDuringKillPeriod_honestChallengerNotSlashed() public {
        address alice = vm.addr(PK_A);
        address bob = vm.addr(PK_B);
        _openChannel(LEAVE_CHANNEL, _keys(PK_A, PK_B, PK_E));

        // step 1 - an earlier post lands with no window and prunes the open block's joins
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshot(LEAVE_CHANNEL, _addresses(alice, bob, vm.addr(PK_E)), _keys(PK_A, PK_B, PK_E));
        diamond.updateStateSnapshotSameFork(LEAVE_CHANNEL, proofs, snapshots, new MessageBlock[](0));

        // step 2 - eve left; bob disputes with a last milestone eve never signed and no auditing data
        Dispute memory dispute = _openWindow(LEAVE_CHANNEL, diamond.getStateSnapshot(LEAVE_CHANNEL).forkId, PK_B);

        // step 3 - eve's signed exit, which anyone can post, is refused on the disputed fork
        (proofs, snapshots) = _makeSameForkSnapshot(LEAVE_CHANNEL, _addresses(alice, bob), _keys(PK_E, PK_A, PK_B));
        _expectDisputedForkRefusal(LEAVE_CHANNEL);
        diamond.updateStateSnapshotSameFork(LEAVE_CHANNEL, proofs, snapshots, new MessageBlock[](0));

        // step 4 - alice proves bob owed auditing data
        _proveNotFinal(dispute, alice);

        assertFalse(diamond.isParticipantSlashedOnChain(LEAVE_CHANNEL, alice), "honest challenger not slashed");
        assertTrue(
            diamond.isParticipantSlashedOnChain(LEAVE_CHANNEL, bob), "disputer who skipped auditing data slashed"
        );
    }

    /// the same-fork refusal of `channelId`'s current fork, with the exact args
    function _expectDisputedForkRefusal(bytes32 channelId) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                RaceConditionSnapshotUpdateDisputedFork.selector, channelId, diamond.getStateSnapshot(channelId).forkId
            )
        );
    }

    /// `disputerPk` uploads a dispute on `forkId` at the chain's inbound head, its last milestone signed by alice and
    /// bob
    function _openWindow(bytes32 channelId, bytes32 forkId, uint256 disputerPk)
        internal
        returns (Dispute memory dispute)
    {
        ChannelBalance memory head = diamond.getChannelBalance(channelId);
        DisputeConfirmation memory confirmation;
        (dispute, confirmation) = _signedDispute(
            channelId, forkId, disputerPk, head.latestInboundMessageBlockHash, head.latestInboundMessageBlockHeight
        );
        vm.prank(vm.addr(disputerPk));
        diamond.uploadDispute(confirmation);
    }

    function _signedDispute(
        bytes32 channelId,
        bytes32 forkId,
        uint256 disputerPk,
        bytes32 anchorHash,
        uint256 anchorHeight
    ) internal pure returns (Dispute memory dispute, DisputeConfirmation memory confirmation) {
        dispute.input.channelId = channelId;
        dispute.input.forkId = forkId;
        dispute.input.disputer = vm.addr(disputerPk);
        dispute.input.latestInboundMessageBlockHash = anchorHash;
        dispute.input.lastInboundMessageBlockHeight = anchorHeight;
        dispute.input.stateProof.milestones = new MilestoneProof[](1);
        dispute.input.stateProof.milestones[0] = _milestone(channelId, forkId, _keys(PK_A, PK_B));
        confirmation.signedDispute =
            SignedDispute({encodedDispute: abi.encode(dispute), signature: _sign(disputerPk, abi.encode(dispute))});
    }

    /// `prover` claims the dispute's last milestone is not final and its disputer owed auditing data
    function _proveNotFinal(Dispute memory dispute, address prover) internal {
        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](1);
        DisputeLastMilestoneNotFinalAndNoAuditingData memory payload;
        proofs[0] = DisputeFraudProof({
            proofType: DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData,
            participant: dispute.input.disputer,
            encodedProof: abi.encode(payload),
            dispute: dispute
        });
        vm.prank(prover);
        diamond.applyDisputeFraudProofs(proofs);
    }

    function _assertCloseLands() internal {
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshot(CHANNEL, new address[](0), _keys(PK_A, PK_B));
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, snapshots, new MessageBlock[](0));
        (bool open,) = diamond.isChannelOpen(CHANNEL);
        assertFalse(open, "the close advance landed");
        assertEq(diamond.getOpenChannelCount(), 0);
    }

    function _join(StateSnapshot memory current) internal {
        address dave = vm.addr(PK_D);
        bytes memory encodedJoin = abi.encode(
            JoinChannel({
                channelId: CHANNEL,
                participant: dave,
                deadlineTimestamp: block.timestamp + 1 days,
                balance: Balance({amount: 0, data: ""})
            })
        );
        JoinChannelConfirmation memory joinConfirmation;
        joinConfirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encodedJoin, signature: _sign(PK_D, encodedJoin)});
        joinConfirmation.signatures = new bytes[](2);
        joinConfirmation.signatures[0] = _sign(PK_A, encodedJoin);
        joinConfirmation.signatures[1] = _sign(PK_B, encodedJoin);
        vm.prank(dave);
        diamond.joinChannel(joinConfirmation, keccak256(abi.encode(current)), current.forkId);
    }
}
