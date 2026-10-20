pragma solidity ^0.8.8;

import {StateProofStaging} from "../harness/StateProofStaging.sol";
import {MathState} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {DisputeConflictsWithFinalState} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import {MESSAGE_TYPE_JOIN} from "../../../contracts/V1/types/MessageTypeHashes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// Review 2's proposed proof (temp/videos/Ljuba-Pruning-PR560-review-2.md, "Side-chain fraud proof"). It does not
/// exist in the contracts yet; replace it with the real struct when `DisputeFinalPointRegression` lands.
struct ProposedDisputeFinalPointRegression {
    ProofWalkInput finalProof;
    uint256 milestoneIndex;
    StateSnapshot gSnapshot;
}

/// `DisputeFraudProof` with its type as a raw number: the same ABI encoding, so the test can name a proof type the
/// enum does not have yet
struct RawDisputeFraudProof {
    uint8 proofType;
    address participant;
    Dispute dispute;
    bytes encodedProof;
}

/// The side-chain bypass of a later joiner (review 2, "The gap: a competing history bypasses a later joiner", plan
/// case K1). The chain anchor is 50 {A, B, C, D, E}. L posts a JOIN on chain. The honest history X consumes it in the
/// join hop at 60 (signed by A to E and L) and reaches the threshold-final point F = 100, where L has won 30 from A.
/// A to E build the side chain Y from the anchor: one hop to 1000' signed by A to E alone, whose inbound head stays
/// below L's JOIN. Y's walk counts the joiners inside its own inbound interval only, so L is never required.
/// L disputes with X, A disputes with Y, both in one window.
///
/// Today no kill removes Y: its proof walks valid from the anchor and it holds no block at F's height, so
/// `DisputeConflictsWithFinalState` cannot be built. `reduce` then picks Y by longest chain, and L's final outcomes on
/// X are rolled back (its deposit is carried, because the reduction consumes the pending JOIN). Review 2 proposes
/// `DisputeFinalPointRegression`: F = 100 is final with inbound height 2, Y's final point G = 1000' is above F with
/// inbound height 1. The test fails today on the last assertion and passes once that kill exists.
// test naming: test_<plan case>_<scenario>
contract DisputeFinalPointRegressionTest is StateProofStaging {
    uint256 internal constant ERIN_KEY = 0xE121;
    uint256 internal constant JOINER_KEY = 0x10E1;
    /// the slot review 2's kill takes when appended to `DisputeFraudProofType` (today's last, DisputeInvalidOutboundRun,
    /// is 21); replace with `DisputeFraudProofType.DisputeFinalPointRegression` when it lands
    uint8 internal constant FINAL_POINT_REGRESSION_TYPE = 22;

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
        // Skipped until the `DisputeFinalPointRegression` kill lands (FIND-DISPUTE-6-E2YJ9X,
        // docs/spec/audit/open-findings.md).
        vm.skip(true);
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
        // G = 1000' above it (inbound 1). Today the proof type does not exist and the call reverts.
        _submitFinalPointRegression(side, honestProof, sideFinal);

        // the property: reduce over the disputes the kill period leaves keeps the joiner's final history
        Dispute[] memory survivors = harness.commitmentCount(CHANNEL, forkId) == 2 ? both : _only(honest);
        assertEq(
            harness.reduce(survivors).latestBlock.transaction.header.transactionCnt,
            100,
            "side chain Y wins reduce: L's final outcomes 60-100 on X are rolled back"
        );
    }

    // ---- the proposed kill ----

    /// L submits review 2's `DisputeFinalPointRegression` against `dispute` with F from `finalProof` and G as the
    /// first block of the dispute's milestone 0, whose snapshot is `gSnapshot`
    function _submitFinalPointRegression(
        Dispute memory dispute,
        ProofWalkInput memory finalProof,
        StateSnapshot memory gSnapshot
    ) internal {
        RawDisputeFraudProof[] memory proofs = new RawDisputeFraudProof[](1);
        proofs[0] = RawDisputeFraudProof({
            proofType: FINAL_POINT_REGRESSION_TYPE,
            participant: dispute.input.disputer,
            dispute: dispute,
            encodedProof: abi.encode(
                ProposedDisputeFinalPointRegression({finalProof: finalProof, milestoneIndex: 0, gSnapshot: gSnapshot})
            )
        });
        vm.prank(joiner);
        (bool applied,) =
            address(harness).call(abi.encodeWithSelector(harness.applyDisputeFraudProofs.selector, proofs));
        if (!applied) emit log("DisputeFinalPointRegression is not a DisputeFraudProofType yet: the kill reverted");
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
