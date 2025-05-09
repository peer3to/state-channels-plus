pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./StateChannelManagerStorage.sol";
import "../StateChannelManagerEvents.sol";
import "./StateChannelUtilLibrary.sol";
import "./AStateChannelManagerProxy.sol";

contract StateChannelCommon is
    StateChannelManagerStorage,
    StateChannelManagerEvents
{

    function getOnChainSlashedParticipants(bytes32 channelId) public view virtual returns (address[] memory) {
        return disputeData[channelId].onChainSlashedParticipants;
    }

    //This is executed only after sucessful auditing -> can safely add/insert participants without checking for duplicates (otherwise auditing would have failed)
    function addOnChainSlashedParticipants(bytes32 channelId, address[] memory slashedParticipants) internal virtual {
        for(uint i = 0; i < slashedParticipants.length; i++) {
            disputeData[channelId].onChainSlashedParticipants.push(slashedParticipants[i]);
        }
    }

    function getDisputeLength(bytes32 channelId) public view virtual returns (uint) {
        return disputeData[channelId].disputeCommitments.length;
    }

    function getSnapshotParticipants(
        bytes32 channelId
    ) public view virtual returns (address[] memory) {
        return stateSnapshots[channelId].participants;
    }

    function getStatemachineParticipants(
        bytes memory encodedState
    ) public virtual returns (address[] memory) {
        stateMachineImplementation.setState(encodedState);
        return stateMachineImplementation.getParticipants();
    }

    function getNextToWrite(
        bytes32 channelId,
        bytes memory encodedState
    ) public virtual returns (address) {
        //channelId not used currenlty since all channels have the same SM - later they can be mapped to different ones
        stateMachineImplementation.setState(encodedState);
        return stateMachineImplementation.getNextToWrite();
    }

    function getP2pTime() public view virtual returns (uint) {
        return p2pTime;
    }

    function getAgreementTime() public view virtual returns (uint) {
        return agreementTime;
    }

    function getChainFallbackTime() public view virtual returns (uint) {
        return chainFallbackTime;
    }

    function getChallengeTime() public view virtual returns (uint) {
        return challengeTime;
    }

    function getGasLimit() public view virtual returns (uint256) {
        return gasLimit;
    }

    function getAllTimes()
        public
        view
        virtual
        returns (uint, uint, uint, uint)
    {
        return (p2pTime, agreementTime, chainFallbackTime, challengeTime);
    }

    function getBlockCallDataCommitment(
        bytes32 channelId,
        uint forkCnt,
        uint blockHeight,
        address participant
    ) public view virtual returns (bool found, bytes32 blockCalldataCommitment) {
        // fetch the blockCallDataCommitment from storage
        bytes32 commitment = blockCalldataCommitments[channelId][participant][forkCnt][blockHeight];
        if(commitment == bytes32(0)) {
            return (false, bytes32(0));
        }
        return (true, commitment);
    }

    function getChainLatestBlockTimestamp(
        bytes32 channelId,
        uint forkCnt,
        uint maxTransactionCnt
    ) public view virtual returns (uint) {
        //TODO
    }

    function isChannelOpen(
        bytes32 channelId
    ) public view virtual returns (bool) {
        return
            stateSnapshots[channelId].participants.length > 0;
    }

    function getDisputeCommitment(bytes32 channelId, uint disputeIndex) public view returns (bool found, bytes32 disputeCommitment) {
        if(disputeIndex >= disputeData[channelId].disputeCommitments.length) {
            return (false, bytes32(0));
        }
        return (true, disputeData[channelId].disputeCommitments[disputeIndex]);
    }

    function _isCorrectDisputeCommitment(
        Dispute memory dispute,
        uint timestamp
    ) internal view returns (bool) {
        bytes32 channelId = dispute.channelId;
        bytes32 commitment = keccak256(abi.encode(
            dispute,
            timestamp
        ));
        DisputeData storage _disputeData = disputeData[channelId];
        if(dispute.disputeIndex >= _disputeData.disputeCommitments.length) {
            return false;
        }
        if(commitment != _disputeData.disputeCommitments[dispute.disputeIndex]) {
            return false;
        }
        return true;
    }

    function _shouldUseSnapshotAsGenesis(
        Dispute memory dispute
    ) internal view returns (bool) {
        StateSnapshot storage stateSnapshot = stateSnapshots[dispute.channelId];
        //Use snapshot as genesis if NOT recursive dispute && on-chain snapshot is from the same fork
        return dispute.previousRecursiveDisputeIndex == type(uint).max && stateSnapshot.forkCnt == dispute.disputeIndex;
    }
    
    function _isCorrectAuditingData(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData) internal view returns (bool) {
        //check dispute commits to disputeData
        if(dispute.disputeAuditingDataHash != keccak256(abi.encode(disputeAuditingData))) {
            return false;
        }
        //check dispute commits to genesisStateSnapshot
        if(dispute.genesisStateSnapshotHash != keccak256(abi.encode(disputeAuditingData.genesisStateSnapshot))) {
            return false;
        }
        //check latestStateSnapshot
        if(dispute.latestStateSnapshotHash != keccak256(abi.encode(disputeAuditingData.latestStateSnapshot))) {
            return false;
        }
        //check latestStateStateMachineState
        if(disputeAuditingData.latestStateSnapshot.stateMachineStateHash != keccak256(disputeAuditingData.latestStateStateMachineState)) {
            return false;
        }
        // *************** check previous dispute ***************
        // 1) should it be used or snapshot should be used as genesis
        // 2) if true (should be used) => is set correctly and commitment exists
        if(_shouldUseSnapshotAsGenesis(dispute)) {
            //Should be unset -> won't be used either way -> timestamp will have default value 0
            //This check is not needed, since _shouldUseGenesis will again return true when actually checking the genesis commitment later - for now leaving it like this since easier to understand mentally
            if(disputeAuditingData.previousDisputeTimestamp != 0) {
                return false;
            }
        } else {
            // Previous dispute should be set and will be used to check genesis
            if(!_isCorrectDisputeCommitment(disputeAuditingData.previousDispute, disputeAuditingData.previousDisputeTimestamp)){
                return false;
            }
            //Commitment exists - check if it's the right one
            //if disputing latest fork -> should be previous (this -1) dispute
            if(dispute.previousRecursiveDisputeIndex == type(uint).max && (dispute.disputeIndex-1) != disputeAuditingData.previousDispute.disputeIndex) {
                return false;
            }
            //if disputing recursive dispute - should be linked
            if(dispute.previousRecursiveDisputeIndex != disputeAuditingData.previousDispute.disputeIndex) {
                return false;
            }
        }

        //check joinChannelBlocks (linked to latestSateSnapshot, chained internally and outputStateSnapshot commits to the head)
        bytes32 previousJoinChannelBlockHash = disputeAuditingData.latestStateSnapshot.latestJoinChannelBlockHash;
        for(uint i = 0; i < disputeAuditingData.joinChannelBlocks.length; i++) {
            if(previousJoinChannelBlockHash != disputeAuditingData.joinChannelBlocks[i].previousBlockHash) {
                return false;
            }
            previousJoinChannelBlockHash = keccak256(abi.encode(disputeAuditingData.joinChannelBlocks[i]));
        }
        return previousJoinChannelBlockHash == disputeAuditingData.outputStateSnapshot.latestExitChannelBlockHash;

    } 

     // Doesn't do any checks and just applies all slashes, removals and joins to a specific stateMachineState and generates the outputStateMachineState - similar logic to playTransaction in the typescript code - this is done to help the backer generate a correct output state while forging the dispute
    function generateDisputeOutputState(
        bytes memory encodedStateMachineState,
        Proof[] memory fraudProofs,
        FraudProofVerificationContext memory poofContext,
        address[] memory onChainSlashes,
        address selfRemoval,
        address timeoutRemoval,
        JoinChannelBlock[] memory joinChannelBlocks,
        StateSnapshot memory latestStateSnapshot
    ) public returns (bytes memory encodedModifiedState, ExitChannelBlock memory exitBlock, Balance memory totalDeposits, Balance memory totalWithdrawals) {
        ExitChannel[] memory exitChannels;
        totalDeposits = latestStateSnapshot.totalDeposits;
        totalWithdrawals = latestStateSnapshot.totalWithdrawals;
        // *************** Apply joins ***************
        for(uint i = 0; i < joinChannelBlocks.length; i++) {
            JoinChannelBlock memory joinChannelBlock = joinChannelBlocks[i];
            // apply the joins to the state machine
            encodedModifiedState = applyJoinChannelToStateMachine(encodedStateMachineState, joinChannelBlock.joinChannels);
            for(uint j = 0; j < joinChannelBlock.joinChannels.length; j++) {
                totalDeposits = stateMachineImplementation.addBalance(
                    totalDeposits,
                    joinChannelBlock.joinChannels[j].balance
                );
            }
        }

        // *************** Apply slashes ***************
        //if contains duplicates or not participants SHOULD fail applying to the stateMachine, so no need for aditional checks
        address[] memory slashes = StateChannelUtilLibrary.concatAddressArrays(_verifyFraudProofs(fraudProofs,poofContext), onChainSlashes);
        // apply the slashes to the state machine
    
        (encodedModifiedState, exitChannels) = _applySlashesToStateMachine(encodedStateMachineState, slashes);

        // *************** Apply removals ***************
        ExitChannel[] memory selfExitChannel;
        if(selfRemoval != address(0)){
            // apply the removals to the state machine
            address[] memory array = new address[](1);
            array[0] = selfRemoval;    
            (encodedModifiedState, selfExitChannel) = _removeParticipantsFromStateMachine(encodedModifiedState, array);
            
        }
        ExitChannel[] memory timeoutExitChannel;
        if(timeoutRemoval != address(0) && slashes.length == 0) {
            // apply the removals to the state machine
            address[] memory array = new address[](1);
            array[0] = timeoutRemoval;    
            (encodedModifiedState, timeoutExitChannel) = _removeParticipantsFromStateMachine(encodedModifiedState, array);

        exitChannels = StateChannelUtilLibrary.concatExitChannelArrays(selfExitChannel, timeoutExitChannel);
        }else{
            exitChannels = StateChannelUtilLibrary.concatExitChannelArrays(exitChannels,selfExitChannel);
        }
        for(uint i = 0; i < exitChannels.length; i++) {
            totalWithdrawals = stateMachineImplementation.addBalance(
                totalWithdrawals,
                exitChannels[i].balance
            );
        }
        return (encodedModifiedState, _formExitChannelBlock(latestStateSnapshot.latestExitChannelBlockHash, exitChannels), totalDeposits, totalWithdrawals);
    }
    
    function _verifyFraudProofs(
        Proof[] memory fraudProofs,
        FraudProofVerificationContext memory poofContext
    ) public returns (address[] memory slashParticipants) {
        return AStateChannelManagerProxy(address(this))
                .verifyFraudProofs(fraudProofs, poofContext);
    }

    function _removeParticipantsFromStateMachine(
        bytes memory encodedState,
        address[] memory participants
    )
        internal
        virtual
        returns (
            bytes memory encodedModifiedState,
            ExitChannel[] memory exitChannels
        )
    {
        return
            AStateChannelManagerProxy(address(this))
                .removeParticipantsFromStateMachine(encodedState, participants);
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

    function _formExitChannelBlock(
        bytes32 previousBlockHash,
        ExitChannel[] memory exitChannels
    ) internal pure returns (ExitChannelBlock memory _block) {
        return ExitChannelBlock({
            exitChannels: exitChannels,
            previousBlockHash: previousBlockHash
        });
    }

    function applyJoinChannelToStateMachine(
        bytes memory encodedState,
        JoinChannel[] memory joinCahnnels
    )
        public
        virtual
        returns (bytes memory encodedModifiedState)
    {
        return
            AStateChannelManagerProxy(address(this))
                .applyJoinChannelToStateMachine(encodedState, joinCahnnels);
    }

    //stateless
    function _applySlashesToStateMachine(
        bytes memory encodedState,
        address[] memory slashedParticipants
    )
        internal
        virtual
        returns (
            bytes memory encodedModifiedState,
            ExitChannel[] memory exitChannels
        )
    {
        return
            AStateChannelManagerProxy(address(this)).applySlashesToStateMachine(
                encodedState,
                slashedParticipants
            );
    }

}
