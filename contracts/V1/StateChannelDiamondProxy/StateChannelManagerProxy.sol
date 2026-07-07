pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "../StateChannelManagerInterface.sol";
import "./AConsumerFacet.sol";

import "./DisputeManagerFacet.sol";
import "./DisputeVerificationFacet.sol";
import "./FraudProofFacet.sol";
import "./DisputeFraudProofFacet.sol";
import "./StateSnapshotFacet.sol";
import "./JoinChannelFacet.sol";
import "./StateProofFacet.sol";
import "../types/DisputeTypes.sol";
import "../types/MessageTypeHashes.sol";
import "./utils/GeneralUtils.sol";
import "./UtilityFacet.sol";

contract StateChannelManagerProxy is StateChannelManagerInterface, StateChannelCommon {
    // Default time values
    uint256 private constant DEFAULT_P2P_TIME = 15;
    uint256 private constant DEFAULT_AGREEMENT_TIME = 5;
    uint256 private constant DEFAULT_CHAIN_FALLBACK_TIME = 30;
    uint256 private constant DEFAULT_EVIDENCE_TIME = 30;
    uint256 private constant DEFAULT_DISPUTE_EXECUTION_GAS_LIMIT = 3_000_000;

    constructor(
        address _stateMachineImplementation,
        address _disputeManagerFacet,
        address _disputeVerificationFacet,
        address _fraudProofFacet,
        address _disputeFraudProofFacet,
        address _stateSnapshotFacet,
        address _joinChannelFacet,
        address _stateProofFacet,
        address _utilityFacet,
        address _consumerFacet,
        uint256 _p2pTime,
        uint256 _agreementTime,
        uint256 _chainFallbackTime,
        uint256 _evidenceTime,
        uint256 _disputeExecutionGasLimit
    ) {
        stateMachineImplementation = AStateMachine(_stateMachineImplementation);
        disputeManagerFacetAddress = _disputeManagerFacet;
        disputeVerificationFacetAddress = _disputeVerificationFacet;
        fraudProofFacetAddress = _fraudProofFacet;
        disputeFraudProofFacetAddress = _disputeFraudProofFacet;
        stateSnapshotFacetAddress = _stateSnapshotFacet;
        joinChannelFacetAddress = _joinChannelFacet;
        stateProofFacetAddress = _stateProofFacet;
        utilityFacetAddress = _utilityFacet;
        consumerFacetAddress = _consumerFacet;
        p2pTime = _p2pTime == 0 ? DEFAULT_P2P_TIME : _p2pTime;
        agreementTime = _agreementTime == 0 ? DEFAULT_AGREEMENT_TIME : _agreementTime;
        chainFallbackTime = _chainFallbackTime == 0 ? DEFAULT_CHAIN_FALLBACK_TIME : _chainFallbackTime;
        evidenceTime = _evidenceTime == 0 ? DEFAULT_EVIDENCE_TIME : _evidenceTime;
        gasLimit = _disputeExecutionGasLimit == 0 ? DEFAULT_DISPUTE_EXECUTION_GAS_LIMIT : _disputeExecutionGasLimit;
    }

    fallback() external {
        bytes memory result = _delegatecall(consumerFacetAddress, msg.data);
        assembly ("memory-safe") {
            return(add(result, 0x20), mload(result))
        }
    }

    // ********** public/external functions **********

    /**
     * Posting calldata is lightweight, since it persists a single hash/commitment.
     *     It's enough to check just the maxTimestamp safety guard that protects against race conditions, since everything else is committed in the block.
     *     We also don't allow overwriting the blockCalldataCommitment if it already exists.
     *     We don't even have to check the signature of the signedBlock, since the msg.sender takes the responsibility of providing correct data.
     *     If the msg.sender provides junk(an invalid SignedBlock), a fraud proof can slash the msg.sender, by verifying the junk data against the commitment.
     *     If msg.sender is not part of the channel, other peers will ignore emitted events and commitments. The sender will still pay tx fees on-chain.
     */
    function postBlockCalldata(SignedBlock memory signedBlock, uint256 maxTimestamp) public override {
        //Time is the only race condition we need to take into account
        require(block.timestamp <= maxTimestamp, RaceConditionBlockCalldataTimestampTooLate());
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
        require(msg.sender == _block.transaction.header.participant, ErrorBlockCalldataMsgSenderNotBlockAuthor());

        blockCalldataCommitments[channelId][msg.sender][forkId][transactionCnt] = commitment;

        emit BlockCalldataPosted(
            _block.transaction.header.channelId, commitment, msg.sender, signedBlock, block.timestamp
        );
    }

    // ********** Consumer Facet Delegation Functions **********

    function open(OpenChannelConfirmation calldata openChannelConfirmation) public virtual override {
        OpenChannel memory openChannelData = abi.decode(openChannelConfirmation.encodedOpenChannel, (OpenChannel));
        require(openChannelData.channelId != bytes32(0), ErrorInvalidJoinChannel());
        (bool isOpen,) = isChannelOpen(openChannelData.channelId);
        require(!isOpen, RaceConditionChannelAlreadyOpen());

        // reject duplicate participants
        for (uint256 i = 0; i < openChannelData.participants.length; i++) {
            for (uint256 j = i + 1; j < openChannelData.participants.length; j++) {
                require(openChannelData.participants[i] != openChannelData.participants[j], ErrorDuplicateParticipant());
            }
        }

        // set zero balance for on-chain deposits/withdrawals
        Balance memory zeroBalance = stateMachineImplementation.getZeroBalance();
        {
            ChannelBalance storage channelBalance = channelBalances[openChannelData.channelId];
            channelBalance.totalDeposits = zeroBalance;
            channelBalance.totalWithdrawals = zeroBalance;
            channelBalance.latestInboundMessageBlockHash = bytes32(0);
            channelBalance.latestInboundMessageBlockHeight = 0;
            channelBalance.latestOutboundMessageBlockHeight = 0;
        }
        // verify threshold signature - must be from all participants - this is deterministic - no race condition on-chain
        (bool isValid, string memory reason) = UtilityFacet(utilityFacetAddress).verifyThresholdSigned(
            openChannelData.participants, openChannelConfirmation.encodedOpenChannel, openChannelConfirmation.signatures
        );
        require(isValid, reason);

        JoinChannel[] memory joinChannels = new JoinChannel[](openChannelData.participants.length);
        for (uint256 i = 0; i < openChannelData.participants.length; i++) {
            joinChannels[i] = JoinChannel({
                channelId: openChannelData.channelId,
                participant: openChannelData.participants[i],
                deadlineTimestamp: openChannelData.deadlineTimestamp,
                balance: openChannelData.balances[i]
            });
        }

        (MessageBlock memory inboundBlock, Balance memory newTotalDeposits, JoinChannel[] memory processedJoins) =
            StateChannelManagerProxy(address(this)).depositAssetsComposable(joinChannels, openChannelData.isAtomic);

        require(processedJoins.length >= 2, ErrorAtLeastTwoParticipantsRequired());
        bytes32 inboundHead = keccak256(abi.encode(inboundBlock));
        bytes memory result = _delegatecall(
            consumerFacetAddress,
            abi.encodeCall(AConsumerFacet.openChannelGenesis, (processedJoins, openChannelData.data))
        );
        (bytes memory genesisState, address[] memory participants) = abi.decode(result, (bytes, address[]));

        SnapshotData memory genesisSnapshotData = SnapshotData({
            originForkId: bytes32(0),
            stateMachineStateHash: keccak256(genesisState),
            participants: participants,
            latestInboundMessageBlockHash: inboundHead,
            latestInboundMessageBlockHeight: inboundBlock.blockHeight,
            latestOutboundMessageBlockHash: bytes32(0),
            latestOutboundMessageBlockHeight: 0,
            totalDeposits: newTotalDeposits,
            totalWithdrawals: zeroBalance
        });

        channelBalances[openChannelData.channelId].latestInboundMessageBlockHeight = inboundBlock.blockHeight;

        bytes32 forkId = keccak256(abi.encode(genesisSnapshotData));
        StateSnapshot memory genesisStateSnapshot = StateSnapshot({
            snapshotData: genesisSnapshotData,
            forkId: forkId,
            blockHeight: 0,
            timestamp: block.timestamp
        });

        stateSnapshots[openChannelData.channelId] = genesisStateSnapshot;

        emit ChannelOpened(openChannelData.channelId, genesisStateSnapshot, genesisState);
    }

    function uploadDispute(DisputeConfirmation memory disputeConfirmation) public override {
        _delegatecall(
            disputeManagerFacetAddress, abi.encodeCall(DisputeManagerFacet.uploadDispute, (disputeConfirmation))
        );
    }

    function uploadDisputeWithCalldata(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public override {
        _delegatecall(
            disputeManagerFacetAddress,
            abi.encodeCall(DisputeManagerFacet.uploadDisputeWithCalldata, (disputeConfirmation, disputeAuditingData))
        );
    }

    function challengeDisputeReduction(
        Dispute[] memory disputes,
        StateSnapshot memory latestStateSnapshot,
        bytes memory encodedStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public override {
        _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(
                DisputeVerificationFacet.challengeDisputeReduction,
                (disputes, latestStateSnapshot, encodedStateMachineState, inboundMessageBlocks)
            )
        );
    }

    function applyDisputeFraudProofs(DisputeFraudProof[] memory proofs) public override {
        _delegatecall(
            disputeFraudProofFacetAddress, abi.encodeCall(DisputeFraudProofFacet.applyDisputeFraudProofs, (proofs))
        );
    }

    function updateStateSnapshotFork(
        bytes32 channelId,
        StateSnapshot memory newStateSnapshot,
        MessageBlock[] memory outboundMessageBlocks
    ) public override {
        _delegatecall(
            stateSnapshotFacetAddress,
            abi.encodeCall(
                StateSnapshotFacet.updateStateSnapshotFork, (channelId, newStateSnapshot, outboundMessageBlocks)
            )
        );
    }

    function updateStateSnapshotSameFork(
        bytes32 channelId,
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        MessageBlock[] memory outboundMessageBlocks
    ) public override {
        _delegatecall(
            stateSnapshotFacetAddress,
            abi.encodeCall(
                StateSnapshotFacet.updateStateSnapshotSameFork,
                (channelId, milestoneProofs, milestoneSnapshots, outboundMessageBlocks)
            )
        );
    }

    function joinChannel(JoinChannelConfirmation memory joinChannelConfirmations, bytes32 expectedSnapshotHash)
        public
        override
    {
        _delegatecall(
            joinChannelFacetAddress,
            abi.encodeCall(JoinChannelFacet.joinChannel, (joinChannelConfirmations, expectedSnapshotHash))
        );
    }

    // ********** public/external DIAMOND functions **********

    // @dev Callable only by diamond facets - performs the deposit of the specific assets by interpreting `joinChannel` - returns bool success
    function depositAssetsComposable(JoinChannel[] memory joinChannels, bool isAtomic)
        public
        virtual
        onlySelf
        returns (
            MessageBlock memory messageBlock,
            Balance memory newTotalDeposits,
            JoinChannel[] memory successfulJoins
        )
    {
        require(joinChannels.length > 0, ErrorNoJoinChannelProvided());
        bytes32 channelId = joinChannels[0].channelId;

        JoinChannel[] memory filteredJoinChannels = new JoinChannel[](joinChannels.length);
        uint256 successfulJoinCount = 0;
        for (uint256 i = 0; i < joinChannels.length; i++) {
            bytes memory result =
                _delegatecall(consumerFacetAddress, abi.encodeCall(AConsumerFacet.deposit, (joinChannels[i])));
            bool success = abi.decode(result, (bool));
            if (!success && isAtomic) revert ErrorJoinChannelAtomicFailure();
            if (success) {
                filteredJoinChannels[successfulJoinCount++] = joinChannels[i];
            }
        }
        require(successfulJoinCount > 0, ErrorNoSuccessfulJoinChannel());
        // Resize the array to the number of successful joins - only ok for shrinking the array
        // TODO - find other places in the code that shrink MEMORY arrays and do the same - better than to allocate more space
        assembly ("memory-safe") {
            mstore(filteredJoinChannels, successfulJoinCount)
        }

        // Build message block representing the inbound joins
        Message[] memory messages = new Message[](successfulJoinCount);
        for (uint256 i = 0; i < successfulJoinCount; i++) {
            messages[i] = Message({
                messageType: MESSAGE_TYPE_JOIN,
                participant: filteredJoinChannels[i].participant,
                balance: filteredJoinChannels[i].balance,
                data: abi.encode(filteredJoinChannels[i])
            });
        }
        (messageBlock, newTotalDeposits) = _appendInboundMessages(channelId, messages);

        return (messageBlock, newTotalDeposits, filteredJoinChannels);
    }

    /// @dev Callable only by diamond facets - performs the withdrawal of the specific assets by interpreting `exitChannel` - returns bool success
    function withdrawAssetsComposable(ExitChannel memory exitChannel) public virtual override onlySelf returns (bool) {
        bytes memory result =
            _delegatecall(consumerFacetAddress, abi.encodeCall(AConsumerFacet.withdraw, (exitChannel)));
        return abi.decode(result, (bool));
    }

    function executeStateTransition(bytes32 channelId, bytes memory encodedState, Transaction memory _tx)
        public
        override
        onlySelf
        returns (bool, bytes memory encodedModifiedState, Message[] memory outboundMessages)
    {
        //channelId not used currently since all channels have the same SM - later they can be mapped to different ones
        stateMachineImplementation.setState(encodedState);
        (bool success, bytes memory response) =
            address(stateMachineImplementation).call(abi.encodeCall(stateMachineImplementation.stateTransition, _tx));
        if (success && response.length > 0) {
            (, outboundMessages) = abi.decode(response, (bool, Message[]));
        }
        return (success, stateMachineImplementation.getState(), outboundMessages);
    }

    function applyFraudProofs(
        FraudProof[] memory fraudProofs,
        FraudProofVerificationContext memory fraudProofVerificationContext //TODO - think is it safe to expose this - currently I don't see any issue
    ) public {
        _delegatecall(
            fraudProofFacetAddress,
            abi.encodeCall(FraudProofFacet.applyFraudProofs, (fraudProofs, fraudProofVerificationContext))
        );
    }

    function hasInvalidTimestamp(InvalidTimestampProof memory proof) public returns (bool) {
        bytes memory result =
            _delegatecall(fraudProofFacetAddress, abi.encodeCall(FraudProofFacet.hasInvalidTimestamp, (proof)));
        return abi.decode(result, (bool));
    }

    function isLastMilestoneFinalByEveryone(Dispute memory dispute) public returns (bool isFinal) {
        bytes memory result = _delegatecall(
            disputeFraudProofFacetAddress,
            abi.encodeCall(DisputeFraudProofFacet.isLastMilestoneFinalByEveryone, (dispute))
        );
        return abi.decode(result, (bool));
    }

    function hasStateProofHeaderMismatch(Dispute memory dispute) public returns (bool) {
        bytes memory result = _delegatecall(
            disputeFraudProofFacetAddress, abi.encodeCall(DisputeFraudProofFacet.hasStateProofHeaderMismatch, (dispute))
        );
        return abi.decode(result, (bool));
    }

    function isDisputeInboundHashValid(Dispute memory dispute) public returns (bool) {
        bytes memory result = _delegatecall(
            disputeFraudProofFacetAddress, abi.encodeCall(DisputeFraudProofFacet.isDisputeInboundHashValid, (dispute))
        );
        return abi.decode(result, (bool));
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

    function getAllTimes()
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (uint256, uint256, uint256, uint256)
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

    function hasInboundMessageBlock(bytes32 channelId, bytes32 messageBlockHash)
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (bool)
    {
        return StateChannelCommon.hasInboundMessageBlock(channelId, messageBlockHash);
    }

    function verifyStateProof(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        virtual
        override(StateChannelManagerInterface)
        returns (bool)
    {
        bytes memory result = _delegatecall(
            stateProofFacetAddress, abi.encodeCall(StateProofFacet.verifyStateProof, (dispute, disputeAuditingData))
        );
        return abi.decode(result, (bool));
    }

    function isCorrectLatestState(Dispute memory dispute, SnapshotData memory genesisStateSnapshotData)
        public
        virtual
        override(StateChannelManagerInterface)
        returns (bool)
    {
        bytes memory result = _delegatecall(
            stateProofFacetAddress,
            abi.encodeCall(StateProofFacet.isCorrectLatestState, (dispute, genesisStateSnapshotData))
        );
        return abi.decode(result, (bool));
    }

    function areSignedBlocksLinkedAndVerified(SignedBlock[] memory signedBlocks)
        public
        virtual
        override(StateChannelManagerInterface)
        returns (bool)
    {
        bytes memory result = _delegatecall(
            stateProofFacetAddress, abi.encodeCall(StateProofFacet.areSignedBlocksLinkedAndVerified, (signedBlocks))
        );
        return abi.decode(result, (bool));
    }

    function verifyMilestones(
        bytes32 forkId,
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        StateSnapshot memory thresholdStateSnapshot
    ) public override(StateChannelManagerInterface) returns (bool isValid) {
        bytes memory result = _delegatecall(
            stateProofFacetAddress,
            abi.encodeCall(
                StateProofFacet.verifyMilestones, (forkId, milestoneProofs, milestoneSnapshots, thresholdStateSnapshot)
            )
        );
        return abi.decode(result, (bool));
    }

    function isMilestoneFinal(
        bytes32 forkId,
        SnapshotData memory thresholdSnapshotData,
        MilestoneProof memory milestone
    ) public override(StateChannelManagerInterface) returns (bool isFinal, bytes32 finalizedSnapshotHash) {
        bytes memory result = _delegatecall(
            stateProofFacetAddress,
            abi.encodeCall(StateProofFacet.isMilestoneFinal, (forkId, thresholdSnapshotData, milestone))
        );
        return abi.decode(result, (bool, bytes32));
    }

    function isGenesisSnapshotWithoutTimeCheck(StateSnapshot memory snapshot)
        public
        view
        override(StateChannelManagerInterface)
        returns (bool)
    {
        return UtilityFacet(utilityFacetAddress).isGenesisSnapshotWithoutTimeCheck(snapshot);
    }

    function isSnapshotNewer(StateSnapshot memory newSnapshot, StateSnapshot memory currentSnapshot)
        public
        view
        override(StateChannelManagerInterface)
        returns (bool)
    {
        return UtilityFacet(utilityFacetAddress).isSnapshotNewer(newSnapshot, currentSnapshot);
    }

    function isChannelOpen(bytes32 channelId) public view override returns (bool, StateSnapshot memory) {
        StateSnapshot memory snapshot = stateSnapshots[channelId];
        bool isOpen = snapshot.snapshotData.participants.length > 0;
        return (isOpen, snapshot);
    }

    function isForkDisputed(bytes32 channelId, bytes32 forkId) public view override returns (bool) {
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[forkId];
        return disputeWindow.evidence.creationTimestamp != 0;
    }

    function multicall(bytes[] calldata calls) external override returns (bytes[] memory results) {
        results = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(calls[i]);
            if (!success) {
                // Bubble up the revert reason
                assembly ("memory-safe") {
                    revert(add(result, 32), mload(result))
                }
            }
            results[i] = result;
        }
    }

    function getWindowCommitments(bytes32 channelId, bytes32 forkId)
        public
        view
        returns (bytes32[] memory disputeCommitments)
    {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[forkId];
        return disputeWindow.evidence.disputeCommitments;
    }

    function getDisputeWindowCreationTimestamp(bytes32 channelId, bytes32 forkId)
        public
        view
        returns (uint256 creationTimestamp)
    {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[forkId];
        return disputeWindow.evidence.creationTimestamp;
    }

    function getReducedResult(bytes32 channelId, bytes32 forkId)
        public
        view
        returns (bytes32 reducedForkId, uint256 timestamp, address reducer)
    {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[forkId];
        DisputeWindowReducedResult storage reducedResult = disputeWindow.reducedResult;
        return (reducedResult.forkId, reducedResult.timestamp, reducedResult.reducer);
    }

    function reduce(Dispute[] memory disputes) public override returns (ReduceOutput memory reducedOutput) {
        bytes memory result =
            _delegatecall(disputeVerificationFacetAddress, abi.encodeCall(DisputeVerificationFacet.reduce, (disputes)));
        return abi.decode(result, (ReduceOutput));
    }

    function reduceOutputToSnapshotData(
        bytes32 forkId,
        ReduceOutput memory reducedOutput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory encodedStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public override returns (SnapshotData memory, bytes memory, MessageBlock memory) {
        bytes memory result = _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(
                DisputeVerificationFacet.reduceOutputToSnapshotData,
                (forkId, reducedOutput, latestStateSnapshot, encodedStateMachineState, inboundMessageBlocks)
            )
        );
        return abi.decode(result, (SnapshotData, bytes, MessageBlock));
    }

    // not used

    // function commitToReducedResult(bytes32 channelId, bytes32 disputedForkId, bytes32 reducedForkId) public {
    //     _delegatecall(
    //         disputeManagerFacetAddress,
    //         abi.encodeCall(DisputeManagerFacet.commitToReducedResult, (channelId, disputedForkId, reducedForkId))
    //     );
    // }

    function reduceAndFinalize(
        Dispute[] memory disputes,
        StateSnapshot memory stateSnapshot,
        bytes memory encodedStateMachineState,
        MessageBlock[] memory inboundMessageBlocks,
        bytes32 expectedReducedForkId
    ) public override {
        _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(
                DisputeVerificationFacet.reduceAndFinalize,
                (disputes, stateSnapshot, encodedStateMachineState, inboundMessageBlocks, expectedReducedForkId)
            )
        );
    }

    // ********** private/internal functions **********

    function isKillPeriodExpired(bytes32 channelId, bytes32 forkId)
        public
        view
        returns (bool isExpired, uint256 killPeriodEnd, uint256 blockTimestamp)
    {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[forkId];
        (isExpired, killPeriodEnd) = _isKillPeriodExpired(disputeWindow, getEvidenceTime());
        return (isExpired, killPeriodEnd, block.timestamp);
    }

    function isReduceChallengePeriodExpired(bytes32 channelId, bytes32 forkId) public view returns (bool) {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[forkId];
        return _isReduceChallengePeriodExpired(disputeWindow, getEvidenceTime());
    }

    function getDisputeWindows(bytes32 channelId, bytes32[] memory forkIds)
        public
        view
        returns (DisputeWindow[] memory)
    {
        DisputeWindow[] memory disputeWindows = new DisputeWindow[](forkIds.length);
        DisputeData storage disputeData = disputeData[channelId];
        for (uint256 i = 0; i < forkIds.length; i++) {
            disputeWindows[i] = disputeData.disputeWindowMap[forkIds[i]];
        }
        return disputeWindows;
    }

    function verifyOutboundMessageBlocks(
        MessageBlock[] memory outboundMessageBlocks,
        SnapshotData memory lowerSnapshot,
        SnapshotData memory upperSnapshot
    ) public view returns (bool) {
        return _verifyOutboundMessageBlocks(outboundMessageBlocks, lowerSnapshot, upperSnapshot);
    }

    function pruneOutboundMessageBlocks(MessageBlock[] memory outboundMessageBlocks, bytes32 lowerHash)
        public
        pure
        returns (MessageBlock[] memory)
    {
        return _pruneOutboundMessageBlocks(outboundMessageBlocks, lowerHash);
    }

    // Data provided from the latestStateSnapshot
    function verifyBalanceInvariantCheckSnapshot(
        bytes32 channelId,
        SnapshotData memory snapshotData,
        bytes memory encodedStateMachineState
    ) public returns (bool) {
        // Encode the function selector and arguments
        bytes memory data = abi.encodeCall(
            DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot,
            (channelId, snapshotData, encodedStateMachineState)
        );
        // Perform the low-level call with a gas limit
        (bool success, bytes memory returnData) = disputeVerificationFacetAddress.delegatecall(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        return abi.decode(returnData, (bool));
    }
}
