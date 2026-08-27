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

/// @dev The proxy implements only the functions that need its own storage and
/// composition (channel opening, calldata posting, the deposit/withdraw
/// composables, multicall). Everything else is routed to a facet by selector in
/// `_facetForSelector` and delegatecalled from the fallback, so the proxy pays a
/// selector comparison instead of a typed forwarder body. The full external
/// surface is declared on `StateChannelManagerInterface` for callers to bind.
contract StateChannelManagerProxy is StateChannelCommon {
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
        bytes memory result = _delegatecall(_facetForSelector(msg.sig), msg.data);
        assembly ("memory-safe") {
            return(add(result, 0x20), mload(result))
        }
    }

    // ********** public/external functions **********

    /// @notice Facet a call with `sig` is delegated to by the fallback.
    /// @dev Selectors the proxy declares itself never reach the fallback, so they
    ///     are not part of the routing table. Unknown selectors resolve to the
    ///     consumer facet, which is the fallback of last resort.
    function facetAddressForSelector(bytes4 sig) public view returns (address) {
        return _facetForSelector(sig);
    }

    /**
     * Posting calldata is lightweight, since it persists a single hash/commitment.
     *     It's enough to check just the maxTimestamp safety guard that protects against race conditions, since everything else is committed in the block.
     *     We also don't allow overwriting the blockCalldataCommitment if it already exists.
     *     We don't even have to check the signature of the signedBlock, since the msg.sender takes the responsibility of providing correct data.
     *     If the msg.sender provides junk(an invalid SignedBlock), a fraud proof can slash the msg.sender, by verifying the junk data against the commitment.
     *     If msg.sender is not part of the channel, other peers will ignore emitted events and commitments. The sender will still pay tx fees on-chain.
     */
    function postBlockCalldata(SignedBlock memory signedBlock, uint256 maxTimestamp) public {
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

    function open(OpenChannelConfirmation calldata openChannelConfirmation) public virtual {
        OpenChannel memory openChannelData = abi.decode(openChannelConfirmation.encodedOpenChannel, (OpenChannel));
        require(openChannelData.channelId != bytes32(0), ErrorInvalidJoinChannel());
        (bool isOpen,) = _isChannelOpen(openChannelData.channelId);
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
        filteredJoinChannels = _shrinkJoinChannelArray(filteredJoinChannels, successfulJoinCount);

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
    function withdrawAssetsComposable(ExitChannel memory exitChannel) public virtual onlySelf returns (bool) {
        bytes memory result =
            _delegatecall(consumerFacetAddress, abi.encodeCall(AConsumerFacet.withdraw, (exitChannel)));
        return abi.decode(result, (bool));
    }

    function executeStateTransition(bytes32 channelId, bytes memory encodedState, Transaction memory _tx)
        public
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

    function multicall(bytes[] calldata calls) external returns (bytes[] memory results) {
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

    // ********** private/internal functions **********

    /// @dev Selector routing table. Selectors are derived by the compiler from the
    ///     facet function types, so a signature change updates the routing with it -
    ///     nothing here is hand-hashed. The state-changing facets come first so
    ///     on-chain calls pay the fewest comparisons; the utility views are read
    ///     off-chain. Unknown selectors keep the historical behaviour of falling
    ///     through to the consumer facet.
    function _facetForSelector(bytes4 sig) internal view returns (address) {
        if (
            sig == DisputeManagerFacet.uploadDispute.selector
                || sig == DisputeManagerFacet.uploadDisputeWithCalldata.selector
        ) return disputeManagerFacetAddress;

        if (
            sig == DisputeVerificationFacet.challengeDisputeReduction.selector
                || sig == DisputeVerificationFacet.reduce.selector
                || sig == DisputeVerificationFacet.reduceOutputToSnapshotData.selector
                || sig == DisputeVerificationFacet.reduceAndFinalize.selector
                || sig == DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot.selector
        ) return disputeVerificationFacetAddress;

        if (
            sig == FraudProofFacet.applyFraudProofs.selector
                || sig == FraudProofFacet.hasInvalidTimestamp.selector
        ) return fraudProofFacetAddress;

        if (
            sig == DisputeFraudProofFacet.applyDisputeFraudProofs.selector
                || sig == DisputeFraudProofFacet.validateTimeoutCalldataPostedProof.selector
                || sig == DisputeFraudProofFacet.isLastMilestoneFinalByEveryone.selector
                || sig == DisputeFraudProofFacet.hasStateProofHeaderMismatch.selector
                || sig == DisputeFraudProofFacet.isDisputeInboundHashValid.selector
        ) return disputeFraudProofFacetAddress;

        if (
            sig == StateSnapshotFacet.updateStateSnapshotFork.selector
                || sig == StateSnapshotFacet.updateStateSnapshotSameFork.selector
        ) return stateSnapshotFacetAddress;

        if (
            sig == JoinChannelFacet.joinChannel.selector || sig == JoinChannelFacet.topUpBalance.selector
        ) return joinChannelFacetAddress;

        if (
            sig == StateProofFacet.verifyStateProof.selector || sig == StateProofFacet.isCorrectLatestState.selector
                || sig == StateProofFacet.areSignedBlocksLinkedAndVerified.selector
                || sig == StateProofFacet.isInvalidBlockStructureInStateProof.selector
                || sig == StateProofFacet.findFirstInvalidBlockStructureInStateProof.selector
                || sig == StateProofFacet.verifyMilestones.selector || sig == StateProofFacet.isMilestoneFinal.selector
        ) return stateProofFacetAddress;

        if (
            sig == UtilityFacet.getParticipants.selector || sig == UtilityFacet.getSnapshotParticipants.selector
                || sig == UtilityFacet.getPendingParticipants.selector
                || sig == UtilityFacet.getOnChainSlashedParticipants.selector
                || sig == UtilityFacet.getOnChainSlashedParticipantsUpToTimestamp.selector
                || sig == UtilityFacet.isParticipantSlashedOnChain.selector
                || sig == UtilityFacet.getOnChainThresholdSet.selector
                || sig == UtilityFacet.canParticipateInDisputes.selector || sig == UtilityFacet.getStateSnapshot.selector
                || sig == UtilityFacet.getChannelBalance.selector || sig == UtilityFacet.isChannelOpen.selector
                || sig == UtilityFacet.isForkDisputed.selector || sig == UtilityFacet.getP2pTime.selector
                || sig == UtilityFacet.getAgreementTime.selector || sig == UtilityFacet.getChainFallbackTime.selector
                || sig == UtilityFacet.getEvidenceTime.selector || sig == UtilityFacet.getGasLimit.selector
                || sig == UtilityFacet.getAllTimes.selector || sig == UtilityFacet.getBlockCallDataCommitment.selector
                || sig == UtilityFacet.hasInboundMessageBlock.selector || sig == UtilityFacet.isBlockAuthentic.selector
                || sig == UtilityFacet.getWindowCommitments.selector
                || sig == UtilityFacet.getDisputeWindowCreationTimestamp.selector
                || sig == UtilityFacet.getReducedResult.selector || sig == UtilityFacet.isKillPeriodExpired.selector
                || sig == UtilityFacet.isReduceChallengePeriodExpired.selector
                || sig == UtilityFacet.getDisputeWindows.selector
                || sig == UtilityFacet.verifyOutboundMessageBlocks.selector
                || sig == UtilityFacet.pruneOutboundMessageBlocks.selector
                || sig == UtilityFacet.isGenesisSnapshotWithoutTimeCheck.selector
                || sig == UtilityFacet.isSnapshotNewer.selector
        ) return utilityFacetAddress;

        return consumerFacetAddress;
    }
}
