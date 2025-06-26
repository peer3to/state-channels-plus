pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";

contract JoinChannelFacet is StateChannelCommon {
    /**
     * @notice Joins participants to the channel by submitting a complete join channel request
     *
     * @param joinChannelConfirmation Array of join channel confirmations to process
     */
    function joinChannel(JoinChannelConfirmation memory joinChannelConfirmation) external {
        SignedJoinChannel memory sjc = joinChannelConfirmation.signedJoinChannel;
        JoinChannel memory jc = abi.decode(sjc.encodedJoinChannel, (JoinChannel));
        bytes32 channelId = jc.channelId;

        // Check deadline
        require(jc.deadlineTimestamp <= block.timestamp, ErrorJoinChannelExpired());

        //verify original siganture
        require(
            jc.participant == StateChannelUtilLibrary.retriveSignerAddress(sjc.encodedJoinChannel, sjc.signature),
            ErrorJoinChannelInvalidSignature()
        );

        // Check threshold from existing participant set
        address[] memory thresholdParticipants = StateChannelUtilLibrary.concatAddressArraysNoDuplicates(
            getSnapshotParticipants(channelId), getPendingParticipants(channelId)
        );
        (bool isValid,) = StateChannelUtilLibrary.verifyThresholdSigned(
            thresholdParticipants, sjc.encodedJoinChannel, joinChannelConfirmation.signatures
        );
        require(isValid, ErrorJoinChannelInvalidSignature());

        // Deposit funds
        isValid = _processJoinChannelDeposits(jc);
        require(isValid, ErrorJoinChannelFailed());

        // Create and apply JoinChannelBlock
        _insertJoinChannelBlock(jc);

        // Uupdate pendingParticipants
        _updatePendingParticipants(jc);
    }

    // ############### Processing Functions ###############

    /**
     * @dev Processes the JoinChannel for the specific StateChannelManager
     */
    function _processJoinChannelDeposits(JoinChannel memory jc) internal returns (bool success) {
        bytes32 channelId = jc.channelId;

        // Process the deposit for the specific StateChannelManager
        success = AStateChannelManagerProxy(address(this)).addParticipantComposable(jc);

        // Update on-chain total deposits
        if (success) {
            totalOnChainProcessedDeposits[channelId] =
                stateMachineImplementation.addBalance(totalOnChainProcessedDeposits[channelId], jc.balance);
        }
        return success;
    }

    function _updatePendingParticipants(JoinChannel memory jc) internal {
        disputeData[jc.channelId].pendingParticipants.push(jc.participant);
    }

    function _insertJoinChannelBlock(JoinChannel memory jc) internal {
        bytes32 channelId = jc.channelId;
        JoinChannel[] memory jcs = new JoinChannel[](1);
        jcs[0] = jc;
        JoinChannelBlock memory joinChannelBlock = JoinChannelBlock({
            previousBlockHash: disputeData[jc.channelId].latestJoinChannelBlockHash,
            joinChannels: jcs
        });

        bytes32 blockHash = keccak256(abi.encode(joinChannelBlock));

        disputeData[jc.channelId].latestJoinChannelBlockHash = blockHash;
        disputeData[jc.channelId].onChainJoinChannels.push(
            OnChainJoinChannel({joinChannelBlockHash: blockHash, timestamp: block.timestamp})
        );

        emit JoinChannelProcessed(channelId, joinChannelBlock, block.timestamp);
    }

    // ############### Events ###############

    event JoinChannelProcessed(bytes32 indexed channelId, JoinChannelBlock joinChannelBlock, uint256 timestamp);
}
