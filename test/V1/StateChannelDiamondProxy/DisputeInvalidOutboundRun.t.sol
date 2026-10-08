pragma solidity ^0.8.8;

import {StateProofStaging} from "../harness/StateProofStaging.sol";
import {DisputeInvalidOutboundRun} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {StateProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol";
import {StateSnapshotFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol";
import {
    ErrorOutboundBalanceSumOutOfGas,
    ErrorOutboundMessageBlocksInvalid
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {AStateMachine} from "../../../contracts/V1/AStateMachine.sol";
import {MathStateMachine} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The invalid-outbound-run counter: A's posted dispute ends at block 8, whose latest state has the outbound head of
/// block 3 (withdrawals 35). The outbound chain is 1 (10), 2 (20), 3 (5). The chain anchor at block 5 holds the head of
/// outbound block 1. Cut at the current anchor, the committed run must link the anchor's outbound head to the latest
/// state's; a run that does not kills the dispute and slashes its submitter. A valid run stays valid after the anchor
/// moves forward, also from an anchor on an older fork; an anchor at or above the latest head needs no run.
// test naming: test_outboundRun_<scenario>

/// UtilityFacet with a real state machine, so a run's balances reach checked `addBalance` arithmetic
contract OutboundRunVerifier is UtilityFacet {
    constructor(AStateMachine stateMachine) {
        stateMachineImplementation = stateMachine;
    }
}

/// a stand-in state machine whose `addBalance` never returns: every call runs out of gas
contract GasBurningAddBalance {
    function addBalance(Balance memory, Balance memory) external pure returns (Balance memory) {
        while (true) {}
        revert();
    }
}

/// StateSnapshotFacet with a real state machine, reaching the snapshot post's outbound-run check at its own entry
contract OutboundSnapshotPostHarness is StateSnapshotFacet {
    constructor() {
        stateMachineImplementation = new MathStateMachine(3_000_000, 32);
    }

    function updateStateSnapshot(
        bytes32 channelId,
        StateSnapshot memory currentOnChainSnapshot,
        StateSnapshot memory newSnapshot,
        MessageBlock[] memory outboundMessageBlocks
    ) external {
        _updateStateSnapshot(channelId, currentOnChainSnapshot, newSnapshot, outboundMessageBlocks, false);
    }
}

contract DisputeInvalidOutboundRunTest is StateProofStaging {
    MessageBlock internal first;
    MessageBlock internal second;
    MessageBlock internal third;

    function setUp() public {
        _stageGenesisChannel();
        first = _outbound(bytes32(0), 1, 10, 10);
        second = _outbound(keccak256(abi.encode(first)), 2, 20, 30);
        third = _outbound(keccak256(abi.encode(second)), 3, 5, 35);
    }

    /// outbound block `height` linked to `previousBlockHash`, one exit of `amount`, `total` withdrawals so far
    function _outbound(bytes32 previousBlockHash, uint256 height, uint256 amount, uint256 total)
        private
        view
        returns (MessageBlock memory outbound)
    {
        outbound.previousBlockHash = previousBlockHash;
        outbound.blockHeight = height;
        outbound.messages = new Message[](1);
        outbound.messages[0].participant = bob;
        outbound.messages[0].balance.amount = amount;
        outbound.totalBalance.amount = total;
        outbound.timestamp = 1000 + height;
    }

    /// `snapshot` whose outbound head is `head` (zero for none) at `height` with `withdrawals`
    function _withOutbound(StateSnapshot memory snapshot, MessageBlock memory head, uint256 height, uint256 withdrawals)
        private
        pure
        returns (StateSnapshot memory)
    {
        snapshot.snapshotData.latestOutboundMessageBlockHash = height == 0 ? bytes32(0) : keccak256(abi.encode(head));
        snapshot.snapshotData.latestOutboundMessageBlockHeight = height;
        snapshot.snapshotData.totalWithdrawals.amount = withdrawals;
        return snapshot;
    }

    /// moves the chain anchor to this fork's block `blockHeight` with the outbound head `head` at `height`
    function _seedOutboundAnchor(uint256 blockHeight, MessageBlock memory head, uint256 height, uint256 withdrawals)
        private
        returns (StateSnapshot memory anchor)
    {
        anchor = _withOutbound(_snapshot(blockHeight, genesisData.participants), head, height, withdrawals);
        harness.seedSnapshot(CHANNEL, anchor);
    }

    /// the latest state at block 8: outbound head block 3, withdrawals 35
    function _latest() private view returns (StateSnapshot memory) {
        return _withOutbound(_snapshot(8, genesisData.participants), third, 3, 35);
    }

    /// A's committed posted dispute over blocks 5..8, the last committing `_latest()`, posting `run`
    function _committedDispute(MessageBlock[] memory run)
        private
        returns (Dispute memory dispute, DisputeAuditingData memory auditingData)
    {
        return _committedDisputeTo(_latest(), run);
    }

    /// A's committed posted dispute over blocks 5..8, the last committing `latest`, posting `run`
    function _committedDisputeTo(StateSnapshot memory latest, MessageBlock[] memory run)
        private
        returns (Dispute memory dispute, DisputeAuditingData memory auditingData)
    {
        MilestoneProof memory milestone = _run(5, 4, keccak256("block 4"), _signers(ALICE_KEY));
        _commitAt(milestone, 3, keccak256(abi.encode(latest)), _signers(ALICE_KEY));
        (dispute, auditingData) =
            _postedDispute(_one(milestone), _entries(_snapshot(5, genesisData.participants)), latest);
        auditingData.outboundMessageBlocks = run;
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
        _commit(dispute);
    }

    function _allege(Dispute memory dispute, DisputeAuditingData memory auditingData) private {
        _apply(
            dispute,
            DisputeFraudProofType.DisputeInvalidOutboundRun,
            abi.encode(DisputeInvalidOutboundRun({auditingData: auditingData}))
        );
    }

    function _run2(MessageBlock memory a, MessageBlock memory b) private pure returns (MessageBlock[] memory run) {
        run = new MessageBlock[](2);
        run[0] = a;
        run[1] = b;
    }

    function _run3(MessageBlock memory a, MessageBlock memory b, MessageBlock memory c)
        private
        pure
        returns (MessageBlock[] memory run)
    {
        run = new MessageBlock[](3);
        run[0] = a;
        run[1] = b;
        run[2] = c;
    }

    // ==================== valid runs: the allegation fails ====================

    function test_outboundRun_runFromTheAnchorToTheLatestHeadIsValid() public {
        _seedOutboundAnchor(5, first, 1, 10);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _committedDispute(_run2(second, third));
        _allege(dispute, auditingData);
        _assertRejected(dispute);
    }

    function test_outboundRun_runBuiltAtAnOlderAnchorStaysValidAfterTheAnchorMoves() public {
        // built while the anchor had no outbound block: the run starts at block 1
        harness.seedSnapshot(CHANNEL, genesis);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _committedDispute(_run3(first, second, third));
        // the anchor moves to block 6, holding outbound block 2: blocks 1 and 2 are cut off
        _seedOutboundAnchor(6, second, 2, 30);
        _allege(dispute, auditingData);
        _assertRejected(dispute);
    }

    function test_outboundRun_anchorOnAnOlderForkIsAStartAcrossTheForkGenesis() public {
        StateSnapshot memory olderForkAnchor = _withOutbound(_snapshot(9, genesisData.participants), first, 1, 10);
        olderForkAnchor.forkId = keccak256("older fork");
        harness.seedSnapshot(CHANNEL, olderForkAnchor);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _committedDispute(_run2(second, third));
        _allege(dispute, auditingData);
        _assertRejected(dispute);
    }

    function test_outboundRun_emptyRunIsValidWhenTheAnchorHoldsTheLatestHead() public {
        _seedOutboundAnchor(8, third, 3, 35);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _committedDispute(new MessageBlock[](0));
        _allege(dispute, auditingData);
        _assertRejected(dispute);
    }

    function test_outboundRun_runBelowAnAnchorAtTheLatestHeadIsCutOff() public {
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _committedDispute(_run2(second, third));
        _seedOutboundAnchor(8, third, 3, 35);
        _allege(dispute, auditingData);
        _assertRejected(dispute);
    }

    function test_outboundRun_emptyRunIsValidWhenTheAnchorIsAboveTheLatestHead() public {
        MessageBlock memory fourth = _outbound(keccak256(abi.encode(third)), 4, 1, 36);
        _seedOutboundAnchor(9, fourth, 4, 36);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _committedDispute(new MessageBlock[](0));
        _allege(dispute, auditingData);
        _assertRejected(dispute);
    }

    // ==================== invalid runs: the dispute is killed ====================

    function test_outboundRun_missingBlockAboveTheAnchorKills() public {
        _seedOutboundAnchor(5, first, 1, 10);
        MessageBlock[] memory run = new MessageBlock[](1);
        run[0] = third;
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _committedDispute(run);
        _allege(dispute, auditingData);
        _assertKilled(dispute);
    }

    function test_outboundRun_emptyRunBelowTheLatestHeadKills() public {
        _seedOutboundAnchor(5, first, 1, 10);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _committedDispute(new MessageBlock[](0));
        _allege(dispute, auditingData);
        _assertKilled(dispute);
    }

    function test_outboundRun_forgedBlockKills() public {
        _seedOutboundAnchor(5, first, 1, 10);
        MessageBlock memory forged = _outbound(keccak256(abi.encode(first)), 2, 25, 35);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _committedDispute(_run2(forged, third));
        _allege(dispute, auditingData);
        _assertKilled(dispute);
    }

    function test_outboundRun_forgedLinkKills() public {
        _seedOutboundAnchor(5, first, 1, 10);
        MessageBlock memory unlinked = _outbound(keccak256("not outbound block 2"), 3, 5, 35);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _committedDispute(_run2(second, unlinked));
        _allege(dispute, auditingData);
        _assertKilled(dispute);
    }

    function test_outboundRun_extraBlockAboveTheLatestHeadKills() public {
        _seedOutboundAnchor(5, first, 1, 10);
        MessageBlock memory fourth = _outbound(keccak256(abi.encode(third)), 4, 1, 36);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _committedDispute(_run3(second, third, fourth));
        _allege(dispute, auditingData);
        _assertKilled(dispute);
    }

    /// a forged block that keeps block 2's predecessor and height; its balance overflows the anchor's withdrawals
    function _overflowingSecond() private view returns (MessageBlock memory forged) {
        forged = _outbound(keccak256(abi.encode(first)), 2, 0, 30);
        forged.messages[0].balance.amount = type(uint256).max;
    }

    function test_outboundRun_overflowingBalanceKills() public {
        _seedOutboundAnchor(5, first, 1, 10);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _committedDispute(_run2(_overflowingSecond(), third));
        _allege(dispute, auditingData);
        _assertKilled(dispute);
    }

    function test_outboundRun_overflowingBalanceIsInvalidNotARevert() public {
        OutboundRunVerifier verifier = new OutboundRunVerifier(new MathStateMachine(3_000_000, 32));
        StateSnapshot memory anchor = _withOutbound(_snapshot(5, genesisData.participants), first, 1, 10);
        (bool isValid, MessageBlock[] memory aboveAnchor) = verifier.verifyOutboundRunAboveAnchor(
            _run2(_overflowingSecond(), third), anchor.snapshotData, _latest().snapshotData
        );
        assertFalse(isValid);
        assertEq(aboveAnchor.length, 2);
        // the same run with the genuine block 2 is valid
        (isValid,) =
            verifier.verifyOutboundRunAboveAnchor(_run2(second, third), anchor.snapshotData, _latest().snapshotData);
        assertTrue(isValid);
    }

    /// a latest state at block 8 signed only by its author, whose outbound head is `_overflowingSecond()` right above
    /// the anchor's head: links, height and endpoint pass, so the balance reaches `addBalance`
    function _forgedLatest() private view returns (StateSnapshot memory) {
        return _withOutbound(_snapshot(8, genesisData.participants), _overflowingSecond(), 2, 30);
    }

    function _overflowingRun() private view returns (MessageBlock[] memory run) {
        run = new MessageBlock[](1);
        run[0] = _overflowingSecond();
    }

    function test_outboundRun_latestHeadAtAnOverflowingBlockIsInvalidNotARevert() public {
        OutboundRunVerifier verifier = new OutboundRunVerifier(new MathStateMachine(3_000_000, 32));
        StateSnapshot memory anchor = _withOutbound(_snapshot(5, genesisData.participants), first, 1, 10);
        (bool isValid, MessageBlock[] memory aboveAnchor) =
            verifier.verifyOutboundRunAboveAnchor(_overflowingRun(), anchor.snapshotData, _forgedLatest().snapshotData);
        assertFalse(isValid);
        assertEq(aboveAnchor.length, 1);
    }

    function test_outboundRun_latestHeadAtAnOverflowingBlockKills() public {
        _seedOutboundAnchor(5, first, 1, 10);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _committedDisputeTo(_forgedLatest(), _overflowingRun());
        assertTrue(
            StateProofFacet(address(harness)).isDisputeOutboundRunInvalid(
                dispute, DisputeInvalidOutboundRun({auditingData: auditingData})
            )
        );
        _allege(dispute, auditingData);
        _assertKilled(dispute);
    }

    function test_outboundRun_snapshotPostWithAnOverflowingHeadRejectsTheRun() public {
        OutboundSnapshotPostHarness facet = new OutboundSnapshotPostHarness();
        StateSnapshot memory anchor = _withOutbound(_snapshot(5, genesisData.participants), first, 1, 10);
        vm.expectRevert(
            abi.encodeWithSelector(ErrorOutboundMessageBlocksInvalid.selector, keccak256(abi.encode(first)), 1, 1)
        );
        facet.updateStateSnapshot(CHANNEL, anchor, _forgedLatest(), _overflowingRun());
    }

    function test_outboundRun_outOfGasInTheSumIsNoVerdict() public {
        OutboundRunVerifier verifier = new OutboundRunVerifier(AStateMachine(address(new GasBurningAddBalance())));
        StateSnapshot memory anchor = _withOutbound(_snapshot(5, genesisData.participants), first, 1, 10);
        vm.expectRevert(ErrorOutboundBalanceSumOutOfGas.selector);
        verifier.verifyOutboundRunAboveAnchor{gas: 1_000_000}(
            _run2(second, third), anchor.snapshotData, _latest().snapshotData
        );
    }

    // ==================== no evidence: the allegation fails ====================

    function test_outboundRun_dataOtherThanTheCommittedDataIsNoEvidence() public {
        _seedOutboundAnchor(5, first, 1, 10);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _committedDispute(_run2(second, third));
        auditingData.outboundMessageBlocks = new MessageBlock[](0);
        _allege(dispute, auditingData);
        _assertRejected(dispute);
    }

    function test_outboundRun_omittedDataIsNoEvidence() public {
        _seedOutboundAnchor(5, first, 1, 10);
        StateSnapshot memory latest = _latest();
        MilestoneProof memory milestone = _run(5, 4, keccak256("block 4"), _signers(ALICE_KEY));
        _commitAt(milestone, 3, keccak256(abi.encode(latest)), _signers(ALICE_KEY));
        Dispute memory dispute = _dispute(_one(milestone));
        DisputeAuditingData memory auditingData;
        auditingData.latestStateSnapshot = latest;
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
        _commit(dispute);
        _allege(dispute, auditingData);
        _assertRejected(dispute);
    }

    function test_outboundRun_postedLatestStateOtherThanTheDisputesIsNoEvidence() public {
        _seedOutboundAnchor(5, first, 1, 10);
        StateSnapshot memory latest = _latest();
        MilestoneProof memory milestone = _run(5, 4, keccak256("block 4"), _signers(ALICE_KEY));
        _commitAt(milestone, 3, keccak256(abi.encode(latest)), _signers(ALICE_KEY));
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _postedDispute(_one(milestone), _entries(_snapshot(5, genesisData.participants)), latest);
        // committed, but its latest state is not the dispute's: the state-proof counter owns that fault
        auditingData.latestStateSnapshot.timestamp += 1;
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
        _commit(dispute);
        _allege(dispute, auditingData);
        _assertRejected(dispute);
    }
}
