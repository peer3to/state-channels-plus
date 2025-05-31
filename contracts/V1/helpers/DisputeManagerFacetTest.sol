// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

import "../StateChannelDiamondProxy/DisputeManagerFacet.sol";

contract DisputeManagerFacetTest is DisputeManagerFacet {
    function getStateSnapshot(bytes32 channelId) 
        public 
        view 
        override(StateChannelCommon) 
        returns (StateSnapshot memory) 
    {
        return super.getStateSnapshot(channelId);
    }
     function setDisputeData(bytes32 channelId, DisputeData calldata data) external {
        disputeData[channelId] = data;
    }

    function setStateSnapshot(bytes32 channelId, StateSnapshot calldata snapshot) external {
        stateSnapshots[channelId] = snapshot;
    }

    function setTotalOnChainProcessedDeposits(bytes32 channelId, Balance calldata balance) external {
        totalOnChainProcessedDeposits[channelId] = balance;
    }

    function getTotalOnChainProcessedDeposits(bytes32 channelId) external view returns (Balance memory) {
        return totalOnChainProcessedDeposits[channelId];
    }

    function setTotalOnChainProcessedWithdrawals(bytes32 channelId, Balance calldata balance) external {
        totalOnChainProcessedWithdrawals[channelId] = balance;
    }

    function getTotalOnChainProcessedWithdrawals(bytes32 channelId) external view returns (Balance memory) {
        return totalOnChainProcessedWithdrawals[channelId];
    }

    function setBlockCalldataCommitment(bytes32 channelId, address signer, uint256 forkCnt, uint256 blockHeight, bytes32 commitment) external {
        blockCalldataCommitments[channelId][signer][forkCnt][blockHeight] = commitment;
    }

    function getBlockCalldataCommitment(bytes32 channelId, address signer, uint256 forkCnt, uint256 blockHeight) external view returns (bytes32) {
        return blockCalldataCommitments[channelId][signer][forkCnt][blockHeight];
    }
 
    function getDisputeData(bytes32 channelId) external view returns (DisputeData memory) {
        return disputeData[channelId];
    }

    function clearDisputeData(bytes32 channelId) external {
        delete disputeData[channelId];
    }

    function clearStateSnapshot(bytes32 channelId) external {
        delete stateSnapshots[channelId];
    }
    function clearBlockCalldataCommitment(bytes32 channelId, address signer, uint256 forkCnt, uint256 blockHeight) external {
        delete blockCalldataCommitments[channelId][signer][forkCnt][blockHeight];
    }

    function getTimeStamp() external view returns (uint256) {
        return block.timestamp;
    }

}
