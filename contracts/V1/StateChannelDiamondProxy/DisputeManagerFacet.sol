pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./DisputeErrors.sol";
import "./Events.sol";

contract DisputeManagerFacet is StateChannelCommon {
    

    function createDispute(
        Dispute memory dispute,
        bytes memory signature
    ) public { 
        // sanity checks
        msg.sender == dispute.disputer;
        // race condition check
        if(onChainSlashes.length != onChainSlashedParticipants.length 
        || onChainSlashes[onChainSlashes.length - 1] != onChainSlashedParticipants[onChainSlashedParticipants.length - 1]) {
            revert("onChainSlashes does not match onChainSlashedParticipants");
        }

        address disputer = StateChannelUtilLibrary.retriveSignerAddress(dispute.encodedBlock, signature);
        if(disputer != dispute.disputer) {
            revert("Invalid signature");
        }
        if(proofs.length == 0) return;
        // commit to dispute struct
        bytes memory encodedDispute = abi.encode(dispute);
        bytes32 memory channelIdHash = keccak256(dispute.channelId);
        bytes32 memory disputeCommitment = keccak256(abi.encodePacked(
            encodedDispute, 
            block.timestamp
        ));
        disputes[channelIdHash].push(disputeCommitment);
        emit DisputeSubmitted(encodedDispute, signature);
    }


    /// @dev This function is used to audit the dispute data and assert if the output state is correct
    // 1. Verify all data against commitments
    // 2. Check state proofs
    // 3. Verify fraud proofs
    // 4. Validate output state
    
    /// Returns:
    /// - bool: success/failure
    /// - bytes: error reason if failed
    /// - address[]: slashed participants if successful
    function auditDispute(
        Dispute memory dispute,
        DisputeAuditingData memory disputeAudit
    ) public returns (bool isSuccess, address[] memory slashParticipants) {

        // check if the commitment of dispute is available
        bytes32 memory disputeCommitment = keccak256(abi.encodePacked(
            dispute,
            block.timestamp
        ));
        (bool isAvailable, int index) = isDisputeCommitmentAvailable(disputeCommitment);
        if(!isAvailable) {
            revert(abi.encode("AUDIT: DISPUTE COMMITMENT NOT AVAILABLE"));
        }

        // verify state proofs
        // see if it should return something
        bool isStateProofValid = _verifyStateProof(disputeAuditingData.latestStateSnapshot, dispute.stateProof, participants);
        if(!isStateProofValid) {
            return (false, [dispute.disputer]);
        }
        // verify fraud proofs
        (bool isValid, address[] memory returnedSlashedParticipants) = _verifyFraudProofs(disputeData,disputeAuditingData);
       
        // validate output state
        bool isOutputStateValid = _validateOutputState(disputeData, disputeAuditingData.latestStateSnapshot);
       
        return (isValid, returnedSlashedParticipants);
    }


    // 1. Run audit on-chain
    // 2. If audit fails:
    //    - Slash disputer
    //    - Create new dispute with updated slashes
    // 3. If audit succeeds:
    //    - Slash challenger
    //    - New dispute is ignored
    function challengeDispute(
        Dispute memory dispute,
        DisputeAuditingData memory disputeAuditingData
    ) public {
       
        address challenger = msg.sender; // I dont think we should slash the auditor as they are like Polkadot fisherman

        (bool isAllAuditValid, address[] memory collectedSlashParticipants) = auditDispute(dispute, disputeAuditingData);

        if(isAllAuditValid) {
            addOnChainSlashedParticipants(collectedSlashParticipants);
            address[] memory returnedSlashParticipants = getOnChainSlashedParticipants();
            emit DisputeChallengeResult(dispute.channelId, isAllAuditValid, returnedSlashParticipants);
        }
        else {
            uint memory disputeLength = getDisputeLength(dispute.channelId);
            DisputePair memory disputePair = DisputePair(dispute.disputeIndex, disputeLength-1);
            onChainDisputePairs.push(disputePair);
            addOnChainSlashedParticipants(collectedSlashParticipants);
            address[] memory returnedSlashParticipants = getOnChainSlashedParticipants();
            emit DisputeChallengeResultWithDisputePair(dispute.channelId, disputePair, isAllAuditValid, returnedSlashParticipants);
        }
        
    }

    // =============================== Fraud Proofs Verification ===============================
    function _verifyFraudProofs(
        Dispute memory dispute,
        DisputeAuditingData memory disputeAuditingData
    ) internal returns (bool isValid, address[] memory slashParticipants) {
        // only when all fraud proofs are verified successfully, return true
        bool isSuccess;
        address[] memory accumulatedSlashParticipants;

        for(uint i = 0; i < dispute.fraudProofs.length; i++) {
           
            if(_isBlockFraudProof(dispute.fraudProofs[i].proofType)) {
                (isValid, slashParticipants) = _handleBlockFraudProofs(dispute, dispute.fraudProofs[i]);
                isSuccess = isSuccess && isValid;
                accumulatedSlashParticipants = StateChannelUtilLibrary.concatAddressArrays(accumulatedSlashParticipants, slashParticipants);
            }else if(_isDisputeFraudProof(dispute.fraudProofs[i].proofType)) {
                (isValid, slashParticipants) = _handleDisputeFraudProofs(dispute, dispute.fraudProofs[i]);
                isSuccess = isSuccess && isValid;
                accumulatedSlashParticipants = StateChannelUtilLibrary.concatAddressArrays(accumulatedSlashParticipants, slashParticipants);
            }else if(_isTimeoutFraudProof(dispute.fraudProofs[i].proofType)) {
                (isValid, slashParticipants) = _handleTimeoutDispute(dispute, dispute.fraudProofs[i]);
                isSuccess = isSuccess && isValid;
                accumulatedSlashParticipants = StateChannelUtilLibrary.concatAddressArrays(accumulatedSlashParticipants, slashParticipants);
            }
        }
        return (isSuccess, accumulatedSlashParticipants);
    }

    function _handleBlockFraudProofs(
        Dispute storage dispute,
        Proof memory proof
    ) internal returns (bool isValid, address[] memory slashParticipants) {
       
        if(proof.proofType == ProofType.BlockDoubleSign){
            (isValid, slashParticipants) = _verifyBlockDoubleSign(dispute,proof);
            return (isValid, slashParticipants);

        }else if(proof.proofType == ProofType.BlockEmptyBlock){
            (isValid, slashParticipants) = _verifyBlockEmptyBlock(dispute,proof);
            return (isValid, slashParticipants);

        }else if(proof.proofType == ProofType.BlockInvalidStateTransition){
            (isValid, slashParticipants) = _verifyBlockInvalidStateTransition(dispute,proof);
            return (isValid, slashParticipants);

        }else if(proof.proofType == ProofType.BlockOutOfGas){
            (isValid, slashParticipants) = _verifyBlockOutOfGas(dispute,proof);
            return (isValid, slashParticipants);
        }
    
    }

    function _handleDisputeFraudProofs(
        Dispute storage dispute,
        Proof memory proofs
    ) internal {

            if(proofs.proofType == ProofType.DisputeNotLatestState){
                _verifyDisputeNotLatestState(dispute,proofs);

            }else if(proofs.proofType == ProofType.DisputeInvalid){
                _verifyDisputeInvalid(dispute,proofs);

            }else if(proofs.proofType == ProofType.DisputeInvalidRecursive){
                _verifyDisputeInvalidRecursive(dispute,proofs);

            }else if(proofs.proofType == ProofType.DisputeOutOfGas){
                _verifyDisputeOutOfGas(dispute,proofs);

            }else if(proofs.proofType == ProofType.DisputeInvalidOutputState){
                _verifyDisputeInvalidOutputState(dispute,proofs);

            }else if(proofs.proofType == ProofType.DisputeInvalidStateProof){
                _verifyDisputeInvalidStateProof(dispute,proofs);

            }else if(proofs.proofType == ProofType.DisputeInvalidPreviousRecursive){
                _verifyDisputeInvalidPreviousRecursive(dispute,proofs);

            }else if(proofs.proofType == ProofType.DisputeInvalidExitChannelBlocks){
                _verifyDisputeInvalidExitChannelBlocks(dispute,proofs);
            }
    }

    function _handleTimeoutDispute(
        Dispute storage dispute,
        Proof memory proof
    ) internal {

            if(proof.proofType == ProofType.TimeoutThreshold){
                _verifyTimeoutThreshold(dispute,proof);

            }else if(proof.proofType == ProofType.TimeoutPriorInvalid){
                _verifyTimeoutPriorInvalid(dispute,proof);

            }else if(proof.proofType == ProofType.TimeoutParticipantNoNext){
                _verifyTimeoutParticipantNoNext(dispute,proof);

            }else if(proof.proofType == ProofType.NotLinkedToLatestState){
                _verifyNotLinkedToLatestState(dispute,proof);
            }
    }

    // =============================== Block Dispute Fraud Proofs Verification ===============================

    function _verifyBlockInvalidStateTransition(
        Dispute memory dispute,
        Proof memory proof
    ) internal returns (bool isValid, address[] memory slashedParticipants )  {

        BlockInvalidStateTransitionProof memory blockInvalidSTProof = abi.decode(proof.encodedProof, (BlockInvalidStateTransitionProof));
        Block memory fraudBlock = abi.decode(blockInvalidSTProof.fraudBlockConfirmation.signedBlock.encodedBlock, (Block));

        if(dispute.channelId != fraudBlock.transaction.header.channelId) {
            return (false, [dispute.disputer]);
        }

        (bool isTransitionValid, bytes memory encodedModifiedState) = executeStateTransitionOnState(
            fraudBlock.channelId,
            blockInvalidSTProof.encodedState,
            fraudBlock.transaction
        );

        if (isTransitionValid) {
            return (true, blockInvalidSTProof.fraudBlockConfirmation.signatures);
        }        
        if (keccak256(encodedModifiedState) == dispute.latestStateSnapshotHash) {
            return (true, blockInvalidSTProof.fraudBlockConfirmation.signatures);
        }
        return (false, [dispute.disputer]);
    }

    function _verifyBlockDoubleSign( 
        Dispute memory dispute,
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

        BlockDoubleSignProof memory blockDoubleSignProof = abi.decode(proof.encodedProof, (BlockDoubleSignProof));

        Block memory block1 = abi.decode(blockDoubleSignProof.block1.encodedBlock, (Block));
        Block memory block2 = abi.decode(blockDoubleSignProof.block2.encodedBlock, (Block));

        if(dispute.channelId != block1.transaction.header.channelId || dispute.channelId != block2.transaction.header.channelId) {
            return (false, [dispute.disputer]);
        }

        if(block1.stateHash != block2.stateHash && block1.previousStateHash != block2.previousStateHash) {
            return (false, [dispute.disputer]);
        }
        
        address memory signer1 = StateChannelUtilLibrary.retriveSignerAddress(
            blockDoubleSignProof.block1.encodedBlock,
            blockDoubleSignProof.block1.signature
        );
        address memory signer2 = StateChannelUtilLibrary.retriveSignerAddress(
            blockDoubleSignProof.block2.encodedBlock,
            blockDoubleSignProof.block2.signature
        );
        if(signer1 != signer2) {
            return (false, [dispute.disputer]);
        }
        return (true, [signer1]);
    }
    
    function _verifyBlockStateTransitionOutOfGas(
        Dispute memory dispute,
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {
        BlockOutOfGasProof memory blockOutOfGasProof = abi.decode(proof.encodedProof, (BlockOutOfGasProof));
        Block memory fraudBlock = abi.decode(blockOutOfGasProof.fraudBlockConfirmation.signedBlock.encodedBlock, (Block));

        if(dispute.channelId != fraudBlock.transaction.header.channelId) {
            return (false, [dispute.disputer]);
        }
        uint256 gasLimit = getGasLimit();
        // transit a state and see if it out of gas error is returned
        try executeStateTransitionOnState{gas: gasLimit}(
            fraudBlock.channelId,
            blockOutOfGasProof.encodedState,
            fraudBlock.transaction
        ){
            return (false, [dispute.disputer]);
        }catch(bytes memory reason){
            address[] memory slashParticipants = blockOutOfGasProof.fraudBlockConfirmation.signatures;
            return (true, slashedParticipant);
        }
        
    }
    
    function _verifyBlockEmptyBlock(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {
        BlockEmptyProof memory blockEmptyProof = abi.decode(proof.encodedProof, (BlockEmptyProof));
        Block memory fraudBlock = abi.decode(blockEmptyProof.emptyBlock.encodedBlock, (Block));

        if(dispute.channelId != fraudBlock.transaction.header.channelId) {
            return (false, [dispute.disputer]);
        }
        if(fraudBlock.transaction.header.transactionCnt != uint(0)) {
            return (false, [dispute.disputer]);
        }
        address memory signer = StateChannelUtilLibrary.retriveSignerAddress(
            blockEmptyProof.emptyBlock.encodedBlock,
            blockEmptyProof.emptyBlock.signature
        );
        return (true, [signer]);
    }
    
    // =============================== Dispute Fraud proof Verification ===============================

    function _verifyDisputeNotLatestState(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }

    function _verifyDisputeInvalid(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }
    
    function _verifyDisputeInvalidRecursive(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }

    function _verifyDisputeOutOfGas(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }

    function _verifyDisputeInvalidOutputState(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }

    function _verifyDisputeInvalidStateProof(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }

    function _verifyDisputeInvalidPreviousRecursive(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }

    function _verifyDisputeInvalidExitChannelBlocks(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }
    
    // =============================== Dispute Timeout Verification ===============================

    function _verifyTimeoutThreshold(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }

    function _verifyTimeoutPriorInvalid(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }

    function _verifyTimeoutParticipantNoNext(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }

    function _verifyNotLinkedToLatestState(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }

    // =============================== State Proofs Verification  ===============================

    function _verifyStateProof(bytes memory encodedLatestState, StateProof memory stateProof, address[] memory participants) internal returns (bool isValid) {
        // ideal case , no signedBlocks, latestState = lastFinalizedState = MilestoneBlock
        if(stateProofs.signedBlocks.length == 0) {
            // check if the last finalized state is the milestone block (Block Confirmation)
            // check if BlockConfirmation is only 1, if not then there should be signedBlocks as the latest state  is not the finalized state
            BlockConfirmation[] memory blockConfirmations = stateProofs.forkProof.forkMilestoneProofs.blockConfirmations;
            if (blockConfirmations.length != 1) {
                revert(abi.encode("LATEST STATE IS NOT FINALIZED STATE"));
            }else{
                Block memory lastFinalizedState = abi.decode(blockConfirmations[0].encodedBlock, (Block));
                // verify signatures
                _verifyBlockConfirmationSignatures(
                    blockConfirmations[0].encodedBlock,
                    participants,
                    blockConfirmations[0].signatures
                );
                if(lastFinalizedState.stateHash != encodedLatestState) {
                    revert(abi.encode("LATEST STATE IS NOT FINALIZED STATE"));
                }
            }
           
            return true;
        }else{
            // worst case, there are signedBlocks, we need to verify the signedBlocks and the forkProofs
            _verifySignedBlocks(stateProof.signedBlocks, stateProof.forkProof, encodedLatestState, participants);
            
        }
        _verifyForkProof(stateProof.forkProof, participants);
    }

    function _verifySignedBlocks(SignedBlock[] memory signedBlocks, ForkProof memory forkProof, bytes memory encodedLatestState, address[] memory participants) internal {
        for (uint i = signedBlocks.length - 1; i > 0; i--) {
            // Get current and previous blocks
            Block memory currentBlock = abi.decode(signedBlocks[i].encodedBlock, (Block));
            Block memory previousBlock = abi.decode(signedBlocks[i-1].encodedBlock, (Block));
            
            if(i == signedBlocks.length - 1 && currentBlock.stateHash != keccak256(encodedLatestState)) {
                revert(abi.encode("SIGNED BLOCKS: LATEST STATE DOES NOT CONNECT TO LAST SIGNED BLOCK"));
            }
            require(
                currentBlock.previousStateHash == previousBlock.stateHash,
                abi.encode("SIGNED BLOCKS: PARENT HASH MISMATCH")
            );

            if(i == 1 && forkProof.forkMilestoneProofs.length > 0){
                // check if the first state connects to milestone block       
                Block memory lastMilestoneConfirmationBlock =
                abi.decode(
                    forkProof.forkMilestoneProofs[forkProof.forkMilestoneProofs.length - 1]
                    .blockConfirmations[forkProof.forkMilestoneProofs[forkProof.forkMilestoneProofs.length - 1].blockConfirmations.length - 1].encodedBlock,
                    (Block)
                );

                if(previousBlock.previousStateHash != lastMilestoneConfirmationBlock.stateHash) {
                    revert(abi.encode("SIGNED BLOCKS: LATEST STATE DOES NOT CONNECT TO MILESTONE BLOCK"));
                }
            }else{
                revert(abi.encode("SIGNED BLOCKS: NO MILESTONE BLOCK FOUND"));
            }   
        }
    }

    /// @dev Verfies ForkMilestoneBlock along with BlockConfirmations and taking into accounts Virtual Voting
    function _verifyForkProof(ForkProof memory forkProof, address[] memory expectedAddresses) internal {    
        // per each forkMilestoneProof we expect the signatures to reduce by 1 until latest Finalized State
        uint expectedSignatures = expectedAddresses.length;
        for(uint i = 0; i < forkProof.forkMilestoneProofs.length; i++) {
            ForkMilestoneProof memory milestone = forkProof.forkMilestoneProofs[i];
            // check BlockConfirmations and Virtual Voting per forkMilestoneBlock
            if(milestone.blockConfirmations.length == 1){
                if(milestone.blockConfirmations[0].signatures.length != expectedSignatures){
                    revert(abi.encode("MILESTONE: INVALID NUMBER OF SIGNATURES"));
                }
                _verifyBlockConfirmationSignatures(
                    milestone.blockConfirmations[0].encodedBlock,
                    expectedAddresses,
                    milestone.blockConfirmations[0].signatures
                );
                expectedSignatures--;
            }else{
                // there is virtual vote
                address[] memory VotingAddresses;
                for(uint j = 0; j < milestone.blockConfirmations.length; j++) {
                    BlockConfirmation memory confirmation = milestone.blockConfirmations[j];
                    BlockConfirmation memory followingConfirmation = milestone.blockConfirmations[j+1];
                    // verify state commitment
                    Block memory signedBlock1 = abi.decode(confirmation.signedBlock.encodedBlock, (Block));
                    Block memory signedBlock2 = abi.decode(followingConfirmation.signedBlock.encodedBlock, (Block));
                    if(signedBlock2.stateHash != signedBlock1.previousStateHash){
                        revert(abi.encode("MILESTONE: STATE COMMITMENT MISMATCH"));
                    }
                    // collect all the addresses
                    address memory signedAddress = StateChannelUtilLibrary.retriveSignerAddress(confirmation.signedBlock.encodedBlock, confirmation.signedBlock.signature);
                    VotingAddresses = StateChannelUtilLibrary.concatAddressArrays(VotingAddresses, signedAddress);
                    if(confirmation.signatures.length > 0 ){
                        VotingAddresses = StateChannelUtilLibrary.concatAddressArrays(VotingAddresses, confirmation.signatures);
                    }
                }
                if(VotingAddresses.length != expectedSignatures){
                    revert(abi.encode("MILESTONE: INVALID NUMBER OF SIGNATURES"));
                }
                expectedSignatures--;
            }
        }

    }

    // =============================== Helper Functions ===============================

    function _verifyBlockConfirmationSignatures(bytes memory encodedBlock, address[] memory expectedAddresses, bytes[] memory signatures) internal {
        for (uint i = 0; i < signatures.length; i++) {
            address signer = StateChannelUtilLibrary.retriveSignerAddress(encodedBlock, signatures[i]);
            if(!StateChannelUtilLibrary.isAddressInArray(expectedAddresses, signer)) {
                revert(abi.encode("INVALID BLOCK CONFIRMATION SIGNATURE"));
            }
        }
    }

     /**
     *
     * Executes all composable operations on the global state (depositing funds, interacting with other contracts)
     * Should NOT modify the state channel state!
     * returns true on success, otherwise should revert or return false
     */
    function addParticipantComposable(
        JoinChannel memory joinChannel
    ) internal returns (bool) {
        return
            AStateChannelManagerProxy(address(this)).addParticipantComposable(
                joinChannel
            );
    }

    /**
     *
     * Executes all composable operations on the global state (depositing funds, interacting with other contracts)
     * Should NOT modify the state channel state!
     * returns true on success, otherwise should revert or return false
     */
    function removeParticipantComposable(
        bytes32 channelId,
        ProcessExit memory processExit
    ) internal returns (bool) {
        return
            AStateChannelManagerProxy(address(this))
                .removeParticipantComposable(channelId, processExit);
    }

    // function getNext
    //stateless
    function applyJoinChannelToStateMachine(
        bytes memory encodedState,
        JoinChannel[] memory joinCahnnels
    )
        internal
        virtual
        returns (bytes memory encodedModifiedState, uint successCnt)
    {
        return
            AStateChannelManagerProxy(address(this))
                .applyJoinChannelToStateMachine(encodedState, joinCahnnels);
    }

    //stateless
    function applySlashesToStateMachine(
        bytes memory encodedState,
        address[] memory slashedParticipants
    )
        internal
        virtual
        returns (
            bytes memory encodedModifiedState,
            ProcessExit[] memory,
            uint successCnt
        )
    {
        return
            AStateChannelManagerProxy(address(this)).applySlashesToStateMachine(
                encodedState,
                slashedParticipants
            );
    }

    //stateless
    function removeParticipantsFromStateMachine(
        bytes memory encodedState,
        address[] memory participants
    )
        internal
        virtual
        returns (
            bytes memory encodedModifiedState,
            ProcessExit[] memory,
            uint successCnt
        )
    {
        return
            AStateChannelManagerProxy(address(this))
                .removeParticipantsFromStateMachine(encodedState, participants);
    }

    function executeStateTransitionOnState(
        bytes32 channelId,
        bytes memory encodedState,
        Transaction memory _tx
    ) public virtual returns (bool, bytes memory) {
        return
            AStateChannelManagerProxy(address(this))
                .executeStateTransitionOnState(channelId, encodedState, _tx);
    }


    
    function _isBlockFraudProof(ProofType proofType) private pure returns (bool) {
    return proofType == ProofType.BlockDoubleSign ||
           proofType == ProofType.BlockEmptyBlock ||
           proofType == ProofType.BlockInvalidStateTransition ||
           proofType == ProofType.BlockOutOfGas;
    }

    function _isTimeoutFraudProof(ProofType proofType) private pure returns (bool) {
    return proofType == ProofType.TimeoutThreshold ||
           proofType == ProofType.TimeoutPriorInvalid ||
           proofType == ProofType.TimeoutParticipantNoNext;
    }

    function _isDisputeFraudProof(ProofType proofType) private pure returns (bool) {
    return proofType == ProofType.DisputeNotLatestState ||
           proofType == ProofType.DisputeInvalid ||
           proofType == ProofType.DisputeInvalidRecursive ||
           proofType == ProofType.DisputeOutOfGas ||
           proofType == ProofType.DisputeInvalidOutputState ||
           proofType == ProofType.DisputeInvalidStateProof ||
           proofType == ProofType.DisputeInvalidPreeviousRecursive ||
           proofType == ProofType.DisputeInvalidExitChannelBlocks;
    }
 
}
