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
        proofHandlers[ProofType.BlockInvalidPreviousLink] = _handleBlockInvalidPreviousLink;
        proofHandlers[ProofType.TimeoutThreshold] = _handleTimeoutThreshold;
        proofHandlers[ProofType.TimeoutPriorInvalid] = _handleTimeoutPriorInvalid;
        proofHandlers[ProofType.DisputeInvalidPreviousRecursive] = _handleDisputeInvalidPreviousRecursive;
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

        if(fraudProofVerificationContext.channelId != block1.transaction.header.channelId && fraudProofVerificationContext.channelId != block2.transaction.header.channelId) {
            revert ErrorNotSameChannelId();
        }

        if (
            !(block1.transaction.header.forkCnt == block2.transaction.header.forkCnt
            && block1.transaction.header.transactionCnt == block2.transaction.header.transactionCnt
            && keccak256(abi.encode(block1)) != keccak256(abi.encode(block2)))
        ){
            revert ErrorDoubleSignBlocksNotSame();
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

    function _handleBlockEmptyBlock(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal pure returns (address) {
        BlockEmptyProof memory blockEmptyProof = abi.decode(encodedProof, (BlockEmptyProof));
        Block memory fraudBlock = abi.decode(blockEmptyProof.emptyBlock.encodedBlock, (Block));

        if(fraudProofVerificationContext.channelId != fraudBlock.transaction.header.channelId) {
            revert ErrorNotSameChannelId();
        }

        if(fraudBlock.transaction.header.transactionCnt == 0){
            if(fraudBlock.stateSnapshotHash != fraudBlock.previousBlockHash){
                revert ErrorNotEmptyBlockFraud();
            }
        }else{
           Block memory previousBlock = abi.decode(blockEmptyProof.previousBlock.encodedBlock, (Block));

           if(fraudBlock.stateSnapshotHash != previousBlock.stateSnapshotHash){
            revert ErrorNotEmptyBlockFraud();
           }
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
        StateSnapshot memory previousStateSnapshot = blockInvalidSTProof.previousBlockStateSnapshot;
        bytes memory previousStateStateMachineState = blockInvalidSTProof.previousStateStateMachineState;

        address signer = StateChannelUtilLibrary.retriveSignerAddress( 
            blockInvalidSTProof.invalidBlock.encodedBlock,
            blockInvalidSTProof.invalidBlock.signature
        );

        if(fraudProofVerificationContext.channelId != fraudBlock.transaction.header.channelId) {
            revert ErrorNotSameChannelId();
        }
        
        if(fraudBlock.transaction.header.transactionCnt == 0){
            require(fraudBlock.previousBlockHash == keccak256(abi.encode(previousStateSnapshot))); 
            require(previousStateSnapshot.stateMachineStateHash == keccak256(previousStateStateMachineState),ErrorInvalidStateSnapshot());
        }else{
            Block memory previousBlock = abi.decode(blockInvalidSTProof.previousBlock.encodedBlock, (Block));
            require(fraudBlock.previousBlockHash == keccak256(abi.encode(previousBlock)), ErrorLinkingPreviousBlock());
        
            require(
                previousStateSnapshot.stateMachineStateHash == keccak256(previousStateStateMachineState) 
                && previousBlock.stateSnapshotHash == keccak256(abi.encode(previousStateSnapshot)),
                ErrorInvalidStateSnapshotHash()
            );
        }
        
        (bool isSuccess, bytes memory encodedModifiedState) = AStateChannelManagerProxy(address(this)).executeStateTransitionOnState(
            fraudProofVerificationContext.channelId,
            previousStateStateMachineState,
            fraudBlock.transaction
        );
        if(!isSuccess){
            return signer;
        }
        StateSnapshot memory newStateSnapshot = StateSnapshot({
            stateMachineStateHash: keccak256(encodedModifiedState),
            participants: getStatemachineParticipants(encodedModifiedState),
            forkCnt: previousStateSnapshot.forkCnt,
            latestJoinChannelBlockHash: previousStateSnapshot.latestJoinChannelBlockHash,
            latestExitChannelBlockHash: previousStateSnapshot.latestExitChannelBlockHash,
            totalDeposits: previousStateSnapshot.totalDeposits,
            totalWithdrawals: previousStateSnapshot.totalWithdrawals
        });
        require(fraudBlock.stateSnapshotHash == keccak256(abi.encode(newStateSnapshot)), ErrorValidStateTransition());
        
        return signer;
    }

    function _handleBlockInvalidPreviousLink(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal pure returns (address) {
        BlockInvalidPreviousLinkProof memory blockInvalidPreviousLinkProof = abi.decode(encodedProof, (BlockInvalidPreviousLinkProof));
        Block memory fraudBlock = abi.decode(blockInvalidPreviousLinkProof.invalidBlock.encodedBlock, (Block));
                  
        if(fraudBlock.transaction.header.transactionCnt == 0){
            bytes memory previousStateMachineState = blockInvalidPreviousLinkProof.previousStateMachineState;
            require(fraudBlock.previousBlockHash != keccak256(abi.encode(previousStateMachineState)), ErrorValidPreviousLink());
        }else{

            Block memory previousBlock = abi.decode(blockInvalidPreviousLinkProof.previousBlock.encodedBlock, (Block));
            require(previousBlock.transaction.header.channelId == fraudBlock.transaction.header.channelId
            && fraudBlock.transaction.header.channelId == fraudProofVerificationContext.channelId, ErrorNotSameChannelId()
            );
            require(fraudBlock.previousBlockHash != keccak256(abi.encode(previousBlock)), ErrorValidPreviousLink());
        }
        address signer = StateChannelUtilLibrary.retriveSignerAddress(
            blockInvalidPreviousLinkProof.invalidBlock.encodedBlock,
            blockInvalidPreviousLinkProof.invalidBlock.signature
        );
        return signer;
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
        if(originalTimedOutDispute.latestStateSnapshotHash != keccak256(timeoutThresholdProof.latestStateSnapshot)) {
            revert ErrorIncorrectLatestStateSnapshot();
        }
        address[] memory participants = abi.decode(timeoutThresholdProof.latestStateSnapshot, (StateSnapshot)).participants;
        
        if(thresholdBlock.transaction.header.forkCnt != originalTimedOutDispute.timeout.forkCnt && thresholdBlock.transaction.header.transactionCnt != originalTimedOutDispute.timeout.blockHeight){
            revert ErrorInvalidBlock();
        }
        // check signatures
        bytes[] memory singleSignerArray = new bytes[](1);
        singleSignerArray[0] = thresholdBlockConfirmation.signedBlock.signature;
        bytes[] memory signatures = StateChannelUtilLibrary.concatBytesArrays(thresholdBlockConfirmation.signatures, singleSignerArray);
        address[] memory signers = StateChannelUtilLibrary.concatAddressArrays(participants, _collectBlockConfirmationAddresses(
            thresholdBlockConfirmation.signedBlock.encodedBlock,
            signatures
        ));

        (bool isVerified, string memory errorMessage) = StateChannelUtilLibrary.verifyThresholdSigned(signers, thresholdBlockConfirmation.signedBlock.encodedBlock, signatures);
        if(!isVerified){
            revert ErrorInvalidBlock();
        }
        if(keccak256(abi.encode(participants))!= keccak256(abi.encode(signers))){
            revert ErrorInvalidBlock();
        }
        // If calldata check also fails, return false with the last error message
        return originalTimedOutDispute.disputer;
    }

    function _handleTimeoutPriorInvalid(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) view internal returns (address) {
        TimeoutPriorInvalidProof memory timeoutPriorInvalidProof = abi.decode(encodedProof, (TimeoutPriorInvalidProof));
        Dispute memory originalDispute = timeoutPriorInvalidProof.originalDispute;
        Dispute memory recursiveDispute = timeoutPriorInvalidProof.recursiveDispute;

        if(recursiveDispute.channelId != originalDispute.channelId && recursiveDispute.channelId != fraudProofVerificationContext.channelId) {
            revert ErrorNotSameChannelId();
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
            revert ErrorDisputeCommitmentNotAvailable();
        }
        if(recursiveDispute.previousRecursiveDisputeIndex == type(uint256).max || recursiveDispute.previousRecursiveDisputeIndex == originalDispute.disputeIndex){
            revert ErrorDisputeCommitmentNotAvailable();
        }
       
        // check if the previous recursive dispute is available
        (bool isOriginalDisputeAvailable, bytes32 originalCommitment) = getDisputeCommitment(fraudProofVerificationContext.channelId, originalDispute.disputeIndex);
        if(!isOriginalDisputeAvailable && originalCommitment != originalDisputeCommitment) {
            revert ErrorDisputeCommitmentNotAvailable();
        }
            
        // check if the original timeout is greater than the recursive timeout
        if(originalDispute.timeout.blockHeight <= recursiveDispute.timeout.blockHeight) {
            revert ErrorInvalidBlock();
        }
        
        return recursiveDispute.disputer;
    }
    
    // ------------------------------------ Dispute Fraud Proofs ------------------------------------
    
    function _handleDisputeInvalidPreviousRecursive(bytes memory encodedProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address) {
        DisputeInvalidPreviousRecursiveProof memory disputeInvalidPreviousRecursiveProof = abi.decode(encodedProof, (DisputeInvalidPreviousRecursiveProof));
        Dispute memory originalDispute = disputeInvalidPreviousRecursiveProof.originalDispute;
        Dispute memory invalidRecursiveDispute = disputeInvalidPreviousRecursiveProof.invalidRecursiveDispute;
        uint originalDisputeTimestamp = disputeInvalidPreviousRecursiveProof.originalDisputeTimestamp;
        uint invalidRecursiveDisputeTimestamp = disputeInvalidPreviousRecursiveProof.invalidRecursiveDisputeTimestamp;
        bytes memory invalidRecursiveDisputeOutputState = disputeInvalidPreviousRecursiveProof.invalidRecursiveDisputeOutputState;
        Block memory originalDisputeLastBlock = abi.decode(originalDispute.stateProof.signedBlocks[originalDispute.stateProof.signedBlocks.length - 1].encodedBlock, (Block));
        Block memory invalidRecursiveDisputeLastBlock = abi.decode(invalidRecursiveDispute.stateProof.signedBlocks[invalidRecursiveDispute.stateProof.signedBlocks.length - 1].encodedBlock, (Block));
        
        // check if the recursive was done during the desired challenge period of the original dispute
        bytes32 recursiveDisputeCommitment = keccak256(abi.encode(
            invalidRecursiveDispute,
            invalidRecursiveDisputeTimestamp
        ));
        bytes32 originalDisputeCommitment = keccak256(abi.encode(
            originalDispute,
            originalDisputeTimestamp
        ));

        (bool isAvailable, bytes32 commitment) = getDisputeCommitment(fraudProofVerificationContext.channelId, invalidRecursiveDispute.disputeIndex);
        require(!isAvailable && commitment != recursiveDisputeCommitment, ErrorDisputeCommitmentNotAvailable());

        require(invalidRecursiveDispute.previousRecursiveDisputeIndex == type(uint256).max || invalidRecursiveDispute.previousRecursiveDisputeIndex != originalDispute.disputeIndex, ErrorDisputeCommitmentNotAvailable());
        (bool isOriginalDisputeAvailable, bytes32 originalCommitment) = getDisputeCommitment(fraudProofVerificationContext.channelId, originalDispute.disputeIndex);
        
        require(!isOriginalDisputeAvailable && originalCommitment != originalDisputeCommitment, ErrorDisputeCommitmentNotAvailable());
        require(invalidRecursiveDisputeTimestamp > originalDisputeTimestamp + getChallengeTime(), ErrorWithinChallengePeriod());

        // check if the disputer used the latest state in recursive dispute       
        require(invalidRecursiveDisputeLastBlock.transaction.header.transactionCnt > originalDisputeLastBlock.transaction.header.transactionCnt, ErrorInvalidLatestState());
        
        address signer = StateChannelUtilLibrary.retriveSignerAddress(
            invalidRecursiveDispute.stateProof.signedBlocks[invalidRecursiveDispute.stateProof.signedBlocks.length - 1].encodedBlock,
            invalidRecursiveDispute.stateProof.signedBlocks[invalidRecursiveDispute.stateProof.signedBlocks.length - 1].signature
        );

        (bool found, bytes32 blockCalldataCommitment) = getBlockCallDataCommitment(fraudProofVerificationContext.channelId, invalidRecursiveDisputeLastBlock.transaction.header.forkCnt, invalidRecursiveDisputeLastBlock.transaction.header.transactionCnt, signer);
        require(signer == invalidRecursiveDispute.disputer || found, ErrorInvalidLatestState());

        // check if the recursive dispute extend the lashes
        require(invalidRecursiveDispute.outputStateSnapshotHash == keccak256(invalidRecursiveDisputeOutputState), ErrorInvalidDisputeOutputState());
        
        address[] memory initialParticipants = getSnapshotParticipants(fraudProofVerificationContext.channelId);
        address[] memory afterDisputeParticipants = getStatemachineParticipants(invalidRecursiveDisputeOutputState);
        require(afterDisputeParticipants.length < initialParticipants.length, ErrorRecursiveDisputeNotExtendingSlashes());
        
        return invalidRecursiveDispute.disputer;
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
