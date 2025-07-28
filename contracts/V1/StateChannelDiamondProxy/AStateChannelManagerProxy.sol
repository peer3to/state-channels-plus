pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "../StateChannelManagerInterface.sol";
import "./StateChannelUtilLibrary.sol";
import "./AConsumerFacet.sol";

import "./DisputeManagerFacet.sol";
import "./FraudProofFacet.sol";
import "./DisputeFraudProofFacet.sol";
import "./StateSnapshotFacet.sol";
import "./JoinChannelFacet.sol";

contract AStateChannelManagerProxy is StateChannelManagerInterface, StateChannelCommon {
    DisputeManagerFacet disputeManagerFacet;
    FraudProofFacet fraudProofFacet;
    DisputeFraudProofFacet disputeFraudProofFacet;
    StateSnapshotFacet stateSnapshotFacet;
    JoinChannelFacet joinChannelFacet;
    AConsumerFacet consumerFacet;

    constructor(
        address _stateMachineImplementation,
        address _disputeManagerFacet,
        address _fraudProofFacet,
        address _disputeFraudProofFacet,
        address _stateSnapshotFacet,
        address _joinChannelFacet,
        address _consumerFacet
    ) {
        stateMachineImplementation = AStateMachine(_stateMachineImplementation);
        disputeManagerFacet = DisputeManagerFacet(_disputeManagerFacet);
        fraudProofFacet = FraudProofFacet(_fraudProofFacet);
        disputeFraudProofFacet = DisputeFraudProofFacet(_disputeFraudProofFacet);
        stateSnapshotFacet = StateSnapshotFacet(_stateSnapshotFacet);
        joinChannelFacet = JoinChannelFacet(_joinChannelFacet);
        consumerFacet = AConsumerFacet(_consumerFacet);
        p2pTime = 15;
        agreementTime = 5;
        chainFallbackTime = 30;
        evidenceTime = 30;
        killTime = 60;
    }

    // ********** public/external functions **********

    /**
     * Posting calldata is lightweight, since it persists a signle hash/commitment.
     *     It's enough to check just the maxTimestamp safety guard that protects against race conditions, since everything else is committed in the block.
     *     We also don't allow overwriting the blockCalldataCommitment if it already exists.
     *     We don't even have to check the siganture of the signedBlock, since the msg.sender takes the responsibility of provifing correct data.
     *     If the msg.sender provides junk(an invalid SignedBlock), a fraud proof can slash the msg.sender, by verifying the junk data against the committment.
     *     If msg.sender is not part of the channel, other peers will ignore emited events and commitments. The sender will still pay tx fees on-chain.
     */
    function postBlockCalldata(SignedBlock memory signedBlock, uint256 maxTimestamp) public override {
        //Time is the only race condition we need to take into account
        require(block.timestamp <= maxTimestamp, ErrorBlockCalldataTimestampTooLate());
        bytes32 commitment = keccak256(abi.encode(signedBlock, block.timestamp));
        Block memory _block = abi.decode(signedBlock.encodedBlock, (Block));

        // Extract values for better readability
        bytes32 channelId = _block.transaction.header.channelId;
        bytes32 forkId = _block.transaction.header.forkId;
        uint256 transactionCnt = _block.transaction.header.transactionCnt;

        //Don't allow overwriting the blockCalldataCommitment if it already exists
        require(
            blockCalldataCommitments[channelId][msg.sender][forkId][transactionCnt] == bytes32(0),
            ErrorBlockCalldataAlreadyPosted()
        );

        blockCalldataCommitments[channelId][msg.sender][forkId][transactionCnt] = commitment;

        emit BlockCalldataPosted(_block.transaction.header.channelId, msg.sender, signedBlock, block.timestamp);
    }

    // ********** Consumer Facet Delegation Functions **********

    function openChannel(bytes32 channelId, bytes[] calldata openChannelData, bytes[] calldata signatures)
        public
        virtual
        override
    {
        require(!isChannelOpen(channelId), "AStateChannelManagerProxy: openChannel - channel already open");
        consumerFacet.openChannel(channelId, openChannelData, signatures);
    }

    function closeChannel(bytes32 channelId, bytes[] calldata closeChannelData, bytes[] calldata signatures)
        public
        virtual
        override
    {
        consumerFacet.closeChannel(channelId, closeChannelData, signatures);
    }

    function removeParticipant(bytes32 channelId, bytes[] calldata removeParticipantData, bytes[] calldata signatures)
        public
        virtual
        override
    {
        consumerFacet.removeParticipant(channelId, removeParticipantData, signatures);
    }

    function addParticipant(bytes32 channelId, bytes[] calldata addParticipantData, bytes[] calldata signatures)
        public
        virtual
        override
    {
        consumerFacet.addParticipant(channelId, addParticipantData, signatures);
    }

    function uploadDispute(DisputeConfirmation memory disputeConfirmation) public override {
        _delegatecall(
            address(disputeManagerFacet), abi.encodeCall(disputeManagerFacet.uploadDispute, (disputeConfirmation))
        );
    }

    function auditDispute(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        override
        returns (address[] memory slashParticipants)
    {
        //This is done manually since the logic is different from other _delegatecalls

        // Encode the function selector and arguments
        bytes memory data = abi.encodeCall(DisputeManagerFacet.auditDispute, (dispute, disputeAuditingData));
        // Perform the low-level call with a gas limit
        (bool success, bytes memory returnData) = address(disputeManagerFacet).delegatecall{gas: getGasLimit()}(data);
        if (!success) {
            assembly {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        address[] memory slashedParticipants = abi.decode(returnData, (address[]));
        return slashedParticipants;
    }

    function uploadDisputeWithCalldata(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public override {
        _delegatecall(
            address(disputeManagerFacet),
            abi.encodeCall(disputeManagerFacet.uploadDisputeWithCalldata, (disputeConfirmation, disputeAuditingData))
        );
    }

    function uploadDisputeAndAudit(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public override {
        _delegatecall(
            address(disputeManagerFacet),
            abi.encodeCall(disputeManagerFacet.uploadDisputeAndAudit, (disputeConfirmation, disputeAuditingData))
        );
    }

    function challengeDispute(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData) public override {
        _delegatecall(
            address(disputeManagerFacet),
            abi.encodeCall(disputeManagerFacet.challengeDispute, (dispute, disputeAuditingData))
        );
    }

    function applyDisputeFraudProofs(DisputeFraudProof[] memory proofs) public override {
        _delegatecall(
            address(disputeManagerFacet), abi.encodeCall(disputeManagerFacet.applyDisputeFraudProofs, (proofs))
        );
    }

    function updateStateSnapshotFork(
        bytes32 channelId,
        StateSnapshot memory newStateSnapshot,
        ExitChannelBlock[] memory exitChannelBlocks
    ) public override {
        _delegatecall(
            address(stateSnapshotFacet),
            abi.encodeCall(stateSnapshotFacet.updateStateSnapshotFork, (channelId, newStateSnapshot, exitChannelBlocks))
        );
    }

    function updateStateSnapshotSameFork(
        bytes32 channelId,
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        ExitChannelBlock[] memory exitChannelBlocks
    ) public override {
        _delegatecall(
            address(stateSnapshotFacet),
            abi.encodeCall(
                stateSnapshotFacet.updateStateSnapshotSameFork,
                (channelId, milestoneProofs, milestoneSnapshots, exitChannelBlocks)
            )
        );
    }

    function joinChannel(JoinChannelConfirmation memory joinChannelConfirmations) public override {
        _delegatecall(
            address(joinChannelFacet), abi.encodeCall(joinChannelFacet.joinChannel, (joinChannelConfirmations))
        );
    }

    // ********** public/external DIAMOND functions **********

    /// @dev Callable only by diamond facets - performs the deposit of the specific assets by interpeting `joinChannel` - returns bool success
    function depositAssetsComposable(JoinChannel memory joinChannel) public virtual onlySelf returns (bool) {
        return consumerFacet.depositAssetsComposable(joinChannel);
    }

    /// @dev Callable only by diamond facets - performs the withdrawal of the specific assets by interpeting `exitChannel` - returns bool success
    function withdrawAssetsComposable(ExitChannel memory exitChannel) public virtual onlySelf returns (bool) {
        return consumerFacet.withdrawAssetsComposable(exitChannel);
    }

    function applySlashesToStateMachine(bytes memory encodedState, address[] memory slashedParticipants)
        public
        onlySelf
        returns (bytes memory encodedModifiedState, ExitChannel[] memory)
    {
        return _applySlashesToStateMachine(encodedState, slashedParticipants);
    }

    function removeParticipantsFromStateMachine(bytes memory encodedState, address[] memory participants)
        public
        onlySelf
        returns (bytes memory encodedModifiedState, ExitChannel[] memory)
    {
        return _removeParticipantsFromStateMachine(encodedState, participants);
    }

    function executeStateTransition(bytes32 channelId, bytes memory encodedState, Transaction memory _tx)
        public
        override
        returns (bool, bytes memory encodedModifiedState)
    {
        //channelId not used currenlty since all channels have the same SM - later they can be mapped to different ones
        stateMachineImplementation.setState(encodedState);
        (bool success,) =
            address(stateMachineImplementation).call(abi.encodeCall(stateMachineImplementation.stateTransition, _tx));
        return (success, stateMachineImplementation.getState());
    }

    function verifyFraudProofs(
        FraudProof[] memory fraudProofs,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) public returns (address[] memory slashParticipants) {
        bytes memory slashedParticipants = _delegatecall(
            address(fraudProofFacet),
            abi.encodeCall(fraudProofFacet.verifyFraudProofs, (fraudProofs, fraudProofVerificationContext))
        );

        return abi.decode(slashedParticipants, (address[]));
    }

    function verifyDisputeFraudProofs(DisputeFraudProof[] memory disputeFraudProofs)
        public
        returns (bytes memory maliciousDisputesEncoded)
    {
        return _delegatecall(
            address(disputeFraudProofFacet),
            abi.encodeCall(disputeFraudProofFacet.verifyDisputeFraudProofs, (disputeFraudProofs))
        );
    }

    function getParticipants(bytes32 channelId)
        public
        view
        override(StateChannelManagerInterface)
        returns (address[] memory)
    {
        return getSnapshotParticipants(channelId);
    }

    function getP2pTime() public view override(StateChannelCommon, StateChannelManagerInterface) returns (uint256) {
        return StateChannelCommon.getP2pTime();
    }

    function getAgreementTime()
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint256)
    {
        return StateChannelCommon.getAgreementTime();
    }

    function getChainFallbackTime()
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint256)
    {
        return StateChannelCommon.getChainFallbackTime();
    }

    function getEvidenceTime()
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint256)
    {
        return StateChannelCommon.getEvidenceTime();
    }

    function getKillTime() public view override(StateChannelCommon, StateChannelManagerInterface) returns (uint256) {
        return StateChannelCommon.getKillTime();
    }

    function getAllTimes()
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint256, uint256, uint256, uint256, uint256)
    {
        return StateChannelCommon.getAllTimes();
    }

    function getBlockCallDataCommitment(bytes32 channelId, bytes32 forkId, uint256 blockHeight, address participant)
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (bool found, bytes32 blockCalldataCommitment)
    {
        return StateChannelCommon.getBlockCallDataCommitment(channelId, forkId, blockHeight, participant);
    }

    function isChannelOpen(bytes32 channelId)
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (bool)
    {
        return StateChannelCommon.isChannelOpen(channelId);
    }

    function verifyMilestones(
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        StateSnapshot memory genesisSnapshot
    ) public returns (bool isValid, bytes memory lastBlockEncoded) {
        bytes memory result = _delegatecall(
            address(disputeManagerFacet),
            abi.encodeCall(disputeManagerFacet.verifyMilestones, (milestoneProofs, milestoneSnapshots, genesisSnapshot))
        );
        return abi.decode(result, (bool, bytes));
    }

    function multicall(bytes[] calldata calls) external override returns (bytes[] memory results) {
        results = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(calls[i]);
            if (!success) {
                // Bubble up the revert reason
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
            results[i] = result;
        }
    }

    // ********** private/internal functions **********

    function _applySlashesToStateMachine(bytes memory encodedState, address[] memory slashedParticipants)
        internal
        override
        returns (bytes memory encodedModifiedState, ExitChannel[] memory exitChannels)
    {
        exitChannels = new ExitChannel[](slashedParticipants.length);
        stateMachineImplementation.setState(encodedState);
        for (uint256 i = 0; i < slashedParticipants.length; i++) {
            bool success;
            (success, exitChannels[i]) = stateMachineImplementation.slashParticipant(slashedParticipants[i]);
            require(success, ErrorDisputeStateMachineSlashingFailed());
        }
        return (stateMachineImplementation.getState(), exitChannels);
    }

    function _removeParticipantsFromStateMachine(bytes memory encodedState, address[] memory participants)
        internal
        override
        returns (bytes memory encodedModifiedState, ExitChannel[] memory)
    {
        ExitChannel[] memory exitChannels = new ExitChannel[](participants.length);
        stateMachineImplementation.setState(encodedState);
        for (uint256 i = 0; i < participants.length; i++) {
            bool success;
            (success, exitChannels[i]) = stateMachineImplementation.removeParticipant(participants[i]);
            // require(success, "Remove failed");
            require(success, ErrorDisputeStateMachineRemovingFailed());
        }
        return (stateMachineImplementation.getState(), exitChannels);
    }

    function _delegatecall(address target, bytes memory data) internal returns (bytes memory) {
        (bool success, bytes memory result) = target.delegatecall(data);
        if (!success) {
            if (result.length == 0) {
                revert("AStateChannelManagerProxy - Delegatecall failed");
            }
            assembly ("memory-safe") {
                let returndata_size := mload(result)
                revert(add(32, result), returndata_size)
            }
        }
        return result;
    }
}
