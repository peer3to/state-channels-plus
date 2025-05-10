pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./DisputeManagerFacet.sol";
import "./FraudProofFacet.sol";

import "./StateChannelUtilLibrary.sol";
import "./StateSnapshotFacet.sol";
import "../StateChannelManagerInterface.sol";

abstract contract AStateChannelManagerProxy is
    StateChannelManagerInterface,
    StateChannelCommon
{
    DisputeManagerFacet disputeManagerFacet;
    FraudProofFacet fraudProofFacet;
    StateSnapshotFacet stateSnapshotFacet;

    constructor(
        address _stateMachineImplementation,
        address _disputeManagerFacet,
        address _fraudProofFacet,
        address _stateSnapshotFacet
    ) {
        stateMachineImplementation = AStateMachine(_stateMachineImplementation);
        disputeManagerFacet = DisputeManagerFacet(_disputeManagerFacet);
        fraudProofFacet = FraudProofFacet(_fraudProofFacet);
        stateSnapshotFacet = StateSnapshotFacet(_stateSnapshotFacet);
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
        returns (bytes memory encodedModifiedState)
    {
        return _applyJoinChannelToStateMachine(encodedState,joinCahnnels);
    }

    function applySlashesToStateMachine(
        bytes memory encodedState,
        address[] memory slashedParticipants
    )
        public
        onlySelf
        returns (
            bytes memory encodedModifiedState,
            ExitChannel[] memory
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
            ExitChannel[] memory
        )
    {
        return _removeParticipantsFromStateMachine(encodedState, participants);
    }

    function _applyJoinChannelToStateMachine(
        bytes memory encodedState,
        JoinChannel[] memory joinCahnnels
    ) internal returns (bytes memory encodedModifiedState) {
        stateMachineImplementation.setState(encodedState);
        for (uint i = 0; i < joinCahnnels.length; i++) {
            bool success = stateMachineImplementation.joinChannel(
                joinCahnnels[i]
            );
            // require(success, "Slash failed");
            require(success,ErrorDisputeStateMachineJoiningFailed());
        }
        return (stateMachineImplementation.getState());
    }

    function _applySlashesToStateMachine(
        bytes memory encodedState,
        address[] memory slashedParticipants
    )
        internal
        returns (
            bytes memory encodedModifiedState,
            ExitChannel[] memory exitChannels
        )
    {
        exitChannels = new ExitChannel[](slashedParticipants.length);
        stateMachineImplementation.setState(encodedState);
        for (uint i = 0; i < slashedParticipants.length; i++) {
            bool success;
            (success, exitChannels[i]) = stateMachineImplementation
                .slashParticipant(slashedParticipants[i]);
            // require(success, "Slash failed");
            require(success,ErrorDisputeStateMachineSlashingFailed());
        }
        return (
            stateMachineImplementation.getState(),
            exitChannels
        );
    }

    function _removeParticipantsFromStateMachine(
        bytes memory encodedState,
        address[] memory participants
    )
        internal
        returns (
            bytes memory encodedModifiedState,
            ExitChannel[] memory
        )
    {
        ExitChannel[] memory exitChannels = new ExitChannel[](
            participants.length
        );
        stateMachineImplementation.setState(encodedState);
        for (uint i = 0; i < participants.length; i++) {
            bool success;
            (success, exitChannels[i]) = stateMachineImplementation
                .removeParticipant(participants[i]);
            // require(success, "Remove failed");
            require(success,ErrorDisputeStateMachineRemovingFailed());
        }
        return (
            stateMachineImplementation.getState(),
            exitChannels
        );
    }

    function executeStateTransitionOnState(
        bytes32 channelId,
        bytes memory encodedState,
        Transaction memory _tx
    ) public override returns (bool, bytes memory) {
        //channelId not used currenlty since all channels have the same SM - later they can be mapped to different ones
        stateMachineImplementation.setState(encodedState);
        (bool success, ) = address(
            stateMachineImplementation
        ).call(abi.encodeCall(stateMachineImplementation.stateTransition, _tx));
        return (success, stateMachineImplementation.getState());
        // return (success, abi.decode(encodedReturnValue, (bytes)));
    }

    /**
        Posting calldata is lightweight, since it persists a signle hash/commitment. 
        It's enough to check just the maxTimestamp safety guard that protects against race conditions, since everything else is committed in the block.
        We also don't allow overwriting the blockCalldataCommitment if it already exists. 
        We don't even have to check the siganture of the signedBlock, since the msg.sender takes the responsibility of provifing correct data.
        If the msg.sender provides junk(an invalid SignedBlock), a fraud proof can slash the msg.sender, by verifying the junk data against the committment.
        If msg.sender is not part of the channel, other peers will ignore emited events and commitments. The sender will still pay tx fees on-chain.
     */
    function postBlockCalldata(SignedBlock memory signedBlock, uint maxTimestamp) public override {
        //Time is the only race condition we need to take into account
        require(block.timestamp <= maxTimestamp, ErrorBlockCalldataTimestampTooLate());
        bytes32 commitment = keccak256(abi.encode(signedBlock,block.timestamp));
        Block memory _block = abi.decode(signedBlock.encodedBlock, (Block));

        // Extract values for better readability
        bytes32 channelId = _block.transaction.header.channelId;
        uint forkCnt = _block.transaction.header.forkCnt;
        uint transactionCnt = _block.transaction.header.transactionCnt;

        //Don't allow overwriting the blockCalldataCommitment if it already exists
        require(
            blockCalldataCommitments[channelId][msg.sender][forkCnt][transactionCnt] == bytes32(0),
            ErrorBlockCalldataAlreadyPosted()
        );

        blockCalldataCommitments[channelId][msg.sender][forkCnt][transactionCnt] = commitment;

        emit BlockCalldataPosted(
            _block.transaction.header.channelId,
            msg.sender,
            signedBlock,
            block.timestamp
        );
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
        DisputeAuditingData memory disputeAuditingData,
        uint timestamp
    ) public override returns (bool success, bytes memory slashedParticipantsOrError) {
       //This is done manually since the logic is different from other _delegatecalls
       
       // Encode the function selector and arguments
        bytes memory data = abi.encodeCall(
            DisputeManagerFacet.auditDispute,
            (
                dispute,
                disputeAuditingData,
                timestamp
            )
        );
        // Perform the low-level call with a gas limit
        (bool success, bytes memory returnData) = address(this).delegatecall{gas: getGasLimit()}(data);

        // If the call was successful, decode the result
        if (success) {
            address[] memory slashedParticipants = abi.decode(returnData, (address[]));
            //for sure no duplicates, otherwise auditing would fail -> just insert
            addOnChainSlashedParticipants(dispute.channelId, slashedParticipants);
        }
        // if !success and returnData.length == 0 => Auditing ran out of gas
        return (success, returnData);
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

    function verifyFraudProofs(
        Proof[] memory fraudProofs,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) public returns (address[] memory slashParticipants) {
        bytes memory slashedParticipants = _delegatecall(
            address(fraudProofFacet),
            abi.encodeCall(
                fraudProofFacet.verifyFraudProofs,
                (
                    fraudProofs,
                    fraudProofVerificationContext
                )
            )
        );

        return abi.decode(slashedParticipants, (address[]));
    }

    function getForkCnt(
        bytes32 channelId
    )
        public
        view
        override(StateChannelManagerInterface)
        returns (uint)
    {
        return disputeData[channelId].disputeCommitments.length;
    }

    function getParticipants(
        bytes32 channelId
    )
        public view
        override(StateChannelManagerInterface)
        returns (address[] memory)
    {
        return getSnapshotParticipants(channelId);
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

    function getBlockCallDataCommitment(
        bytes32 channelId,
        uint forkCnt,
        uint blockHeight,
        address participant
    )
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (bool found, bytes32 blockCalldataCommitment)
    {
        return
            StateChannelCommon.getBlockCallDataCommitment(
                channelId,
                forkCnt,
                blockHeight,
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

    function updateStateSnapshot(
        bytes32 channelId,
        ForkMilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        DisputeProof memory disputeProof,
        ExitChannelBlock[] memory exitChannelBlocks) public override {
        _delegatecall(
            address(stateSnapshotFacet),
            abi.encodeCall(
                stateSnapshotFacet.updateStateSnapshot,
                (channelId, milestoneProofs, milestoneSnapshots, disputeProof, exitChannelBlocks)
            )
        );
    }
    function verifyForkProof(
        ForkMilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        StateSnapshot memory genesisSnapshot
    ) public returns (bool isValid, bytes memory lastBlockEncoded) {
        bytes memory result = _delegatecall(
            address(disputeManagerFacet),
            abi.encodeCall(
                disputeManagerFacet.verifyForkProof,
                (milestoneProofs, milestoneSnapshots, genesisSnapshot)
            )
        );
        return abi.decode(result, (bool, bytes));
    }
}
