pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
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
    }

    // ############### Processing Functions ###############

    /**
     * @dev Processes the JoinChannel for the specific StateChannelManager
     */
    function _processJoinChannelDeposits(JoinChannel memory jc) internal returns (bool success) {
        bytes32 channelId = jc.channelId;

        // Process the deposit for the specific StateChannelManager
        success = StateChannelManagerProxy(address(this)).depositAssetsComposable(jc);
        if (!success) return false;

        // Create JoinChannelBlock
        JoinChannelBlock memory jcb = _createJoinChannelBlock(jc);
        bytes32 blockHash = keccak256(abi.encode(jcb));

        // Update on-chain balance
        ChannelBalance storage channelBalance = channelBalances[channelId];
        // Get previous total deposits
        Balance memory previousTotalDeposits =
            channelBalance.onChainJoinChannelMap[channelBalance.latestJoinChannelBlockHash].totalDeposits;
        // Calculate new totalDeposits
        Balance memory newTotalDeposits = stateMachineImplementation.addBalance(previousTotalDeposits, jc.balance);

        // Persist the onChainJoinChannel in the map
        channelBalance.onChainJoinChannelMap[blockHash] = OnChainJoinChannel({
            previousJoinChannelBlockHash: channelBalance.latestJoinChannelBlockHash,
            timestamp: block.timestamp,
            totalDeposits: newTotalDeposits
        });
        // Update the latestJoinChannelBlockHash;
        channelBalance.latestJoinChannelBlockHash = blockHash;

        // Update pending participants
        _updatePendingParticipants(jc);

        // Emit the event
        emit JoinChannelProcessed(channelId, jcb, block.timestamp, newTotalDeposits);
        return true;
    }

    function _updatePendingParticipants(JoinChannel memory jc) internal {
        disputeData[jc.channelId].pendingParticipants.push(jc.participant);
    }

    function _createJoinChannelBlock(JoinChannel memory jc) internal view returns (JoinChannelBlock memory) {
        JoinChannel[] memory jcs = new JoinChannel[](1);
        ChannelBalance storage channelBalance = channelBalances[jc.channelId];
        jcs[0] = jc;
        bytes32 latestBlockHash = channelBalance.latestJoinChannelBlockHash;
        bytes32 previousBlockHash = channelBalance.onChainJoinChannelMap[latestBlockHash].previousJoinChannelBlockHash;
        JoinChannelBlock memory joinChannelBlock =
            JoinChannelBlock({previousBlockHash: previousBlockHash, joinChannels: jcs});
        return joinChannelBlock;
    }
}
