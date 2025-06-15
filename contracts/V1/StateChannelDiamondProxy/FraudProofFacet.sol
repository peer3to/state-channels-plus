pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";

contract FraudProofFacet is StateChannelCommon {
    mapping(
        ProofType
            => function(bytes memory encodedFraudProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address)
    ) private proofHandlers;

    constructor() {
        //If we endup having too many fraud proofs, we'll refactor them into a seperate 'facet' (ERC-2535)
        proofHandlers[ProofType.BlockDoubleSign] = _handleBlockDoubleSign;
        proofHandlers[ProofType.BlockEmptyBlock] = _handleBlockEmptyBlock;
        proofHandlers[ProofType.BlockInvalidStateTransition] = _handleBlockInvalidStateTransition;
        // proofHandlers[ProofType.TimeoutThreshold] = _handleTimeoutThreshold;
        // proofHandlers[ProofType.TimeoutPriorInvalid] = _handleTimeoutPriorInvalid;
        // proofHandlers[ProofType.DisputeInvalidPreviousRecursive] = _handleDisputeInvalidPreviousRecursive;
    }

    //This is a bit inefficient, since public/external functions always do a deep copy unline internal/private that pas by reference, but this shares the context
    function verifyFraudProofs(
        Proof[] memory fraudProofs,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) public returns (address[] memory slashParticipants) {
        Proof[] memory proofs = fraudProofs;
        slashParticipants = new address[](proofs.length);
        uint256 slashCount = 0;
        for (uint256 i = 0; i < proofs.length; i++) {
            address slashedParticipant =
                proofHandlers[proofs[i].proofType](proofs[i].encodedProof, fraudProofVerificationContext);
            if (slashedParticipant == address(0)) {
                revert ErrorDisptuteFraudProofDidntSlash(i);
            }
            slashParticipants[slashCount] = slashedParticipant;
            slashCount++;
        }
        return slashParticipants;
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

        (bool isSuccess, bytes memory encodedModifiedState) = AStateChannelManagerProxy(address(this))
            .executeStateTransitionOnState(
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

        StateSnapshot memory newStateSnapshot =
            StateSnapshot({snapshotData: newSnapshotData, forkId: previousStateSnapshot.forkId});
        require(fraudBlock.stateSnapshotHash == keccak256(abi.encode(newStateSnapshot)), ErrorValidStateTransition());

        return signer;
    }
    // ----------------------------------- Timeout Fraud Proofs -----------------------------------

    // function _handleTimeoutThreshold(
    //     bytes memory encodedProof,
    //     FraudProofVerificationContext memory fraudProofVerificationContext
    // ) internal view returns (address) {
    //     TimeoutThresholdProof memory timeoutThresholdProof = abi.decode(encodedProof, (TimeoutThresholdProof));
    //     BlockConfirmation memory thresholdBlockConfirmation = timeoutThresholdProof.thresholdBlock;
    //     Block memory thresholdBlock = abi.decode(thresholdBlockConfirmation.signedBlock.encodedBlock, (Block));
    //     Dispute memory originalTimedOutDispute = timeoutThresholdProof.timedOutDispute;

    //     bytes32 originalDisputeCommitment =
    //         keccak256(abi.encode(originalTimedOutDispute, timeoutThresholdProof.timedOutDisputeTimestamp));

    //     (bool isAvailable, bytes32 commitment) =
    //         getDisputeCommitment(fraudProofVerificationContext.channelId, originalTimedOutDispute.disputeIndex);
    //     if (!isAvailable && commitment != originalDisputeCommitment) {
    //         return address(0);
    //     }
    //     if (originalTimedOutDispute.latestStateSnapshotHash != keccak256(timeoutThresholdProof.latestStateSnapshot)) {
    //         revert ErrorIncorrectLatestStateSnapshot();
    //     }
    //     address[] memory participants =
    //         abi.decode(timeoutThresholdProof.latestStateSnapshot, (StateSnapshot)).participants;

    //     if (
    //         thresholdBlock.transaction.header.forkId != originalTimedOutDispute.timeout.forkId
    //             && thresholdBlock.transaction.header.transactionCnt != originalTimedOutDispute.timeout.blockHeight
    //     ) {
    //         revert ErrorInvalidBlock();
    //     }
    //     // check signatures
    //     bytes[] memory singleSignerArray = new bytes[](1);
    //     singleSignerArray[0] = thresholdBlockConfirmation.signedBlock.signature;
    //     bytes[] memory signatures =
    //         StateChannelUtilLibrary.concatBytesArrays(thresholdBlockConfirmation.signatures, singleSignerArray);
    //     address[] memory signers = StateChannelUtilLibrary.concatAddressArrays(
    //         participants,
    //         _collectBlockConfirmationAddresses(thresholdBlockConfirmation.signedBlock.encodedBlock, signatures)
    //     );

    //     (bool isVerified, string memory errorMessage) = StateChannelUtilLibrary.verifyThresholdSigned(
    //         signers, thresholdBlockConfirmation.signedBlock.encodedBlock, signatures
    //     );
    //     if (!isVerified) {
    //         revert ErrorInvalidBlock();
    //     }
    //     if (keccak256(abi.encode(participants)) != keccak256(abi.encode(signers))) {
    //         revert ErrorInvalidBlock();
    //     }
    //     // If calldata check also fails, return false with the last error message
    //     return originalTimedOutDispute.disputer;
    // }

    // function _handleTimeoutPriorInvalid(
    //     bytes memory encodedProof,
    //     FraudProofVerificationContext memory fraudProofVerificationContext
    // ) internal view returns (address) {
    //     TimeoutPriorInvalidProof memory timeoutPriorInvalidProof = abi.decode(encodedProof, (TimeoutPriorInvalidProof));
    //     Dispute memory originalDispute = timeoutPriorInvalidProof.originalDispute;
    //     Dispute memory recursiveDispute = timeoutPriorInvalidProof.recursiveDispute;

    //     if (
    //         recursiveDispute.channelId != originalDispute.channelId
    //             && recursiveDispute.channelId != fraudProofVerificationContext.channelId
    //     ) {
    //         revert ErrorNotSameChannelId();
    //     }
    //     // check if the recursive dispute is available
    //     bytes32 recursiveDisputeCommitment =
    //         keccak256(abi.encode(recursiveDispute, timeoutPriorInvalidProof.recursiveDisputeTimestamp));
    //     bytes32 originalDisputeCommitment =
    //         keccak256(abi.encode(originalDispute, timeoutPriorInvalidProof.originalDisputeTimestamp));

    //     (bool isAvailable, bytes32 commitment) =
    //         getDisputeCommitment(fraudProofVerificationContext.channelId, recursiveDispute.disputeIndex);

    //     if (!isAvailable && commitment != recursiveDisputeCommitment) {
    //         revert ErrorDisputeCommitmentNotAvailable();
    //     }
    //     if (
    //         recursiveDispute.previousRecursiveDisputeIndex == type(uint256).max
    //             || recursiveDispute.previousRecursiveDisputeIndex == originalDispute.disputeIndex
    //     ) {
    //         revert ErrorDisputeCommitmentNotAvailable();
    //     }

    //     // check if the previous recursive dispute is available
    //     (bool isOriginalDisputeAvailable, bytes32 originalCommitment) =
    //         getDisputeCommitment(fraudProofVerificationContext.channelId, originalDispute.disputeIndex);
    //     if (!isOriginalDisputeAvailable && originalCommitment != originalDisputeCommitment) {
    //         revert ErrorDisputeCommitmentNotAvailable();
    //     }

    //     // check if the original timeout is greater than the recursive timeout
    //     if (originalDispute.timeout.blockHeight <= recursiveDispute.timeout.blockHeight) {
    //         revert ErrorInvalidBlock();
    //     }

    //     return recursiveDispute.disputer;
    // }

    // ------------------------------------ Dispute Fraud Proofs ------------------------------------

    function _collectBlockConfirmationAddresses(bytes memory encodedBlock, bytes[] memory signatures)
        internal
        pure
        returns (address[] memory confirmationAddress)
    {
        address[] memory collectedAddresses = new address[](signatures.length);
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = StateChannelUtilLibrary.retriveSignerAddress(encodedBlock, signatures[i]);
            collectedAddresses[i] = signer;
        }
        return collectedAddresses;
    }
}
