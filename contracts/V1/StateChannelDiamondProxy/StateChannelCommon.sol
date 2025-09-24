pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./StateChannelManagerStorage.sol";
import "../StateChannelManagerEvents.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";
import "./utils/DisputeUtils.sol";
import "./utils/BlockUtils.sol";

contract StateChannelCommon is StateChannelManagerStorage, StateChannelManagerEvents {
    function getOnChainSlashes(bytes32 channelId) public view virtual returns (OnChainSlash[] memory) {
        return disputeData[channelId].onChainSlashes;
    }
    // Get participants who have been slashed up to (including) timestamp

    function getOnChainSlashedParticipantsUpToTimestamp(bytes32 channelId, uint256 timestamp)
        public
        view
        virtual
        returns (address[] memory)
    {
        address[] memory slashedParticipants = new address[](disputeData[channelId].onChainSlashes.length);
        uint256 actualCount = 0;
        for (
            uint256 i = 0;
            i < disputeData[channelId].onChainSlashes.length
                && disputeData[channelId].onChainSlashes[i].timestamp <= timestamp;
            i++
        ) {
            slashedParticipants[actualCount++] = disputeData[channelId].onChainSlashes[i].participant;
        }
        address[] memory finalSlashedParticipants = new address[](actualCount);
        for (uint256 i = 0; i < actualCount; i++) {
            finalSlashedParticipants[i] = slashedParticipants[i];
        }
        return finalSlashedParticipants;
    }

    function getOnChainSlashedParticipants(bytes32 channelId) public view virtual returns (address[] memory) {
        address[] memory slashedParticipants = new address[](disputeData[channelId].onChainSlashes.length);
        for (uint256 i = 0; i < disputeData[channelId].onChainSlashes.length; i++) {
            slashedParticipants[i] = disputeData[channelId].onChainSlashes[i].participant;
        }
        return slashedParticipants;
    }

    function isParticipantSlashedOnChain(bytes32 channelId, address participant) public view virtual returns (bool) {
        address[] memory slashedParticipants = getOnChainSlashedParticipants(channelId);
        for (uint256 i = 0; i < slashedParticipants.length; i++) {
            if (slashedParticipants[i] == participant) {
                return true;
            }
        }
        return false;
    }

    function addOnChainSlashedParticipant(bytes32 channelId, address slashedParticipant) internal virtual {
        if (isParticipantSlashedOnChain(channelId, slashedParticipant)) {
            return; //already slashed
        }
        disputeData[channelId].onChainSlashes.push(OnChainSlash(slashedParticipant, block.timestamp));
        emit OnChainSlashAdded(channelId, slashedParticipant, block.timestamp);
    }

    function getOnChainThresholdSet(bytes32 channelId) public view virtual returns (address[] memory) {
        return StateChannelUtilLibrary.subtractAddressArrays(
            StateChannelUtilLibrary.concatAddressArrays(
                getSnapshotParticipants(channelId), getPendingParticipants(channelId)
            ),
            getOnChainSlashedParticipants(channelId)
        );
    }

    function getGenesisTimestamp(bytes32 channelId, bytes32 originForkId, bytes32 forkId)
        public
        view
        returns (bool isAvailable, uint256 timestamp)
    {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[originForkId];
        if (!_isKillPeriodExpired(disputeWindow, getEvidenceTime())) {
            return (false, 0);
        }
        timestamp = disputeWindow.evidence.lastEvidenceSubmissionTimestamp + getEvidenceTime();
        if (timestamp == 0) {
            // Dispute window doesn't exist
            StateSnapshot memory currentOnChainSnapshot = stateSnapshots[channelId];
            // check if current on-chain snapshot.fork == forkId
            if (currentOnChainSnapshot.forkId == forkId && isGenesisSnapshot(currentOnChainSnapshot)) {
                return (true, currentOnChainSnapshot.timestamp);
            }
            return (false, 0);
        }
        return (true, timestamp);
    }

    function isGenesisSnapshot(StateSnapshot memory snapshot) public pure returns (bool) {
        return snapshot.forkId == keccak256(abi.encode(snapshot.snapshotData)) && snapshot.blockHeight == 0;
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

    function getGasLimit() public view virtual returns (uint256) {
        return gasLimit;
    }

    function getAllTimes() public view virtual returns (uint256, uint256, uint256, uint256) {
        return (p2pTime, agreementTime, chainFallbackTime, evidenceTime);
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

    function decodeBlock(bytes memory encodedBlock) public pure returns (Block memory) {
        return abi.decode(encodedBlock, (Block));
    }

    function isBlockAuthentic(SignedBlock memory _block) public view returns (bool) {
        // try decode block
        bytes memory data = abi.encodeCall(this.decodeBlock, (_block.encodedBlock));
        (bool success, bytes memory encodedBlock) = address(this).staticcall(data);
        if (!success) return false;
        Block memory decodedBlock = abi.decode(encodedBlock, (Block));
        address signer = StateChannelUtilLibrary.retriveSignerAddress(encodedBlock, _block.signature);
        if (signer != decodedBlock.transaction.header.participant) {
            return false;
        }
        return true;
    }

    function _applyJoins(
        bytes memory encodedStateMachineState,
        JoinChannelBlock[] memory joinChannelBlocks,
        Balance memory totalDeposits
    ) internal returns (bytes memory encodedModifiedState, Balance memory newTotalDeposits) {
        encodedModifiedState = encodedStateMachineState;
        newTotalDeposits = totalDeposits;
        for (uint256 i = 0; i < joinChannelBlocks.length; i++) {
            JoinChannelBlock memory joinChannelBlock = joinChannelBlocks[i];
            encodedModifiedState = applyJoinChannelToStateMachine(encodedModifiedState, joinChannelBlock.joinChannels);
            for (uint256 j = 0; j < joinChannelBlock.joinChannels.length; j++) {
                newTotalDeposits =
                    stateMachineImplementation.addBalance(newTotalDeposits, joinChannelBlock.joinChannels[j].balance);
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
        bytes32 channelId = dispute.input.channelId;
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

    function _canParticipateInDisputes(bytes32 channelId, address participant) public view returns (bool) {
        StateSnapshot storage stateSnapshot = stateSnapshots[channelId];
        bool isParticipant = false;
        //Check if normal participant
        for (uint256 i = 0; i < stateSnapshot.snapshotData.participants.length; i++) {
            if (stateSnapshot.snapshotData.participants[i] == participant) {
                isParticipant = true;
                break;
            }
        }
        if (!isParticipant) {
            //check pending participants
            DisputeData storage _disputeData = disputeData[channelId];
            for (uint256 i = 0; i < _disputeData.pendingParticipants.length; i++) {
                if (_disputeData.pendingParticipants[i] == participant) {
                    isParticipant = true;
                    break;
                }
            }
            if (!isParticipant) return false;
        }

        address[] memory onChainSlashedParticipants = getOnChainSlashedParticipants(channelId);
        //check if slashed on-chain -> slashed participants can't participate in disputes
        for (uint256 i = 0; i < onChainSlashedParticipants.length; i++) {
            if (onChainSlashedParticipants[i] == participant) {
                return false; //is slashed -> can't participate
            }
        }
        return true; //is participant and not slashed -> can participate
    }

    function _commitToDisputeReducedResult(
        bytes32 channelId,
        DisputeWindow storage disputeWindow,
        bytes32 reducedForkId,
        uint256 reductionTimestamp
    ) internal {
        require(!_isKillPeriodExpired(disputeWindow, getEvidenceTime()), ErrorDisputeKillPeriodNotExpired());
        require(disputeWindow.reducedResult.forkId == bytes32(0), ErrorDisputeAlreadyReduced());
        disputeWindow.reducedResult.forkId = reducedForkId;
        disputeWindow.reducedResult.timestamp = reductionTimestamp;
        disputeWindow.reducedResult.reducer = msg.sender; //calling function should check that msg.sender is part of channel 'can participate'

        emit DisputeReducedResultCommitted(
            channelId, disputeWindow.forkId, reducedForkId, reductionTimestamp, msg.sender
        );
    }

    function _delegatecall(address target, bytes memory data) internal returns (bytes memory) {
        (bool success, bytes memory result) = target.delegatecall(data);
        if (!success) {
            if (result.length == 0) {
                revert("StateChannelManagerProxy - Delegatecall failed");
            }
            assembly ("memory-safe") {
                let returndata_size := mload(result)
                revert(add(32, result), returndata_size)
            }
        }
        return result;
    }
}
