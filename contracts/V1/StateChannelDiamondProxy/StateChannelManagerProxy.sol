pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "../StateChannelManagerInterface.sol";
import "./StateChannelUtilLibrary.sol";
import "./AConsumerFacet.sol";

import "./DisputeManagerFacet.sol";
import "./DisputeVerificationFacet.sol";
import "./FraudProofFacet.sol";
import "./DisputeFraudProofFacet.sol";
import "./StateSnapshotFacet.sol";
import "./JoinChannelFacet.sol";
import "../types/DisputeTypes.sol";

contract StateChannelManagerProxy is StateChannelManagerInterface, StateChannelCommon {
    constructor(
        address _stateMachineImplementation,
        address _disputeManagerFacet,
        address _disputeVerificationFacet,
        address _fraudProofFacet,
        address _disputeFraudProofFacet,
        address _stateSnapshotFacet,
        address _joinChannelFacet,
        address _consumerFacet
    ) {
        stateMachineImplementation = AStateMachine(_stateMachineImplementation);
        disputeManagerFacetAddress = _disputeManagerFacet;
        disputeVerificationFacetAddress = _disputeVerificationFacet;
        fraudProofFacetAddress = _fraudProofFacet;
        disputeFraudProofFacetAddress = _disputeFraudProofFacet;
        stateSnapshotFacetAddress = _stateSnapshotFacet;
        joinChannelFacetAddress = _joinChannelFacet;
        consumerFacetAddress = _consumerFacet;
        p2pTime = 15;
        agreementTime = 5;
        chainFallbackTime = 30;
        evidenceTime = 30;
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

        emit BlockCalldataPosted(
            _block.transaction.header.channelId, commitment, msg.sender, signedBlock, block.timestamp
        );
    }

    // ********** Consumer Facet Delegation Functions **********

    // function openChannel(OpenChannelConfirmation calldata openChannelConfirmation)
    //     public
    //     virtual
    //     override
    // {
    //     // OpenChannel memory openChannelData = abi.decode(openChannelConfirmation.encodedOpenChannel, (OpenChannel));
    //     // require(!isChannelOpen(openChannelData.channelId), ErrorChannelAlreadyOpen());

    //     // // set zero balance for on-chain deposits/withdrawals
    //     // Balance memory zeroBalance = stateMachineImplementation.getZeroBalance();
    //     // {
    //     // ChannelBalance storage channelBalance = channelBalances[openChannelData.channelId];
    //     // channelBalance.onChainJoinChannelMap[channelBalance.latestJoinChannelBlockHash].totalDeposits = zeroBalance;
    //     // channelBalance.totalOnChainWithdrawals = zeroBalance;
    //     // }
    //     // // verify threshold signature - must be from all participants - this is deterministic - no race condition on-chain
    //     // (bool isValid, string memory reason ) = StateChannelUtilLibrary.verifyThresholdSigned(
    //     //     openChannelData.participants, openChannelConfirmation.encodedOpenChannel, openChannelConfirmation.signatures
    //     // );
    //     // require(isValid, reason);

    //     // JoinChannel[] memory joinChannels = new JoinChannel[](openChannelData.participants.length);
    //     // for(uint256 i = 0; i < openChannelData.participants.length; i++) {
    //     //     joinChannels[i] = JoinChannel({
    //     //         channelId: openChannelData.channelId,
    //     //         participant: openChannelData.participants[i],
    //     //         deadlineTimestamp: openChannelData.deadlineTimestamp,
    //     //         balance: openChannelData.balances[i]
    //     //     });
    //     // }

    //     // (JoinChannelBlock memory jcb, Balance memory newTotalDeposits) = depositAssetsComposable(joinChannels, openChannelData.isAtomic);

    //     // require(jcb.joinChannels.length >= 2, ErrorAtLeastTwoParticipantsRequired());
    //     // (bytes memory genesisState, address[] memory participants) = AConsumerFacet(consumerFacetAddress).openChannelGenesis(jcb.joinChannels, openChannelData.data);

    //     // SnapshotData memory genesisSnapshotData = SnapshotData({
    //     //     originForkId: bytes32(0),
    //     //     stateMachineStateHash: keccak256(genesisState),
    //     //     participants: participants,
    //     //     latestJoinChannelBlockHash: keccak256(abi.encode(jcb)),
    //     //     latestExitChannelBlockHash: bytes32(0),
    //     //     totalDeposits: newTotalDeposits,
    //     //     totalWithdrawals: zeroBalance
    //     // });

    //     // bytes32 forkId = keccak256(abi.encode(genesisSnapshotData));
    //     // StateSnapshot memory genesisStateSnapshot = StateSnapshot({
    //     //     snapshotData: genesisSnapshotData,
    //     //     forkId: forkId,
    //     //     blockHeight: 0,
    //     //     timestamp: block.timestamp
    //     // });

    //     // stateSnapshots[openChannelData.channelId]= genesisStateSnapshot;

    //     // emit ChannelOpened(openChannelData.channelId, genesisStateSnapshot, genesisState);
    // }

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
        JoinChannelBlock[] memory joinChannelBlocks
    ) public override {
        _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(
                DisputeVerificationFacet.challengeDisputeReduction,
                (disputes, latestStateSnapshot, encodedStateMachineState, joinChannelBlocks)
            )
        );
    }

    function applyDisputeFraudProofs(DisputeFraudProof[] memory proofs) public override {
        _delegatecall(
            disputeVerificationFacetAddress, abi.encodeCall(DisputeVerificationFacet.applyDisputeFraudProofs, (proofs))
        );
    }

    function updateStateSnapshotFork(
        bytes32 channelId,
        StateSnapshot memory newStateSnapshot,
        ExitChannelBlock[] memory exitChannelBlocks
    ) public override {
        _delegatecall(
            stateSnapshotFacetAddress,
            abi.encodeCall(StateSnapshotFacet.updateStateSnapshotFork, (channelId, newStateSnapshot, exitChannelBlocks))
        );
    }

    function updateStateSnapshotSameFork(
        bytes32 channelId,
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        ExitChannelBlock[] memory exitChannelBlocks
    ) public override {
        _delegatecall(
            stateSnapshotFacetAddress,
            abi.encodeCall(
                StateSnapshotFacet.updateStateSnapshotSameFork,
                (channelId, milestoneProofs, milestoneSnapshots, exitChannelBlocks)
            )
        );
    }

    function joinChannel(JoinChannelConfirmation memory joinChannelConfirmations) public override {
        _delegatecall(joinChannelFacetAddress, abi.encodeCall(JoinChannelFacet.joinChannel, (joinChannelConfirmations)));
    }

    // ********** public/external DIAMOND functions **********

    /// @dev Callable only by diamond facets - performs the deposit of the specific assets by interpreting `joinChannel` - returns bool success
    // function depositAssetsComposable(JoinChannel[] memory joinChannels, bool isAtomic) public virtual onlySelf returns (JoinChannelBlock memory jcb, Balance memory newTotalDeposits) {
    // require(joinChannels.length > 0, ErrorNoJoinChannelProvided());
    // bytes32 channelId = joinChannels[0].channelId;

    // JoinChannel[] memory filteredJoinChannels = new JoinChannel[](joinChannels.length);
    // uint256 successfulJoins = 0;
    // for(uint i = 1; i < joinChannels.length; i++) {
    //     bool success = AConsumerFacet(consumerFacetAddress).deposit(joinChannels[i]);
    //     if (!success && isAtomic) revert ErrorJoinChannelAtomicFailure();
    //     if (success) {
    //         filteredJoinChannels[successfulJoins++] = joinChannels[i];
    //     }
    // }
    // require(successfulJoins > 0, ErrorNoSuccessfulJoinChannel());
    // // Resize the array to the number of successful joins - only ok for shrinking the array
    // // TODO - find other places in the code that shrink MEMORY arrays and do the same - better than to allocate more space
    // assembly { mstore(filteredJoinChannels, successfulJoins) }

    // // Create JoinChannelBlock
    // jcb = _createJoinChannelBlock(filteredJoinChannels);
    // bytes32 blockHash = keccak256(abi.encode(jcb));

    // // Update on-chain balance
    // ChannelBalance storage channelBalance = channelBalances[channelId];
    // // Get previous total deposits
    // newTotalDeposits =
    //     channelBalance.onChainJoinChannelMap[channelBalance.latestJoinChannelBlockHash].totalDeposits;
    // // Calculate new totalDeposits
    // for(uint i = 0; i < filteredJoinChannels.length; i++) {
    //     newTotalDeposits = stateMachineImplementation.addBalance(newTotalDeposits, filteredJoinChannels[i].balance);
    // }

    // // Persist the onChainJoinChannel in the map
    // channelBalance.onChainJoinChannelMap[blockHash] = OnChainJoinChannel({
    //     previousJoinChannelBlockHash: channelBalance.latestJoinChannelBlockHash,
    //     timestamp: block.timestamp,
    //     totalDeposits: newTotalDeposits
    // });
    // // Update the latestJoinChannelBlockHash;
    // channelBalance.latestJoinChannelBlockHash = blockHash;

    // return (jcb, newTotalDeposits);
    // }

    /// @dev Callable only by diamond facets - performs the withdrawal of the specific assets by interpreting `exitChannel` - returns bool success
    function withdrawAssetsComposable(ExitChannel memory exitChannel) public virtual onlySelf returns (bool) {
        return AConsumerFacet(consumerFacetAddress).withdraw(exitChannel);
    }

    function executeStateTransition(bytes32 channelId, bytes memory encodedState, Transaction memory _tx)
        public
        override
        returns (bool, bytes memory encodedModifiedState)
    {
        //channelId not used currently since all channels have the same SM - later they can be mapped to different ones
        stateMachineImplementation.setState(encodedState);
        (bool success,) =
            address(stateMachineImplementation).call(abi.encodeCall(stateMachineImplementation.stateTransition, _tx));
        return (success, stateMachineImplementation.getState());
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

    function verifyDisputeFraudProofs(DisputeFraudProof[] memory disputeFraudProofs)
        public
        returns (bytes memory maliciousDisputesEncoded)
    {
        bytes memory result = _delegatecall(
            disputeFraudProofFacetAddress,
            abi.encodeCall(DisputeFraudProofFacet.verifyDisputeFraudProofs, (disputeFraudProofs))
        );
        return result;
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

    function isChannelOpen(bytes32 channelId)
        public
        view
        override(StateChannelCommon, StateChannelManagerInterface)
        returns (bool)
    {
        return StateChannelCommon.isChannelOpen(channelId);
    }

    function isForkDisputed(bytes32 channelId, bytes32 forkId) public view override returns (bool) {
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[forkId];
        return disputeWindow.evidence.creationTimestamp != 0;
    }

    function verifyMilestones(
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        SnapshotData memory genesisSnapshotData
    ) public view returns (bool isValid, bytes memory lastBlockEncoded) {
        return DisputeVerificationFacet(disputeVerificationFacetAddress).verifyMilestones(
            milestoneProofs, milestoneSnapshots, genesisSnapshotData
        );
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
        JoinChannelBlock[] memory joinChannelBlocks
    ) public override returns (SnapshotData memory, bytes memory, ExitChannelBlock memory) {
        bytes memory result = _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(
                DisputeVerificationFacet.reduceOutputToSnapshotData,
                (forkId, reducedOutput, latestStateSnapshot, encodedStateMachineState, joinChannelBlocks)
            )
        );
        return abi.decode(result, (SnapshotData, bytes, ExitChannelBlock));
    }

    function commitToReducedResult(bytes32 channelId, bytes32 disputedForkId, bytes32 reducedForkId) public {
        _delegatecall(
            disputeManagerFacetAddress,
            abi.encodeCall(DisputeManagerFacet.commitToReducedResult, (channelId, disputedForkId, reducedForkId))
        );
    }

    function reduceAndFinalize(
        Dispute[] memory disputes,
        StateSnapshot memory stateSnapshot,
        bytes memory encodedStateMachineState,
        JoinChannelBlock[] memory joinChannelBlocks
    ) public override {
        _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(
                DisputeVerificationFacet.reduceAndFinalize,
                (disputes, stateSnapshot, encodedStateMachineState, joinChannelBlocks)
            )
        );
    }

    // ********** private/internal functions **********

    function isKillPeriodExpired(bytes32 channelId, bytes32 forkId) public view returns (bool, uint256) {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[forkId];
        return _isKillPeriodExpired(disputeWindow, getEvidenceTime());
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

    function verifyExitChannelBlocks(
        ExitChannelBlock[] memory exitChannelBlocks,
        SnapshotData memory fromSnapshot,
        SnapshotData memory toSnapshot
    ) public view returns (bool) {
        return _verifyExitChannelBlocks(exitChannelBlocks, fromSnapshot, toSnapshot);
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
            assembly {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        return abi.decode(returnData, (bool));
    }

    // function _createJoinChannelBlock(JoinChannel[] memory jcs) internal view returns (JoinChannelBlock memory) {
    //     // require(jcs.length > 0, ErrorNoJoinChannelProvided());
    //     // bytes32 channelId = jcs[0].channelId;
    //     // ChannelBalance storage channelBalance = channelBalances[channelId];
    //     // bytes32 latestBlockHash = channelBalance.latestJoinChannelBlockHash;
    //     // bytes32 previousBlockHash = channelBalance.onChainJoinChannelMap[latestBlockHash].previousJoinChannelBlockHash;
    //     // JoinChannelBlock memory joinChannelBlock =
    //     //     JoinChannelBlock({previousBlockHash: previousBlockHash, joinChannels: jcs});
    //     // return joinChannelBlock;
    // }
}
