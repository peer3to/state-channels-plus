pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";

contract DisputeManagerFacet is StateChannelCommon {

    function createDispute(
        Dispute memory dispute
    ) public { 
        if(msg.sender != dispute.disputer){
            revert ErrorDisputerNotMsgSender();
        }
        if(!_canParticipateInDisputes(dispute.channelId, msg.sender)){
            revert ErrorCantParticipateInDispute();
        }
        // race condition checks
        _disputeRaceConditionCheck(dispute);

        // commit to dispute struct
        bytes memory encodedDispute = abi.encode(dispute);
        bytes32 disputeCommitment = keccak256(abi.encode(
            encodedDispute, 
            block.timestamp
        ));
        disputeData[dispute.channelId].disputeCommitments.push(disputeCommitment);
        emit DisputeCommited(encodedDispute,block.timestamp);
    }
    
    
    /// @dev This function is used to audit the dispute data and assert if the output state is correct
    // Should be callable onlfy from the Diamond (Proxy) as a low level delegatecall with a gas limit -> external onlySelf
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
        DisputeAuditingData memory disputeAuditingData,
        uint timestamp
    ) external onlySelf returns (address[] memory slashParticipants) {
        
        require(_isCorrectDisputeCommitment(dispute, timestamp),ErrorDisputeWrongCommitment());
        require(_isCorrectAuditingData(dispute,disputeAuditingData),ErrorDisputeWrongAuditingData());
        require(!_isExpired(timestamp), ErrorDisputeExpired());
        require(_isCorrectGenesis(dispute,disputeAuditingData), ErrorDisputeGenesisInvalid());
        require(_verifyStateProof(dispute, disputeAuditingData), ErrorDisputeStateProofInvalid());
        require(_verifyJoinChannelBlocks(dispute, disputeAuditingData), ErrorDisputeJoinChannelBlocksInvalid());
        require(_verifyExitChannelBlocks(dispute, disputeAuditingData), ErrorDisputeExitChannelBlocksInvalid());

        FraudProofVerificationContext memory poofContext = FraudProofVerificationContext({
            channelId: dispute.channelId
        }); 
        (bytes memory encodedModifiedState, ExitChannelBlock memory exitBlock, 
        Balance memory totalDeposits, Balance memory totalWithdrawals) = generateDisputeOutputState(
            disputeAuditingData.latestStateStateMachineState,
            dispute.fraudProofs,
            poofContext,
            dispute.onChainSlashes,
            dispute.selfRemoval ? dispute.disputer : address(0),
            dispute.timeout.participant,
            disputeAuditingData.joinChannelBlocks,
            disputeAuditingData.latestStateSnapshot
        );
        require(_verifyBalanceInvariantCheck(dispute.channelId, totalDeposits, totalWithdrawals), ErrorDisputeBalanceInvariantInvalid());
        
        // ***************** Generate output snapshot ***************
        StateSnapshot memory outputStateSnapshot = StateSnapshot({
            stateMachineStateHash: keccak256(encodedModifiedState),
            participants: getStatemachineParticipants(encodedModifiedState),
            latestJoinChannelBlockHash: disputeAuditingData.outputStateSnapshot.latestExitChannelBlockHash, // This has been verified in _verifyJoinChannelBlocks
            latestExitChannelBlockHash: keccak256(abi.encode(exitBlock)),
            totalDeposits: totalDeposits, 
            totalWithdrawals: totalWithdrawals,
            forkCnt: disputeData[dispute.channelId].disputeCommitments.length
        });

        //verify outputStateSnapshot commitment
        if(keccak256(abi.encode(outputStateSnapshot)) != dispute.outputStateSnapshotHash) {
            revert ErrorDisputeOutputStateSnapshotInvalid();
        }
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
       
        // address challenger = msg.sender; // I dont think we should slash the auditor as they are like Polkadot fisherman

        // (bool isAllAuditValid, address[] memory collectedSlashParticipants, bytes memory fraudProofErrorResult) = auditDispute(dispute, disputeAuditingData);

        // if(isAllAuditValid) {
        //     addOnChainSlashedParticipants(collectedSlashParticipants);
        //     address[] memory returnedSlashParticipants = getOnChainSlashedParticipants();
        //     emit DisputeChallengeResultWithError(dispute.channelId, isAllAuditValid, returnedSlashParticipants, fraudProofErrorResult);
        // }
        // else {
        //     uint disputeLength = getDisputeLength(dispute.channelId);
        //     DisputePair memory disputePair = DisputePair(dispute.disputeIndex, disputeLength-1);
        //     onChainDisputePairs.push(disputePair);
        //     addOnChainSlashedParticipants(collectedSlashParticipants);
        //     address[] memory returnedSlashParticipants = getOnChainSlashedParticipants();
        //     emit DisputeChallengeResultWithDisputePair(dispute.channelId, disputePair, isAllAuditValid, returnedSlashParticipants);
        // }
        
    }

   
    // =============================== State Proofs Verification  ===============================
    function _verifyStateProof(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData) internal returns (bool isValid) {
        //This runs after verifying auditingData and genesisStateSnapshot => we can skip those checks here
        
        // Milestone checking
        (bool isValid, bytes memory lastBlockEncoded) = _verifyForkProof(dispute, disputeAuditingData);
        if(!isValid) {
            return false;
        }
        // If no blocks in milestones
        if(lastBlockEncoded.length == 0) {
            if(dispute.stateProof.signedBlocks.length == 0) {
                //no blocks at all => genesis == latest
                if(dispute.genesisStateSnapshotHash != dispute.latestStateSnapshotHash)
                    return false;   
            }else{
                //check if signedBlocks are linked, signed and build on genesis
                if(!_areSignedBlocksLinkedAndVerified(dispute.stateProof.signedBlocks, dispute.genesisStateSnapshotHash))
                    return false;

                Block memory lastBlock = abi.decode(dispute.stateProof.signedBlocks[dispute.stateProof.signedBlocks.length - 1].encodedBlock, (Block));
                //check if lastBlock commits to the latestStateSnapshot
                if(lastBlock.stateSnapshotHash != dispute.latestStateSnapshotHash)
                    return false;
            }
        }
        else{
            //check if signedBlocks are linked, signed and build on lastBlock from the milestones
            if(!_areSignedBlocksLinkedAndVerified(dispute.stateProof.signedBlocks, keccak256(lastBlockEncoded)))
                return false;

            //check if lastBlock commits to the latestStateSnapshot
            if(dispute.stateProof.signedBlocks.length != 0)
                lastBlockEncoded = dispute.stateProof.signedBlocks[dispute.stateProof.signedBlocks.length - 1].encodedBlock;
            Block memory lastBlock = abi.decode(lastBlockEncoded, (Block));
            //check if lastBlock commits to the latestStateSnapshot
            if(lastBlock.stateSnapshotHash != dispute.latestStateSnapshotHash)
                return false;
        }
            //check commitment to latestStateSnapshot
            if(dispute.latestStateSnapshotHash != keccak256(abi.encode(disputeAuditingData.latestStateSnapshot)))
                return false;
            //check commitment to latestStateStateMachineState
            if(disputeAuditingData.latestStateSnapshot.stateMachineStateHash != keccak256(disputeAuditingData.latestStateStateMachineState))
                return false;
            return true;
    }

    function _areSignedBlocksLinkedAndVerified(SignedBlock[] memory signedBlocks, bytes32 optionalPreviousHash) internal pure returns (bool isLinked) {
        bytes32 previousBlockHash = optionalPreviousHash;
        for(uint i = 0; i < signedBlocks.length; i++) {
            bytes memory currentBlockEncoded = signedBlocks[i].encodedBlock;
            Block memory currentBlock = abi.decode(currentBlockEncoded, (Block));
            //check is linked
            if(previousBlockHash!=bytes32(0) && previousBlockHash != currentBlock.previousBlockHash) {
                return false;
            }
            previousBlockHash = keccak256(currentBlockEncoded);
            //verify original siganture
            address signer = StateChannelUtilLibrary.retriveSignerAddress(currentBlockEncoded, signedBlocks[i].signature);
            if(signer != currentBlock.transaction.header.participant) {
                return false;
            }
            
        }
        return true;
    }

    function _isMilestoneFinal(ForkMilestoneProof memory milestone, address[] memory expectedParticipants, bytes32 genesisSnapshotHash) internal pure returns (bool isFinal,bytes32 finalizedSnapshotHash) {
        address[] memory thresholdSet = new address[](expectedParticipants.length);
        uint thresholdCount = 0;
        bytes memory previousEncodedBlock;
        BlockConfirmation memory currentBlockConfirmation;
        Block memory currentBlock;
        address adr;
        if(milestone.blockConfirmations.length == 0) {
            return (false, bytes32(0));
        }
        for (uint i = 0; i < milestone.blockConfirmations.length; i++) {
            currentBlockConfirmation = milestone.blockConfirmations[i];
            currentBlock = abi.decode(currentBlockConfirmation.signedBlock.encodedBlock, (Block));
            //check linked
            if(i!=0){
                if(currentBlock.previousBlockHash != keccak256(previousEncodedBlock)) {
                    return (false, bytes32(0));
                }
            }else{
                finalizedSnapshotHash = currentBlock.stateSnapshotHash;
            }
            // Collect signatures
            adr = StateChannelUtilLibrary.retriveSignerAddress(currentBlockConfirmation.signedBlock.encodedBlock, currentBlockConfirmation.signedBlock.signature);
            if(adr != currentBlock.transaction.header.participant)
                return (false, bytes32(0));
            thresholdCount = StateChannelUtilLibrary.tryInsertAddressInThresholdSet(adr, thresholdSet, thresholdCount, expectedParticipants);
            for (uint j = 0; j < currentBlockConfirmation.signatures.length; j++) {
                adr = StateChannelUtilLibrary.retriveSignerAddress(currentBlockConfirmation.signedBlock.encodedBlock, currentBlockConfirmation.signatures[j]);
                thresholdCount = StateChannelUtilLibrary.tryInsertAddressInThresholdSet(adr, thresholdSet, thresholdCount, expectedParticipants);
            }
            previousEncodedBlock = currentBlockConfirmation.signedBlock.encodedBlock;
        }
        
        return (thresholdCount == expectedParticipants.length, finalizedSnapshotHash);
    }
    /// @dev Verfies ForkMilestoneBlock along with BlockConfirmations and taking into account Virtual Voting
    function _verifyForkProof(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData) internal pure returns (bool isValid, bytes memory lastBlockEncoded) {    
        ForkMilestoneProof[] memory milestoneProofs = dispute.stateProof.forkProof.forkMilestoneProofs;
        StateSnapshot[] memory milestoneSnapshots = disputeAuditingData.milestoneSnapshots;
        StateSnapshot memory snapshot = disputeAuditingData.genesisStateSnapshot;
        address[] memory participants = snapshot.participants;
        lastBlockEncoded = "";
        // Every milestone (the final block) commits to a snapshot, that's needed to prove the next milestone => for K milestones K-1 snapshots are needed
        if(milestoneProofs.length != milestoneSnapshots.length + 1)
            return (false, "");
        
        for(uint i = 0; i < milestoneProofs.length; i++) {
            ForkMilestoneProof memory milestone = milestoneProofs[i];
            (bool isFinal, bytes32 finalizedSnapshotHash) = _isMilestoneFinal(milestone, participants, snapshot.stateMachineStateHash);
            if(!isFinal) {
                return (false, "");
            }
            if(keccak256(abi.encode(milestoneSnapshots[i])) != finalizedSnapshotHash) {
                return (false, "");
            }
            if(i < milestoneSnapshots.length) {
                snapshot = milestoneSnapshots[i];
                participants = milestoneSnapshots[i].participants;
            }
            if(i == milestoneProofs.length - 1 && milestone.blockConfirmations.length > 0) {
                lastBlockEncoded = milestone.blockConfirmations[milestone.blockConfirmations.length - 1].signedBlock.encodedBlock;
            }
        }
        return (true, lastBlockEncoded);
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
        ExitChannel memory exitChannel
    ) internal returns (bool) {
        return
            AStateChannelManagerProxy(address(this))
                .removeParticipantComposable(channelId, exitChannel);
    }

    // function getNext
    //stateless
    

    //stateless
   

    function _executeStateTransitionOnState(
        bytes32 channelId,
        bytes memory encodedState,
        Transaction memory _tx
    ) internal returns (bool, bytes memory) {
        return
            AStateChannelManagerProxy(address(this))
                .executeStateTransitionOnState(channelId, encodedState, _tx);
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

    function _isCorrectGenesis(Dispute memory dispute,DisputeAuditingData memory disputeAuditingData) internal view returns (bool) {
        StateSnapshot storage stateSnapshot = stateSnapshots[dispute.channelId];
        //check genesis commitment - this should always be true
        if(dispute.genesisStateSnapshotHash != keccak256(abi.encode(disputeAuditingData.genesisStateSnapshot))) {
            return false;
        }
        //check should use snapshot as genesis
        if(_shouldUseSnapshotAsGenesis(dispute) && dispute.genesisStateSnapshotHash != keccak256(abi.encode(stateSnapshot))) {
            return false;
            
        }
        // Some dispute is geneisis => disputeAuditingData.previousDispute should be set correclty
        if(!_isCorrectDisputeCommitment(disputeAuditingData.previousDispute, disputeAuditingData.previousDisputeTimestamp)){
            return false;
        }
        //if disputing latest fork (not recursive) -> disputeAuditingData.previousDispute should be previous (this -1) dispute && previous outputSnapshot should be genesisSnapshot
        if(dispute.previousRecursiveDisputeIndex == type(uint).max) {
            if((dispute.disputeIndex-1) != disputeAuditingData.previousDispute.disputeIndex)
                return false;
            if(disputeAuditingData.previousDispute.outputStateSnapshotHash != dispute.genesisStateSnapshotHash)
                return false;
        }
        else{
            //disputing recursive dispute - disputeAuditingData.previousDispute should be linked && previous genesisSnapshot should be genesisSnapshot && previous should not be expired
            if(dispute.previousRecursiveDisputeIndex != disputeAuditingData.previousDispute.disputeIndex) 
                return false;
            if(disputeAuditingData.previousDispute.genesisStateSnapshotHash != dispute.genesisStateSnapshotHash)
                return false;
            if(_isExpired(disputeAuditingData.previousDisputeTimestamp))
                return false;
        }
        
        return true;
        
    }
     
    
    function _verifyJoinChannelBlocks(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData) internal pure returns (bool) {
        //check joinChannelBlocks (linked to latestSateSnapshot, chained internally and outputStateSnapshot commits to the head)
        bytes32 previousJoinChannelBlockHash = disputeAuditingData.latestStateSnapshot.latestJoinChannelBlockHash;
        for(uint i = 0; i < disputeAuditingData.joinChannelBlocks.length; i++) {
            if(previousJoinChannelBlockHash != disputeAuditingData.joinChannelBlocks[i].previousBlockHash) {
                return false;
            }
            previousJoinChannelBlockHash = keccak256(abi.encode(disputeAuditingData.joinChannelBlocks[i]));
        }
        return previousJoinChannelBlockHash == disputeAuditingData.outputStateSnapshot.latestJoinChannelBlockHash;
    }

    function _verifyExitChannelBlocks(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData) internal pure returns (bool) {
        //check joinChannelBlocks (linked to latestSateSnapshot, chained internally and outputStateSnapshot commits to the head)
        bytes32 previousExitChannelBlockHash = disputeAuditingData.genesisStateSnapshot.latestExitChannelBlockHash;
        for(uint i = 0; i < dispute.exitChannelBlocks.length; i++) {
            if(previousExitChannelBlockHash != dispute.exitChannelBlocks[i].previousBlockHash) {
                return false;
            }
            previousExitChannelBlockHash = keccak256(abi.encode(dispute.exitChannelBlocks[i]));
        }
        return previousExitChannelBlockHash == disputeAuditingData.latestStateSnapshot.latestExitChannelBlockHash;
    }
    function _verifyBalanceInvariantCheck(bytes32 channelId, Balance memory totalDeposits, Balance memory totalWithdrawals) internal view returns (bool) {
        Balance memory onChainDeposits = totalOnChainProcessedDeposits[channelId];
        Balance memory onChainWithdrawals = totalOnChainProcessedWithdrawals[channelId];
        //on-chain deposits have to match outputState deposits since deposits only happen on-chain
        if(!stateMachineImplementation.areBalancesEqual(totalDeposits, onChainDeposits))
            return false;
        //total withdrawals can not be less than on-chain withdrawals since on-chain withdrawals are already processed
        if(stateMachineImplementation.isBalanceLesserThan(totalWithdrawals, onChainWithdrawals))
            return false;
        Balance memory stateMachineBalance = stateMachineImplementation.getTotalStateBalance(); // The state is already set
        // totalDeposits == totalWithdrawals + stateMachineBalance
        if(!stateMachineImplementation.areBalancesEqual(totalDeposits, stateMachineImplementation.addBalance(totalWithdrawals,stateMachineBalance)))
            return false;
        return true;

    }
   
    function _canParticipateInDisputes(bytes32 channelId, address participant) internal view returns (bool) {
        StateSnapshot storage stateSnapshot = stateSnapshots[channelId];
        bool isParticipant = false;
        //Check if normal participant
        for(uint i = 0; i < stateSnapshot.participants.length; i++) {
            if(stateSnapshot.participants[i] == participant) {
                isParticipant = true;
                break;
            }
        }
        if(!isParticipant) {
            //check pending participants
            DisputeData storage _disputeData = disputeData[channelId];
            for(uint i = 0; i < _disputeData.pendingParticipants.length; i++) {
                if(_disputeData.pendingParticipants[i] == participant) {
                    isParticipant = true;
                    break;
                }
            }
            if(!isParticipant) return false;
        }

        DisputeData storage _disputeData = disputeData[channelId];
        //check if slashed on-chain -> slashed participants can't participate in disputes
        for(uint i = 0; i < _disputeData.onChainSlashedParticipants.length; i++) {
            if(_disputeData.onChainSlashedParticipants[i] == participant) {
                return false; //is slashed -> can't participate
            }
        }
        return true; //is participant and not slashed -> can participate
    }
    function _isExpired(uint timestamp) internal view returns (bool) {
        if(block.timestamp + getChallengeTime() > timestamp) {
            return true;
        }
        return false;
    }
   
    
    function _disputeRaceConditionCheck(
        Dispute memory dispute
    ) view internal {
        StateSnapshot storage stateSnapshot = stateSnapshots[dispute.channelId];
        DisputeData storage _disputeData = disputeData[dispute.channelId];
        // *********** 1. should on-chain snapshot be genesis for dispute *************
        if(_shouldUseSnapshotAsGenesis(dispute)) {
            //should use stateSnapshot as genesis
            if(keccak256(abi.encode(stateSnapshot)) != dispute.genesisStateSnapshotHash) {
                revert ErrorDisputeShouldUseSnapshotAsGenesisState();
            }
        } 

        // *********** 2. on-chain slashes should match *************
        address[] memory onChainSlashes = getOnChainSlashedParticipants(dispute.channelId);
        if(!StateChannelUtilLibrary.areAddressArraysEqual(onChainSlashes, dispute.onChainSlashes)) {
            revert ErrorDisputeOnChainSlashedParticipantsMismatch();
        }

        // *********** 3. should be the expected i-th dispute *************
        if(_disputeData.disputeCommitments.length != dispute.disputeIndex) {
            revert ErrorDisputeNotExpectedIndex();
        }

        // *********** 4. Timeout *************
        if(dispute.timeout.participant != address(0) && !dispute.timeout.isForced) {
            //check if participant posted calldata commitment
            (bool found, bytes32 blockCalldataCommitment) = getBlockCallDataCommitment(dispute.channelId, dispute.timeout.forkCnt, dispute.timeout.blockHeight, dispute.timeout.participant);
            if(found) {
                revert ErrorDisputeTimeoutCalldataPosted();
            }

            //check if previous block producer posted blockCalldata and if the expectation matches
            if(dispute.timeout.previousBlockProducer != address(0)) {
                (bool found, bytes32 blockCalldataCommitment) = getBlockCallDataCommitment(dispute.channelId, dispute.timeout.forkCnt, dispute.timeout.blockHeight - 1, dispute.timeout.previousBlockProducer);
                if(found != dispute.timeout.previousBlockProducerPostedCalldata) {
                    revert ErrorDisputeTimeoutPreviousBlockProducerPostedCalldataMissmatch();
                }
            }
            if(block.timestamp > dispute.timeout.minTimeStamp){
                revert ErrorDisputeTimeoutNotMinTimestamp(); 
            }
        }

        // *********** 5. onChainLatestJoinChannelBlockHash should match *************
        require(dispute.onChainLatestJoinChannelBlockHash == _disputeData.latestJoinChannelBlockHash, ErrorDisputeOnChainLatestJoinChannelBlockHashMismatch());
    }
}
