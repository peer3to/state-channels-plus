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
        bytes memory dispute,
        bytes memory disputeAudit
    ) public returns (address[] memory slashParticipants) {

        address challenger = msg.sender;
        Dispute memory disputeData = abi.decode(dispute, (Dispute));
        DisputeAuditingData memory disputeAuditingData = abi.decode(disputeAudit, (DisputeAuditingData));
        address[] memory participants = getParticipants(disputeData.channelId, disputeData.forkCnt);
        address[] memory slashedParticipants;

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
        // verify fraud proofs
        address[] memory returnedSlashedParticipants = _verifyFraudProofs(disputeData,disputeAuditingData);
        // validate output state
        bool isOutputStateValid = _validateOutputState(disputeData, disputeAuditingData.latestStateSnapshot);
       
        if(!isStateProofValid || !isOutputStateValid) {
            if(returnedSlashedParticipants.length > 0) {
                slashedParticipants = returnedSlashedParticipants;
            }else {
                slashedParticipants.push(disputeData.disputer);
            }
        }
        
        return slashedParticipants;
    }


    // 1. Run audit on-chain
    // 2. If audit fails:
    //    - Slash disputer
    //    - Create new dispute with updated slashes
    // 3. If audit succeeds:
    //    - Slash challenger
    //    - New dispute is ignored
    function challengeDispute(
        bytes memory disputeAudit
    ) public {
        
        
    }

    // =============================== Fraud Proofs Verification ===============================
    function _verifyFraudProofs(
        Dispute memory dispute,
        DisputeAuditingData memory disputeAuditingData
    ) internal {
        for(uint i = 0; i < disputeAuditingData.proofs.length; i++) {

            if(_isBlockFraudProof(dispute.fraudProofs[i].proofType)) {
                _handleBlockFraudProofs(dispute, dispute.fraudProofs[i]);

            }else if(_isDisputeFraudProof(dispute.fraudProofs[i].proofType)) {
                _handleDisputeFraudProofs(dispute, dispute.fraudProofs[i]);

            }else if(_isTimeoutFraudProof(dispute.fraudProofs[i].proofType)) {
                _handleTimeoutDispute(dispute, dispute.fraudProofs[i]);
            }
        }
    }

    function _handleBlockFraudProofs(
        Dispute storage dispute,
        Proof memory proof
    ) internal {
       
        if(proof.proofType == ProofType.BlockDoubleSign){
            _verifyBlockDoubleSign(proof);

        }else if(proof.proofType == ProofType.BlockEmptyBlock){
            _verifyBlockEmptyBlock(proof);

        }else if(proof.proofType == ProofType.BlockInvalidStateTransition){
            _verifyBlockInvalidStateTransition(proof);

        }else if(proof.proofType == ProofType.BlockOutOfGas){
            _verifyBlockOutOfGas(proof);
        }
    
    }

    function _handleDisputeFraudProofs(
        Dispute storage dispute,
        Proof[] memory proofs
    ) internal {
        for(uint i = 0; i < proofs.length; i++) {

            if(proofs[i].proofType == ProofType.DisputeNotLatestState){
                _verifyDisputeNotLatestState(proofs[i]);

            }else if(proofs[i].proofType == ProofType.DisputeInvalid){
                _verifyDisputeInvalid(proofs[i]);

            }else if(proofs[i].proofType == ProofType.DisputeInvalidRecursive){
                _verifyDisputeInvalidRecursive(proofs[i]);

            }else if(proofs[i].proofType == ProofType.DisputeOutOfGas){
                _verifyDisputeOutOfGas(proofs[i]);

            }else if(proofs[i].proofType == ProofType.DisputeInvalidOutputState){
                _verifyDisputeInvalidOutputState(proofs[i]);

            }else if(proofs[i].proofType == ProofType.DisputeInvalidStateProof){
                _verifyDisputeInvalidStateProof(proofs[i]);

            }else if(proofs[i].proofType == ProofType.DisputeInvalidPreviousRecursive){
                _verifyDisputeInvalidPreviousRecursive(proofs[i]);

            }else if(proofs[i].proofType == ProofType.DisputeInvalidExitChannelBlocks){
                _verifyDisputeInvalidExitChannelBlocks(proofs[i]);
            }
        }
    }

    function _handleTimeoutDispute(
        Dispute storage dispute,
        Proof[] memory proofs
    ) internal {
        for(uint i = 0; i < proofs.length; i++) {

            if(proofs[i].proofType == ProofType.TimeoutThreshold){
                _verifyTimeoutThreshold(proofs[i]);

            }else if(proofs[i].proofType == ProofType.TimeoutPriorInvalid){
                _verifyTimeoutPriorInvalid(proofs[i]);

            }else if(proofs[i].proofType == ProofType.TimeoutParticipantNoNext){
                _verifyTimeoutParticipantNoNext(proofs[i]);

            }else if(proofs[i].proofType == ProofType.NotLinkedToLatestState){
                _verifyNotLinkedToLatestState(proofs[i]);
            }
        }   
    }

    // =============================== Block Dispute Fraud Proofs Verification ===============================

    function _verifyBlockInvalidStateTransition(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant )  {
        Block memory block = abi.decode(proof.encodedBlock, (Block));
    }

    function _verifyBlockDoubleSign(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }
    
    function _verifyBlockStateTransitionOutOfGas(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

    }
    
    function _verifyBlockEmptyBlock(
        Proof memory proof
    ) internal returns (bool isValid, address slashedParticipant) {

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
}
