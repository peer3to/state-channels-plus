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
     * @param joinChannelConfirmations Array of join channel confirmations to process
     * @param disputeAuditBundleConfirmation Signed dispute audit bundle to create new fork commitment
     */
    function joinChannel(
        bytes32 channelId,
        JoinChannelConfirmation[] memory joinChannelConfirmations,
        DisputeAuditBundleConfirmation memory disputeAuditBundleConfirmation
    ) external {
        if (!isSnapshotLatest(channelId)) {
            revert ErrorSnapshotNotLatest();
        }

        // SETUP PHASE
        // make a list of join channels
        JoinChannel[] memory joinChannels = new JoinChannel[](joinChannelConfirmations.length);
        for (uint256 i = 0; i < joinChannelConfirmations.length; i++) {
            joinChannels[i] =
                abi.decode(joinChannelConfirmations[i].signedJoinChannel.encodedJoinChannel, (JoinChannel));
        }
        // make a list of joining participants
        address[] memory joiningParticipants = new address[](joinChannels.length);
        for (uint256 i = 0; i < joinChannels.length; i++) {
            joiningParticipants[i] = joinChannels[i].participant;
        }

        // Create validity tracking arrays
        bool[] memory isValid = new bool[](joinChannelConfirmations.length);
        uint256 validCount = 0;

        // VALIDATION PHASE - Filter out invalid join channels

        // 1. Filter by join channel deadlines
        for (uint256 i = 0; i < joinChannels.length; i++) {
            if (joinChannels[i].deadlineTimestamp > block.timestamp) {
                isValid[i] = true;
                validCount++;
            }
        }

        // 2. Filter by threshold signatures from existing participants
        address[] memory participants = getSnapshotParticipants(channelId);
        for (uint256 i = 0; i < joinChannelConfirmations.length; i++) {
            if (!isValid[i]) continue; // Skip already invalid ones

            bytes memory encodedJoinChannel = joinChannelConfirmations[i].signedJoinChannel.encodedJoinChannel;
            bytes[] memory confirmationSignatures = joinChannelConfirmations[i].signatures;

            (bool isValidSignature,) =
                StateChannelUtilLibrary.verifyThresholdSigned(participants, encodedJoinChannel, confirmationSignatures);

            if (!isValidSignature) {
                isValid[i] = false;
                validCount--;
            }
        }

        // 3. Filter by joining participant signatures on dispute
        for (uint256 i = 0; i < joinChannels.length; i++) {
            if (!isValid[i]) continue; // Skip already invalid ones

            bool hasValidSignature =
                _didJoinerApproveDisputeAuditBundle(joiningParticipants[i], disputeAuditBundleConfirmation);

            if (!hasValidSignature) {
                isValid[i] = false;
                validCount--;
            }
        }

        // Terminate early if no valid join channels
        require(validCount > 0, ErrorNoValidJoinChannels());

        // Create arrays with only valid join channels
        JoinChannel[] memory validJoinChannels = new JoinChannel[](validCount);
        uint256 validIndex = 0;
        for (uint256 i = 0; i < joinChannels.length; i++) {
            if (isValid[i]) {
                validJoinChannels[validIndex] = joinChannels[i];
                validIndex++;
            }
        }

        // Create JoinChannelBlock from successful join channels
        JoinChannelBlock memory joinChannelBlock = JoinChannelBlock({
            previousBlockHash: getOnChainLatestJoinChannelBlockHash(channelId),
            joinChannels: validJoinChannels
        });

        // PROCESSING PHASE - Execute state changes after all verifications pass

        // 5. Process deposits
        _processJoinChannelDeposits(channelId, joinChannelBlock);

        // 6. Update pending participants (must be done before createDispute)
        _updatePendingParticipants(channelId, joinChannelBlock);

        // 7. Create dispute - this handles remaining verification and state updates
        DisputeAuditBundle memory disputeAuditBundle = abi.decode(
            disputeAuditBundleConfirmation.signedDisputeAuditBundle.encodedDisputeAuditBundle, (DisputeAuditBundle)
        );
        AStateChannelManagerProxy(address(this)).createDispute(disputeAuditBundle.dispute);

        // 8. Emit events
        emit JoinChannelProcessed(channelId, joinChannelBlock, block.timestamp);
    }

    // ############### Verification Functions ###############

    /**
     * @dev Checks if a joining participant has a valid signature on the dispute
     */
    function _didJoinerApproveDisputeAuditBundle(
        address joiningParticipant,
        DisputeAuditBundleConfirmation memory disputeAuditBundleConfirmation
    ) internal pure returns (bool) {
        // Find the signature from this participant
        for (uint256 j = 0; j < disputeAuditBundleConfirmation.signatures.length; j++) {
            address recoveredSigner = StateChannelUtilLibrary.retriveSignerAddress(
                disputeAuditBundleConfirmation.signedDisputeAuditBundle.encodedDisputeAuditBundle,
                disputeAuditBundleConfirmation.signatures[j]
            );

            if (recoveredSigner == joiningParticipant) {
                return true;
            }
        }
        return false;
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
