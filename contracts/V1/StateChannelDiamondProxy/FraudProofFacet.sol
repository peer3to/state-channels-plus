pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";
import "../types/FraudProofTypes.sol";

contract FraudProofFacet is StateChannelCommon {
    mapping(
        FraudProofType
            => function(bytes memory encodedFraudProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address)
    ) private proofHandlers;

    constructor() {
        //If we endup having too many fraud proofs, we'll refactor them into a seperate 'facet' (ERC-2535)
        proofHandlers[FraudProofType.BlockDoubleSign] = _handleBlockDoubleSign;
        proofHandlers[FraudProofType.BlockEmptyBlock] = _handleBlockEmptyBlock;
        proofHandlers[FraudProofType.BlockInvalidStateTransition] = _handleBlockInvalidStateTransition;
        // proofHandlers[FraudProofType.TimeoutThreshold] = _handleTimeoutThreshold;
        // proofHandlers[FraudProofType.TimeoutPriorInvalid] = _handleTimeoutPriorInvalid;
        // proofHandlers[FraudProofType.DisputeInvalidPreviousRecursive] = _handleDisputeInvalidPreviousRecursive;
    }

    //This is a bit inefficient, since public/external functions always do a deep copy unlike internal/private that pas by reference, but this shares the context
    function applyFraudProofs(
        FraudProof[] memory fraudProofs,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) public {
        FraudProof[] memory proofs = fraudProofs;
        for (uint256 i = 0; i < proofs.length; i++) {
            if (!isParticipantSlashedOnChain(fraudProofVerificationContext.channelId, proofs[i].participant)) {
                address slashedParticipant =
                    proofHandlers[proofs[i].proofType](proofs[i].encodedProof, fraudProofVerificationContext);
                if (slashedParticipant == address(0) || slashedParticipant != proofs[i].participant) {
                    // slash the disputer
                    slashedParticipant = msg.sender;
                }
                // if in (participants || pendingParticipants) && !slashedOnChain
                if (_canParticipateInDisputes(fraudProofVerificationContext.channelId, slashedParticipant)) {
                    addOnChainSlashedParticipant(fraudProofVerificationContext.channelId, slashedParticipant);
                }
            }
        }
    }

    // ******************************* FRAUD PROOF IMPLEMENTATION *******************************

    // ------------------------------- Block Fraud Proofs ---------------------------------------
    function _handleBlockDoubleSign(
        bytes memory encodedProof,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) internal pure returns (address) {
        BlockDoubleSignProof memory blockDoubleSignProof = abi.decode(encodedProof, (BlockDoubleSignProof));

        Block memory block1 = abi.decode(blockDoubleSignProof.block1.encodedBlock, (Block));
        Block memory block2 = abi.decode(blockDoubleSignProof.block2.encodedBlock, (Block));

        if (
            fraudProofVerificationContext.channelId != block1.transaction.header.channelId
                || fraudProofVerificationContext.channelId != block2.transaction.header.channelId
        ) {
            revert ErrorNotSameChannelId();
        }

        if (
            !(
                block1.transaction.header.forkId == block2.transaction.header.forkId
                    && block1.transaction.header.transactionCnt == block2.transaction.header.transactionCnt
                    && keccak256(abi.encode(block1)) != keccak256(abi.encode(block2))
            )
        ) {
            revert ErrorDoubleSignBlocksNotSame();
        }

        address signer1 = StateChannelUtilLibrary.retriveSignerAddress(
            blockDoubleSignProof.block1.encodedBlock, blockDoubleSignProof.block1.signature
        );
        address signer2 = StateChannelUtilLibrary.retriveSignerAddress(
            blockDoubleSignProof.block2.encodedBlock, blockDoubleSignProof.block2.signature
        );
        if (signer1 != signer2) {
            return address(0);
        }
        return signer1;
    }

    function _handleBlockEmptyBlock(
        bytes memory encodedProof,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) internal pure returns (address) {
        BlockEmptyProof memory blockEmptyProof = abi.decode(encodedProof, (BlockEmptyProof));
        Block memory fraudBlock = abi.decode(blockEmptyProof.emptyBlock.encodedBlock, (Block));

        if (fraudProofVerificationContext.channelId != fraudBlock.transaction.header.channelId) {
            revert ErrorNotSameChannelId();
        }

        if (fraudBlock.transaction.header.transactionCnt == 0) {
            if (fraudBlock.stateSnapshotHash != fraudBlock.previousBlockHash) {
                revert ErrorNotEmptyBlockFraud();
            }
        } else {
            Block memory previousBlock = abi.decode(blockEmptyProof.previousBlock.encodedBlock, (Block));

            if (fraudBlock.stateSnapshotHash != previousBlock.stateSnapshotHash) {
                revert ErrorNotEmptyBlockFraud();
            }
        }
        address signer = StateChannelUtilLibrary.retriveSignerAddress(
            blockEmptyProof.emptyBlock.encodedBlock, blockEmptyProof.emptyBlock.signature
        );
        return signer;
    }

    function _handleBlockInvalidStateTransition(
        bytes memory encodedProof,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) internal returns (address) {
        BlockInvalidStateTransitionProof memory blockInvalidSTProof =
            abi.decode(encodedProof, (BlockInvalidStateTransitionProof));
        Block memory fraudBlock = abi.decode(blockInvalidSTProof.invalidBlock.encodedBlock, (Block));
        StateSnapshot memory previousStateSnapshot = blockInvalidSTProof.previousBlockStateSnapshot;
        bytes memory previousStateStateMachineState = blockInvalidSTProof.previousStateStateMachineState;

        address signer = StateChannelUtilLibrary.retriveSignerAddress(
            blockInvalidSTProof.invalidBlock.encodedBlock, blockInvalidSTProof.invalidBlock.signature
        );

        if (fraudProofVerificationContext.channelId != fraudBlock.transaction.header.channelId) {
            revert ErrorNotSameChannelId();
        }

        if (fraudBlock.transaction.header.transactionCnt == 0) {
            require(fraudBlock.previousBlockHash == keccak256(abi.encode(previousStateSnapshot)));
            require(
                previousStateSnapshot.snapshotData.stateMachineStateHash == keccak256(previousStateStateMachineState),
                ErrorInvalidStateSnapshot()
            );
        } else {
            Block memory previousBlock = abi.decode(blockInvalidSTProof.previousBlock.encodedBlock, (Block));
            require(fraudBlock.previousBlockHash == keccak256(abi.encode(previousBlock)), ErrorLinkingPreviousBlock());

            require(
                previousStateSnapshot.snapshotData.stateMachineStateHash == keccak256(previousStateStateMachineState)
                    && previousBlock.stateSnapshotHash == keccak256(abi.encode(previousStateSnapshot)),
                ErrorInvalidStateSnapshotHash()
            );
        }

        (bool isSuccess, bytes memory encodedModifiedState) = StateChannelManagerProxy(address(this))
            .executeStateTransition(
            fraudProofVerificationContext.channelId, previousStateStateMachineState, fraudBlock.transaction
        );
        if (!isSuccess) {
            return signer;
        }
        SnapshotData memory newSnapshotData = SnapshotData({
            stateMachineStateHash: keccak256(encodedModifiedState),
            participants: getStatemachineParticipants(encodedModifiedState),
            latestJoinChannelBlockHash: previousStateSnapshot.snapshotData.latestJoinChannelBlockHash,
            latestExitChannelBlockHash: previousStateSnapshot.snapshotData.latestExitChannelBlockHash,
            totalDeposits: previousStateSnapshot.snapshotData.totalDeposits,
            totalWithdrawals: previousStateSnapshot.snapshotData.totalWithdrawals
        });

        StateSnapshot memory newStateSnapshot = StateSnapshot({
            snapshotData: newSnapshotData,
            forkId: previousStateSnapshot.forkId,
            blockHeight: previousStateSnapshot.blockHeight + 1,
            timestamp: fraudBlock.transaction.header.timestamp
        });
        require(fraudBlock.stateSnapshotHash == keccak256(abi.encode(newStateSnapshot)), ErrorValidStateTransition());

        return signer;
    }
}
