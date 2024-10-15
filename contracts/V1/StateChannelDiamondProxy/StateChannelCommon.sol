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
    ) public view virtual returns (bool found, BlockCalldata memory) {
        ForkDataAvailability storage forkDataAvailability = postedBlockCalldata[
            channelId
        ][forkCnt];
        BlockCalldata memory blockCalldata = forkDataAvailability.map[
            transactionCnt
        ][participant];
        return (blockCalldata.timestamp != 0, blockCalldata);
    }

    function getChainLatestBlockTimestamp(
        bytes32 channelId,
        uint forkCnt,
        uint maxTransactionCnt
    ) public view virtual returns (uint) {
        ForkDataAvailability storage forkDataAvailability = postedBlockCalldata[
            channelId
        ][forkCnt];
        //Easy in O(N) - withouth autodisputes on keys when not sorted not possible in O(logN)
        uint latestTimestamp = 0;
        for (uint i = 0; i < forkDataAvailability.keys.length; i++) {
            ForkDataAvailabilityKey memory key = forkDataAvailability.keys[i];
            if (
                //forkDataAvailability.keys[i] > latesttransactionCnt &&
                forkDataAvailability
                .map[key.transactionCnt][key.participant].timestamp >
                latestTimestamp &&
                key.transactionCnt <= maxTransactionCnt
            ) {
                latestTimestamp = forkDataAvailability
                .map[key.transactionCnt][key.participant].timestamp;
            }
        }
        return latestTimestamp; //can be 0 - if no blockCallData posted
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

    //TODO* - just store the latestdispute hahs and this becomes a stateless operation
    function isDisputeInProgress(bytes32 channelId) public view returns (bool) {
        return
            !(disputes[channelId].channelId == bytes32(0) ||
                disputes[channelId].deadlineTimestamp < block.timestamp);
    }
}
