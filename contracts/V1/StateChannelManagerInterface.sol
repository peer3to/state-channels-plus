pragma solidity ^0.8.8;

import "./DataTypes.sol";
import "./DisputeTypes.sol";

abstract contract StateChannelManagerInterface {
    function openChannel(
        bytes32 channelId,
        bytes[] calldata openChannelData,
        bytes[] calldata signatures
    ) public virtual;

    function isChannelOpen(
        bytes32 channelId
    ) public view virtual returns (bool);

    function getForkCnt(bytes32 channelId) public view virtual returns (uint);

    function getLatestState(
        bytes32 channelId
    ) public view virtual returns (bytes memory);

    function getParticipants(
        bytes32 channelId,
        uint forkCnt
    ) public virtual returns (address[] memory);

    function getNextToWrite(
        bytes32 channelId,
        bytes memory encodedState
    ) public virtual returns (address);

    function isGenesisState(
        bytes32 channelId,
        uint forkCnt,
        bytes memory encodedFinalizedState
    ) public view virtual returns (bool);

    function getP2pTime() public view virtual returns (uint);

    function getAgreementTime() public view virtual returns (uint);

    function getChainFallbackTime() public view virtual returns (uint);

    function getChallengeTime() public view virtual returns (uint);

    function getAllTimes() public view virtual returns (uint, uint, uint, uint);

    function getChainLatestBlockTimestamp(
        bytes32 channelId,
        uint forkCnt,
        uint maxTransactionCnt
    ) public view virtual returns (uint);

    function getGenesisTimestamp(
        bytes32 channelId,
        uint forkCnt
    ) public view virtual returns (uint);

    function postBlockCalldata(SignedBlock memory signedBlock) public virtual;

    function getBlockCallData(
        bytes32 channelId,
        uint forkCnt,
        uint transactionCnt,
        address participant
    ) public view virtual returns (bool found, BlockCalldata memory);

    function getDispute(
        bytes32 channelId
    ) public view virtual returns (Dispute memory);

    function createDispute(
        bytes32 channelId,
        uint forkCnt,
        bytes memory encodedLatestFinalizedState,
        bytes memory encodedLatestCorrectState,
        ConfirmedBlock[] memory virtualVotingBlocks,
        address timedoutParticipant,
        uint foldedTransactionCnt,
        Proof[] memory proofs
    ) public virtual;

    function challengeDispute(
        bytes32 channelId,
        uint forkCnt,
        uint challengeCnt,
        Proof[] memory proofs,
        ConfirmedBlock[] memory virtualVotingBlocks,
        bytes memory encodedLatestFinalizedState,
        bytes memory encodedLatestCorrectState
    ) public virtual;
}
