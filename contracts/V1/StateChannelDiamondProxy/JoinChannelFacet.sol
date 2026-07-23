pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
import "./Errors.sol";
import "./UtilityFacet.sol";

contract JoinChannelFacet is StateChannelCommon {
    /**
     * @notice Joins participants to the channel by submitting a complete join channel request
     *
     * @param joinChannelConfirmation Join channel confirmation to process
     * @param expectedSnapshotHash Latest snapshot the submitter is comfortable joining
     * @param expectedForkId Latest fork the submitter is comfortable joining
     */
    function joinChannel(
        JoinChannelConfirmation memory joinChannelConfirmation,
        bytes32 expectedSnapshotHash,
        bytes32 expectedForkId
    ) external {
        _processJoinChannel(joinChannelConfirmation, expectedSnapshotHash, expectedForkId, false);
    }

    function topUpBalance(
        JoinChannelConfirmation memory joinChannelConfirmation,
        bytes32 expectedSnapshotHash,
        bytes32 expectedForkId
    ) external {
        _processJoinChannel(joinChannelConfirmation, expectedSnapshotHash, expectedForkId, true);
    }

    function _processJoinChannel(
        JoinChannelConfirmation memory joinChannelConfirmation,
        bytes32 expectedSnapshotHash,
        bytes32 expectedForkId,
        bool isTopUp
    ) internal {
        SignedJoinChannel memory sjc = joinChannelConfirmation.signedJoinChannel;
        JoinChannel memory jc = abi.decode(sjc.encodedJoinChannel, (JoinChannel));
        bytes32 channelId = jc.channelId;
        require(channelId != bytes32(0), ErrorInvalidChannelId());
        require(msg.sender == jc.participant, ErrorJoinChannelInvalidSubmitter(jc.participant, msg.sender));

        // Check deadline
        require(jc.deadlineTimestamp >= block.timestamp, RaceConditionJoinChannelExpired());
        StateSnapshot memory currentSnapshot = getStateSnapshot(channelId);
        require(expectedForkId == currentSnapshot.forkId, RaceConditionSnapshotForkMismatch());
        require(
            expectedSnapshotHash == keccak256(abi.encode(currentSnapshot)), RaceConditionJoinChannelSnapshotMismatch()
        );

        address[] memory thresholdParticipants = UtilityFacet(utilityFacetAddress).concatAddressArraysNoDuplicates(
            getSnapshotParticipants(channelId), getPendingParticipants(channelId)
        );
        bool isExistingParticipant =
            UtilityFacet(utilityFacetAddress).isAddressInArray(thresholdParticipants, jc.participant);
        if (isTopUp) {
            require(isExistingParticipant, ErrorTopUpBalanceParticipantNotFound());
        } else {
            require(!isExistingParticipant, ErrorJoinChannelParticipantAlreadyExists());
            require(
                !StateChannelManagerProxy(address(this)).isForkDisputed(channelId, expectedForkId),
                RaceConditionForceInboundJoinForkDisputed()
            );
        }

        //verify original signature
        (address retrievedAddress, bool isValidSignature) =
            UtilityFacet(utilityFacetAddress).retrieveSignerAddress(sjc.encodedJoinChannel, sjc.signature);
        require(jc.participant == retrievedAddress && isValidSignature, ErrorJoinChannelInvalidSignature());

        // Check threshold from existing participant set
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
