pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./DisputeErrors.sol";

contract FraudProofFacet is StateChannelCommon {
    

    mapping(ProofType => function(bytes memory encodedFraudProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address)) private proofHandlers;

    constructor() {
        //If we endup having too many fraud proofs, we'll refactor them into a seperate 'facet' (ERC-2535)
        proofHandlers[ProofType.BlockDoubleSign] = _handleBlockDoubleSign;
        proofHandlers[ProofType.BlockEmptyBlock] = _handleBlockEmptyBlock;
        proofHandlers[ProofType.BlockInvalidStateTransition] = _handleBlockInvalidStateTransition;
        proofHandlers[ProofType.BlockOutOfGas] = _handleBlockOutOfGas;
        proofHandlers[ProofType.TimeoutThreshold] = _handleTimeoutThreshold;
        proofHandlers[ProofType.TimeoutPriorInvalid] = _handleTimeoutPriorInvalid;
        proofHandlers[ProofType.TimeoutParticipantNoNext] = _handleTimeoutParticipantNoNext;
        proofHandlers[ProofType.DisputeNotLatestState] = _handleDisputeNotLatestState;
        proofHandlers[ProofType.DisputeInvalid] = _handleDisputeInvalid;
        proofHandlers[ProofType.DisputeInvalidRecursive] = _handleDisputeInvalidRecursive;
        proofHandlers[ProofType.DisputeInvalidStateProof] = _handleDisputeInvalidStateProof;
        proofHandlers[ProofType.DisputeInvalidPreeviousRecursive] = _handleDisputeInvalidPreeviousRecursive;
        proofHandlers[ProofType.DisputeInvalidExitChannelBlocks] = _handleDisputeInvalidExitChannelBlocks;
    }

    //This is a bit inefficient, since public/external functions always do a deep copy unline internal/private that pas by reference, but this shares the context
    function verifyFraudProofs(
        Proof[] memory fraudProofs,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) public returns (address[] memory slashParticipants) {
        Proof[] memory proofs = fraudProofs;
        address[] memory slashParticipants = new address[](proofs.length);
        uint slashCount = 0;
        for (uint i = 0; i < proofs.length; i++) {
            address slashedParticipant = proofHandlers[proofs[i].proofType](proofs[i].encodedProof, fraudProofVerificationContext);
            if (slashedParticipant == address(0)) 
                revert ErrorDisptuteFraudProofDidntSlash(i);
            slashParticipants[slashCount] = slashedParticipant;
            slashCount++;
            
        }
        return slashParticipants;
    }

    // ******************************* FRAUD PROOF IMPLEMENTATION *******************************
    
    function _handleBlockDoubleSign(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling BlockDoubleSign proof
        return address(0); // Replace with actual logic
    }

    function _handleBlockEmptyBlock(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling BlockEmptyBlock proof
        return address(0); // Replace with actual logic
    }

    function _handleBlockInvalidStateTransition(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling BlockInvalidStateTransition proof
        return address(0); // Replace with actual logic
    }

    function _handleBlockOutOfGas(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling BlockOutOfGas proof
        return address(0); // Replace with actual logic
    }

    function _handleTimeoutThreshold(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling TimeoutThreshold proof
        return address(0); // Replace with actual logic
    }

    function _handleTimeoutPriorInvalid(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling TimeoutPriorInvalid proof
        return address(0); // Replace with actual logic
    }

    function _handleTimeoutParticipantNoNext(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling TimeoutParticipantNoNext proof
        return address(0); // Replace with actual logic
    }
    
    function _handleDisputeNotLatestState(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling DisputeNotLatestState proof
        return address(0); // Replace with actual logic
    }

    function _handleDisputeInvalid(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling DisputeInvalid proof
        return address(0); // Replace with actual logic
    }

    function _handleDisputeInvalidRecursive(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling DisputeInvalidRecursive proof
        return address(0); // Replace with actual logic
    }

    function _handleDisputeInvalidStateProof(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling DisputeInvalidStateProof proof
        return address(0); // Replace with actual logic
    }

    function _handleDisputeInvalidPreeviousRecursive(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling DisputeInvalidPreeviousRecursive proof
        return address(0); // Replace with actual logic
    }

    function _handleDisputeInvalidExitChannelBlocks(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling DisputeInvalidExitChannelBlocks proof
        return address(0); // Replace with actual logic
    }


    // =============================== Block Dispute Fraud Proofs Verification ===============================

    // function _verifyBlockInvalidStateTransition(
    //     Dispute memory dispute,
    //     Proof memory proof
    // ) internal returns (bool isValid, address[] memory slashedParticipants, bytes memory fraudProofErrorResult) {

    //     BlockInvalidStateTransitionProof memory blockInvalidSTProof = abi.decode(proof.encodedProof, (BlockInvalidStateTransitionProof));
    //     Block memory fraudBlock = abi.decode(blockInvalidSTProof.fraudBlockConfirmation.signedBlock.encodedBlock, (Block));
    //     address[] memory slashParticipants = new address[](1);
        
    //     if(dispute.channelId != fraudBlock.transaction.header.channelId) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("BLOCK INVALID STATE TRANSITION: CHANNEL ID MISMATCH"));
    //     }

    //     (bool isTransitionValid, bytes memory encodedModifiedState) = executeStateTransitionOnState(
    //         fraudBlock.transaction.header.channelId,
    //         blockInvalidSTProof.encodedState,
    //         fraudBlock.transaction
    //     );

    //     if (!isTransitionValid) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, new bytes(0));
    //     }        
    //     if (keccak256(encodedModifiedState) != dispute.latestStateSnapshotHash) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("BLOCK INVALID STATE TRANSITION: STATE HASH MISMATCH"));
    //     }
    //     address[] memory returnedSlashParticipants = _collectBlockConfirmationAddresses(
    //         blockInvalidSTProof.fraudBlockConfirmation.signedBlock.encodedBlock,
    //         blockInvalidSTProof.fraudBlockConfirmation.signatures
    //     );
    //     return (true, returnedSlashParticipants, new bytes(0));
    // }

    // function _verifyBlockDoubleSign( 
    //     Dispute memory dispute,
    //     Proof memory proof
    // ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {

    //     BlockDoubleSignProof memory blockDoubleSignProof = abi.decode(proof.encodedProof, (BlockDoubleSignProof));

    //     Block memory block1 = abi.decode(blockDoubleSignProof.block1.encodedBlock, (Block));
    //     Block memory block2 = abi.decode(blockDoubleSignProof.block2.encodedBlock, (Block));

    //     address[] memory slashParticipants = new address[](1);
    //     if(dispute.channelId != block1.transaction.header.channelId || dispute.channelId != block2.transaction.header.channelId) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("BLOCK DOUBLE SIGN: CHANNEL ID MISMATCH"));
    //     }

    //     if(block1.stateSnapshotHash != block2.stateSnapshotHash && block1.previousBlockHash != block2.previousBlockHash) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("BLOCK DOUBLE SIGN: STATE HASH MISMATCH"));
    //     }
        
    //     address signer1 = StateChannelUtilLibrary.retriveSignerAddress(
    //         blockDoubleSignProof.block1.encodedBlock,
    //         blockDoubleSignProof.block1.signature
    //     );
    //     address signer2 = StateChannelUtilLibrary.retriveSignerAddress(
    //         blockDoubleSignProof.block2.encodedBlock,
    //         blockDoubleSignProof.block2.signature
    //     );
    //     if(signer1 != signer2) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("BLOCK DOUBLE SIGN: SIGNER MISMATCH"));
    //     }
    //     slashParticipants[0] = signer1;
    //     return (true, slashParticipants, new bytes(0));
    // }
    
    // function _verifyBlockStateTransitionOutOfGas(
    //     Dispute memory dispute,
    //     Proof memory proof
    // ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {
    //     BlockOutOfGasProof memory blockOutOfGasProof = abi.decode(proof.encodedProof, (BlockOutOfGasProof));
    //     Block memory fraudBlock = abi.decode(blockOutOfGasProof.fraudBlockConfirmation.signedBlock.encodedBlock, (Block));
    //     address[] memory slashParticipants = new address[](1);  
        
    //     if(dispute.channelId != fraudBlock.transaction.header.channelId) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("BLOCK OUT OF GAS: CHANNEL ID MISMATCH"));
    //     }
        
    //     (bool isSuccess, bytes memory encodedModifiedState) = executeStateTransitionOnState(
    //         fraudBlock.transaction.header.channelId,
    //         blockOutOfGasProof.encodedState,
    //         fraudBlock.transaction
    //     );
    //     if(isSuccess){
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("BLOCK OUT OF GAS: STATE TRANSITION SUCCESSFUL"));
    //     }
    //     address[] memory returnedSlashParticipants = _collectBlockConfirmationAddresses(
    //         blockOutOfGasProof.fraudBlockConfirmation.signedBlock.encodedBlock,
    //         blockOutOfGasProof.fraudBlockConfirmation.signatures
    //     );
    //     address signer = StateChannelUtilLibrary.retriveSignerAddress(
    //         blockOutOfGasProof.fraudBlockConfirmation.signedBlock.encodedBlock,
    //         blockOutOfGasProof.fraudBlockConfirmation.signedBlock.signature
    //     );
    //     returnedSlashParticipants[returnedSlashParticipants.length] = signer;
    //     return (true, returnedSlashParticipants, new bytes(0));
        
    // }
    
    // function _verifyBlockEmptyBlock(
    //     Dispute memory dispute,
    //     Proof memory proof
    // ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {
    //     BlockEmptyProof memory blockEmptyProof = abi.decode(proof.encodedProof, (BlockEmptyProof));
    //     Block memory fraudBlock = abi.decode(blockEmptyProof.emptyBlock.encodedBlock, (Block));

    //     address[] memory slashParticipants = new address[](1);
    //     if(dispute.channelId != fraudBlock.transaction.header.channelId) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("BLOCK EMPTY: CHANNEL ID MISMATCH"));
    //     }
    //     if(fraudBlock.transaction.header.transactionCnt != uint(0)) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("BLOCK EMPTY: TRANSACTION COUNT NOT ZERO"));
    //     }
    //     address signer = StateChannelUtilLibrary.retriveSignerAddress(
    //         blockEmptyProof.emptyBlock.encodedBlock,
    //         blockEmptyProof.emptyBlock.signature
    //     );
    //     slashParticipants[0] = signer;
    //     return (true, slashParticipants, new bytes(0));
    // }
    
    // // =============================== Dispute Fraud proof Verification ===============================

    // function _verifyDisputeNotLatestState(
    //     Dispute memory dispute,
    //     Proof memory proof,
    //     DisputeAuditingData memory disputeAuditingData
    // ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {
    //     DisputeNotLatestStateProof memory disputeNotLatestStateProof = abi.decode(proof.encodedProof, (DisputeNotLatestStateProof));
    //     address[] memory slashParticipants = new address[](1);
        
    //     Block memory newerBlock = abi.decode(disputeNotLatestStateProof.newerBlock.signedBlock.encodedBlock, (Block));
    //     if(dispute.channelId != newerBlock.transaction.header.channelId) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("DISPUTE NOT LATEST STATE: CHANNEL ID MISMATCH"));
    //     }

    //     address originalDisputer = disputeNotLatestStateProof.originalDispute.disputer;
        
    //     bytes32 originalDisputeCommitment = keccak256(abi.encode(
    //         disputeNotLatestStateProof.originalDispute,
    //         disputeAuditingData.disputeTimestamp
    //     ));
    //     (bool isAvailable, int index) = isDisputeCommitmentAvailable(dispute.channelId, originalDisputeCommitment);
    //     if(!isAvailable) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("DISPUTE NOT LATEST STATE: ORIGINAL DISPUTE NOT AVAILABLE"));
    //     }

    //     address signer = StateChannelUtilLibrary.retriveSignerAddress(
    //         disputeNotLatestStateProof.newerBlock.signedBlock.encodedBlock,
    //         disputeNotLatestStateProof.newerBlock.signedBlock.signature
    //     );
    //     address[] memory signers = _collectBlockConfirmationAddresses(
    //         disputeNotLatestStateProof.newerBlock.signedBlock.encodedBlock,
    //         disputeNotLatestStateProof.newerBlock.signatures
    //     );

    //     // check block ordering
    //     uint latestStateHeight = _getLatestHeight(disputeNotLatestStateProof.originalDispute.stateProof);
    //     if(newerBlock.transaction.header.transactionCnt < latestStateHeight) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("DISPUTE NOT LATEST STATE: NEWER BLOCK HEIGHT IS LESS THAN LATEST STATE HEIGHT"));
    //     }
    //     if(signer != originalDisputer && !StateChannelUtilLibrary.isAddressInArray(signers, originalDisputer)) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("DISPUTE NOT LATEST STATE: SIGNER MISMATCH"));
    //     }
    //     slashParticipants[0] = originalDisputer;
    //     return (true, slashParticipants, new bytes(0));
    // }

    // function _verifyDisputeInvalidStateProof(
    //     Dispute memory dispute,
    //     Proof memory proof,
    //     DisputeAuditingData memory disputeAuditingData
    // ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {
    //     DisputeInvalidStateProof memory disputeInvalidStateProof = abi.decode(proof.encodedProof, (DisputeInvalidStateProof));
    //     address[] memory slashParticipants = new address[](1);
    //     if(dispute.channelId != disputeInvalidStateProof.dispute.channelId) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("DISPUTE NOT LATEST STATE: CHANNEL ID MISMATCH"));
    //     }
    //     address originalDisputer = disputeInvalidStateProof.dispute.disputer;
        
    //     bool isStateProofValid = _verifyStateProof(
    //         disputeAuditingData,
    //         disputeInvalidStateProof.dispute.genesisStateSnapshotHash,
    //         disputeInvalidStateProof.dispute.stateProof,
    //         disputeInvalidStateProof.dispute.latestStateSnapshotHash
    //     );
    //     if(!isStateProofValid) {
    //         slashParticipants[0] = originalDisputer;
    //         return (false, slashParticipants, abi.encode("DISPUTE INVALID STATE PROOF: STATE PROOF INVALID"));
    //     }
    //     slashParticipants[0] = originalDisputer;
    //     return (true, slashParticipants, new bytes(0));
    // }

    // function _verifyDisputeInvalidExitChannelBlocks(
    //     Dispute memory dispute,
    //     Proof memory proof
    // ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {
    //     // TODO: implement processExitChannelBlocks
    //     revert("NOT IMPLEMENTED");
    // }
    
    // // =============================== Dispute Timeout Verification ===============================

    // function _verifyTimeoutThreshold(
    //     Dispute memory dispute,
    //     Proof memory proof,
    //     DisputeAuditingData memory disputeAuditingData
    // ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {

    //     TimeoutThresholdProof memory timeoutThresholdProof = abi.decode(proof.encodedProof, (TimeoutThresholdProof));
    //     BlockConfirmation memory thresholdBlockConfirmation = timeoutThresholdProof.thresholdBlock;
    //     Block memory thresholdBlock = abi.decode(thresholdBlockConfirmation.signedBlock.encodedBlock, (Block));
    //     Dispute memory originalTimedOutDispute = timeoutThresholdProof.timedOutDispute;
        
    //     address[] memory slashParticipants = new address[](1);
    //     bool allThresholdChecksPass = true;
    //     bytes memory errorMessage;

    //     bytes32 originalDisputeCommitment = keccak256(abi.encode(
    //         originalTimedOutDispute,
    //         disputeAuditingData.disputeTimestamp
    //     ));
    //     (bool isAvailable, int index) = isDisputeCommitmentAvailable(dispute.channelId, originalDisputeCommitment);
    //     if(!isAvailable) {
    //         allThresholdChecksPass = false;
    //         errorMessage = abi.encode("TIMEOUT THRESHOLD: ORIGINAL DISPUTE NOT AVAILABLE");
    //     }

    //     if(thresholdBlock.transaction.header.channelId != originalTimedOutDispute.channelId) {
    //         allThresholdChecksPass = false;
    //         errorMessage = abi.encode("TIMEOUT THRESHOLD: BLOCK CHANNEL ID MISMATCH");
    //     }

    //     uint latestStateHeight = _getLatestHeight(originalTimedOutDispute.stateProof);
    //     if(latestStateHeight != thresholdBlock.transaction.header.transactionCnt) {
    //         allThresholdChecksPass = false;
    //         errorMessage = abi.encode("TIMEOUT THRESHOLD: BLOCK HEIGHT MISMATCH");
    //     }
       
    //     if(thresholdBlock.stateSnapshotHash != originalTimedOutDispute.latestStateSnapshotHash) {
    //         allThresholdChecksPass = false;
    //         errorMessage = abi.encode("TIMEOUT THRESHOLD: BLOCK STATE HASH MISMATCH");
    //     }

    //     // check signatures
    //     address signer = StateChannelUtilLibrary.retriveSignerAddress(
    //         thresholdBlockConfirmation.signedBlock.encodedBlock,
    //         thresholdBlockConfirmation.signedBlock.signature
    //     );
    //     address[] memory signers = _collectBlockConfirmationAddresses(
    //         thresholdBlockConfirmation.signedBlock.encodedBlock,
    //         thresholdBlockConfirmation.signatures
    //     );

    //     if(signer != dispute.disputer || !StateChannelUtilLibrary.isAddressInArray(signers, dispute.disputer)) {
    //         allThresholdChecksPass = false;
    //         errorMessage = abi.encode("TIMEOUT THRESHOLD: SIGNER NOT AVAILABLE");
    //     }

    //     if (!allThresholdChecksPass) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, errorMessage);
    //     }

    //     // If calldata check also fails, return false with the last error message
    //     slashParticipants[0] = originalTimedOutDispute.disputer;
    //     return (true, slashParticipants, new bytes(0));
    // }

    // function _verifyTimeoutPriorInvalidProof(
    //     Dispute memory dispute,
    //     Proof memory proof,
    //     DisputeAuditingData memory disputeAuditingData
    // ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {

    //     TimeoutPriorInvalidProof memory timeoutPriorInvalidProof = abi.decode(proof.encodedProof, (TimeoutPriorInvalidProof));
    //     Dispute memory originalDispute = timeoutPriorInvalidProof.originalDispute;
    //     Dispute memory recursiveDispute = timeoutPriorInvalidProof.recursiveDispute;
    //     address[] memory slashParticipants = new address[](1);

    //     if(recursiveDispute.channelId != originalDispute.channelId && recursiveDispute.channelId != dispute.channelId) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: CHANNEL ID MISMATCH"));
    //     }
    //     // check if the recursive dispute is available
    //     bytes32 recursiveDisputeCommitment = keccak256(abi.encode(
    //         recursiveDispute,
    //         disputeAuditingData.disputeTimestamp
    //     ));
    //     (bool isAvailable, int index) = isDisputeCommitmentAvailable(recursiveDispute.channelId, recursiveDisputeCommitment);

    //     if(!isAvailable) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: RECURSIVE DISPUTE NOT AVAILABLE"));
    //     }
    //     if(recursiveDispute.previousRecursiveDisputeHash != bytes32(0)) {
    //         // check if the previous recursive dispute is available
    //         (bool isOriginalDisputeAvailable, int index) = isDisputeCommitmentAvailable(recursiveDispute.channelId,recursiveDispute.previousRecursiveDisputeHash);
    //         if(!isOriginalDisputeAvailable) {
    //             slashParticipants[0] = dispute.disputer;
    //             return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: PREVIOUS RECURSIVE DISPUTE NOT AVAILABLE"));
    //         }
    //     }
        
    //     (bool isOriginalTimeoutSet, bool isOriginalOptionalSet) = isTimeoutSetWithOptional(originalDispute.timeout, false);
    //     if(!isOriginalTimeoutSet) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: ORIGINAL TIMEOUT NOT SET"));
    //     }
    //     (bool isRecursiveTimeoutSet, bool isRecursiveOptionalSet) = isTimeoutSetWithOptional(recursiveDispute.timeout, false);
    //     if(!isRecursiveTimeoutSet) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: RECURSIVE TIMEOUT NOT SET"));
    //     }
        
    //     // check if the original timeout is greater than the recursive timeout
    //     if(originalDispute.timeout.blockHeight < recursiveDispute.timeout.blockHeight) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: RECURSIVE TIMEOUT IS NEW"));
    //     }
    //     // check if the timeout peeer in original dispute is the disputer in recursive dispute
    //     if(originalDispute.timeout.participant != recursiveDispute.disputer) {
    //         slashParticipants[0] = dispute.disputer;
    //         return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: TIMEOUT PEER MISMATCH"));
    //     }

    //     slashParticipants[0] = recursiveDispute.disputer;
    //     return (true, slashParticipants, new bytes(0));
    // }


    // function isTimeoutSetWithOptional(Timeout memory timeout, bool checkOptional) internal pure returns (bool isSet, bool optionalSet) {
    //     if(checkOptional) {
    //         return (timeout.participant != address(0), timeout.previousBlockProducer != address(0));
    //     }
    //     return (timeout.participant != address(0), false);
    // }

    // function _getLatestHeight(StateProof memory stateProof) internal view returns (uint) {

    //     if(stateProof.signedBlocks.length == 0) {
    //         uint lastMilestoneBlockConfirmationIndex = stateProof.forkProof.forkMilestoneProofs[stateProof.forkProof.forkMilestoneProofs.length - 1].blockConfirmations.length - 1; 
    //         Block memory lastMilestoneBlockConfirmation = abi.decode(stateProof.forkProof.forkMilestoneProofs[stateProof.forkProof.forkMilestoneProofs.length - 1].blockConfirmations[lastMilestoneBlockConfirmationIndex].signedBlock.encodedBlock, (Block));
    //         return lastMilestoneBlockConfirmation.transaction.header.transactionCnt;
    //     }
    //     Block memory lastSignedBlock = abi.decode(stateProof.signedBlocks[stateProof.signedBlocks.length - 1].encodedBlock, (Block));
    //     return lastSignedBlock.transaction.header.transactionCnt;
    // }

    // function _calculateTotalDeposits(JoinChannelBlock[] memory joinChannelBlocks) internal view returns (uint) {
    //     uint totalDeposits = 0;
    //     for (uint i = 0; i < joinChannelBlocks.length; i++) {
    //         for(uint j = 0; j < joinChannelBlocks[i].joinChannels.length; j++) {
    //             totalDeposits += joinChannelBlocks[i].joinChannels[j].amount;
    //         }
    //     }
    //     return totalDeposits;
    // }

}
