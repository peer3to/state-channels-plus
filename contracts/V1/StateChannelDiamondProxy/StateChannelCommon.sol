pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./StateChannelManagerStorage.sol";
import "../StateChannelManagerEvents.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";
import "./utils/DisputeUtils.sol";

contract StateChannelCommon is StateChannelManagerStorage, StateChannelManagerEvents {
    function getOnChainSlashes(bytes32 channelId) public view virtual returns (OnChainSlash[] memory) {
        return disputeData[channelId].onChainSlashes;
    }

    function getOnChainSlashedParticipants(bytes32 channelId) public view virtual returns (address[] memory) {
        address[] memory slashedParticipants = new address[](disputeData[channelId].onChainSlashes.length);
        for (uint256 i = 0; i < disputeData[channelId].onChainSlashes.length; i++) {
            slashedParticipants[i] = disputeData[channelId].onChainSlashes[i].participant;
        }
        return slashedParticipants;
    }

    function addOnChainSlashedParticipant(bytes32 channelId, address slashedParticipant) internal virtual {
        disputeData[channelId].onChainSlashes.push(OnChainSlash(slashedParticipant, block.timestamp));
    }

    function getOnChainThresholdSet(bytes32 channelId) public view virtual returns (address[] memory) {
        return StateChannelUtilLibrary.subtractAddressArrays(
            StateChannelUtilLibrary.concatAddressArrays(
                getSnapshotParticipants(channelId), getPendingParticipants(channelId)
            ),
            getOnChainSlashedParticipants(channelId)
        );
    }

    function getSnapshotParticipants(bytes32 channelId) public view virtual returns (address[] memory) {
        return stateSnapshots[channelId].snapshotData.participants;
    }

    function getPendingParticipants(bytes32 channelId) public view virtual returns (address[] memory) {
        return disputeData[channelId].pendingParticipants;
    }

    function getSnapshotforkId(bytes32 channelId) public view virtual returns (bytes32) {
        return stateSnapshots[channelId].forkId;
    }

    function getStateSnapshot(bytes32 channelId) public view virtual returns (StateSnapshot memory) {
        return stateSnapshots[channelId];
    }

    function getStatemachineParticipants(bytes memory encodedState) public virtual returns (address[] memory) {
        stateMachineImplementation.setState(encodedState);
        return stateMachineImplementation.getParticipants();
    }

    function getNextToWrite(bytes32 channelId, bytes memory encodedState) public virtual returns (address) {
        //channelId not used currenlty since all channels have the same SM - later they can be mapped to different ones
        stateMachineImplementation.setState(encodedState);
        return stateMachineImplementation.getNextToWrite();
    }

    function getP2pTime() public view virtual returns (uint256) {
        return p2pTime;
    }

    function getAgreementTime() public view virtual returns (uint256) {
        return agreementTime;
    }

    function getChainFallbackTime() public view virtual returns (uint256) {
        return chainFallbackTime;
    }

    function getEvidenceTime() public view virtual returns (uint256) {
        return evidenceTime;
    }

    function getKillTime() public view virtual returns (uint256) {
        return killTime;
    }

    function getGasLimit() public view virtual returns (uint256) {
        return gasLimit;
    }

    function getAllTimes() public view virtual returns (uint256, uint256, uint256, uint256, uint256) {
        return (p2pTime, agreementTime, chainFallbackTime, evidenceTime, killTime);
    }

    function _isReduceChallengePeriodExpired(DisputeWindow storage disputeWindow) internal view returns (bool) {
        return block.timestamp > disputeWindow.reducedResult.timestamp + evidenceTime;
    }

    function getBlockCallDataCommitment(bytes32 channelId, bytes32 forkId, uint256 blockHeight, address participant)
        public
        view
        virtual
        returns (bool found, bytes32 blockCalldataCommitment)
    {
        // fetch the blockCallDataCommitment from storage
        bytes32 commitment = blockCalldataCommitments[channelId][participant][forkId][blockHeight];
        if (commitment == bytes32(0)) {
            return (false, bytes32(0));
        }
        return (true, commitment);
    }

    function isChannelOpen(bytes32 channelId) public view virtual returns (bool) {
        return stateSnapshots[channelId].snapshotData.participants.length > 0;
    }

    function _applyJoins(
        bytes memory encodedStateMachineState,
        JoinChannelBlock[] memory joinChannelBlocks,
        Balance memory totalDeposits
    ) internal returns (bytes memory encodedModifiedState) {
        encodedModifiedState = encodedStateMachineState;
        for (uint256 i = 0; i < joinChannelBlocks.length; i++) {
            JoinChannelBlock memory joinChannelBlock = joinChannelBlocks[i];
            encodedModifiedState = applyJoinChannelToStateMachine(encodedModifiedState, joinChannelBlock.joinChannels);
            for (uint256 j = 0; j < joinChannelBlock.joinChannels.length; j++) {
                totalDeposits =
                    stateMachineImplementation.addBalance(totalDeposits, joinChannelBlock.joinChannels[j].balance);
            }
        }
    }

    function _calculateTotalWithdrawals(Balance memory totalWithdrawals, ExitChannel[] memory exitChannels)
        internal
        view
        returns (Balance memory)
    {
        for (uint256 i = 0; i < exitChannels.length; i++) {
            totalWithdrawals = stateMachineImplementation.addBalance(totalWithdrawals, exitChannels[i].balance);
        }
        return totalWithdrawals;
    }

    function _areSignedBlocksLinkedAndVerified(SignedBlock[] memory signedBlocks, bytes32 optionalPreviousHash)
        internal
        pure
        returns (bool isLinked)
    {
        bytes32 previousBlockHash = optionalPreviousHash;
        for (uint256 i = 0; i < signedBlocks.length; i++) {
            bytes memory currentBlockEncoded = signedBlocks[i].encodedBlock;
            Block memory currentBlock = abi.decode(currentBlockEncoded, (Block));
            //check is linked
            if (previousBlockHash != bytes32(0) && previousBlockHash != currentBlock.previousBlockHash) {
                return false;
            }
            previousBlockHash = keccak256(currentBlockEncoded);
            //verify original siganture
            address signer =
                StateChannelUtilLibrary.retriveSignerAddress(currentBlockEncoded, signedBlocks[i].signature);
            if (signer != currentBlock.transaction.header.participant) {
                return false;
            }
        }
        return true;
    }

    function _formExitChannelBlock(bytes32 previousBlockHash, ExitChannel[] memory exitChannels)
        internal
        pure
        returns (ExitChannelBlock memory _block)
    {
        return ExitChannelBlock({exitChannels: exitChannels, previousBlockHash: previousBlockHash});
    }

    /// @dev Callable only by diamond facets - applies the join to the given state of the state machine and returns the modified state
    function applyJoinChannelToStateMachine(bytes memory encodedState, JoinChannel[] memory joinCahnnels)
        public
        onlySelf
        returns (bytes memory encodedModifiedState)
    {
        stateMachineImplementation.setState(encodedState);
        for (uint256 i = 0; i < joinCahnnels.length; i++) {
            bool success = stateMachineImplementation.joinChannel(joinCahnnels[i]);
            require(success, ErrorDisputeStateMachineJoiningFailed());
        }
        return (stateMachineImplementation.getState());
    }
    //stateless

    function isDisputeCommitted(Dispute memory dispute) internal view returns (bool) {
        bytes32 channelId = dispute.channelId;
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[_getDisputeFork(dispute)];
        bytes32 commitment = keccak256(abi.encode(dispute));

        for (uint256 i = 0; i < disputeWindow.evidence.disputeCommitments.length; i++) {
            if (disputeWindow.evidence.disputeCommitments[i] == commitment) {
                return true;
            }
        }
        return false;
    }
}
