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
        ProcessExit memory processExit
    ) internal virtual returns (bool);

    function joinChannelWithAgreement(
        ConfirmedJoinChannelAgreement memory confirmedJoinChannelAgreement,
        bytes memory encodedState
    ) public {
        JoinChannelAgreement memory joinChannelAgreement = abi.decode(
            confirmedJoinChannelAgreement.encodedJoinChannelAgreement,
            (JoinChannelAgreement)
        );
        SignedJoinChannel memory signedJoinChannel = joinChannelAgreement
            .signedJoinChannel;

        JoinChannel memory joinChannel = abi.decode(
            signedJoinChannel.encodedJoinChannel,
            (JoinChannel)
        );

        // Require no dispute in progress
        require(
            !isDisputeInProgress(joinChannel.channelId),
            "AStateChannelManager: joinChannelWithAgreement - Dispute in progress"
        );
        tryProcessOldExits(joinChannel.channelId);

        //require forkCnt to match
        require(
            latestFork[joinChannel.channelId] == joinChannelAgreement.forkCnt,
            "AStateChannelManager: joinChannelWithAgreement - forkCnt mismatch"
        );

        //require hash(state) == previousStateHash
        require(
            keccak256(encodedState) == joinChannelAgreement.previousStateHash,
            "AStateChannelManager: joinChannelWithAgreement - previousStateHash mismatch"
        );

        address[] memory participants = getParticipants(
            joinChannel.channelId,
            joinChannelAgreement.forkCnt
        );

        //require joiner not participant
        bool isParticipant = StateChannelUtilLibrary.isAddressInArray(
            participants,
            joinChannel.participant
        );
        require(
            !isParticipant,
            "AStateChannelManager: joinChannelWithAgreement - joiner is participant"
        );

        //require msg.sender == submitter == participant
        isParticipant = StateChannelUtilLibrary.isAddressInArray(
            participants,
            joinChannelAgreement.submitter
        );
        require(
            isParticipant,
            "AStateChannelManager: joinChannelWithAgreement - submitter not participant"
        );
        require(
            msg.sender == joinChannelAgreement.submitter,
            "AStateChannelManager: joinChannelWithAgreement - msg.sender != submitter"
        ); //TODO? think about potential disputes - probably not needed

        //check signatures
        (bool success, ) = StateChannelUtilLibrary.verifyThresholdSigned(
            participants,
            confirmedJoinChannelAgreement.encodedJoinChannelAgreement,
            confirmedJoinChannelAgreement.signatures
        );
        require(
            success,
            "AStateChannelManager: joinChannelWithAgreement - signatures invalid"
        );

        //check initial signature
        address[] memory p = new address[](1);
        p[0] = joinChannel.participant;
        bytes[] memory signature = new bytes[](1);
        signature[0] = signedJoinChannel.signature;
        (success, ) = StateChannelUtilLibrary.verifyThresholdSigned(
            p,
            signedJoinChannel.encodedJoinChannel,
            signature
        );
        require(
            success,
            "AStateChannelManager: joinChannelWithAgreement - initial signature invalid"
        );

        //apply joinChannelComposable
        success = _addParticipantComposable(joinChannel);
        require(
            success,
            "AStateChannelManager: joinChannelWithAgreement - addParticipantComposable failed"
        );

        //apply joinChannelToState
        JoinChannel[] memory joinCahnnels = new JoinChannel[](1);
        joinCahnnels[0] = joinChannel;
        uint successCnt;
        (encodedState, successCnt) = applyJoinChannelToStateMachine(
            encodedState,
            joinCahnnels
        );
        require(
            successCnt == 1,
            "AStateChannelManager: joinChannelWithAgreement - applyJoinChannelToStateMachine failed"
        );

        //setState
        setState(joinChannel.channelId, encodedState);
        //TODO? - what if somone lies and triggeres this later - should not be wated upon and should trigget dispute from others if they play a move -> they're not a particopant anymore
    }

    function leaveChannelWithAgreement(
        LeaveChannelAgreement memory leaveChannelAgreement,
        bytes memory encodedState
    ) public {
        LeaveChannel memory leaveChannel = abi.decode(
            leaveChannelAgreement.encodedLeaveChannel,
            (LeaveChannel)
        );
        // Require no dispute in progress
        require(
            !isDisputeInProgress(leaveChannel.channelId),
            "AStateChannelManager: leaveChannelWithAgreement - Dispute in progress"
        );
        tryProcessOldExits(leaveChannel.channelId);

        //require forkCnt to match
        require(
            latestFork[leaveChannel.channelId] == leaveChannel.forkCnt,
            "AStateChannelManager: leaveChannelWithAgreement - forkCnt mismatch"
        );

        //require hash(state) == previousStateHash
        require(
            keccak256(encodedState) == leaveChannel.previousStateHash,
            "AStateChannelManager: leaveChannelWithAgreement - previousStateHash mismatch"
        );

        address[] memory participants = getParticipants(
            leaveChannel.channelId,
            leaveChannel.forkCnt
        );

        //require isParticipant
        bool isParticipant = StateChannelUtilLibrary.isAddressInArray(
            participants,
            leaveChannel.participant
        );
        require(
            isParticipant,
            "AStateChannelManager: leaveChannelWithAgreement - not participant"
        );

        //check signatures
        (bool success, ) = StateChannelUtilLibrary.verifyThresholdSigned(
            participants,
            leaveChannelAgreement.encodedLeaveChannel,
            leaveChannelAgreement.signatures
        );
        require(
            success,
            "AStateChannelManager: leaveChannelWithAgreement - signatures invalid"
        );

        address[] memory p = new address[](1);
        p[0] = leaveChannel.participant;
        (
            bytes memory encodedState,
            ProcessExit[] memory pe,
            uint successCnt
        ) = removeParticipantsFromStateMachine(encodedState, p);
        require(
            successCnt == 1,
            "AStateChannelManager: leaveChannelWithAgreement - removeParticipantsFromStateMachine failed"
        );
        //apply leaveChannelComposable
        success = _removeParticipantComposable(leaveChannel.channelId, pe[0]);
        require(
            success,
            "AStateChannelManager: leaveChannelWithAgreement - removeParticipantComposable failed"
        );

        //setState
        setState(leaveChannel.channelId, encodedState);
        //TODO? - what if somone lies and triggeres this later - should not be wated upon and should trigget dispute from others if they play a move -> they're not a particopant anymore
    }

    function tryProcessOldExits(bytes32 channelId) internal {
        Dispute storage dispute = disputes[channelId];
        bool isExpired = dispute.deadlineTimestamp < block.timestamp;
        if (isExpired) {
            for (uint i = 0; i < dispute.processExits.length; i++) {
                _removeParticipantComposable(
                    channelId,
                    dispute.processExits[i]
                );
            }
            delete dispute.processExits; //clears the array
        }
    }
    function addParticipantComposable(
        JoinChannel memory joinChannel
    ) public onlySelf returns (bool) {
        return _addParticipantComposable(joinChannel);
    }

    function removeParticipantComposable(
        bytes32 channelId,
        ProcessExit memory processExit
    ) public onlySelf returns (bool) {
        return _removeParticipantComposable(channelId, processExit);
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
            ProcessExit[] memory,
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
            ProcessExit[] memory,
            uint successCnt
        )
    {
        return _removeParticipantsFromStateMachine(encodedState, participants);
    }

    function getLatestState(
        bytes32 channelId
    ) public view override returns (bytes memory) {
        return encodedStates[channelId][latestFork[channelId]];
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
            ProcessExit[] memory,
            uint successCnt
        )
    {
        ProcessExit[] memory processExits = new ProcessExit[](
            participants.length
        );
        uint successCnt = 0;
        stateMachineImplementation.setState(encodedState);
        for (uint i = 0; i < participants.length; i++) {
            bool success;
            (success, processExits[successCnt]) = stateMachineImplementation
                .removeParticipant(participants[i]);
            // require(success, "Remove failed");
            if (success) successCnt++;
        }
        return (
            stateMachineImplementation.getState(),
            processExits,
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


    /**
     * This implementation covers a MFS (minimal feature set) funded by the Web3 Foundation.
     * Posting calldata is currenlty unefficient since the dispute mechanism only has a minimal feature set (MFS)
     * In the Full feature set (FFS) this will post the calldata and modify a single storage slot
     */
    function postBlockCalldata(SignedBlock memory signedBlock) public override {
        //check siganture
        address[] memory addressesInThreshold = new address[](1);
        addressesInThreshold[0] = msg.sender;
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = bytes(signedBlock.signature);
        (bool succeeds, ) = StateChannelUtilLibrary.verifyThresholdSigned(
            addressesInThreshold,
            bytes(signedBlock.encodedBlock),
            signatures
        );

        require(
            succeeds,
            "AStateChannelManager: postBlockCalldata signature invalid"
        );

        //Decode block;
        Block memory _block = abi.decode(
            bytes(signedBlock.encodedBlock),
            (Block)
        );
        //Check if sender is participant - needed since chainTime will be used as block/tx time in disputes
        require(
            msg.sender == _block.transaction.header.participant,
            "AStateChannelManager: postBlockCalldata sender must be participant"
        );
        //Check timestamp within range:
        require(
            _block.transaction.header.timestamp >=
                block.timestamp - p2pTime - agreementTime - chainFallbackTime,
            "AStateChannelManager: postBlockCalldata timestamp too old"
        );
        require(
            _block.transaction.header.timestamp <= block.timestamp,
            "AStateChannelManager: postBlockCalldata timestamp too new"
        );
        bytes32 channelId = _block.transaction.header.channelId;
        uint forkCnt = _block.transaction.header.forkCnt;
        uint transactionCnt = _block.transaction.header.transactionCnt;

        //Could do aditional checks here like forkCnt < globalForkCnt, but not needed since it can be detected on-client and disputed
        //Aslo could check if block producer part of state channel, but this too can be discarded on client - interacting on-chain has fees so no reason for someone to spam this
        //TODO? should potentially remove all checks and just have posting blocks? For honest participants it would be cheaper, and spaming would be disacrded regardless at a cost

        ForkDataAvailability storage forkDataAvailability = postedBlockCalldata[
            channelId
        ][forkCnt];

        forkDataAvailability.map[transactionCnt][msg.sender] = BlockCalldata({
            signedBlock: signedBlock,
            timestamp: block.timestamp
        });
        forkDataAvailability.keys.push(
            ForkDataAvailabilityKey(transactionCnt, msg.sender)
        );

        emit BlockCalldataPosted(channelId, signedBlock, block.timestamp);
    }

    function _delegatecall(
        address target,
        bytes memory data
    ) internal returns (bytes memory) {
        (bool success, bytes memory result) = target.delegatecall(data);
        if (!success) {
            if (result.length == 0)
                revert("AStateChannelManagerProxy - Delegatecall failed");
            assembly {
                let returndata_size := mload(result)
                revert(add(32, result), returndata_size)
            }
        }
        return result;
    }

    function getDispute(
        bytes32 channelId
    ) public view override returns (Dispute memory) {
        return disputes[channelId];
    }

    function createDispute(
        Dispute memory dispute
    ) public override {
        _delegatecall(
            address(disputeManagerFacet),
            abi.encodeCall(
                disputeManagerFacet.createDispute,
                (
                    dispute
                )
            )
        );
    }

    function auditDispute(
        Dispute memory dispute,
        DisputeAuditingData memory disputeAuditingData
    ) public override {
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
    )
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint)
    {
        return StateChannelCommon.getForkCnt(channelId);
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
        uint transactionCnt,
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
                transactionCnt,
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

    function getGenesisTimestamp(
        bytes32 channelId,
        uint forkCnt
    )
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint)
    {
        return StateChannelCommon.getGenesisTimestamp(channelId, forkCnt);
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
