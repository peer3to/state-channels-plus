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

        address challenger = msg.sender;
        // check if the commitment of dispute is available
        bytes32 memory disputeCommitment = keccak256(abi.encodePacked(
            dispute,
            block.timestamp
        ));
        (bool isAvailable, int index) = isDisputeCommitmentAvailable(disputeCommitment);
        if(!isAvailable) {
            revert("Dispute commitment not available");
        }

        // verify state proofs
        // see if it should return something
        bool isStateProofValid = _verifyStateProof(disputeAuditingData.latestStateSnapshot, disputeData.stateProofs, participants);
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
       
        (bool isSuccess, address[] memory slashParticipants) = auditDispute(dispute, disputeAuditingData);
        
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
                accumulatedSlashParticipants = concatAddressArrays(accumulatedSlashParticipants, slashParticipants);
            }else if(_isDisputeFraudProof(dispute.fraudProofs[i].proofType)) {
                (isValid, slashParticipants) = _handleDisputeFraudProofs(dispute, dispute.fraudProofs[i]);
                isSuccess = isSuccess && isValid;
                accumulatedSlashParticipants = concatAddressArrays(accumulatedSlashParticipants, slashParticipants);
            }else if(_isTimeoutFraudProof(dispute.fraudProofs[i].proofType)) {
                (isValid, slashParticipants) = _handleTimeoutDispute(dispute, dispute.fraudProofs[i]);
                isSuccess = isSuccess && isValid;
                accumulatedSlashParticipants = concatAddressArrays(accumulatedSlashParticipants, slashParticipants);
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

        // if the state transition is invalid, slash the disputer
        (bool isTransitionValid, bytes memory encodedModifiedState) = executeStateTransitionOnState(
            fraudBlock.channelId,
            blockInvalidSTProof.encodedState,
            fraudBlock.transaction
        );

         // If state transition is valid, return true and block confirmation signatures
        if (isTransitionValid) {
            return (true, blockInvalidSTProof.fraudBlockConfirmation.signatures);
        }
        
        // If state hash matches, return true and block confirmation signatures
        if (keccak256(encodedModifiedState) == dispute.latestStateSnapshotHash) {
            return (true, blockInvalidSTProof.fraudBlockConfirmation.signatures);
        }
        
        // If both checks fail, slash the disputer
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

    function _verifyStateProof(bytes memory encodedLatestState, StateProof[] memory stateProofs, address[] memory participants) internal {
        for(uint i = 0; i < stateProofs.length; i++) {
            _verifySignedBlocks(stateProofs[i].signedBlocks, stateProofs[i].forkProof, encodedLatestState, participants);
        }
        for(uint i = 1; i < stateProofs.length; i++) {
            _verifyForkProof(stateProofs[i].forkProof, participants);
        }
    }

    function _verifySignedBlocks(SignedBlock[] memory signedBlocks, ForkProof memory forkProof, bytes memory encodedLatestState, address[] memory participants) internal {
        for (uint i = signedBlocks.length - 1; i > 0; i--) {
            // Get current and previous blocks
            Block memory currentBlock = abi.decode(signedBlocks[i].encodedBlock, (Block));
            Block memory previousBlock = abi.decode(signedBlocks[i-1].encodedBlock, (Block));
            
            if(i == signedBlocks.length - 1 && currentBlock.stateHash != keccak256(encodedLatestState)) {
                revert("Latest state does not connect to last signed block");
            }
            require(
                currentBlock.previousStateHash == previousBlock.stateHash,
                "Parent hash mismatch"
            );

            if(forkProof.forkMilestoneProofs.length > 0){
                // check if the first state connects to milestone block       
                Block memory lastMilestoneConfirmationBlock =
                abi.decode(
                    forkProof.forkMilestoneProofs[forkProof.forkMilestoneProofs.length - 1]
                    .blockConfirmations[forkProof.forkMilestoneProofs[forkProof.forkMilestoneProofs.length - 1].blockConfirmations.length - 1].encodedBlock,
                    (Block)
                );

                if(i == 1 && previousBlock.previousStateHash != lastMilestoneConfirmationBlock.stateHash) {
                    revert("Latest state does not connect to milestone block");
                }
            }
            
        }
        
    }

    function _verifyForkProof(ForkProof memory forkProof, address[] memory expectedAddresses) internal {
        // per each forkMilestoneProof we expect the signatures to reduce by 1
        uint expectedSignatures = expectedAddresses.length;
        // 1. verify forkMilestoneProofs
        for (uint i = 0; i < forkProof.forkMilestoneProofs.length; i++) {
        ForkMilestoneProof memory milestone = forkProof.forkMilestoneProofs[i];
        
            // Verify each block confirmation
            for (uint j = 0; j < milestone.blockConfirmations.length; j++) {
                BlockConfirmation memory confirmation = milestone.blockConfirmations[j];
                
                // Verify block signatures
                if(confirmation.signatures.length != expectedSignatures) {
                    revert("Invalid number of signatures");
                }
                // verify signatures are from peers in genesis state
                _verifyBlockConfirmationSignatures(
                    confirmation.encodedBlock,
                    expectedAddresses,
                    confirmation.signatures
                );
                expectedSignatures--;
            }
        }

    }

    // =============================== Helper Functions ===============================

    function _verifyBlockConfirmationSignatures(bytes memory encodedBlock, address[] memory expectedAddresses, bytes[] memory signatures) internal {
        for (uint i = 0; i < signatures.length; i++) {
            address signer = StateChannelUtilLibrary.retriveSignerAddress(encodedBlock, signatures[i]);
            if(!StateChannelUtilLibrary.isAddressInArray(expectedAddresses, signer)) {
                revert("Invalid signature");
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

    function concatAddressArrays(address[] memory array1, address[] memory array2) internal pure returns (address[] memory) {
       for (uint i = 0; i < array2.length; i++) {
        array1.push(array2[i]);
       }
       return array1;
    }
}
