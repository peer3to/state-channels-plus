pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./StateChannelManagerStorage.sol";
import "../StateChannelManagerEvents.sol";
import "./StateChannelUtilLibrary.sol";
import "./AStateChannelManagerProxy.sol";

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

    function addOnChainSlashedParticipants(bytes32 channelId, address slashedParticipant) internal virtual {
        disputeData[channelId].onChainSlashes.push(OnChainSlash(slashedParticipant, block.timestamp));
    }

    function getOnChainThresholdSet(bytes32 channelId) public view virtual returns (address[] memory) {
        SnapshotData storage snapshotData = stateSnapshots[channelId].snapshotData;
        DisputeData storage _disputeData = disputeData[channelId];
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

    function getChallengeTime() public view virtual returns (uint256) {
        return challengeTime;
    }

    function getGasLimit() public view virtual returns (uint256) {
        return gasLimit;
    }

    function getAllTimes() public view virtual returns (uint256, uint256, uint256, uint256) {
        return (p2pTime, agreementTime, chainFallbackTime, challengeTime);
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

    function getDisputeCommitment(bytes32 channelId, uint256 disputeIndex)
        public
        view
        returns (bool found, bytes32 disputeCommitment)
    {
        if (disputeIndex >= disputeData[channelId].disputeCommitments.length) {
            return (false, bytes32(0));
        }
        return (true, disputeData[channelId].disputeCommitments[disputeIndex]);
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

    function _applySlashes(bytes memory encodedStateMachineState, address[] memory slashParticipants)
        internal
        returns (bytes memory encodedModifiedState, ExitChannel[] memory exitChannels)
    {
        (encodedModifiedState, exitChannels) = _applySlashesToStateMachine(encodedStateMachineState, slashParticipants);
    }

    function _applyRemovals(bytes memory encodedStateMachineState, address[] memory removeParticipants)
        internal
        returns (bytes memory encodedModifiedState, ExitChannel[] memory exitChannels)
    {
        (encodedModifiedState, exitChannels) =
            _removeParticipantsFromStateMachine(encodedStateMachineState, removeParticipants);
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

    function _verifyFraudProofs(Proof[] memory fraudProofs, FraudProofVerificationContext memory poofContext)
        public
        returns (address[] memory slashParticipants)
    {
        return AStateChannelManagerProxy(address(this)).verifyFraudProofs(fraudProofs, poofContext);
    }

    function _removeParticipantsFromStateMachine(bytes memory encodedState, address[] memory participants)
        internal
        virtual
        returns (bytes memory encodedModifiedState, ExitChannel[] memory exitChannels)
    {
        return AStateChannelManagerProxy(address(this)).removeParticipantsFromStateMachine(encodedState, participants);
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

    function applyJoinChannelToStateMachine(bytes memory encodedState, JoinChannel[] memory joinCahnnels)
        public
        virtual
        returns (bytes memory encodedModifiedState)
    {
        return AStateChannelManagerProxy(address(this)).applyJoinChannelToStateMachine(encodedState, joinCahnnels);
    }

    //stateless
    function _applySlashesToStateMachine(bytes memory encodedState, address[] memory slashedParticipants)
        internal
        virtual
        returns (bytes memory encodedModifiedState, ExitChannel[] memory exitChannels)
    {
        return AStateChannelManagerProxy(address(this)).applySlashesToStateMachine(encodedState, slashedParticipants);
    }
}
