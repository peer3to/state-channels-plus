// @spec-test-coverage-ignore: shared Foundry timeout-calldata-posted staging exercised by owning mapped test declarations
pragma solidity ^0.8.8;

import {DiamondHarness} from "./DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {StateChannelManagerEvents} from "../../../contracts/V1/StateChannelManagerEvents.sol";
import {Vm} from "forge-std/Vm.sol";
import {TimeoutCalldataPosted} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";
import {_getLatestBlock} from "../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol";

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

    function _signPostedBlock(uint256 timedOutPk, bytes memory encodedBlock) internal virtual returns (bytes memory) {
        return _sign(timedOutPk, encodedBlock);
    }

    /// Stage the dispute and the posted block for `transitionData`, authored by `timedOutPk`
    /// on the genesis state `encodedGenesisState` of `channelId` (an open channel whose
    /// snapshot is still its genesis), consuming `messageBlocks`. The block's snapshot hash is
    /// the one a fully funded replay of the transition and those inbound messages gives, so the
    /// block is honest whenever that replay succeeds.
    function _stageTimeoutCalldataPosted(
        StateChannelManagerInterface diamond,
        bytes32 channelId,
        uint256 timedOutPk,
        uint256 disputerPk,
        bytes memory encodedGenesisState,
        bytes memory transitionData,
        MessageBlock[] memory messageBlocks
    ) internal returns (Dispute memory dispute, DisputeFraudProof[] memory proofs) {
        StateSnapshot memory genesis = diamond.getStateSnapshot(channelId);
        assertEq(genesis.blockHeight, 0, "the channel snapshot is its genesis");
        assertEq(
            genesis.snapshotData.stateMachineStateHash,
            keccak256(encodedGenesisState),
            "the staged state is the channel's genesis state"
        );
        StateProof memory noBlocks;
        return _stageTimeoutCalldataPostedAfter(
            diamond,
            channelId,
            timedOutPk,
            disputerPk,
            noBlocks,
            PostedBlockBase(genesis, encodedGenesisState, keccak256(abi.encode(genesis))),
            transitionData,
            messageBlocks
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
        return _stageTimeoutCalldataPostedAfter(
            diamond, channelId, timedOutPk, disputerPk, noBlocks, base, transitionData, new MessageBlock[](0)
        );
    }

    /// `_stageTimeoutCalldataPostedOn` with a dispute whose state proof is `stateProof` and a
    /// posted block consuming `messageBlocks`. The blamed height, and the posted block's height,
    /// is the next one after its latest block.
    function _stageTimeoutCalldataPostedAfter(
        StateChannelManagerInterface diamond,
        bytes32 channelId,
        uint256 timedOutPk,
        uint256 disputerPk,
        StateProof memory stateProof,
        PostedBlockBase memory base,
        bytes memory transitionData,
        MessageBlock[] memory messageBlocks
    ) internal returns (Dispute memory dispute, DisputeFraudProof[] memory proofs) {
        Block memory postedBlock;
        postedBlock.transaction.header.channelId = channelId;
        postedBlock.transaction.header.forkId = base.latestStateSnapshot.forkId;
        postedBlock.transaction.header.participant = vm.addr(timedOutPk);
        postedBlock.transaction.header.transactionCnt = _heightAfter(stateProof);
        postedBlock.transaction.header.timestamp = block.timestamp;
        postedBlock.transaction.body.data = transitionData;
        postedBlock.previousBlockHash = base.previousBlockHash;
        postedBlock.messageBlocks = messageBlocks;
        (StateSnapshot memory replayedSnapshot,) = _fundedReplay(diamond, channelId, base, postedBlock);
        postedBlock.stateSnapshotHash = keccak256(abi.encode(replayedSnapshot));

        dispute = _uploadTimeoutDispute(
            diamond, channelId, base.latestStateSnapshot.forkId, stateProof, vm.addr(timedOutPk), disputerPk
        );

        bytes memory encodedBlock = abi.encode(postedBlock);
        SignedBlock memory signedBlock =
            SignedBlock({encodedBlock: encodedBlock, signature: _signPostedBlock(timedOutPk, encodedBlock)});
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
    /// proof's latest block, signed and uploaded by the disputer. Nothing is posted for that
    /// height yet, so the upload's race check passes.
    function _uploadTimeoutDispute(
        StateChannelManagerInterface diamond,
        bytes32 channelId,
        bytes32 forkId,
        StateProof memory stateProof,
        address timedOut,
        uint256 disputerPk
    ) internal returns (Dispute memory dispute) {
        ChannelBalance memory inboundHead = diamond.getChannelBalance(channelId);
        dispute.input.channelId = channelId;
        dispute.input.forkId = forkId;
        dispute.input.disputer = vm.addr(disputerPk);
        dispute.input.latestInboundMessageBlockHash = inboundHead.latestInboundMessageBlockHash;
        dispute.input.lastInboundMessageBlockHeight = inboundHead.latestInboundMessageBlockHeight;
        dispute.input.timeout.participant = timedOut;
        dispute.input.stateProof = stateProof;
        dispute.input.timeout.blockHeight = _heightAfter(stateProof);
        dispute.input.timeout.minTimeStamp = block.timestamp;

        DisputeConfirmation memory confirmation;
        confirmation.signedDispute.encodedDispute = abi.encode(dispute);
        confirmation.signedDispute.signature = _sign(disputerPk, confirmation.signedDispute.encodedDispute);
        vm.prank(dispute.input.disputer);
        diamond.uploadDispute(confirmation);
    }

    /// The height after `stateProof`'s latest block (the last block of its last milestone); 0 for the empty proof.
    function _heightAfter(StateProof memory stateProof) private pure returns (uint256) {
        (bool hasBlock, Block memory latestBlock) = _getLatestBlock(stateProof);
        return hasBlock ? latestBlock.transaction.header.transactionCnt + 1 : 0;
    }

    /// The snapshot the proof recomputes after a fully funded replay of `_block`'s transaction
    /// and then its inbound message blocks on `base`'s state, and that state. Each message block
    /// becomes the inbound head at the next height; a message the machine rejects is skipped. The replay
    /// runs as the diamond itself (its `onlySelf` entry point), and every change it makes is
    /// rolled back.
    function _fundedReplay(
        StateChannelManagerInterface diamond,
        bytes32 channelId,
        PostedBlockBase memory base,
        Block memory _block
    ) internal returns (StateSnapshot memory next, bytes memory encodedModifiedState) {
        // Deep copy: a memory struct assignment would alias the base snapshot.
        next = abi.decode(abi.encode(base.latestStateSnapshot), (StateSnapshot));
        uint256 snapshot = vm.snapshotState();
        vm.prank(address(diamond));
        Message[] memory outboundMessages;
        (, encodedModifiedState, outboundMessages) =
            diamond.executeStateTransition(channelId, base.encodedLatestState, _block.transaction);
        assertEq(outboundMessages.length, 0, "the staged transition emits no outbound messages");
        stateMachine.setState(encodedModifiedState);
        for (uint256 i = 0; i < _block.messageBlocks.length; i++) {
            Message[] memory messages = _block.messageBlocks[i].messages;
            for (uint256 j = 0; j < messages.length; j++) {
                stateMachine.processInboundMessage(messages[j]);
                next.snapshotData.totalDeposits =
                    stateMachine.addBalance(next.snapshotData.totalDeposits, messages[j].balance);
            }
            next.snapshotData.latestInboundMessageBlockHash = keccak256(abi.encode(_block.messageBlocks[i]));
            next.snapshotData.latestInboundMessageBlockHeight += 1;
        }
        encodedModifiedState = stateMachine.getState();
        next.snapshotData.participants = stateMachine.getParticipants();
        vm.revertToState(snapshot);

        next.snapshotData.stateMachineStateHash = keccak256(encodedModifiedState);
        // clients number a block's snapshot by the block's own height
        next.blockHeight = _block.transaction.header.transactionCnt;
        next.timestamp = _block.transaction.header.timestamp;
    }

    /// `joinerPk` joins `channelId` with `amount` (a top-up when `isTopUp`), threshold-signed by
    /// `signerPks`; returns the inbound block the chain appended for it.
    function _joinOnChain(
        StateChannelManagerInterface diamond,
        bytes32 channelId,
        uint256 joinerPk,
        uint256[] memory signerPks,
        uint256 amount,
        bool isTopUp
    ) internal returns (MessageBlock memory inbound) {
        bytes memory encodedJoin = abi.encode(
            JoinChannel({
                channelId: channelId,
                participant: vm.addr(joinerPk),
                deadlineTimestamp: block.timestamp + 1 days,
                balance: Balance({amount: amount, data: ""})
            })
        );
        JoinChannelConfirmation memory confirmation;
        confirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encodedJoin, signature: _sign(joinerPk, encodedJoin)});
        confirmation.signatures = new bytes[](signerPks.length);
        for (uint256 i = 0; i < signerPks.length; i++) {
            confirmation.signatures[i] = _sign(signerPks[i], encodedJoin);
        }
        StateSnapshot memory current = diamond.getStateSnapshot(channelId);
        vm.recordLogs();
        vm.prank(vm.addr(joinerPk));
        if (isTopUp) diamond.topUpBalance(confirmation, keccak256(abi.encode(current)), current.forkId);
        else diamond.joinChannel(confirmation, keccak256(abi.encode(current)), current.forkId);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == StateChannelManagerEvents.InboundMessagesProcessed.selector) {
                return abi.decode(logs[i].data, (MessageBlock));
            }
        }
        revert("the join appended no inbound block");
    }
}
