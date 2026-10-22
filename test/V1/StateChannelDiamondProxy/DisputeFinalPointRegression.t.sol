pragma solidity ^0.8.8;

import {StateProofStaging} from "../harness/StateProofStaging.sol";
import {MathState} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {
    DisputeConflictsWithFinalState,
    DisputeFinalPointRegression
} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import {MESSAGE_TYPE_JOIN} from "../../../contracts/V1/types/MessageTypeHashes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The side-chain bypass of a later joiner (FIND-DISPUTE-6-E2YJ9X). The chain anchor is 50 {A, B, C, D, E}. L posts
/// a JOIN on chain. The honest history X consumes it in the join hop at 60 (signed by A to E and L) and reaches the
/// threshold-final point F = 100, where L has won 30 from A. A to E build the side chain Y from the anchor: one hop to
/// 1000' signed by A to E alone, whose inbound head stays below L's JOIN. Y's walk counts the joiners inside its own
/// inbound interval only, so L is never required, and Y holds no block at F's height for
/// `DisputeConflictsWithFinalState`. `DisputeFinalPointRegression` kills Y: F = 100 is final with inbound height 2,
/// Y's final point G = 1000' is above F with inbound height 1. Controls that do not kill: G above F on the same inbound
/// head, G at F's height, a snapshot G does not commit, a milestone index out of range, and a final proof that does
/// not walk.
contract DisputeFinalPointRegressionTest is StateProofStaging {
    uint256 internal constant ERIN_KEY = 0xE121;
    uint256 internal constant JOINER_KEY = 0x10E1;

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
        (StateSnapshot memory joinHop,) = _mathSnapshot(60, _joinedSet(), _balances(100, 100, 50), joinInboundHash, 2);
        (StateSnapshot memory finalPoint,) =
            _mathSnapshot(100, _joinedSet(), _balances(70, 100, 80), joinInboundHash, 2);
        MilestoneProof[] memory honestMilestones =
            _two(_hopRun(joinHop, 1, _joinedKeys()), _hopRun(finalPoint, 1, _joinedKeys()));
        StateSnapshot[] memory honestSnapshots = _entries(joinHop, finalPoint);
        (Dispute memory honest, DisputeAuditingData memory honestData) =
            _postedDisputeBy(joiner, honestMilestones, honestSnapshots, finalPoint);

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
                        .isDisputeConflictingWithFinalState(side, DisputeConflictsWithFinalState(honestProof, i, j)),
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

        // the defense: L, online in the kill period, proves F = 100 final (inbound 2) and Y's final point
        // G = 1000' above it (inbound 1)
        _applyRegression(side, _regressionProof(honestProof, 0, sideFinal));
        assertEq(harness.commitmentCount(CHANNEL, forkId), 1, "Y killed, X stays");
        assertTrue(harness.isSlashed(CHANNEL, alice), "Y's disputer slashed");
        assertFalse(harness.isSlashed(CHANNEL, joiner), "L keeps its seat");

        // the property: reduce over the disputes the kill period leaves keeps the joiner's final history
        assertEq(
            harness.reduce(_only(honest)).latestBlock.transaction.header.transactionCnt,
            100,
            "side chain Y wins reduce: L's final outcomes 60-100 on X are rolled back"
        );
    }

    function test_K2_inflatedInboundHeightFieldInGSnapshotStillKills() public {
        // Y's G claims inbound height 99 next to the real hash of the opening inbound block
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 99);
        Dispute memory side = _sideDispute(_one(_hopRun(sideFinal, 1, _anchorKeys())), _entries(sideFinal), sideFinal);
        _commit(side);
        _applyRegression(side, _regressionProof(_honestFinalProof(), 0, sideFinal));
        _assertRegressionKilled(side);
    }

    function test_K3_gInboundHeadTheChainDoesNotHoldKills() public {
        // the anchor's own head is pruned when the anchor is posted; a head the chain never held reads the same
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), keccak256("pruned head"), 1);
        Dispute memory side = _sideDispute(_one(_hopRun(sideFinal, 1, _anchorKeys())), _entries(sideFinal), sideFinal);
        _commit(side);
        _applyRegression(side, _regressionProof(_honestFinalProof(), 0, sideFinal));
        _assertRegressionKilled(side);
    }

    function test_K4_regressionAtASecondHopMilestoneKills() public {
        // Y hops to 80' (below F, no regression there), then to 1000'
        (StateSnapshot memory low,) = _mathSnapshot(80, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(
            _two(_hopRun(low, 1, _anchorKeys()), _hopRun(sideFinal, 1, _anchorKeys())),
            _entries(low, sideFinal),
            sideFinal
        );
        _commit(side);
        assertFalse(
            _diamond().isDisputeFinalPointRegression(side, _regression(_honestFinalProof(), 0, low)),
            "premise: a milestone below F is no regression"
        );
        _applyRegression(side, _regressionProof(_honestFinalProof(), 1, sideFinal));
        _assertRegressionKilled(side);
    }

    function test_N1_gAboveFOnTheSameInboundHeadDoesNotKill() public {
        // a later final point that consumed L's JOIN too: the inbound height did not go down
        (StateSnapshot memory later,) = _mathSnapshot(1000, _joinedSet(), _balances(70, 100, 80), joinInboundHash, 2);
        Dispute memory dispute = _sideDispute(_one(_hopRun(later, 1, _joinedKeys())), _entries(later), later);
        _commit(dispute);
        _applyRegression(dispute, _regressionProof(_honestFinalProof(), 0, later));
        _assertRegressionRejected(dispute);
    }

    function test_N2_gAtTheFinalHeightDoesNotKill() public {
        // a block at F's height is the conflict kill's case, not a regression
        (StateSnapshot memory atF,) = _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(_one(_hopRun(atF, 1, _anchorKeys())), _entries(atF), atF);
        _commit(side);
        _applyRegression(side, _regressionProof(_honestFinalProof(), 0, atF));
        _assertRegressionRejected(side);
    }

    function test_N3_snapshotTheBlockDoesNotCommitDoesNotKill() public {
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(_one(_hopRun(sideFinal, 1, _anchorKeys())), _entries(sideFinal), sideFinal);
        _commit(side);
        StateSnapshot memory other = sideFinal;
        other.timestamp += 1;
        _applyRegression(side, _regressionProof(_honestFinalProof(), 0, other));
        _assertRegressionRejected(side);
    }

    function test_N4_milestoneIndexOutOfRangeDoesNotKill() public {
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(_one(_hopRun(sideFinal, 1, _anchorKeys())), _entries(sideFinal), sideFinal);
        _commit(side);
        _applyRegression(side, _regressionProof(_honestFinalProof(), 1, sideFinal));
        _assertRegressionRejected(side);
    }

    function test_N5_finalProofThatDoesNotWalkDoesNotKill() public {
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(_one(_hopRun(sideFinal, 1, _anchorKeys())), _entries(sideFinal), sideFinal);
        _commit(side);
        // X's real hops to F, then a hop to 150 signed by A to E alone: L is seated, so the walk fails there
        (StateSnapshot memory joinHop, StateSnapshot memory finalPoint) = _honestSnapshots();
        (StateSnapshot memory unsignedHop,) =
            _mathSnapshot(150, _joinedSet(), _balances(70, 100, 80), joinInboundHash, 2);
        MilestoneProof[] memory milestones = new MilestoneProof[](3);
        milestones[0] = _hopRun(joinHop, 1, _joinedKeys());
        milestones[1] = _hopRun(finalPoint, 1, _joinedKeys());
        milestones[2] = _hopRun(unsignedHop, 1, _anchorKeys());
        ProofWalkInput memory broken = _finalProof(forkId, milestones, _entries(joinHop, finalPoint, unsignedHop));
        assertFalse(_diamond().verifyMilestones(broken).valid, "premise: the final proof does not walk");
        _applyRegression(side, _regressionProof(broken, 0, sideFinal));
        _assertRegressionRejected(side);
    }

    // ---- the kill ----

    function _regression(ProofWalkInput memory finalProof, uint256 milestoneIndex, StateSnapshot memory gSnapshot)
        internal
        pure
        returns (DisputeFinalPointRegression memory)
    {
        return
            DisputeFinalPointRegression({finalProof: finalProof, milestoneIndex: milestoneIndex, gSnapshot: gSnapshot});
    }

    function _regressionProof(ProofWalkInput memory finalProof, uint256 milestoneIndex, StateSnapshot memory gSnapshot)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(_regression(finalProof, milestoneIndex, gSnapshot));
    }

    /// L submits the regression allegation against `dispute`
    function _applyRegression(Dispute memory dispute, bytes memory encodedProof) internal {
        _applyBy(joiner, dispute, DisputeFraudProofType.DisputeFinalPointRegression, encodedProof);
    }

    /// the allegation held: the dispute is killed and its disputer slashed, the challenger L keeps its seat
    function _assertRegressionKilled(Dispute memory dispute) internal view {
        assertEq(harness.commitmentCount(CHANNEL, dispute.input.forkId), 0, "dispute killed");
        assertTrue(harness.isSlashed(CHANNEL, dispute.input.disputer), "disputer slashed");
        assertFalse(harness.isSlashed(CHANNEL, joiner), "challenger keeps its seat");
    }

    /// the allegation failed: the dispute stays, its submitter is not punished, the challenger L pays
    function _assertRegressionRejected(Dispute memory dispute) internal view {
        assertEq(harness.commitmentCount(CHANNEL, dispute.input.forkId), 1, "dispute stays committed");
        assertFalse(harness.isSlashed(CHANNEL, dispute.input.disputer), "dispute submitter not punished");
        assertTrue(harness.isSlashed(CHANNEL, joiner), "the unsupported allegation costs the challenger");
    }

    /// X's join hop at 60 and its final point F = 100, where L won 30 from A
    function _honestSnapshots() internal view returns (StateSnapshot memory joinHop, StateSnapshot memory finalPoint) {
        (joinHop,) = _mathSnapshot(60, _joinedSet(), _balances(100, 100, 50), joinInboundHash, 2);
        (finalPoint,) = _mathSnapshot(100, _joinedSet(), _balances(70, 100, 80), joinInboundHash, 2);
    }

    /// L's final proof of F = 100 along X, signed by A to E and L
    function _honestFinalProof() internal view returns (ProofWalkInput memory) {
        (StateSnapshot memory joinHop, StateSnapshot memory finalPoint) = _honestSnapshots();
        return _finalProof(
            forkId,
            _two(_hopRun(joinHop, 1, _joinedKeys()), _hopRun(finalPoint, 1, _joinedKeys())),
            _entries(joinHop, finalPoint)
        );
    }

    /// A's dispute posting its auditing data
    function _sideDispute(
        MilestoneProof[] memory milestones,
        StateSnapshot[] memory snapshots,
        StateSnapshot memory latest
    ) internal view returns (Dispute memory dispute) {
        (dispute,) = _postedDisputeBy(alice, milestones, snapshots, latest);
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
