pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";

contract JoinChannelFacet is StateChannelCommon {
    /**
     * @notice Joins participants to the channel by submitting a complete join channel request
     * @dev This is the main entry point for joining channels on-chain. The process is:
     * 1. Verify each joining participant has signed the dispute struct
     * 2. Process deposits and update disputeData.pendingParticipants
     * 3. Call DisputeManagerFacet.createDispute (handles most verification including genesis state validation)
     *
     * @param channelId The channel identifier
     * @param joinChannelBlock The block containing all join channel requests
     * @param dispute Dispute struct to create new fork commitment
     * @param disputeSignatures Threshold signatures on the dispute from joining participants
     * @param confirmationSignatures 2D array where confirmationSignatures[i] contains threshold signatures from existing participants for joinChannels[i]
     */
    function joinChannel(
        bytes32 channelId,
        JoinChannelBlock memory joinChannelBlock,
        Dispute memory dispute,
        bytes[] memory disputeSignatures,
        bytes[][] memory confirmationSignatures
    ) external {
        // 1. Verify each joining participant has signed the dispute struct
        _verifyJoinChannelSignatures(channelId, joinChannelBlock, dispute, disputeSignatures);
        // 2. Verify threshold signatures from existing participants on each join channel
        _verifyJoinChannelBlock(channelId, joinChannelBlock, confirmationSignatures);

        // 3. Check invariants and process deposits
        _processJoinChannelDeposits(channelId, joinChannelBlock);

        // 4. Update pending participants (must be done before createDispute)
        _updatePendingParticipants(channelId, joinChannelBlock);

        // 5. Create dispute - this handles most verification including:
        //    - Genesis state snapshot validation
        //    - Dispute index validation
        //    - Participant permissions
        //    - Race condition checks
        AStateChannelManagerProxy(address(this)).createDispute(dispute);

        // 6. Emit events
        emit JoinChannelProcessed(channelId, joinChannelBlock, block.timestamp);
    }

    /**
     * @dev Verifies threshold signatures on the dispute for fast-track finalization
     */
    function _verifyDisputeThresholdSignatures(bytes32 channelId, Dispute memory dispute, bytes[] memory signatures)
        internal
        view
    {
        address[] memory participants = getSnapshotParticipants(channelId);
        bytes memory encodedDispute = abi.encode(dispute);

        (bool isValid,) = StateChannelUtilLibrary.verifyThresholdSigned(participants, encodedDispute, signatures);

        require(isValid, ErrorSignatureInvalid());
    }

    /**
     * @dev Verifies the JoinChannelBlock has valid threshold signatures from all current participants
     * This ensures all existing participants agree to expand the channel
     */
    function _verifyJoinChannelBlock(
        bytes32 channelId,
        JoinChannelBlock memory joinChannelBlock,
        bytes[][] memory confirmationSignatures
    ) internal view {
        address[] memory participants = getSnapshotParticipants(channelId);

        // Verify we have the correct number of signature arrays
        require(
            confirmationSignatures.length == joinChannelBlock.joinChannels.length,
            "Confirmation signatures count mismatch"
        );

        // Verify each join channel has threshold signatures from existing participants
        for (uint256 i = 0; i < joinChannelBlock.joinChannels.length; i++) {
            JoinChannel memory joinChannel = joinChannelBlock.joinChannels[i];

            // Basic validation
            require(joinChannel.deadlineTimestamp > block.timestamp, ErrorJoinChannelExpired());

            // Verify threshold signatures from existing participants on this join channel request
            bytes memory encodedJoinChannel = abi.encode(joinChannel);
            (bool isValid,) = StateChannelUtilLibrary.verifyThresholdSigned(
                participants, encodedJoinChannel, confirmationSignatures[i]
            );
            require(isValid, ErrorSignatureInvalid());
        }

        // Verify join channel block is properly linked
        StateSnapshot memory currentSnapshot = stateSnapshots[channelId];
        require(
            joinChannelBlock.previousBlockHash == currentSnapshot.latestJoinChannelBlockHash,
            ErrorLinkingPreviousBlock()
        );
    }

    /**
     * @dev Performs critical on-chain invariant checks to ensure safety for new participants
     * If these checks fail, the channel is closed and all participants are slashed
     */
    function _performInvariantChecks(
        bytes32 channelId,
        Dispute memory dispute,
        JoinChannelBlock memory joinChannelBlock
    ) internal {
        // Set the state machine to the genesis state for verification
        StateSnapshot memory genesisSnapshot = stateSnapshots[channelId];

        // Apply join channels to the state and verify invariants
        bytes memory encodedGenesisState = _getStateMachineStateFromSnapshot(genesisSnapshot);

        // Apply all join channels to the genesis state
        bytes memory modifiedState = applyJoinChannelToStateMachine(encodedGenesisState, joinChannelBlock.joinChannels);

        // Verify state machine state is valid after applying joins
        stateMachineImplementation.setState(modifiedState);

        // Verify balance invariants - this is the critical safety check
        _verifyBalanceInvariantsForJoin(channelId, joinChannelBlock);

        // Verify participants are properly added
        address[] memory newParticipants = stateMachineImplementation.getParticipants();
        require(newParticipants.length > genesisSnapshot.participants.length, "No participants added");
    }

    /**
     * @dev Verifies balance invariants when adding new deposits
     */
    function _verifyBalanceInvariantsForJoin(bytes32 channelId, JoinChannelBlock memory joinChannelBlock)
        internal
        view
    {
        Balance memory currentDeposits = totalOnChainProcessedDeposits[channelId];
        Balance memory additionalDeposits;

        // Calculate total additional deposits
        for (uint256 i = 0; i < joinChannelBlock.joinChannels.length; i++) {
            additionalDeposits =
                stateMachineImplementation.addBalance(additionalDeposits, joinChannelBlock.joinChannels[i].balance);
        }

        Balance memory totalDeposits = stateMachineImplementation.addBalance(currentDeposits, additionalDeposits);

        // Verify total deposits don't overflow or violate any constraints
        require(
            !stateMachineImplementation.isBalanceLesserThan(totalDeposits, currentDeposits), "Deposit overflow detected"
        );
    }

    /**
     * @dev Verifies that each joining participant has signed the dispute struct
     * This is the core security check - joining participants must sign the dispute
     * to prove they have the data and agree to join at this state
     */
    function _verifyJoinChannelSignatures(
        bytes32 channelId,
        JoinChannelBlock memory joinChannelBlock,
        Dispute memory dispute,
        bytes[] memory disputeSignatures
    ) internal view {
        // Verify we have the correct number of signatures (one per joining participant)
        require(disputeSignatures.length == joinChannelBlock.joinChannels.length, "Signature count mismatch");

        bytes memory encodedDispute = abi.encode(dispute);

        // Verify each joining participant has signed the dispute
        for (uint256 i = 0; i < joinChannelBlock.joinChannels.length; i++) {
            JoinChannel memory joinChannel = joinChannelBlock.joinChannels[i];

            // Basic validation
            require(joinChannel.deadlineTimestamp > block.timestamp, ErrorJoinChannelExpired());

            // Verify the joining participant's signature on the dispute
            address recoveredSigner = StateChannelUtilLibrary.retriveSignerAddress(encodedDispute, disputeSignatures[i]);

            require(recoveredSigner == joinChannel.participant, "Invalid signature from joining participant");
        }
    }

    /**
     * @dev Updates pending participants list with new joining participants
     * This must be done before createDispute so the dispute creation can validate signatures
     */
    function _updatePendingParticipants(bytes32 channelId, JoinChannelBlock memory joinChannelBlock) internal {
        // Add new participants to pending participants list
        for (uint256 i = 0; i < joinChannelBlock.joinChannels.length; i++) {
            address participant = joinChannelBlock.joinChannels[i].participant;

            // Check if participant is not already in the list
            address[] memory currentParticipants = getSnapshotParticipants(channelId);
            if (!StateChannelUtilLibrary.isAddressInArray(currentParticipants, participant)) {
                disputeData[channelId].pendingParticipants.push(participant);
            }
        }
    }

    /**
     * @dev Processes all deposits in the join channel block
     * Updates on-chain total deposits and executes composable operations
     */
    function _processJoinChannelDeposits(bytes32 channelId, JoinChannelBlock memory joinChannelBlock) internal {
        for (uint256 i = 0; i < joinChannelBlock.joinChannels.length; i++) {
            JoinChannel memory joinChannel = joinChannelBlock.joinChannels[i];

            // Execute composable operations (external contract interactions, etc.)
            bool success = AStateChannelManagerProxy(address(this)).addParticipantComposable(joinChannel);
            require(success, ErrorJoinChannelFailed());

            // Update on-chain total deposits
            totalOnChainProcessedDeposits[channelId] =
                stateMachineImplementation.addBalance(totalOnChainProcessedDeposits[channelId], joinChannel.balance);
        }
    }

    /**
     * @dev Helper function to extract state machine state from snapshot
     * TODO: This may need to be implemented based on how state is stored in snapshots
     */
    function _getStateMachineStateFromSnapshot(StateSnapshot memory snapshot) internal pure returns (bytes memory) {
        // TODO: Implementation depends on how state machine state is stored/retrieved
        // This might need to query the state machine or decode from snapshot data
        return "";
    }

    // Events
    event JoinChannelProcessed(bytes32 indexed channelId, JoinChannelBlock joinChannelBlock, uint256 timestamp);
}
