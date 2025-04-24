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
        require(msg.sender == dispute.disputer, "CREATE DISPUTE: INVALID DISPUTER");
        // race condition check
        address[] memory onChainSlashedParticipants = getOnChainSlashedParticipants();

        if (keccak256(abi.encode(dispute.onChainSlashes)) != 
            keccak256(abi.encode(onChainSlashedParticipants))) {
            revert("onChainSlashesMismatch");
        }
    
        address disputer = StateChannelUtilLibrary.retriveSignerAddress(abi.encode(dispute), signature);
        if (disputer != dispute.disputer) {
            revert("Invalid disoute signature");
        } 
       
        // commit to dispute struct
        bytes memory encodedDispute = abi.encode(dispute);
        bytes32 disputeCommitment = keccak256(abi.encode(
            encodedDispute, 
            block.timestamp
        ));
        disputes[dispute.channelId].push(disputeCommitment);
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
        DisputeAuditingData memory disputeAuditData
    ) public returns (bool isSuccess, address[] memory slashParticipants, bytes memory errorMessage) {

        address[] memory genesisParticipants = getParticipants(dispute.channelId, 0);

        address[] memory slashParticipants = new address[](1);
        // check if the commitment of dispute is available
        bytes32 disputeCommitment = keccak256(abi.encode(
            dispute,
            disputeAuditData.disputeTimestamp
        ));
        (bool isAvailable, int index) = isDisputeCommitmentAvailable(dispute.channelId,disputeCommitment);
        if(!isAvailable) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("AUDIT: DISPUTE COMMITMENT NOT AVAILABLE"));
        }

        // verify state proofs
        bool isStateProofValid = _verifyStateProof(disputeAuditData, dispute.genesisStateSnapshotHash, dispute.stateProof, dispute.latestStateSnapshotHash);
        if(!isStateProofValid) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("AUDIT: STATE PROOF INVALID"));
        }

        // if timeout struct available checks
        (bool isTimeoutSet, bool isOptionalSet) = isTimeoutSetWithOptional(dispute.timeout, true);
        if(isTimeoutSet) {
            uint forkCnt = getDisputeLength(dispute.channelId);
            (bool isCalldataPosted, bytes32 blockCallData) = getBlockCallData(dispute.channelId, forkCnt, dispute.disputer);
            if (isCalldataPosted) {
                slashParticipants[0] = dispute.disputer;
                return (false, slashParticipants, abi.encode("AUDIT: CALLLDATA POSTED"));
            }
            if (dispute.timeout.minTimeStamp > block.timestamp) {
                slashParticipants[0] = dispute.disputer;
                return (false, slashParticipants, abi.encode("AUDIT: MIN TIMESTAMP INVALID"));
            }
            if (getNextToWrite(dispute.channelId, disputeAuditData.latestStateSnapshot) != dispute.timeout.participant) {
                slashParticipants[0] = dispute.disputer;
                return (false, slashParticipants, abi.encode("AUDIT: NEXT TO WRITE INVALID"));
            }
            uint latestStateHeight = _getLatestHeight(dispute.stateProof);
            forkCnt = disputes[dispute.channelId].length;
            if(dispute.timeout.blockHeight != latestStateHeight && forkCnt != dispute.timeout.forkCnt ) {
                slashParticipants[0] = dispute.disputer;
                return (false, slashParticipants, abi.encode("AUDIT: NOT LINKED TO LATEST STATE"));
            }
        }

        // verify fraud proofs
        (bool isValid, address[] memory returnedSlashedParticipants, bytes memory fraudProofErrorResult) = _verifyFraudProofs(dispute,disputeAuditData);
        if(!isValid) {
            return (isValid, returnedSlashedParticipants, fraudProofErrorResult);
        }
       
        // validate output state
        bool isOutputStateValid = _validateDisputeOutputState(disputeAuditData,dispute,returnedSlashedParticipants);
        if(!isOutputStateValid) {
            return (false, returnedSlashedParticipants, abi.encode("AUDIT: OUTPUT STATE INVALID"));
            }
        return (isValid, returnedSlashedParticipants, new bytes(0));
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

        (bool isAllAuditValid, address[] memory collectedSlashParticipants, bytes memory fraudProofErrorResult) = auditDispute(dispute, disputeAuditingData);

        if(isAllAuditValid) {
            addOnChainSlashedParticipants(collectedSlashParticipants);
            address[] memory returnedSlashParticipants = getOnChainSlashedParticipants();
            emit DisputeChallengeResultWithError(dispute.channelId, isAllAuditValid, returnedSlashParticipants, fraudProofErrorResult);
        }
        else {
            uint disputeLength = getDisputeLength(dispute.channelId);
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
    ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {
        // only when all fraud proofs are verified successfully, return true
        bool isSuccess;
        address[] memory accumulatedSlashParticipants;

        for(uint i = 0; i < dispute.fraudProofs.length; i++) {
           
            if(_isBlockFraudProof(dispute.fraudProofs[i].proofType)) {
                (isValid, slashParticipants, fraudProofErrorResult) = _handleBlockFraudProofs(dispute, dispute.fraudProofs[i]);
                if(!isValid) {
                    return (false, slashParticipants, fraudProofErrorResult);
                }
                accumulatedSlashParticipants = StateChannelUtilLibrary.concatAddressArrays(accumulatedSlashParticipants, slashParticipants);
            }else if(_isDisputeFraudProof(dispute.fraudProofs[i].proofType)) {
                (isValid, slashParticipants, fraudProofErrorResult) = _handleDisputeFraudProofs(dispute, dispute.fraudProofs[i],disputeAuditingData);
                if(!isValid) {
                    return (false, slashParticipants, fraudProofErrorResult);
                }
                accumulatedSlashParticipants = StateChannelUtilLibrary.concatAddressArrays(accumulatedSlashParticipants, slashParticipants);
            }else if(_isTimeoutFraudProof(dispute.fraudProofs[i].proofType)) {
                (isValid, slashParticipants, fraudProofErrorResult) = _handleTimeoutDispute(dispute, dispute.fraudProofs[i],disputeAuditingData);
                if(!isValid) {
                    return (false, slashParticipants, fraudProofErrorResult);
                }
                accumulatedSlashParticipants = StateChannelUtilLibrary.concatAddressArrays(accumulatedSlashParticipants, slashParticipants);
            }
        }
        return (true, accumulatedSlashParticipants, new bytes(0));
    }

    function _handleBlockFraudProofs(
        Dispute memory dispute,
        Proof memory proof
    ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {
       
        if(proof.proofType == ProofType.BlockDoubleSign){
            (isValid, slashParticipants, fraudProofErrorResult) = _verifyBlockDoubleSign(dispute,proof);
            if(!isValid) {
                return (isValid, slashParticipants, fraudProofErrorResult);
            }
            return (isValid, slashParticipants, new bytes(0));

        }else if(proof.proofType == ProofType.BlockEmptyBlock){
            (isValid, slashParticipants, fraudProofErrorResult) = _verifyBlockEmptyBlock(dispute,proof);
            if(!isValid) {
                return (isValid, slashParticipants, fraudProofErrorResult);
            }
            return (isValid, slashParticipants, new bytes(0));

        }else if(proof.proofType == ProofType.BlockInvalidStateTransition){
            (isValid, slashParticipants, fraudProofErrorResult) = _verifyBlockInvalidStateTransition(dispute,proof);
            if (!isValid) {
                return (isValid, slashParticipants, fraudProofErrorResult);
            }
            return (isValid, slashParticipants, new bytes(0));

        }else if (proof.proofType == ProofType.BlockOutOfGas) {
            (isValid, slashParticipants, fraudProofErrorResult) = _verifyBlockStateTransitionOutOfGas(dispute,proof); 
            if (!isValid) {
                return (isValid, slashParticipants, fraudProofErrorResult);
            }
            return (isValid, slashParticipants, new bytes(0));
        }
    
    }

    function _handleDisputeFraudProofs(
        Dispute memory dispute,
        Proof memory proofs,
        DisputeAuditingData memory disputeAuditingData
    ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {

            if(proofs.proofType == ProofType.DisputeNotLatestState){
                (isValid, slashParticipants, fraudProofErrorResult) = _verifyDisputeNotLatestState(dispute,proofs,disputeAuditingData);
                if(!isValid) {
                    return (isValid, slashParticipants, fraudProofErrorResult);
                }
                return (isValid, slashParticipants, new bytes(0));

            }else if(proofs.proofType == ProofType.DisputeInvalidStateProof){
                (isValid, slashParticipants, fraudProofErrorResult) = _verifyDisputeInvalidStateProof(dispute,proofs,disputeAuditingData);
                if(!isValid) {
                    return (isValid, slashParticipants, fraudProofErrorResult);
                }
                return (isValid, slashParticipants, new bytes(0));

            }else if(proofs.proofType == ProofType.DisputeInvalidExitChannelBlocks){
                (isValid, slashParticipants, fraudProofErrorResult) = _verifyDisputeInvalidExitChannelBlocks(dispute,proofs);
                if(!isValid) {
                    return (isValid, slashParticipants, fraudProofErrorResult);
                }
                return (isValid, slashParticipants, new bytes(0));
            }
    }

    function _handleTimeoutDispute(
        Dispute memory dispute,
        Proof memory proof,
        DisputeAuditingData memory disputeAuditingData
    ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {

            if(proof.proofType == ProofType.TimeoutThreshold){
                (isValid, slashParticipants, fraudProofErrorResult) = _verifyTimeoutThreshold(dispute,proof,disputeAuditingData);
                if(!isValid) {
                    return (isValid, slashParticipants, fraudProofErrorResult);
                }
                return (isValid, slashParticipants, new bytes(0));
            }else if(proof.proofType == ProofType.TimeoutPriorInvalid){
                (isValid, slashParticipants, fraudProofErrorResult) = _verifyTimeoutPriorInvalidProof(dispute,proof,disputeAuditingData);
                if(!isValid) {
                    return (isValid, slashParticipants, fraudProofErrorResult);
                }
                return (isValid, slashParticipants, new bytes(0));
        }
    }

    // =============================== Block Dispute Fraud Proofs Verification ===============================

    function _verifyBlockInvalidStateTransition(
        Dispute memory dispute,
        Proof memory proof
    ) internal returns (bool isValid, address[] memory slashedParticipants, bytes memory fraudProofErrorResult) {

        BlockInvalidStateTransitionProof memory blockInvalidSTProof = abi.decode(proof.encodedProof, (BlockInvalidStateTransitionProof));
        Block memory fraudBlock = abi.decode(blockInvalidSTProof.fraudBlockConfirmation.signedBlock.encodedBlock, (Block));
        address[] memory slashParticipants = new address[](1);
        
        if(dispute.channelId != fraudBlock.transaction.header.channelId) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("BLOCK INVALID STATE TRANSITION: CHANNEL ID MISMATCH"));
        }

        (bool isTransitionValid, bytes memory encodedModifiedState) = executeStateTransitionOnState(
            fraudBlock.transaction.header.channelId,
            blockInvalidSTProof.encodedState,
            fraudBlock.transaction
        );

        if (!isTransitionValid) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, new bytes(0));
        }        
        if (keccak256(encodedModifiedState) != dispute.latestStateSnapshotHash) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("BLOCK INVALID STATE TRANSITION: STATE HASH MISMATCH"));
        }
        address[] memory returnedSlashParticipants = _collectBlockConfirmationAddresses(
            blockInvalidSTProof.fraudBlockConfirmation.signedBlock.encodedBlock,
            blockInvalidSTProof.fraudBlockConfirmation.signatures
        );
        return (true, returnedSlashParticipants, new bytes(0));
    }

    function _verifyBlockDoubleSign( 
        Dispute memory dispute,
        Proof memory proof
    ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {

        BlockDoubleSignProof memory blockDoubleSignProof = abi.decode(proof.encodedProof, (BlockDoubleSignProof));

        Block memory block1 = abi.decode(blockDoubleSignProof.block1.encodedBlock, (Block));
        Block memory block2 = abi.decode(blockDoubleSignProof.block2.encodedBlock, (Block));

        address[] memory slashParticipants = new address[](1);
        if(dispute.channelId != block1.transaction.header.channelId || dispute.channelId != block2.transaction.header.channelId) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("BLOCK DOUBLE SIGN: CHANNEL ID MISMATCH"));
        }

        if(block1.stateHash != block2.stateHash && block1.previousStateHash != block2.previousStateHash) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("BLOCK DOUBLE SIGN: STATE HASH MISMATCH"));
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
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("BLOCK DOUBLE SIGN: SIGNER MISMATCH"));
        }
        slashParticipants[0] = signer1;
        return (true, slashParticipants, new bytes(0));
    }
    
    function _verifyBlockStateTransitionOutOfGas(
        Dispute memory dispute,
        Proof memory proof
    ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {
        BlockOutOfGasProof memory blockOutOfGasProof = abi.decode(proof.encodedProof, (BlockOutOfGasProof));
        Block memory fraudBlock = abi.decode(blockOutOfGasProof.fraudBlockConfirmation.signedBlock.encodedBlock, (Block));
        address[] memory slashParticipants = new address[](1);  
        
        if(dispute.channelId != fraudBlock.transaction.header.channelId) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("BLOCK OUT OF GAS: CHANNEL ID MISMATCH"));
        }
        
        (bool isSuccess, bytes memory encodedModifiedState) = executeStateTransitionOnState(
            fraudBlock.transaction.header.channelId,
            blockOutOfGasProof.encodedState,
            fraudBlock.transaction
        );
        if(isSuccess){
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("BLOCK OUT OF GAS: STATE TRANSITION SUCCESSFUL"));
        }
        address[] memory returnedSlashParticipants = _collectBlockConfirmationAddresses(
            blockOutOfGasProof.fraudBlockConfirmation.signedBlock.encodedBlock,
            blockOutOfGasProof.fraudBlockConfirmation.signatures
        );
        address signer = StateChannelUtilLibrary.retriveSignerAddress(
            blockOutOfGasProof.fraudBlockConfirmation.signedBlock.encodedBlock,
            blockOutOfGasProof.fraudBlockConfirmation.signedBlock.signature
        );
        returnedSlashParticipants[returnedSlashParticipants.length] = signer;
        return (true, returnedSlashParticipants, new bytes(0));
        
    }
    
    function _verifyBlockEmptyBlock(
        Dispute memory dispute,
        Proof memory proof
    ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {
        BlockEmptyProof memory blockEmptyProof = abi.decode(proof.encodedProof, (BlockEmptyProof));
        Block memory fraudBlock = abi.decode(blockEmptyProof.emptyBlock.encodedBlock, (Block));

        address[] memory slashParticipants = new address[](1);
        if(dispute.channelId != fraudBlock.transaction.header.channelId) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("BLOCK EMPTY: CHANNEL ID MISMATCH"));
        }
        if(fraudBlock.transaction.header.transactionCnt != uint(0)) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("BLOCK EMPTY: TRANSACTION COUNT NOT ZERO"));
        }
        address signer = StateChannelUtilLibrary.retriveSignerAddress(
            blockEmptyProof.emptyBlock.encodedBlock,
            blockEmptyProof.emptyBlock.signature
        );
        slashParticipants[0] = signer;
        return (true, slashParticipants, new bytes(0));
    }
    
    // =============================== Dispute Fraud proof Verification ===============================

    function _verifyDisputeNotLatestState(
        Dispute memory dispute,
        Proof memory proof,
        DisputeAuditingData memory disputeAuditingData
    ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {
        DisputeNotLatestStateProof memory disputeNotLatestStateProof = abi.decode(proof.encodedProof, (DisputeNotLatestStateProof));
        address[] memory slashParticipants = new address[](1);
        
        Block memory newerBlock = abi.decode(disputeNotLatestStateProof.newerBlock.signedBlock.encodedBlock, (Block));
        if(dispute.channelId != newerBlock.transaction.header.channelId) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("DISPUTE NOT LATEST STATE: CHANNEL ID MISMATCH"));
        }

        address originalDisputer = disputeNotLatestStateProof.originalDispute.disputer;
        
        bytes32 originalDisputeCommitment = keccak256(abi.encode(
            disputeNotLatestStateProof.originalDispute,
            disputeAuditingData.disputeTimestamp
        ));
        (bool isAvailable, int index) = isDisputeCommitmentAvailable(dispute.channelId, originalDisputeCommitment);
        if(!isAvailable) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("DISPUTE NOT LATEST STATE: ORIGINAL DISPUTE NOT AVAILABLE"));
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
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("DISPUTE NOT LATEST STATE: NEWER BLOCK HEIGHT IS LESS THAN LATEST STATE HEIGHT"));
        }
        if(signer != originalDisputer && !StateChannelUtilLibrary.isAddressInArray(signers, originalDisputer)) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("DISPUTE NOT LATEST STATE: SIGNER MISMATCH"));
        }
        slashParticipants[0] = originalDisputer;
        return (true, slashParticipants, new bytes(0));
    }

    function _verifyDisputeInvalidStateProof(
        Dispute memory dispute,
        Proof memory proof,
        DisputeAuditingData memory disputeAuditingData
    ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {
        DisputeInvalidStateProof memory disputeInvalidStateProof = abi.decode(proof.encodedProof, (DisputeInvalidStateProof));
        address[] memory slashParticipants = new address[](1);
        if(dispute.channelId != disputeInvalidStateProof.dispute.channelId) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("DISPUTE NOT LATEST STATE: CHANNEL ID MISMATCH"));
        }
        address originalDisputer = disputeInvalidStateProof.dispute.disputer;
        
        bool isStateProofValid = _verifyStateProof(
            disputeAuditingData,
            disputeInvalidStateProof.dispute.genesisStateSnapshotHash,
            disputeInvalidStateProof.dispute.stateProof,
            disputeInvalidStateProof.dispute.latestStateSnapshotHash
        );
        if(!isStateProofValid) {
            slashParticipants[0] = originalDisputer;
            return (false, slashParticipants, abi.encode("DISPUTE INVALID STATE PROOF: STATE PROOF INVALID"));
        }
        slashParticipants[0] = originalDisputer;
        return (true, slashParticipants, new bytes(0));
    }

    function _verifyDisputeInvalidExitChannelBlocks(
        Dispute memory dispute,
        Proof memory proof
    ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {
        // TODO: implement processExitChannelBlocks
        revert("NOT IMPLEMENTED");
    }
    
    // =============================== Dispute Timeout Verification ===============================

    function _verifyTimeoutThreshold(
        Dispute memory dispute,
        Proof memory proof,
        DisputeAuditingData memory disputeAuditingData
    ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {

        TimeoutThresholdProof memory timeoutThresholdProof = abi.decode(proof.encodedProof, (TimeoutThresholdProof));
        BlockConfirmation memory thresholdBlockConfirmation = timeoutThresholdProof.thresholdBlock;
        Block memory thresholdBlock = abi.decode(thresholdBlockConfirmation.signedBlock.encodedBlock, (Block));
        Dispute memory originalTimedOutDispute = timeoutThresholdProof.timedOutDispute;
        
        address[] memory slashParticipants = new address[](1);
        bool allThresholdChecksPass = true;
        bytes memory errorMessage;

        bytes32 originalDisputeCommitment = keccak256(abi.encode(
            originalTimedOutDispute,
            disputeAuditingData.disputeTimestamp
        ));
        (bool isAvailable, int index) = isDisputeCommitmentAvailable(dispute.channelId, originalDisputeCommitment);
        if(!isAvailable) {
            allThresholdChecksPass = false;
            errorMessage = abi.encode("TIMEOUT THRESHOLD: ORIGINAL DISPUTE NOT AVAILABLE");
        }

        if(thresholdBlock.transaction.header.channelId != originalTimedOutDispute.channelId) {
            allThresholdChecksPass = false;
            errorMessage = abi.encode("TIMEOUT THRESHOLD: BLOCK CHANNEL ID MISMATCH");
        }

        uint latestStateHeight = _getLatestHeight(originalTimedOutDispute.stateProof);
        if(latestStateHeight != thresholdBlock.transaction.header.transactionCnt) {
            allThresholdChecksPass = false;
            errorMessage = abi.encode("TIMEOUT THRESHOLD: BLOCK HEIGHT MISMATCH");
        }
       
        if(thresholdBlock.stateHash != originalTimedOutDispute.latestStateSnapshotHash) {
            allThresholdChecksPass = false;
            errorMessage = abi.encode("TIMEOUT THRESHOLD: BLOCK STATE HASH MISMATCH");
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

        if(signer != dispute.disputer || !StateChannelUtilLibrary.isAddressInArray(signers, dispute.disputer)) {
            allThresholdChecksPass = false;
            errorMessage = abi.encode("TIMEOUT THRESHOLD: SIGNER NOT AVAILABLE");
        }

        if (!allThresholdChecksPass) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, errorMessage);
        }

        // If calldata check also fails, return false with the last error message
        slashParticipants[0] = originalTimedOutDispute.disputer;
        return (true, slashParticipants, new bytes(0));
    }

    function _verifyTimeoutPriorInvalidProof(
        Dispute memory dispute,
        Proof memory proof,
        DisputeAuditingData memory disputeAuditingData
    ) internal returns (bool isValid, address[] memory slashParticipants, bytes memory fraudProofErrorResult) {

        TimeoutPriorInvalidProof memory timeoutPriorInvalidProof = abi.decode(proof.encodedProof, (TimeoutPriorInvalidProof));
        Dispute memory originalDispute = timeoutPriorInvalidProof.originalDispute;
        Dispute memory recursiveDispute = timeoutPriorInvalidProof.recursiveDispute;
        address[] memory slashParticipants = new address[](1);

        if(recursiveDispute.channelId != originalDispute.channelId && recursiveDispute.channelId != dispute.channelId) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: CHANNEL ID MISMATCH"));
        }
        // check if the recursive dispute is available
        bytes32 recursiveDisputeCommitment = keccak256(abi.encode(
            recursiveDispute,
            disputeAuditingData.disputeTimestamp
        ));
        (bool isAvailable, int index) = isDisputeCommitmentAvailable(recursiveDispute.channelId, recursiveDisputeCommitment);

        if(!isAvailable) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: RECURSIVE DISPUTE NOT AVAILABLE"));
        }
        if(recursiveDispute.previousRecursiveDisputeHash != bytes32(0)) {
            // check if the previous recursive dispute is available
            (bool isOriginalDisputeAvailable, int index) = isDisputeCommitmentAvailable(recursiveDispute.channelId,recursiveDispute.previousRecursiveDisputeHash);
            if(!isOriginalDisputeAvailable) {
                slashParticipants[0] = dispute.disputer;
                return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: PREVIOUS RECURSIVE DISPUTE NOT AVAILABLE"));
            }
        }
        
        (bool isOriginalTimeoutSet, bool isOriginalOptionalSet) = isTimeoutSetWithOptional(originalDispute.timeout, false);
        if(!isOriginalTimeoutSet) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: ORIGINAL TIMEOUT NOT SET"));
        }
        (bool isRecursiveTimeoutSet, bool isRecursiveOptionalSet) = isTimeoutSetWithOptional(recursiveDispute.timeout, false);
        if(!isRecursiveTimeoutSet) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: RECURSIVE TIMEOUT NOT SET"));
        }
        
        // check if the original timeout is greater than the recursive timeout
        if(originalDispute.timeout.blockHeight < recursiveDispute.timeout.blockHeight) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: RECURSIVE TIMEOUT IS NEW"));
        }
        // check if the timeout peeer in original dispute is the disputer in recursive dispute
        if(originalDispute.timeout.participant != recursiveDispute.disputer) {
            slashParticipants[0] = dispute.disputer;
            return (false, slashParticipants, abi.encode("TIMEOUT PRIOR INVALID: TIMEOUT PEER MISMATCH"));
        }

        slashParticipants[0] = recursiveDispute.disputer;
        return (true, slashParticipants, new bytes(0));
    }

    // ================================ Dispute Verification ================================
    function _validateDisputeOutputState(DisputeAuditingData memory disputeAuditingData,Dispute memory dispute,address[] memory slashParticipants) internal returns (bool isValid) {
        
        (bytes memory encodedModifiedState, ExitChannel[] memory exitChannels, uint successCnt) = applySlashesToStateMachine(disputeAuditingData.latestStateStateMachineState, slashParticipants);
        if(successCnt != slashParticipants.length) {
            return false;
        }

        uint totalDeposits = _calculateTotalDeposits(disputeAuditingData.joinChannelBlocks);
        uint totalWithdrawals = _calculateTotalWithdrawals(exitChannels);



        StateSnapshot memory latestStateSnapshot = abi.decode(disputeAuditingData.latestStateSnapshot, (StateSnapshot));
        // construct a snapshot from the modified state
        StateSnapshot memory outputStateSnapshot = StateSnapshot({
            stateMachineStateHash: keccak256(encodedModifiedState),
            participants: latestStateSnapshot.participants,
            latestJoinChannelBlockHash: latestStateSnapshot.latestJoinChannelBlockHash,
            latestExitChannelBlockHash: latestStateSnapshot.latestExitChannelBlockHash,
            totalDeposits: totalDeposits,
            totalWithdrawals: totalWithdrawals
        });

        if(keccak256(abi.encode(outputStateSnapshot)) != dispute.outputStateSnapshotHash) {
            return false;
        }
        return true;
    }

    // =============================== State Proofs Verification  ===============================

    function _verifyStateProof(DisputeAuditingData memory disputeAuditingData, bytes32 genesisStateSnapshotHash, StateProof memory stateProof, bytes32 latestStateSnapshotHash) internal returns (bool isValid) {
      
        StateSnapshot memory latestStateSnapshot = abi.decode(disputeAuditingData.latestStateSnapshot, (StateSnapshot));
        StateSnapshot memory genesisStateSnapshot = abi.decode(disputeAuditingData.genesisStateSnapshot, (StateSnapshot));
        address[] memory participants = latestStateSnapshot.participants;

        if(keccak256(disputeAuditingData.genesisStateSnapshot) != genesisStateSnapshotHash) {
            return false;
        }

        // Milestone checking
        bool isValid = _verifyForkProof(stateProof.forkProof, genesisStateSnapshot, latestStateSnapshot);
        if(!isValid) {
            return false;
        }
        // Signedblocks and latest state checking
        isValid = _verifySignedBlocks(stateProof.forkProof, stateProof.signedBlocks, latestStateSnapshotHash);
        if(!isValid) {
            return false;
        }
        return true;
    }

    function _verifySignedBlocks(ForkProof memory forkProof, SignedBlock[] memory signedBlocks, bytes32 latestStateSnapshotHash) internal returns (bool isValid) {
       
       BlockConfirmation memory lastConfirmation = 
        forkProof.forkMilestoneProofs[forkProof.forkMilestoneProofs.length - 1]
        .blockConfirmations[forkProof.forkMilestoneProofs[forkProof.forkMilestoneProofs.length - 1].blockConfirmations.length - 1];

       Block memory lastConfirmedBlock = abi.decode(lastConfirmation.signedBlock.encodedBlock, (Block));

       address signer = StateChannelUtilLibrary.retriveSignerAddress(lastConfirmation.signedBlock.encodedBlock, lastConfirmation.signedBlock.signature);

       for(uint i = 1; i < signedBlocks.length; i++) {
        Block memory currentBlock = abi.decode(signedBlocks[i].encodedBlock, (Block));

        if(lastConfirmedBlock.stateHash != currentBlock.previousStateHash) {
            return false;
        }
        lastConfirmedBlock = currentBlock;
       }

       if(lastConfirmedBlock.stateHash != latestStateSnapshotHash) {
        return false;
       }
       return true;
    }

    /// @dev Verfies ForkMilestoneBlock along with BlockConfirmations and taking into accounts Virtual Voting
    function _verifyForkProof(ForkProof memory forkProof, StateSnapshot memory genesisStateSnapshot, StateSnapshot memory latestStateSnapshot) internal returns (bool isValid) {    
       
        for(uint i = 0; i < forkProof.forkMilestoneProofs.length; i++) {
       
            ForkMilestoneProof memory milestone = forkProof.forkMilestoneProofs[i];
            // check if the milestone is finalized, include the virtual voting
            address[] memory collectedSignedAddresses = new address[](genesisStateSnapshot.participants.length);

            BlockConfirmation memory currentConfirmation = milestone.blockConfirmations[0];
            Block memory currentBlock = abi.decode(currentConfirmation.signedBlock.encodedBlock, (Block));
            // collect signatures
            address signer = StateChannelUtilLibrary.retriveSignerAddress(currentConfirmation.signedBlock.encodedBlock, currentConfirmation.signedBlock.signature);
            address[] memory collectedSigners = _collectBlockConfirmationAddresses(currentConfirmation.signedBlock.encodedBlock, currentConfirmation.signatures);
            collectedSignedAddresses[i] = signer;
            collectedSignedAddresses = StateChannelUtilLibrary.concatAddressArrays(collectedSignedAddresses, collectedSigners);
            
            // first milestone N/N signatures
            if (i == 0) {
                if (keccak256(abi.encode(collectedSignedAddresses)) != keccak256(abi.encode(genesisStateSnapshot.participants))) {
                    return false;
                }
            }

            // verify integrity of the blockConfirmations   
            for(uint j = 1; j < milestone.blockConfirmations.length; j++) {
                BlockConfirmation memory confirmation = milestone.blockConfirmations[j];
                Block memory nextBlock = abi.decode(confirmation.signedBlock.encodedBlock, (Block));
                if(nextBlock.previousStateHash != currentBlock.stateHash) {
                    return false;
                }
                currentConfirmation = confirmation;     
            }
        }

    }


    // =============================== Helper Functions ===============================

    function _collectBlockConfirmationAddresses(bytes memory encodedBlock, bytes[] memory signatures) internal returns (address[] memory collectedSigners) {
        address[] memory collectedSigners = new address[](signatures.length);
        for (uint i = 0; i < signatures.length; i++) {
            address signer = StateChannelUtilLibrary.retriveSignerAddress(encodedBlock, signatures[i]);
            collectedSigners[i] = signer;
        }
        return collectedSigners;
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
            ExitChannel[] memory exitChannels,
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
            ExitChannel[] memory exitChannels,
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

    function isTimeoutSetWithOptional(Timeout memory timeout, bool checkOptional) internal pure returns (bool isSet, bool optionalSet) {
        if(checkOptional) {
            return (timeout.participant != address(0), timeout.previousBlockProducer != address(0));
        }
        return (timeout.participant != address(0), false);
    }

    function _getLatestHeight(StateProof memory stateProof) internal view returns (uint) {

        if(stateProof.signedBlocks.length == 0) {
            uint lastMilestoneBlockConfirmationIndex = stateProof.forkProof.forkMilestoneProofs[stateProof.forkProof.forkMilestoneProofs.length - 1].blockConfirmations.length - 1; 
            Block memory lastMilestoneBlockConfirmation = abi.decode(stateProof.forkProof.forkMilestoneProofs[stateProof.forkProof.forkMilestoneProofs.length - 1].blockConfirmations[lastMilestoneBlockConfirmationIndex].signedBlock.encodedBlock, (Block));
            return lastMilestoneBlockConfirmation.transaction.header.transactionCnt;
        }
        Block memory lastSignedBlock = abi.decode(stateProof.signedBlocks[stateProof.signedBlocks.length - 1].encodedBlock, (Block));
        return lastSignedBlock.transaction.header.transactionCnt;
    }

    function _calculateTotalDeposits(JoinChannelBlock[] memory joinChannelBlocks) internal view returns (uint) {
        uint totalDeposits = 0;
        for (uint i = 0; i < joinChannelBlocks.length; i++) {
            for(uint j = 0; j < joinChannelBlocks[i].joinChannels.length; j++) {
                totalDeposits += joinChannelBlocks[i].joinChannels[j].amount;
            }
        }
        return totalDeposits;
    }

    function _calculateTotalWithdrawals(ExitChannel[] memory exitChannels) internal view returns (uint) {
        uint totalWithdrawals = 0;
        for(uint i = 0; i < exitChannels.length; i++) {
            totalWithdrawals += exitChannels[i].amount;
        }
        return totalWithdrawals;
    }
 
}
