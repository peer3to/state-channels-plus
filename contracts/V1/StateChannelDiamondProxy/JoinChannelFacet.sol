pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";

contract JoinChannelFacet is StateChannelCommon {
    /**
     * @notice Joins participants to the channel by submitting a complete join channel request
     *
     * @param channelId The channel identifier
     * @param joinChannelBlock The block containing all join channel requests
     * @param disputeConfirmation Signed dispute struct to create new fork commitment
     * @param confirmationSignatures 2D array where confirmationSignatures[i] contains threshold signatures from existing participants for joinChannels[i]
     */
    function joinChannel(
        bytes32 channelId,
        JoinChannelBlock memory joinChannelBlock,
        DisputeConfirmation memory disputeConfirmation,
        bytes[][] memory confirmationSignatures // per join channel, per participant
    ) external {
        // VERIFICATION PHASE

        // 1. Validate join channel deadlines
        _validateJoinChannelDeadlines(joinChannelBlock);

        // 2. for each join channel, verify that the joining participant has signed the dispute struct
        _verifyJoinChannelSignatures(
            joinChannelBlock, disputeConfirmation.signedDispute.encodedDispute, disputeConfirmation.signatures
        );

        // 3. Verify:
        //    a. threshold signatures from existing participants on each join channel
        //    b. that the block is properly linked

        _verifyJoinChannelBlock(channelId, joinChannelBlock, confirmationSignatures);

        // 4. Verify balance invariants
        _verifyJoinChannelBalanceInvariants(channelId);

        // PROCESSING PHASE - Execute state changes after all verifications pass

        // 5. Process deposits
        _processJoinChannelDeposits(channelId, joinChannelBlock);

        // 6. Update pending participants (must be done before createDispute)
        _updatePendingParticipants(channelId, joinChannelBlock);

        // 7. Create dispute - this handles remaining verification and state updates
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        AStateChannelManagerProxy(address(this)).createDispute(dispute);

        // 8. Emit events
        emit JoinChannelProcessed(channelId, joinChannelBlock, block.timestamp);
    }

    // ############### Verification Functions ###############

    /**
     * @dev Validates that all join channel requests have not expired
     */
    function _validateJoinChannelDeadlines(JoinChannelBlock memory joinChannelBlock) internal view {
        for (uint256 i = 0; i < joinChannelBlock.joinChannels.length; i++) {
            require(joinChannelBlock.joinChannels[i].deadlineTimestamp > block.timestamp, ErrorJoinChannelExpired());
        }
    }

    /**
     * @dev Verifies that each joining participant has signed the dispute struct
     */
    function _verifyJoinChannelSignatures(
        JoinChannelBlock memory joinChannelBlock,
        bytes memory encodedDispute,
        bytes[] memory confirmationSignatures
    ) internal pure {
        // Track which signatures have been used to avoid double-counting
        bool[] memory signatureUsed = new bool[](confirmationSignatures.length);

        // Verify each joining participant has signed the dispute
        for (uint256 i = 0; i < joinChannelBlock.joinChannels.length; i++) {
            address participant = joinChannelBlock.joinChannels[i].participant;

            // Find the signature from this participant by checking all signatures
            bool foundSignature = false;
            for (uint256 j = 0; j < confirmationSignatures.length; j++) {
                // Skip signatures that have already been matched
                if (signatureUsed[j]) {
                    continue;
                }

                // Check if this signature is from the joining participant
                address recoveredSigner =
                    StateChannelUtilLibrary.retriveSignerAddress(encodedDispute, confirmationSignatures[j]);

                if (recoveredSigner == participant) {
                    // Mark this signature as used
                    signatureUsed[j] = true;
                    foundSignature = true;
                    break;
                }
            }

            require(foundSignature, ErrorSignatureInvalid());
        }
    }

    /**
     * @dev Verifies the JoinChannelBlock is valid by checking:
     * 1. The block is properly linked to the previous join channel block
     * 2. Each join channel has valid threshold signatures from all current participants
     * This ensures all existing participants agree to expand the channel and the block chain is intact
     *
     */
    function _verifyJoinChannelBlock(
        bytes32 channelId,
        JoinChannelBlock memory joinChannelBlock,
        bytes[][] memory confirmationSignatures
    ) internal view {
        address[] memory participants = getSnapshotParticipants(channelId);

        // Verify join channel block is properly linked
        StateSnapshot memory currentSnapshot = stateSnapshots[channelId];
        require(
            joinChannelBlock.previousBlockHash == currentSnapshot.latestJoinChannelBlockHash,
            ErrorLinkingPreviousBlock()
        );

        // Verify each join channel has threshold signatures from existing participants
        for (uint256 i = 0; i < joinChannelBlock.joinChannels.length; i++) {
            bytes memory encodedJoinChannel = abi.encode(joinChannelBlock.joinChannels[i]);

            // Verify threshold signatures from existing participants on this join channel request
            (bool isValid,) = StateChannelUtilLibrary.verifyThresholdSigned(
                participants, encodedJoinChannel, confirmationSignatures[i]
            );
            require(isValid, ErrorSignatureInvalid());
        }
    }

    /**
     * @dev Verifies balance invariants for join channel operations
     */
    function _verifyJoinChannelBalanceInvariants(bytes32 channelId) internal view {
        // Get current on-chain balance (deposits - withdrawals)
        Balance memory currentOnChainDeposits = totalOnChainProcessedDeposits[channelId];
        Balance memory currentOnChainWithdrawals = totalOnChainProcessedWithdrawals[channelId];

        // Get current state machine total balance
        Balance memory currentStateBalance = stateMachineImplementation.getTotalStateBalance();

        // Calculate expected balance (deposits - withdrawals)
        Balance memory expectedBalance =
            stateMachineImplementation.subtractBalance(currentOnChainDeposits, currentOnChainWithdrawals);

        // Verify balance invariant: state machine balance should equal on-chain balance
        require(
            stateMachineImplementation.areBalancesEqual(currentStateBalance, expectedBalance),
            ErrorJoinChannelBalanceInvariantFailed()
        );
    }

    // ############### Processing Functions ###############

    /**
     * @dev Processes all deposits in the join channel block
     */
    function _processJoinChannelDeposits(bytes32 channelId, JoinChannelBlock memory joinChannelBlock) internal {
        // Process each join channel deposit
        for (uint256 i = 0; i < joinChannelBlock.joinChannels.length; i++) {
            JoinChannel memory currentJoinChannel = joinChannelBlock.joinChannels[i];

            bool success = AStateChannelManagerProxy(address(this)).addParticipantComposable(currentJoinChannel);
            require(success, ErrorJoinChannelFailed());

            // Update on-chain total deposits
            totalOnChainProcessedDeposits[channelId] = stateMachineImplementation.addBalance(
                totalOnChainProcessedDeposits[channelId], currentJoinChannel.balance
            );
        }
    }

    /**
     * @dev Updates pending participants list with new joining participants
     * This must be done before createDispute so the dispute creation can validate signatures
     */
    function _updatePendingParticipants(bytes32 channelId, JoinChannelBlock memory joinChannelBlock) internal {
        for (uint256 i = 0; i < joinChannelBlock.joinChannels.length; i++) {
            disputeData[channelId].pendingParticipants.push(joinChannelBlock.joinChannels[i].participant);
        }
    }

    // ############### Events ###############

    event JoinChannelProcessed(bytes32 indexed channelId, JoinChannelBlock joinChannelBlock, uint256 timestamp);
}
