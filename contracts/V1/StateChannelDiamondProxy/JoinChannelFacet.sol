pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
import "./Errors.sol";
import "./UtilityFacet.sol";

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
        require(channelId != bytes32(0), ErrorInvalidChannelId());

        // Check deadline
        require(jc.deadlineTimestamp >= block.timestamp, RaceConditionJoinChannelExpired());
        StateSnapshot memory currentSnapshot = getStateSnapshot(channelId);
        require(
            jc.latestStateSnapshotHash == keccak256(abi.encode(currentSnapshot)),
            RaceConditionJoinChannelStaleSnapshot()
        );
        require(
            !StateChannelManagerProxy(address(this)).isForkDisputed(channelId, currentSnapshot.forkId),
            RaceConditionJoinChannelForkDisputed()
        );

        //verify original signature
        (address retrievedAddress, bool isValidSignature) =
            UtilityFacet(utilityFacetAddress).retrieveSignerAddress(sjc.encodedJoinChannel, sjc.signature);
        require(jc.participant == retrievedAddress && isValidSignature, ErrorJoinChannelInvalidSignature());

        // Check threshold from existing participant set
        address[] memory thresholdParticipants = UtilityFacet(utilityFacetAddress).concatAddressArraysNoDuplicates(
            getSnapshotParticipants(channelId), getPendingParticipants(channelId)
        );
        (bool isValid,) = UtilityFacet(utilityFacetAddress).verifyThresholdSigned(
            thresholdParticipants, sjc.encodedJoinChannel, joinChannelConfirmation.signatures
        );
        require(isValid, ErrorJoinChannelInvalidSignature());

        // Deposit funds
        JoinChannel[] memory jcs = new JoinChannel[](1);
        jcs[0] = jc;
        StateChannelManagerProxy(address(this)).depositAssetsComposable(jcs, true);
    }
}
