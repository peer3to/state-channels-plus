// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import {TimeoutCalldataPostedStaging} from "../harness/TimeoutCalldataPostedStaging.sol";
import {GasHungryMathStateMachine} from "../harness/GasHungryMathStateMachine.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {MathStateMachine, MathState} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {TimeoutCalldataPosted} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// U126: Alice signed her departure at height 0 and left the participant set, but the chain still
/// holds her (no exit snapshot), so she can dispute. Her dispute ends at that departure state and
/// times out Bob, the next author, at height 1. Bob posted that block as calldata. Only qualifying
/// posted evidence kills her timeout; posted data that fails the timing, block identity or block
/// validity condition is not a refutation, and its submitter is slashed instead.
// test naming: test_<plan case>_<scenario>
contract DepartedTimeoutCalldataPostedTest is TimeoutCalldataPostedStaging {
    StateChannelManagerInterface internal diamond;
    address[] internal departureParticipants;

    bytes32 internal constant CHANNEL_ID = keccak256("departed-timeout-channel");
    uint256 internal constant ALICE_PK = 1;
    uint256 internal constant BOB_PK = 2;
    uint256 internal constant CAROL_PK = 3;
    // Enough for the 63/64 headroom of every frame above the replay's stipend call.
    uint256 internal constant FUNDED_GAS = SM_GAS_LIMIT * 3;

    function setUp() public {
        // the departure block's timestamp may lie a full timeout window in the past
        vm.warp(1_000_000);
        diamond = deployDiamondWith(new GasHungryMathStateMachine(SM_GAS_LIMIT, MAX_CHANNEL_PARTICIPANTS));
        uint256[] memory privateKeys = new uint256[](3);
        privateKeys[0] = ALICE_PK;
        privateKeys[1] = BOB_PK;
        privateKeys[2] = CAROL_PK;
        _openChannel(CHANNEL_ID, privateKeys);
        departureParticipants = new address[](2);
        departureParticipants[0] = vm.addr(BOB_PK);
        departureParticipants[1] = vm.addr(CAROL_PK);
    }

    function _encodedState(address[] memory participants) internal pure returns (bytes memory) {
        MathState memory state;
        state.participants = participants;
        state.balances = new uint256[](participants.length);
        return abi.encode(state);
    }

    /// Alice's departure block at height 0 (her last signed state) and the base it leaves:
    /// the set without her, Bob next to write.
    function _departure(uint256 departureTimestamp)
        internal
        view
        returns (StateProof memory stateProof, PostedBlockBase memory base)
    {
        StateSnapshot memory genesis = diamond.getStateSnapshot(CHANNEL_ID);
        bytes memory departureState = _encodedState(departureParticipants);
        // Deep copy: a memory struct assignment would alias the genesis snapshot.
        StateSnapshot memory departureSnapshot = abi.decode(abi.encode(genesis), (StateSnapshot));
        departureSnapshot.blockHeight = 1;
        departureSnapshot.timestamp = departureTimestamp;
        departureSnapshot.snapshotData.participants = departureParticipants;
        departureSnapshot.snapshotData.stateMachineStateHash = keccak256(departureState);

        Block memory departureBlock;
        departureBlock.transaction.header.channelId = CHANNEL_ID;
        departureBlock.transaction.header.forkId = genesis.forkId;
        departureBlock.transaction.header.participant = vm.addr(ALICE_PK);
        departureBlock.transaction.header.transactionCnt = 0;
        departureBlock.transaction.header.timestamp = departureTimestamp;
        departureBlock.previousBlockHash = keccak256(abi.encode(genesis));
        departureBlock.stateSnapshotHash = keccak256(abi.encode(departureSnapshot));
        bytes memory encodedDeparture = abi.encode(departureBlock);

        stateProof.milestones = new MilestoneProof[](1);
        stateProof.milestones[0].blockConfirmations = new BlockConfirmation[](1);
        stateProof.milestones[0].blockConfirmations[0].signedBlock =
            SignedBlock({encodedBlock: encodedDeparture, signature: _sign(ALICE_PK, encodedDeparture)});
        base = PostedBlockBase(departureSnapshot, departureState, keccak256(encodedDeparture));
    }

    /// Alice's committed timeout of Bob at height 1, Bob's posted block for it, and the proof
    /// that presents that block.
    function _stageDepartedTimeout(uint256 departureTimestamp, bytes memory transitionData)
        internal
        returns (Dispute memory dispute, DisputeFraudProof[] memory proofs)
    {
        (StateProof memory stateProof, PostedBlockBase memory base) = _departure(departureTimestamp);
        (dispute, proofs) =
            _stageTimeoutCalldataPostedAfter(diamond, CHANNEL_ID, BOB_PK, ALICE_PK, stateProof, base, transitionData);
        assertEq(dispute.input.disputer, vm.addr(ALICE_PK));
        assertEq(dispute.input.timeout.participant, vm.addr(BOB_PK));
        assertEq(dispute.input.timeout.blockHeight, 1, "the timeout names the height after her departure");
        assertTrue(
            diamond.canParticipateInDisputes(CHANNEL_ID, vm.addr(ALICE_PK)), "the departed Alice is chain-eligible"
        );
        assertTrue(_isDisputeCommitted(diamond, dispute), "her timeout dispute is committed");
    }

    /// `proofs` presenting `postedBlock`, posted on chain by its author at the current time.
    function _presentPostedBlock(DisputeFraudProof[] memory proofs, uint256 authorPk, Block memory postedBlock)
        internal
        returns (DisputeFraudProof[] memory presented)
    {
        bytes memory encodedBlock = abi.encode(postedBlock);
        SignedBlock memory signedBlock =
            SignedBlock({encodedBlock: encodedBlock, signature: _sign(authorPk, encodedBlock)});
        vm.prank(vm.addr(authorPk));
        diamond.postBlockCalldata(signedBlock, block.timestamp);

        TimeoutCalldataPosted memory proof = abi.decode(proofs[0].encodedProof, (TimeoutCalldataPosted));
        proof.postedBlock = signedBlock;
        proof.onChainTimestamp = block.timestamp;
        presented = new DisputeFraudProof[](1);
        presented[0] = proofs[0];
        presented[0].encodedProof = abi.encode(proof);
    }

    function _postedBlock(DisputeFraudProof[] memory proofs) internal pure returns (Block memory) {
        TimeoutCalldataPosted memory proof = abi.decode(proofs[0].encodedProof, (TimeoutCalldataPosted));
        return abi.decode(proof.postedBlock.encodedBlock, (Block));
    }

    function _submit(DisputeFraudProof[] memory proofs, uint256 submitterPk) internal {
        vm.prank(vm.addr(submitterPk));
        (bool ok,) = address(diamond).call{gas: FUNDED_GAS}(abi.encodeCall(diamond.applyDisputeFraudProofs, (proofs)));
        assertTrue(ok, "a funded counter gives a verdict");
    }

    /// The counter failed: Alice's timeout stays committed, she keeps standing, and the
    /// submitter of the non-qualifying evidence is slashed.
    function _assertCounterFailed(Dispute memory dispute, uint256 submitterPk) internal view {
        assertTrue(_isDisputeCommitted(diamond, dispute), "the timeout dispute stays committed");
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL_ID, vm.addr(ALICE_PK)), "Alice is not slashed");
        assertTrue(
            diamond.isParticipantSlashedOnChain(CHANNEL_ID, vm.addr(submitterPk)),
            "the submitter of non-qualifying evidence is slashed"
        );
    }

    function _timeoutWindow() internal view returns (uint256) {
        return diamond.getP2pTime() + diamond.getAgreementTime() + diamond.getChainFallbackTime();
    }

    function test_U126_qualifyingPostedBlockKillsTheDepartedSubmittersTimeout() public {
        (Dispute memory dispute, DisputeFraudProof[] memory proofs) =
            _stageDepartedTimeout(block.timestamp, abi.encodeCall(MathStateMachine.add, (1)));
        Block memory posted = _postedBlock(proofs);
        assertEq(posted.transaction.header.participant, vm.addr(BOB_PK), "Bob authored the accused block");
        assertEq(posted.transaction.header.transactionCnt, 1, "at the accused height");
        // the posted calldata carries Bob's signature alone: Alice's is not needed
        TimeoutCalldataPosted memory proof = abi.decode(proofs[0].encodedProof, (TimeoutCalldataPosted));
        (address signer,) =
            utilityFacet.retrieveSignerAddress(proof.postedBlock.encodedBlock, proof.postedBlock.signature);
        assertEq(signer, vm.addr(BOB_PK));

        _submit(proofs, BOB_PK);

        assertFalse(_isDisputeCommitted(diamond, dispute), "the false timeout is killed");
        assertTrue(diamond.isParticipantSlashedOnChain(CHANNEL_ID, vm.addr(ALICE_PK)), "Alice is slashed");
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL_ID, vm.addr(BOB_PK)), "Bob keeps standing");
    }

    // (a) timing: Bob posted the block after the timeout window following her departure block
    function test_U126_postedBlockAfterTheTimeoutWindowDoesNotKill() public {
        (Dispute memory dispute, DisputeFraudProof[] memory proofs) =
            _stageDepartedTimeout(block.timestamp - _timeoutWindow() - 1, abi.encodeCall(MathStateMachine.add, (1)));
        _submit(proofs, BOB_PK);

        _assertCounterFailed(dispute, BOB_PK);
    }

    // (b) block identity: the presented posted block is another author's block at the accused height
    function test_U126_postedBlockOfAnotherAuthorDoesNotKill() public {
        (Dispute memory dispute, DisputeFraudProof[] memory proofs) =
            _stageDepartedTimeout(block.timestamp, abi.encodeCall(MathStateMachine.add, (1)));
        Block memory carolsBlock = _postedBlock(proofs);
        carolsBlock.transaction.header.participant = vm.addr(CAROL_PK);
        DisputeFraudProof[] memory presented = _presentPostedBlock(proofs, CAROL_PK, carolsBlock);

        _submit(presented, CAROL_PK);

        _assertCounterFailed(dispute, CAROL_PK);
    }

    // (b) block identity: the presented posted block is Bob's block at a later height
    function test_U126_postedBlockAtAnotherHeightDoesNotKill() public {
        (Dispute memory dispute, DisputeFraudProof[] memory proofs) =
            _stageDepartedTimeout(block.timestamp, abi.encodeCall(MathStateMachine.add, (1)));
        TimeoutCalldataPosted memory accused = abi.decode(proofs[0].encodedProof, (TimeoutCalldataPosted));
        Block memory laterBlock = _postedBlock(proofs);
        laterBlock.transaction.header.transactionCnt = 2;
        laterBlock.previousBlockHash = keccak256(accused.postedBlock.encodedBlock);
        DisputeFraudProof[] memory presented = _presentPostedBlock(proofs, BOB_PK, laterBlock);

        _submit(presented, BOB_PK);

        _assertCounterFailed(dispute, BOB_PK);
    }

    // (c) block validity: the posted block's transition fails on the departure state
    function test_U126_postedBlockWithFailingTransitionDoesNotKill() public {
        (Dispute memory dispute, DisputeFraudProof[] memory proofs) =
            _stageDepartedTimeout(block.timestamp, abi.encodeCall(GasHungryMathStateMachine.burn, ()));

        _submit(proofs, BOB_PK);

        _assertCounterFailed(dispute, BOB_PK);
    }
}
