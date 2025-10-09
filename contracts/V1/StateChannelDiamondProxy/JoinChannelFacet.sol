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

        //verify original signature
        require(
            jc.participant == StateChannelUtilLibrary.retrieveSignerAddress(sjc.encodedJoinChannel, sjc.signature),
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
        // JoinChannel[] memory jcs = new JoinChannel[](1);
        // jcs[0] = jc;
        // (JoinChannelBlock memory jcb, Balance memory newTotalDeposits) = StateChannelManagerProxy(address(this)).depositAssetsComposable(jcs, true);
        // emit JoinChannelProcessed(channelId, jcb, block.timestamp, newTotalDeposits);
    }
}
