// @spec-test-coverage-ignore: shared Foundry storage-seeding mixin exercised by owning mapped test declarations
pragma solidity ^0.8.8;

import {StateChannelCommon} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol";
import "../../../contracts/V1/types/DataTypes.sol";

/// Seeds a dispute window the way `DisputeManagerFacet.uploadDispute` opens
/// one on the first dispute: the window's own fork id, both evidence
/// timestamps, and the channel's disputed-fork list (pushed once, on
/// creation, like the upload does). Harnesses that need a window without
/// running an upload inherit this, so every seeded window has one shape.
abstract contract DisputeWindowSeeding is StateChannelCommon {
    function _seedDisputeWindow(
        bytes32 channelId,
        bytes32 forkId,
        uint256 creationTimestamp,
        uint256 lastEvidenceSubmissionTimestamp
    ) internal returns (DisputeWindow storage disputeWindow) {
        DisputeData storage channelDisputes = disputeData[channelId];
        disputeWindow = channelDisputes.disputeWindowMap[forkId];
        if (disputeWindow.evidence.creationTimestamp == 0) {
            channelDisputes.disputedForks.push(forkId);
        }
        disputeWindow.forkId = forkId;
        disputeWindow.evidence.creationTimestamp = creationTimestamp;
        disputeWindow.evidence.lastEvidenceSubmissionTimestamp = lastEvidenceSubmissionTimestamp;
    }
}
