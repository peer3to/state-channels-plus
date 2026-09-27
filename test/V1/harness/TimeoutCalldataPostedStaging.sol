// @spec-test-coverage-ignore: shared Foundry timeout-calldata-posted staging exercised by owning mapped test declarations
pragma solidity ^0.8.8;

import {DiamondHarness} from "./DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {TimeoutCalldataPosted} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// A committed timeout dispute on a channel's genesis fork, and the calldata the blamed
/// participant posted for the block it was blamed for. Everything goes through the diamond's
/// public entry points: `uploadDispute` (by the disputer, before the calldata exists, so the
/// upload's race check passes) and `postBlockCalldata` (by the blamed participant, inside its
/// deadline). The returned proof refutes the timeout with that posted block, so applying it
/// replays the block's transition on the genesis state.
abstract contract TimeoutCalldataPostedStaging is DiamondHarness {
    /// What a posted block claims to build on: the proof's latest snapshot, the state machine
    /// state it names, and the block's `previousBlockHash`. An honest base is the channel's
    /// genesis snapshot, its state, and the genesis snapshot's hash.
    struct PostedBlockBase {
        StateSnapshot latestStateSnapshot;
        bytes encodedLatestState;
        bytes32 previousBlockHash;
    }

    /// Stage the dispute and the posted block for `transitionData`, authored by `timedOutPk`
    /// on the genesis state `encodedGenesisState` of `channelId` (an open channel whose
    /// snapshot is still its genesis). The block's snapshot hash is the one a fully funded
    /// replay of the transition gives, so the block is honest whenever that transition
    /// succeeds.
    function _stageTimeoutCalldataPosted(
        StateChannelManagerInterface diamond,
        bytes32 channelId,
        uint256 timedOutPk,
        uint256 disputerPk,
        bytes memory encodedGenesisState,
        bytes memory transitionData
    ) internal returns (Dispute memory dispute, DisputeFraudProof[] memory proofs) {
        StateSnapshot memory genesis = diamond.getStateSnapshot(channelId);
        assertEq(genesis.blockHeight, 0, "the channel snapshot is its genesis");
        assertEq(
            genesis.snapshotData.stateMachineStateHash,
            keccak256(encodedGenesisState),
            "the staged state is the channel's genesis state"
        );
        return _stageTimeoutCalldataPostedOn(
            diamond,
            channelId,
            timedOutPk,
            disputerPk,
            PostedBlockBase(genesis, encodedGenesisState, keccak256(abi.encode(genesis))),
            transitionData
        );
    }

    /// `_stageTimeoutCalldataPosted` with the posted block built on `base` instead of the
    /// genesis. The block's snapshot hash is what a fully funded replay of the transition on
    /// `base.encodedLatestState` gives, so a forged base yields a block that is consistent
    /// with its own made-up pre-state.
    function _stageTimeoutCalldataPostedOn(
        StateChannelManagerInterface diamond,
        bytes32 channelId,
        uint256 timedOutPk,
        uint256 disputerPk,
        PostedBlockBase memory base,
        bytes memory transitionData
    ) internal returns (Dispute memory dispute, DisputeFraudProof[] memory proofs) {
        StateProof memory noBlocks;
        return
            _stageTimeoutCalldataPostedAfter(diamond, channelId, timedOutPk, disputerPk, noBlocks, base, transitionData);
    }

    /// `_stageTimeoutCalldataPostedOn` with a dispute whose state proof is `stateProof`
    /// (signed blocks only). The blamed height, and the posted block's height, is the next one
    /// after those blocks.
    function _stageTimeoutCalldataPostedAfter(
        StateChannelManagerInterface diamond,
        bytes32 channelId,
        uint256 timedOutPk,
        uint256 disputerPk,
        StateProof memory stateProof,
        PostedBlockBase memory base,
        bytes memory transitionData
    ) internal returns (Dispute memory dispute, DisputeFraudProof[] memory proofs) {
        Block memory postedBlock;
        postedBlock.transaction.header.channelId = channelId;
        postedBlock.transaction.header.forkId = base.latestStateSnapshot.forkId;
        postedBlock.transaction.header.participant = vm.addr(timedOutPk);
        postedBlock.transaction.header.transactionCnt = stateProof.signedBlocks.length;
        postedBlock.transaction.header.timestamp = block.timestamp;
        postedBlock.transaction.body.data = transitionData;
        postedBlock.previousBlockHash = base.previousBlockHash;
        postedBlock.stateSnapshotHash = _fundedReplaySnapshotHash(diamond, channelId, base, postedBlock.transaction);

        dispute = _uploadTimeoutDispute(
            diamond, channelId, base.latestStateSnapshot.forkId, stateProof, vm.addr(timedOutPk), disputerPk
        );

        bytes memory encodedBlock = abi.encode(postedBlock);
        SignedBlock memory signedBlock =
            SignedBlock({encodedBlock: encodedBlock, signature: _sign(timedOutPk, encodedBlock)});
        vm.prank(vm.addr(timedOutPk));
        diamond.postBlockCalldata(signedBlock, block.timestamp);

        TimeoutCalldataPosted memory proof;
        proof.genesisStateSnapshotData = diamond.getStateSnapshot(channelId).snapshotData;
        proof.latestStateSnapshot = base.latestStateSnapshot;
        proof.latestStateStateMachineState = base.encodedLatestState;
        proof.postedBlock = signedBlock;
        proof.onChainTimestamp = block.timestamp;
        proofs = new DisputeFraudProof[](1);
        proofs[0] = DisputeFraudProof({
            proofType: DisputeFraudProofType.TimeoutCalldataPosted,
            participant: dispute.input.disputer,
            dispute: dispute,
            encodedProof: abi.encode(proof)
        });
    }

    /// Whether `dispute` is still in its fork's window (a kill removes it).
    function _isDisputeCommitted(StateChannelManagerInterface diamond, Dispute memory dispute)
        internal
        view
        returns (bool)
    {
        bytes32 commitment = keccak256(abi.encode(dispute));
        bytes32[] memory commitments = diamond.getWindowCommitments(dispute.input.channelId, dispute.input.forkId);
        for (uint256 i = 0; i < commitments.length; i++) {
            if (commitments[i] == commitment) return true;
        }
        return false;
    }

    /// A dispute on `forkId` with `stateProof`, blaming `timedOut` for the height after the
    /// proof's signed blocks, signed and uploaded by the disputer. Nothing is posted for that
    /// height yet, so the upload's race check passes.
    function _uploadTimeoutDispute(
        StateChannelManagerInterface diamond,
        bytes32 channelId,
        bytes32 forkId,
        StateProof memory stateProof,
        address timedOut,
        uint256 disputerPk
    ) private returns (Dispute memory dispute) {
        ChannelBalance memory inboundHead = diamond.getChannelBalance(channelId);
        dispute.input.channelId = channelId;
        dispute.input.forkId = forkId;
        dispute.input.disputer = vm.addr(disputerPk);
        dispute.input.latestInboundMessageBlockHash = inboundHead.latestInboundMessageBlockHash;
        dispute.input.lastInboundMessageBlockHeight = inboundHead.latestInboundMessageBlockHeight;
        dispute.input.timeout.participant = timedOut;
        dispute.input.stateProof = stateProof;
        dispute.input.timeout.blockHeight = stateProof.signedBlocks.length;
        dispute.input.timeout.minTimeStamp = block.timestamp;

        DisputeConfirmation memory confirmation;
        confirmation.signedDispute.encodedDispute = abi.encode(dispute);
        confirmation.signedDispute.signature = _sign(disputerPk, confirmation.signedDispute.encodedDispute);
        vm.prank(dispute.input.disputer);
        diamond.uploadDispute(confirmation);
    }

    /// The snapshot hash the proof recomputes after a fully funded replay of `transaction` on
    /// `base`'s state. The replay runs as the diamond itself (its `onlySelf` entry point),
    /// and every change it makes is rolled back.
    function _fundedReplaySnapshotHash(
        StateChannelManagerInterface diamond,
        bytes32 channelId,
        PostedBlockBase memory base,
        Transaction memory transaction
    ) private returns (bytes32) {
        uint256 snapshot = vm.snapshotState();
        vm.prank(address(diamond));
        (, bytes memory encodedModifiedState, Message[] memory outboundMessages) =
            diamond.executeStateTransition(channelId, base.encodedLatestState, transaction);
        assertEq(outboundMessages.length, 0, "the staged transition emits no outbound messages");
        stateMachine.setState(encodedModifiedState);
        address[] memory participants = stateMachine.getParticipants();
        vm.revertToState(snapshot);

        // Deep copy: a memory struct assignment would alias the base snapshot.
        StateSnapshot memory next = abi.decode(abi.encode(base.latestStateSnapshot), (StateSnapshot));
        next.snapshotData.stateMachineStateHash = keccak256(encodedModifiedState);
        next.snapshotData.participants = participants;
        next.blockHeight = base.latestStateSnapshot.blockHeight + 1;
        next.timestamp = transaction.header.timestamp;
        return keccak256(abi.encode(next));
    }
}
