pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./DisputeManagerFacet.sol";
import "./StateChannelUtilLibrary.sol";
import "../StateChannelManagerInterface.sol";

abstract contract AStateChannelManagerProxy is
    StateChannelManagerInterface,
    StateChannelCommon
{
    DisputeManagerFacet disputeManagerFacet;

    constructor(
        address _stateMachineImplementation,
        address _disputeManagerFacet
    ) {
        stateMachineImplementation = AStateMachine(_stateMachineImplementation);
        disputeManagerFacet = DisputeManagerFacet(_disputeManagerFacet);
        p2pTime = 15;
        agreementTime = 5;
        chainFallbackTime = 30;
        challengeTime = 60;
    }

    function _addParticipantComposable(
        JoinChannel memory joinChannel
    ) internal virtual returns (bool);

    function _removeParticipantComposable(
        bytes32 channelId,
        ExitChannel memory exitChannel
    ) internal virtual returns (bool);

    function addParticipantComposable(
        JoinChannel memory joinChannel
    ) public onlySelf returns (bool) {
        return _addParticipantComposable(joinChannel);
    }

    function removeParticipantComposable(
        bytes32 channelId,
        ExitChannel memory exitChannel
    ) public onlySelf returns (bool) {
        return _removeParticipantComposable(channelId, exitChannel);
    }

    function applyJoinChannelToStateMachine(
        bytes memory encodedState,
        JoinChannel[] memory joinCahnnels
    )
        public
        onlySelf
        returns (bytes memory encodedModifiedState, uint successCnt)
    {
        return _applyJoinChannelToStateMachine(encodedState, joinCahnnels);
    }

    function applySlashesToStateMachine(
        bytes memory encodedState,
        address[] memory slashedParticipants
    )
        public
        onlySelf
        returns (
            bytes memory encodedModifiedState,
            ExitChannel[] memory,
            uint successCnt
        )
    {
        return _applySlashesToStateMachine(encodedState, slashedParticipants);
    }

    function removeParticipantsFromStateMachine(
        bytes memory encodedState,
        address[] memory participants
    )
        public
        onlySelf
        returns (
            bytes memory encodedModifiedState,
            ExitChannel[] memory,
            uint successCnt
        )
    {
        return _removeParticipantsFromStateMachine(encodedState, participants);
    }

    function getLatestState(
        bytes32 channelId
    ) public view override returns (bytes memory) {
        return encodedStates[channelId][disputes[channelId].length - 1];
    }

    function _applyJoinChannelToStateMachine(
        bytes memory encodedState,
        JoinChannel[] memory joinCahnnels
    ) internal returns (bytes memory encodedModifiedState, uint successCnt) {
        uint successCnt = 0;
        stateMachineImplementation.setState(encodedState);
        for (uint i = 0; i < joinCahnnels.length; i++) {
            bool success = stateMachineImplementation.joinChannel(
                joinCahnnels[i]
            );
            // require(success, "JoinChannel failed");
            if (success) successCnt++;
        }
        return (stateMachineImplementation.getState(), successCnt);
    }

    function _applySlashesToStateMachine(
        bytes memory encodedState,
        address[] memory slashedParticipants
    )
        internal
        returns (
            bytes memory encodedModifiedState,
            ExitChannel[] memory,
            uint successCnt
        )
    {
        ExitChannel[] memory exitChannels = new ExitChannel[](
            slashedParticipants.length
        );
        uint successCnt = 0;
        stateMachineImplementation.setState(encodedState);
        for (uint i = 0; i < slashedParticipants.length; i++) {
            bool success;
            (success, exitChannels[successCnt]) = stateMachineImplementation
                .slashParticipant(slashedParticipants[i]);
            // require(success, "Slash failed");
            if (success) successCnt++;
        }
        return (
            stateMachineImplementation.getState(),
            exitChannels,
            successCnt
        );
    }

    function _removeParticipantsFromStateMachine(
        bytes memory encodedState,
        address[] memory participants
    )
        internal
        returns (
            bytes memory encodedModifiedState,
            ExitChannel[] memory,
            uint successCnt
        )
    {
        ExitChannel[] memory exitChannels = new ExitChannel[](
            participants.length
        );
        uint successCnt = 0;
        stateMachineImplementation.setState(encodedState);
        for (uint i = 0; i < participants.length; i++) {
            bool success;
            (success, exitChannels[successCnt]) = stateMachineImplementation
                .removeParticipant(participants[i]);
            // require(success, "Remove failed");
            if (success) successCnt++;
        }
        return (
            stateMachineImplementation.getState(),
            exitChannels,
            successCnt
        );
    }

    function executeStateTransitionOnState(
        bytes32 channelId,
        bytes memory encodedState,
        Transaction memory _tx
    ) public override returns (bool, bytes memory) {
        //channelId not used currenlty since all channels have the same SM - later they can be mapped to different ones
        stateMachineImplementation.setState(encodedState);
        (bool success, bytes memory encodedReturnValue) = address(
            stateMachineImplementation
        ).call(abi.encodeCall(stateMachineImplementation.stateTransition, _tx));
        return (success, stateMachineImplementation.getState());
        // return (success, abi.decode(encodedReturnValue, (bytes)));
    }


    
    function postBlockCalldata(SignedBlock memory signedBlock) public override {
       revert("NOT IMPLEMENTED");
    }

    function _delegatecall(
        address target,
        bytes memory data
    ) internal returns (bytes memory) {
        (bool success, bytes memory result) = target.delegatecall(data);
        if (!success) {
            if (result.length == 0)
                revert("AStateChannelManagerProxy - Delegatecall failed");
            assembly ("memory-safe") {
                let returndata_size := mload(result)
                revert(add(32, result), returndata_size)
            }
        }
        return result;
    }

    function getDispute(
        bytes32 channelId
    ) public view override returns (bytes32[] memory) {
        return disputes[channelId];
    }

    function createDispute(
        Dispute memory dispute
    ) public override {
        _delegatecall(
            address(disputeManagerFacet),
            abi.encode(
                disputeManagerFacet.createDispute.selector,
                dispute
            )
        );
    }

    function auditDispute(
        Dispute memory dispute,
        DisputeAuditingData memory disputeAuditingData
    ) public override returns (bool isSuccess, address[] memory slashParticipants, bytes memory errorMessage) {
        _delegatecall(
            address(disputeManagerFacet),
            abi.encodeCall(
                disputeManagerFacet.auditDispute,
                (
                    dispute,
                    disputeAuditingData
                )
            )
        );
    }

    function challengeDispute(
        Dispute memory dispute,
        DisputeAuditingData memory disputeAuditingData
    ) public override {
        _delegatecall(
            address(disputeManagerFacet),
            abi.encodeCall(
                disputeManagerFacet.challengeDispute,
                (
                    dispute, 
                    disputeAuditingData
                )
            )
        );
    }

    function getForkCnt(
        bytes32 channelId
    )
        public
        view
        override(StateChannelManagerInterface)
        returns (uint)
    {
        return disputes[channelId].length;
    }

    function getParticipants(
        bytes32 channelId,
        uint forkCnt
    )
        public
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (address[] memory)
    {
        return StateChannelCommon.getParticipants(channelId, forkCnt);
    }

    function getNextToWrite(
        bytes32 channelId,
        bytes memory encodedState
    )
        public
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (address)
    {
        return StateChannelCommon.getNextToWrite(channelId, encodedState);
    }

    function isGenesisState(
        bytes32 channelId,
        uint forkCnt,
        bytes memory encodedFinalizedState
    )
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (bool)
    {
        return
            StateChannelCommon.isGenesisState(
                channelId,
                forkCnt,
                encodedFinalizedState
            );
    }

    function getP2pTime()
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint)
    {
        return StateChannelCommon.getP2pTime();
    }

    function getAgreementTime()
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint)
    {
        return StateChannelCommon.getAgreementTime();
    }

    function getChainFallbackTime()
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint)
    {
        return StateChannelCommon.getChainFallbackTime();
    }

    function getChallengeTime()
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint)
    {
        return StateChannelCommon.getChallengeTime();
    }

    function getAllTimes()
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint, uint, uint, uint)
    {
        return StateChannelCommon.getAllTimes();
    }

    function getBlockCallData(
        bytes32 channelId,
        uint forkCnt,
        address participant
    )
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (bool found, bytes32 blockCallData)
    {
        return
            StateChannelCommon.getBlockCallData(
                channelId,
                forkCnt,
                participant
            );
    }

    function getChainLatestBlockTimestamp(
        bytes32 channelId,
        uint forkCnt,
        uint maxTransactionCnt
    )
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint)
    {
        return
            StateChannelCommon.getChainLatestBlockTimestamp(
                channelId,
                forkCnt,
                maxTransactionCnt
            );
    }

    function isChannelOpen(
        bytes32 channelId
    )
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (bool)
    {
        return StateChannelCommon.isChannelOpen(channelId);
    }
}
