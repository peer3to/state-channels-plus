pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./StateChannelManagerStorage.sol";
import "../StateChannelManagerEvents.sol";

contract StateChannelCommon is
    StateChannelManagerStorage,
    StateChannelManagerEvents
{
    function getForkCnt(bytes32 channelId) public view virtual returns (uint) {
        return latestFork[channelId];
    }

    function getOnChainSlashedParticipants() public view virtual returns (address[] memory) {
        return onChainSlashedParticipants;
    }

    function addOnChainSlashedParticipants(address[] memory slashedParticipants) internal virtual {
        for(uint i = 0; i < slashedParticipants.length; i++) {
            onChainSlashedParticipants.push(slashedParticipants[i]);
        }
    }

    function getDisputeLength(bytes32 channelId) public view virtual returns (uint) {
        return disputes[channelId].length;
    }

    function getParticipants(
        bytes32 channelId,
        uint forkCnt
    ) public virtual returns (address[] memory) {
        bytes storage encodedState = encodedStates[channelId][forkCnt];
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

    function isGenesisState(
        bytes32 channelId,
        uint forkCnt,
        bytes memory encodedFinalizedState
    ) public view virtual returns (bool) {
        return
            keccak256(abi.encodePacked(encodedFinalizedState)) ==
            keccak256(abi.encodePacked(encodedStates[channelId][forkCnt]));
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

    function getBlockCallData(
        bytes32 channelId,
        uint forkCnt,
        uint transactionCnt,
        address participant
    ) public view virtual returns (bool found, bytes32 blockCallDataCommitment) {
        // fetch the blockCallDataCommitment from storage
        blockCallDataCommitment = blockCallDataCommitments[channelId][forkCnt][transactionCnt][participant];
        if(blockCallDataCommitment == bytes32(0)) {
            return (false, new bytes(0));
        }
        return (true, blockCallDataCommitment);
    }

    function getChainLatestBlockTimestamp(
        bytes32 channelId,
        uint forkCnt,
        uint maxTransactionCnt
    ) public view virtual returns (uint) {
        //TODO
    }

    function setState(bytes32 channelId, bytes memory encodedState) internal {
        uint newForkCnt = latestFork[channelId] + 1; //only here is forkCnt incremented
        latestFork[channelId] = newForkCnt;
        encodedStates[channelId][newForkCnt] = encodedState;
        genesisTimestamps[channelId][newForkCnt] = block.timestamp;
        //TODO check invariant (balances etc...) - or not do it here, but where threshold is submitted - think about this
        emit SetState(channelId, encodedState, newForkCnt, block.timestamp);
    }

    function getGenesisTimestamp(
        bytes32 channelId,
        uint forkCnt
    ) public view virtual returns (uint) {
        return genesisTimestamps[channelId][forkCnt];
    }

    function isChannelOpen(
        bytes32 channelId
    ) public view virtual returns (bool) {
        return
            keccak256(abi.encodePacked(encodedStates[channelId][0])) !=
            keccak256(abi.encodePacked(new bytes(0)));
    }

    function isDisputeCommitmentAvailable(bytes32 channelId, bytes32 disputeCommitment) public view returns (bool, int) {
        bytes32[] storage disputeHashes = disputes[channelId];
        if (disputeHashes.length == 0) return (false, -1);
        for(uint i = 0; i < disputeHashes.length; i++) {
            if(disputeHashes[i] == disputeCommitment) {
                return (true, int(i));
            }
        }
        return (false, -1);
    }
}
