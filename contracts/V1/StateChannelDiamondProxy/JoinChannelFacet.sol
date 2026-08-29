pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
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
        StateSnapshot memory currentSnapshot = _getStateSnapshot(channelId);
        require(
            expectedForkId == currentSnapshot.forkId,
            RaceConditionSnapshotForkMismatch(currentSnapshot.forkId, expectedForkId)
        );
        require(
            expectedSnapshotHash == keccak256(abi.encode(currentSnapshot)), RaceConditionJoinChannelSnapshotMismatch()
        );

        address[] memory participantUnion = UtilityFacet(utilityFacetAddress)
            .concatAddressArraysNoDuplicates(_getSnapshotParticipants(channelId), _getPendingParticipants(channelId));
        bool isExistingParticipant =
            UtilityFacet(utilityFacetAddress).isAddressInArray(participantUnion, jc.participant);
        if (isTopUp) {
            require(isExistingParticipant, ErrorTopUpBalanceParticipantNotFound());
            require(
                !_isParticipantSlashedOnChain(channelId, jc.participant),
                ErrorTopUpBalanceParticipantSlashed(jc.participant)
            );
        } else {
            require(!isExistingParticipant, ErrorJoinChannelParticipantAlreadyExists());
            require(!_isForkDisputed(channelId, expectedForkId), RaceConditionForceInboundJoinForkDisputed());
        }

        //verify original signature
        (address retrievedAddress, bool isValidSignature) =
            UtilityFacet(utilityFacetAddress).retrieveSignerAddress(sjc.encodedJoinChannel, sjc.signature);
        require(jc.participant == retrievedAddress && isValidSignature, ErrorJoinChannelInvalidSignature());

        // Check threshold from the current eligibility set
        address[] memory thresholdParticipants = _getOnChainThresholdSet(channelId);
        (bool isValid,) = UtilityFacet(utilityFacetAddress)
            .verifyThresholdSigned(thresholdParticipants, sjc.encodedJoinChannel, joinChannelConfirmation.signatures);
        require(isValid, ErrorJoinChannelInvalidSignature());

        // Deposit funds
        JoinChannel[] memory jcs = new JoinChannel[](1);
        jcs[0] = jc;
        StateChannelManagerInterface(address(this)).depositAssetsComposable(jcs, true);
    }
}
