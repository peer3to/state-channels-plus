pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./StateChannelManagerStorage.sol";
import "../StateChannelManagerEvents.sol";

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
}
