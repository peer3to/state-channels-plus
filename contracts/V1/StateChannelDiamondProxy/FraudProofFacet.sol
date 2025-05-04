pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";

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
        proofHandlers[ProofType.DisputeNotLatestState] = _handleDisputeNotLatestState;
        proofHandlers[ProofType.DisputeInvalidPreviousRecursive] = _handleDisputeInvalidPreviousRecursive;
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


    // ------------------------------- Block Fraud Proofs --------------------------------------- 
    function _handleBlockDoubleSign(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) pure internal returns (address) {
        BlockDoubleSignProof memory blockDoubleSignProof = abi.decode(encodedProof, (BlockDoubleSignProof));

        Block memory block1 = abi.decode(blockDoubleSignProof.block1.encodedBlock, (Block));
        Block memory block2 = abi.decode(blockDoubleSignProof.block2.encodedBlock, (Block));

        if(fraudProofVerificationContext.channelId != block1.transaction.header.channelId || fraudProofVerificationContext.channelId != block2.transaction.header.channelId) {
            return address(0);
        }

        if(block1.stateSnapshotHash != block2.stateSnapshotHash && block1.previousBlockHash != block2.previousBlockHash) {
            return address(0);
        }
        
        address signer1 = StateChannelUtilLibrary.retriveSignerAddress(
            blockDoubleSignProof.block1.encodedBlock,
            blockDoubleSignProof.block1.signature
        );
        address signer2 = StateChannelUtilLibrary.retriveSignerAddress(
            blockDoubleSignProof.block2.encodedBlock,
            blockDoubleSignProof.block2.signature
        );
        if(signer1 != signer2) {
            return address(0);
        }
        return signer1; 
    }

    function _handleBlockEmptyBlock(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) pure internal returns (address) {
        BlockEmptyProof memory blockEmptyProof = abi.decode(encodedProof, (BlockEmptyProof));
        Block memory fraudBlock = abi.decode(blockEmptyProof.emptyBlock.encodedBlock, (Block));

        if(fraudProofVerificationContext.channelId != fraudBlock.transaction.header.channelId) {
            return address(0);
        }
        if(fraudBlock.transaction.header.transactionCnt != uint(0)) {
            return address(0);
        }
        address signer = StateChannelUtilLibrary.retriveSignerAddress(
            blockEmptyProof.emptyBlock.encodedBlock,
            blockEmptyProof.emptyBlock.signature
        );
        return signer;
    }

    function _handleBlockInvalidStateTransition(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        BlockInvalidStateTransitionProof memory blockInvalidSTProof = abi.decode(encodedProof, (BlockInvalidStateTransitionProof));
        Block memory fraudBlock = abi.decode(blockInvalidSTProof.invalidBlock.encodedBlock, (Block));
        
        if(fraudProofVerificationContext.channelId != fraudBlock.transaction.header.channelId) {
            return address(0);
        }

        (bool isTransitionValid, bytes memory encodedModifiedState) = AStateChannelManagerProxy(address(this)).executeStateTransitionOnState(
            fraudProofVerificationContext.channelId,
            blockInvalidSTProof.encodedLatestState,
            fraudBlock.transaction
        );

        if (isTransitionValid) {
            return address(0);
        } 

        if(fraudBlock.stateSnapshotHash == keccak256(encodedModifiedState)){
            return address(0);
        }       
        address signer = StateChannelUtilLibrary.retriveSignerAddress(
            blockInvalidSTProof.invalidBlock.encodedBlock,
            blockInvalidSTProof.invalidBlock.signature
        );
        return signer;
    }

    function _handleBlockOutOfGas(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling BlockOutOfGas proof
        return address(0); // Replace with actual logic
    }

    // ----------------------------------- Timeout Fraud Proofs -----------------------------------
    function _handleTimeoutThreshold(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal view returns (address) {
        
        TimeoutThresholdProof memory timeoutThresholdProof = abi.decode(encodedProof, (TimeoutThresholdProof));
        BlockConfirmation memory thresholdBlockConfirmation = timeoutThresholdProof.thresholdBlock;
        Block memory thresholdBlock = abi.decode(thresholdBlockConfirmation.signedBlock.encodedBlock, (Block));
        Dispute memory originalTimedOutDispute = timeoutThresholdProof.timedOutDispute;
        
        bytes32 originalDisputeCommitment = keccak256(abi.encode(
            originalTimedOutDispute,
            timeoutThresholdProof.timedOutDisputeTimestamp
        ));

        (bool isAvailable, bytes32 commitment) = getDisputeCommitment(fraudProofVerificationContext.channelId, originalTimedOutDispute.disputeIndex);
        if(!isAvailable && commitment != originalDisputeCommitment){
            return address(0);
        }

        uint latestStateHeight = _getLatestHeight(originalTimedOutDispute.stateProof);
        if(latestStateHeight != thresholdBlock.transaction.header.transactionCnt) {
            return address(0);
        }
       
        if(thresholdBlock.stateSnapshotHash != originalTimedOutDispute.latestStateSnapshotHash) {
            return address(0);
        }

        // check signatures
        address signer = StateChannelUtilLibrary.retriveSignerAddress(
            thresholdBlockConfirmation.signedBlock.encodedBlock,
            thresholdBlockConfirmation.signedBlock.signature
        );
        address[] memory signers = _collectBlockConfirmationAddresses(
            thresholdBlockConfirmation.signedBlock.encodedBlock,
            thresholdBlockConfirmation.signatures
        );

        if(signer != msg.sender || !StateChannelUtilLibrary.isAddressInArray(signers, msg.sender)) {
            return address(0);
        }
        // If calldata check also fails, return false with the last error message
        return originalTimedOutDispute.disputer;
    }

    function _handleTimeoutPriorInvalid(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) view internal returns (address) {
        TimeoutPriorInvalidProof memory timeoutPriorInvalidProof = abi.decode(encodedProof, (TimeoutPriorInvalidProof));
        Dispute memory originalDispute = timeoutPriorInvalidProof.originalDispute;
        Dispute memory recursiveDispute = timeoutPriorInvalidProof.recursiveDispute;

        if(recursiveDispute.channelId != originalDispute.channelId && recursiveDispute.channelId != fraudProofVerificationContext.channelId) {
            return address(0);
        }
        // check if the recursive dispute is available
        bytes32 recursiveDisputeCommitment = keccak256(abi.encode(
            recursiveDispute,
            timeoutPriorInvalidProof.recursiveDisputeTimestamp
        ));
        bytes32 originalDisputeCommitment = keccak256(abi.encode(
            originalDispute,
            timeoutPriorInvalidProof.originalDisputeTimestamp
        ));

        (bool isAvailable, bytes32 commitment) = getDisputeCommitment(fraudProofVerificationContext.channelId, recursiveDispute.disputeIndex);

        if(!isAvailable && commitment != recursiveDisputeCommitment) {
            return address(0);
        }
        if(recursiveDispute.previousRecursiveDisputeIndex == type(uint256).max){
            return address(0);
        }
       
        // check if the previous recursive dispute is available
        (bool isOriginalDisputeAvailable, bytes32 originalCommitment) = getDisputeCommitment(fraudProofVerificationContext.channelId, originalDispute.disputeIndex);
        if(!isOriginalDisputeAvailable && originalCommitment != originalDisputeCommitment) {
            return address(0);
        }
            
        // check if the original timeout is greater than the recursive timeout
        if(originalDispute.timeout.blockHeight < recursiveDispute.timeout.blockHeight) {
            return address(0);
        }
        // check if the timeout peeer in original dispute is the disputer in recursive dispute
        if(originalDispute.timeout.participant != recursiveDispute.disputer) {
            return address(0);
        }

        return recursiveDispute.disputer;
    }
    
    // ------------------------------------ Dispute Fraud Proofs ------------------------------------
    function _handleDisputeNotLatestState(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) view internal returns (address) {
        DisputeNotLatestStateProof memory disputeNotLatestStateProof = abi.decode(encodedProof, (DisputeNotLatestStateProof));
        address[] memory slashParticipants = new address[](1);
        
        Block memory newerBlock = abi.decode(disputeNotLatestStateProof.newerBlock.signedBlock.encodedBlock, (Block));
        if(fraudProofVerificationContext.channelId != newerBlock.transaction.header.channelId) {
            return address(0);
        }

        address originalDisputer = disputeNotLatestStateProof.originalDispute.disputer;
        
        bytes32 originalDisputeCommitment = keccak256(abi.encode(
            disputeNotLatestStateProof.originalDispute,
            disputeNotLatestStateProof.originalDisputeTimestamp
        ));
        (bool isAvailable, bytes32 commitment) = getDisputeCommitment(fraudProofVerificationContext.channelId, disputeNotLatestStateProof.originalDispute.disputeIndex);
        if(!isAvailable && originalDisputeCommitment != commitment) {
            return address(0);            
        }

        address signer = StateChannelUtilLibrary.retriveSignerAddress(
            disputeNotLatestStateProof.newerBlock.signedBlock.encodedBlock,
            disputeNotLatestStateProof.newerBlock.signedBlock.signature
        );
        address[] memory signers = _collectBlockConfirmationAddresses(
            disputeNotLatestStateProof.newerBlock.signedBlock.encodedBlock,
            disputeNotLatestStateProof.newerBlock.signatures
        );

        // check block ordering
        uint latestStateHeight = _getLatestHeight(disputeNotLatestStateProof.originalDispute.stateProof);
        if(newerBlock.transaction.header.transactionCnt < latestStateHeight) {
            return address(0);
        }
        if(signer != originalDisputer && !StateChannelUtilLibrary.isAddressInArray(signers, originalDisputer)) {
            return address(0);
        }
        return originalDisputer;
    }

    function _handleDisputeInvalidPreviousRecursive(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        
    }

    function _handleDisputeInvalidExitChannelBlocks(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        // Implementation for handling DisputeInvalidExitChannelBlocks proof
        return address(0); // Replace with actual logic
    }

    function isTimeoutSetWithOptional(Timeout memory timeout, bool checkOptional) internal pure returns (bool isSet, bool optionalSet) {
        if(checkOptional) {
            return (timeout.participant != address(0), timeout.previousBlockProducer != address(0));
        }
        return (timeout.participant != address(0), false);
    }

    function _getLatestHeight(StateProof memory stateProof) internal pure returns (uint) {

        if(stateProof.signedBlocks.length == 0) {
            uint lastMilestoneBlockConfirmationIndex = stateProof.forkProof.forkMilestoneProofs[stateProof.forkProof.forkMilestoneProofs.length - 1].blockConfirmations.length - 1; 
            Block memory lastMilestoneBlockConfirmation = abi.decode(stateProof.forkProof.forkMilestoneProofs[stateProof.forkProof.forkMilestoneProofs.length - 1].blockConfirmations[lastMilestoneBlockConfirmationIndex].signedBlock.encodedBlock, (Block));
            return lastMilestoneBlockConfirmation.transaction.header.transactionCnt;
        }
        Block memory lastSignedBlock = abi.decode(stateProof.signedBlocks[stateProof.signedBlocks.length - 1].encodedBlock, (Block));
        return lastSignedBlock.transaction.header.transactionCnt;
    }

    function _collectBlockConfirmationAddresses(bytes memory encodedBlock, bytes[] memory signatures) pure internal returns (address[] memory confirmationAddress){
        address[] memory collectedAddresses = new address[](signatures.length); 
        for(uint i = 0; i < signatures.length; i++){
            address signer = StateChannelUtilLibrary.retriveSignerAddress(encodedBlock, signatures[i]);
            collectedAddresses[i] = signer;
        }
        return collectedAddresses;
    }

}
