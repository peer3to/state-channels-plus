pragma solidity ^0.8.8;

import {console} from "../../../lib/forge-std/src/console.sol";
import {StateProofStaging} from "../harness/StateProofStaging.sol";
import {MathState} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {ErrorInboundMessageBlockNotStored} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {DisputeConflictsWithFinalState} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import {MESSAGE_TYPE_JOIN} from "../../../contracts/V1/types/MessageTypeHashes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The side-chain bypass of a later joiner and `DisputeFinalPointRegression`, its kill. The chain anchor is 50
/// {A, B, C, D, E}. L posts a JOIN on chain. The honest history X consumes it in the join hop at 60 (signed by A to E
/// and L) and reaches the threshold-final point F = 100, where L has won 30 from A. A to E build the side chain Y from
/// the anchor: one hop to 1000' signed by A to E alone, whose inbound head stays below L's JOIN. Y's walk counts the
/// joiners inside its own inbound interval only, so L is never required. L disputes with X, A disputes with Y, both in
/// one window.
///
/// No block of Y is at F's height, so `DisputeConflictsWithFinalState` cannot remove Y, and `reduce` would pick Y by
/// longest chain. `DisputeFinalPointRegression` kills Y: F = 100 is final with inbound height 2, and Y's latest
/// finalized point G = 1000' is above F with inbound height 1. The further cases pin the strict inbound boundary, the
/// height boundary, the anchor as G, the snapshot check, the inbound lookup, and the inbound guard on
/// `DisputeConflictsWithFinalState`: a side-chain final point below a later JOIN cannot kill the honest history, either
/// through an early milestone of the honest proof or through a block at its height.
// test naming: test_<case>_<scenario>
contract DisputeFinalPointRegressionTest is StateProofStaging {
    uint256 internal constant ERIN_KEY = 0xE121;
    uint256 internal constant JOINER_KEY = 0x10E1;
    /// the peer3 parachain runtime's per-transaction gas limit (`MAX_TRANSACTION_GAS` in src/utils/config.ts)
    uint256 internal constant MAX_TRANSACTION_GAS = 17_916_000;
    /// the parachain's per-transaction calldata limit
    uint256 internal constant MAX_CALLDATA_BYTES = 64 * 1024;

    address internal erin = vm.addr(ERIN_KEY);
    address internal joiner = vm.addr(JOINER_KEY);

    bytes32 internal openingInboundHash;
    MessageBlock internal joinInbound;
    bytes32 internal joinInboundHash;

    function setUp() public {
        _stageGenesisChannel();
        // the channel opened with A to E's JOINs (inbound height 1); L's JOIN follows at inbound height 2, unconsumed
        // by the anchor
        openingInboundHash = harness.seedInboundBlock(CHANNEL, _openingInbound());
        joinInbound = _joinBlock(openingInboundHash, 2, joiner, 50);
        joinInbound.totalBalance.amount = 550;
        joinInboundHash = harness.seedInboundBlock(CHANNEL, joinInbound);
        (StateSnapshot memory anchor,) = _mathSnapshot(50, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        harness.seedSnapshot(CHANNEL, anchor);
    }

    function test_K1_sideChainBypassingALaterJoinerLosesTheReductionToTheJoinersFinalHistory() public {
        // ---- the honest history X: the join hop at 60, then F = 100 where L won 30 from A ----
        (MilestoneProof[] memory honestMilestones, StateSnapshot[] memory honestSnapshots) = _honestHistory();
        (Dispute memory honest, DisputeAuditingData memory honestData) =
            _postedDisputeBy(joiner, honestMilestones, honestSnapshots, honestSnapshots[1]);

        // ---- the side chain Y: one compact hop from the anchor to 1000', below L's JOIN ----
        (StateSnapshot memory sideFinal, bytes memory sideState) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        (Dispute memory side, DisputeAuditingData memory sideData) =
            _postedDisputeBy(alice, _one(_hopRun(sideFinal, 1, _anchorKeys())), _entries(sideFinal), sideFinal);

        _commit(honest);
        _commit(side);

        // premise: both proofs walk valid from the on-chain anchor 50
        assertTrue(_chainAcceptsPostedProof(honest, honestData), "premise: X walks from the anchor");
        assertTrue(_chainAcceptsPostedProof(side, sideData), "premise: Y walks from the anchor without L");
        ProofWalkInput memory honestProof = _finalProof(forkId, honestMilestones, honestSnapshots);
        assertEq(_diamond().verifyMilestones(honestProof).finalizedSnapshot.blockHeight, 100, "premise: F is 100");

        // premise: DisputeConflictsWithFinalState cannot be built, Y has no checked block at F's height
        for (uint256 i = 0; i < side.input.stateProof.milestones.length; i++) {
            for (uint256 j = 0; j < side.input.stateProof.milestones[i].blockConfirmations.length; j++) {
                assertFalse(
                    _diamond()
                        .isDisputeConflictingWithFinalState(
                            side, DisputeConflictsWithFinalState(honestProof, i, j, sideFinal)
                        ),
                    "premise: no block of Y conflicts with F"
                );
            }
        }

        // premise: reduced together, Y wins by longest chain; the reduction consumes L's JOIN, so L's deposit is
        // carried into the new fork, but the new fork starts from Y's state: L's outcomes 60-100 on X are lost
        Dispute[] memory both = new Dispute[](2);
        both[0] = honest;
        both[1] = side;
        ReduceOutput memory reduced = harness.reduce(both);
        assertEq(reduced.latestBlock.transaction.header.transactionCnt, 1000, "premise: reduce picks Y's 1000'");
        assertEq(reduced.latestInboundMessageBlockHash, joinInboundHash, "premise: the reduction consumes L's JOIN");
        (SnapshotData memory nextFork, bytes memory nextState,) =
            harness.reduceOutputToSnapshotData(forkId, reduced, sideFinal, sideState, _inbound(joinInbound));
        MathState memory next = abi.decode(nextState, (MathState));
        assertEq(nextFork.participants.length, 6, "premise: L is a participant of the new fork");
        assertEq(nextFork.participants[5], joiner, "premise: L joins the new fork");
        assertEq(nextFork.totalDeposits.amount, 550, "premise: L's deposit is carried");
        assertEq(next.number, 1000, "premise: the new fork continues Y's state");
        assertEq(next.balances[0], 100, "premise: A's loss to L on X is undone");
        assertEq(next.balances[5], 50, "premise: L holds its bare deposit, not its final 80 on X");

        // the defense: L, online in the kill period, proves F = 100 final (inbound 2) and Y's latest finalized point
        // G = 1000' above it (inbound 1)
        _applyBy(
            joiner, side, DisputeFraudProofType.DisputeFinalPointRegression, _regressionProof(honestProof, sideFinal)
        );

        assertEq(harness.commitmentCount(CHANNEL, forkId), 1, "Y is killed, X stays");
        assertTrue(harness.isSlashed(CHANNEL, alice), "Y's disputer is slashed");
        assertFalse(harness.isSlashed(CHANNEL, joiner), "the challenger L keeps its seat");
        // the property: reduce over the disputes the kill period leaves keeps the joiner's final history
        assertEq(
            harness.reduce(_only(honest)).latestBlock.transaction.header.transactionCnt,
            100,
            "reduce keeps L's final outcomes 60-100 on X"
        );
    }

    // ==================== DisputeFinalPointRegression boundaries ====================

    function test_regression_latestFinalizedPointWithTheFinalPointsInboundDoesNotKill() public {
        // Y's 1000' consumed L's JOIN too (inbound 2 = F's): no inbound went missing
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _joinedSet(), _balances(100, 100, 50), joinInboundHash, 2);
        Dispute memory side = _sideDispute(sideFinal);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(_honestFinalProof(), sideFinal)
        );

        _assertRejectedBy(side, joiner);
    }

    function test_regression_latestFinalizedPointAtTheFinalHeightDoesNotKill() public {
        // Y's G is at F's height 100 with the lower inbound: not above F (a conflict at that height is another proof)
        (StateSnapshot memory sideHundred,) =
            _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(sideHundred);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(_honestFinalProof(), sideHundred)
        );

        _assertRejectedBy(side, joiner);
    }

    function test_regression_snapshotTheLatestFinalizedBlockDoesNotCommitDoesNotKill() public {
        // Y's 1000' really consumed L's JOIN (inbound 2); the challenger claims a snapshot at inbound 1 instead
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _joinedSet(), _balances(100, 100, 50), joinInboundHash, 2);
        Dispute memory side = _sideDispute(sideFinal);
        (StateSnapshot memory claimed,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(_honestFinalProof(), claimed)
        );

        _assertRejectedBy(side, joiner);
    }

    function test_regression_anchorAsTheLatestFinalizedPointDoesNotKill() public {
        // Y's only milestone is the run holding the anchor 50: its latest finalized point is the anchor itself
        Dispute memory side = _disputeBy(alice, _one(_run(50, 3, keccak256("block 49"), _anchorKeys())));
        _commit(side);
        (StateSnapshot memory claimed,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(_honestFinalProof(), claimed)
        );

        _assertRejectedBy(side, joiner);
    }

    function test_FR1_sideChainFinalPointBelowTheJoinCannotKillTheHonestDisputeThroughAnEarlyMilestone() public {
        (bytes32 topUpHash, bytes32 lateJoinHash) = _seedTopUpThenLateJoin();
        (Dispute memory honest, StateSnapshot memory honestLatestFinalized) =
            _honestDisputeOverTheLateJoin(lateJoinHash);
        // A to E's side-chain final point F' = 55 consumed E's top-up (inbound 2) but not L's JOIN
        (StateSnapshot memory sideFinal,) = _mathSnapshot(55, _anchorSet(), _balances(100, 100, 0), topUpHash, 2);
        ProofWalkInput memory sideProof =
            _finalProof(forkId, _one(_hopRun(sideFinal, 1, _anchorKeys())), _entries(sideFinal));
        assertEq(_diamond().verifyMilestones(sideProof).finalizedSnapshot.blockHeight, 55, "premise: F' = 55 is final");
        // premise: X's early hop at 60 is above F' with inbound 1, but X's latest finalized point 100 has inbound 3

        _apply(
            honest,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(sideProof, honestLatestFinalized)
        );

        _assertRejected(honest);
    }

    function test_FR2_sideChainFinalPointBelowTheJoinCannotKillTheHonestDisputeThroughAConflict() public {
        (bytes32 topUpHash, bytes32 lateJoinHash) = _seedTopUpThenLateJoin();
        (Dispute memory honest, StateSnapshot memory honestLatestFinalized) =
            _honestDisputeOverTheLateJoin(lateJoinHash);
        // A to E's side-chain final point F' = 60 (inbound 2) commits another snapshot than X's hop at 60 (inbound 1)
        ProofWalkInput memory sideProof = _sideFinalAtSixty(topUpHash);

        _apply(
            honest,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(sideProof, 0, 0, honestLatestFinalized)
        );

        _assertRejected(honest);
    }

    function test_FR2_conflictWithTheLatestFinalizedPointsInboundKills() public {
        (bytes32 topUpHash,) = _seedTopUpThenLateJoin();
        ProofWalkInput memory finalProof = _sideFinalAtSixty(topUpHash);
        // A's dispute holds one hop at 60 that commits another snapshot than F, with F's inbound 2
        (StateSnapshot memory forked,) = _mathSnapshot(60, _anchorSet(), _balances(70, 100, 0), topUpHash, 2);
        Dispute memory dispute = _disputeBy(alice, _one(_hopRun(forked, 1, _anchorKeys())));
        _commit(dispute);

        _apply(dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 0, forked));

        _assertKilled(dispute);
    }

    function test_conflict_anchorAsTheLatestFinalizedPointReadsTheAnchorsInbound() public {
        (bytes32 topUpHash, bytes32 lateJoinHash) = _seedTopUpThenLateJoin();
        ProofWalkInput memory finalProof = _sideFinalAtSixty(topUpHash);
        // A's dispute is the run 50..61 holding the anchor; its block 60 commits another snapshot than F
        Dispute memory dispute = _disputeBy(alice, _one(_run(50, 12, keccak256("block 49"), _anchorKeys())));
        _commit(dispute);
        // a snapshot at inbound 3 the anchor block does not commit: the chain reads the anchor's inbound 1 instead
        (StateSnapshot memory claimed,) = _mathSnapshot(50, _joinedSet(), _balances(100, 100, 50), lateJoinHash, 3);

        _apply(
            dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 10, claimed)
        );

        _assertKilled(dispute);
    }

    // ==================== the inbound lookup ====================

    function test_lookup_anchorInboundHeadOutsideStorageReadsTheAnchorsHeight() public {
        // the anchor's inbound head at height 7 is not stored (the run below it was pruned)
        bytes32 prunedHead = keccak256("an inbound head whose block is not stored");
        (StateSnapshot memory anchor,) = _mathSnapshot(50, _anchorSet(), _balances(100, 100, 0), prunedHead, 7);
        harness.seedSnapshot(CHANNEL, anchor);
        (StateSnapshot memory finalPoint,) = _mathSnapshot(60, _anchorSet(), _balances(90, 100, 0), prunedHead, 7);
        ProofWalkInput memory finalProof =
            _finalProof(forkId, _one(_hopRun(finalPoint, 1, _anchorKeys())), _entries(finalPoint));
        assertEq(_diamond().verifyMilestones(finalProof).finalizedSnapshot.blockHeight, 60, "premise: F = 60 is final");
        // Y's G = 100 consumed the stored opening block only (inbound 1 < 7)
        (StateSnapshot memory sideHundred,) =
            _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(sideHundred);

        _apply(side, DisputeFraudProofType.DisputeFinalPointRegression, _regressionProof(finalProof, sideHundred));

        _assertKilled(side);
    }

    function test_lookup_inboundHashNeitherStoredNorTheAnchorHeadReverts() public {
        bytes32 neverPosted = keccak256("an inbound block the chain never held");
        (StateSnapshot memory sideFinal,) = _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), neverPosted, 3);
        Dispute memory side = _sideDispute(sideFinal);

        vm.expectRevert(abi.encodeWithSelector(ErrorInboundMessageBlockNotStored.selector, CHANNEL, neverPosted));
        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(_honestFinalProof(), sideFinal)
        );
    }

    // ==================== cost ====================

    function test_regression_killFitsTheParachainTransactionLimits() public {
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(sideFinal);
        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](1);
        proofs[0] = DisputeFraudProof({
            proofType: DisputeFraudProofType.DisputeFinalPointRegression,
            participant: side.input.disputer,
            dispute: side,
            encodedProof: _regressionProof(_honestFinalProof(), sideFinal)
        });
        uint256 calldataBytes = abi.encodeCall(harness.applyDisputeFraudProofs, (proofs)).length;

        vm.prank(joiner);
        uint256 before = gasleft();
        harness.applyDisputeFraudProofs(proofs);
        uint256 gasUsed = before - gasleft();

        _assertKilledBy(side, joiner);
        console.log("DisputeFinalPointRegression kill gas", gasUsed);
        console.log("DisputeFinalPointRegression kill calldata bytes", calldataBytes);
        assertLt(gasUsed, MAX_TRANSACTION_GAS, "the kill fits one parachain transaction's gas");
        assertLt(calldataBytes, MAX_CALLDATA_BYTES, "the kill fits one parachain transaction's calldata");
    }

    // ---- histories ----

    /// X's milestones and snapshots: the join hop at 60 consuming L's JOIN, then F = 100 where L won 30 from A
    function _honestHistory()
        internal
        view
        returns (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots)
    {
        (StateSnapshot memory joinHop,) = _mathSnapshot(60, _joinedSet(), _balances(100, 100, 50), joinInboundHash, 2);
        (StateSnapshot memory finalPoint,) =
            _mathSnapshot(100, _joinedSet(), _balances(70, 100, 80), joinInboundHash, 2);
        milestones = _two(_hopRun(joinHop, 1, _joinedKeys()), _hopRun(finalPoint, 1, _joinedKeys()));
        snapshots = _entries(joinHop, finalPoint);
    }

    /// L's final proof of F = 100 (inbound 2) over X
    function _honestFinalProof() internal view returns (ProofWalkInput memory finalProof) {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots) = _honestHistory();
        finalProof = _finalProof(forkId, milestones, snapshots);
    }

    /// A's committed side-chain dispute: one hop from the anchor to `latestFinalized`, signed by A to E
    function _sideDispute(StateSnapshot memory latestFinalized) internal returns (Dispute memory dispute) {
        (dispute,) = _postedDisputeBy(
            alice, _one(_hopRun(latestFinalized, 1, _anchorKeys())), _entries(latestFinalized), latestFinalized
        );
        _commit(dispute);
    }

    /// E's top-up at inbound height 2 after the opening, then L's JOIN at inbound height 3: E needs no new signer,
    /// so A to E alone can finalize the top-up below L's JOIN
    function _seedTopUpThenLateJoin() internal returns (bytes32 topUpHash, bytes32 lateJoinHash) {
        MessageBlock memory topUp = _joinBlock(openingInboundHash, 2, erin, 10);
        topUp.totalBalance.amount = 510;
        topUpHash = harness.seedInboundBlock(CHANNEL, topUp);
        MessageBlock memory lateJoin = _joinBlock(topUpHash, 3, joiner, 50);
        lateJoin.totalBalance.amount = 560;
        lateJoinHash = harness.seedInboundBlock(CHANNEL, lateJoin);
    }

    /// L's committed honest dispute over the late JOIN: an early hop at 60 (inbound 1), the join hop at 80 and its
    /// latest finalized point 100 (both inbound 3, signed by A to E and L). Returns the snapshot of 100.
    function _honestDisputeOverTheLateJoin(bytes32 lateJoinHash)
        internal
        returns (Dispute memory dispute, StateSnapshot memory latestFinalized)
    {
        (StateSnapshot memory early,) = _mathSnapshot(60, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        (StateSnapshot memory joinHop,) = _mathSnapshot(80, _joinedSet(), _balances(100, 100, 50), lateJoinHash, 3);
        (latestFinalized,) = _mathSnapshot(100, _joinedSet(), _balances(70, 100, 80), lateJoinHash, 3);
        (dispute,) = _postedDisputeBy(
            joiner,
            _three(
                _hopRun(early, 1, _anchorKeys()),
                _hopRun(joinHop, 1, _joinedKeys()),
                _hopRun(latestFinalized, 1, _joinedKeys())
            ),
            _entries(early, joinHop, latestFinalized),
            latestFinalized
        );
        _commit(dispute);
    }

    /// A to E's final proof of a side-chain point F' = 60 that consumed E's top-up (`topUpHash`, inbound 2)
    function _sideFinalAtSixty(bytes32 topUpHash) internal returns (ProofWalkInput memory finalProof) {
        (StateSnapshot memory sideSixty,) = _mathSnapshot(60, _anchorSet(), _balances(90, 100, 0), topUpHash, 2);
        finalProof = _finalProof(forkId, _one(_hopRun(sideSixty, 1, _anchorKeys())), _entries(sideSixty));
        assertEq(_diamond().verifyMilestones(finalProof).finalizedSnapshot.blockHeight, 60, "premise: F' = 60 is final");
    }

    // ---- staging ----

    /// a Math snapshot at `height` with `participants` holding `balances`, consuming the inbound head `inboundHash`
    /// (its stored height is `inboundHeight`); its deposits are the sum of the balances
    function _mathSnapshot(
        uint256 height,
        address[] memory participants,
        uint256[] memory balances,
        bytes32 inboundHash,
        uint256 inboundHeight
    ) internal view returns (StateSnapshot memory s, bytes memory encodedState) {
        MathState memory state;
        state.number = height;
        state.participants = participants;
        state.balances = new uint256[](participants.length);
        uint256 deposits;
        for (uint256 i = 0; i < participants.length; i++) {
            state.balances[i] = balances[i];
            deposits += balances[i];
        }
        encodedState = abi.encode(state);
        s = _snapshotAt(height, participants, inboundHash, inboundHeight);
        s.snapshotData.stateMachineStateHash = keccak256(encodedState);
        s.snapshotData.totalDeposits.amount = deposits;
    }

    /// A to E's opening JOINs of 100 each at inbound height 1
    function _openingInbound() internal view returns (MessageBlock memory inbound) {
        address[] memory openers = _anchorSet();
        inbound.blockHeight = 1;
        inbound.timestamp = block.timestamp;
        inbound.totalBalance.amount = 500;
        inbound.messages = new Message[](openers.length);
        for (uint256 i = 0; i < openers.length; i++) {
            JoinChannel memory join;
            join.channelId = CHANNEL;
            join.participant = openers[i];
            join.balance.amount = 100;
            inbound.messages[i] = Message({
                messageType: MESSAGE_TYPE_JOIN, participant: openers[i], balance: join.balance, data: abi.encode(join)
            });
        }
    }

    /// `disputer`'s dispute posting its auditing data, with the chain's inbound head at upload (L's JOIN)
    function _postedDisputeBy(
        address disputer,
        MilestoneProof[] memory milestones,
        StateSnapshot[] memory snapshots,
        StateSnapshot memory latest
    ) internal view returns (Dispute memory dispute, DisputeAuditingData memory auditingData) {
        dispute = _disputeBy(disputer, milestones);
        dispute.input.latestInboundMessageBlockHash = joinInboundHash;
        dispute.input.lastInboundMessageBlockHeight = 2;
        auditingData.genesisStateSnapshotData = genesisData;
        auditingData.milestoneSnapshots = snapshots;
        auditingData.latestStateSnapshot = latest;
        dispute.postedAuditingData = true;
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
    }

    /// A's balance, B to E's balance, and L's balance when L is a participant
    function _balances(uint256 aBalance, uint256 othersBalance, uint256 joinerBalance)
        internal
        pure
        returns (uint256[] memory balances)
    {
        balances = new uint256[](6);
        balances[0] = aBalance;
        for (uint256 i = 1; i < 5; i++) {
            balances[i] = othersBalance;
        }
        balances[5] = joinerBalance;
    }

    function _anchorSet() internal view returns (address[] memory set) {
        set = new address[](5);
        set[0] = alice;
        set[1] = bob;
        set[2] = carol;
        set[3] = dave;
        set[4] = erin;
    }

    function _joinedSet() internal view returns (address[] memory set) {
        address[] memory anchorSet = _anchorSet();
        set = new address[](6);
        for (uint256 i = 0; i < 5; i++) {
            set[i] = anchorSet[i];
        }
        set[5] = joiner;
    }

    /// A to E's keys, A (every block's author) first
    function _anchorKeys() internal pure returns (uint256[] memory keys) {
        keys = new uint256[](5);
        keys[0] = ALICE_KEY;
        keys[1] = BOB_KEY;
        keys[2] = CAROL_KEY;
        keys[3] = DAVE_KEY;
        keys[4] = ERIN_KEY;
    }

    function _joinedKeys() internal pure returns (uint256[] memory keys) {
        uint256[] memory anchorKeys = _anchorKeys();
        keys = new uint256[](6);
        for (uint256 i = 0; i < 5; i++) {
            keys[i] = anchorKeys[i];
        }
        keys[5] = JOINER_KEY;
    }

    function _only(Dispute memory dispute) internal pure returns (Dispute[] memory disputes) {
        disputes = new Dispute[](1);
        disputes[0] = dispute;
    }
}
