pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";
import "./utils/DisputeUtils.sol";

contract DisputeManagerFacet is StateChannelCommon {
    function uploadDispute(DisputeConfirmation memory disputeConfirmation) public {
        _uploadDispute(disputeConfirmation, false);
    }

    function uploadDisputeWithCalldata(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        bytes32 disputeAuditingDataHash = keccak256(abi.encode(disputeAuditingData));
        require(dispute.disputeAuditingDataHash == disputeAuditingDataHash, ErrorAuditingDataHashMismatch());
        _uploadDispute(disputeConfirmation, true);
        emit DisputeAuditingDataPosted(
            dispute.channelId, keccak256(disputeConfirmation.signedDispute.encodedDispute), disputeAuditingData
        );
    }

    function uploadDisputeAndAudit(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public {
        //first audit -> update on-chain slashes -> reduced threshold
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        address[] memory slashes = StateChannelManagerProxy(address(this)).auditDispute(dispute, disputeAuditingData);
        for (uint256 i = 0; i < slashes.length; i++) {
            addOnChainSlashedParticipant(dispute.channelId, slashes[i]);
        }
        _uploadDispute(disputeConfirmation, true);
        emit DisputeAuditingDataPosted(
            dispute.channelId, keccak256(disputeConfirmation.signedDispute.encodedDispute), disputeAuditingData
        );
    }

    function commitToReducedResult(
        bytes32 channelId,
        bytes32 disputedForkId,
        bytes32 reducedForkId,
        uint256 reducedForkGenesisTimestamps
    ) public {
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[disputedForkId];
        require(_canParticipateInDisputes(channelId, msg.sender), ErrorCantParticipateInDispute());
        _commitToDisputeReducedResult(disputeWindow, reducedForkId, block.timestamp, reducedForkGenesisTimestamps);
        //TODO - emit event
    }

    // ********************** Internal/private functions

    function _uploadDispute(DisputeConfirmation memory disputeConfirmation, bool isAuditingCalldataProvided) internal {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        require(msg.sender == dispute.disputer, ErrorDisputerNotMsgSender());
        require(_canParticipateInDisputes(dispute.channelId, msg.sender), ErrorCantParticipateInDispute());

        // race condition checks
        _disputeRaceConditionCheck(dispute);

        DisputeData storage disputeData = disputeData[dispute.channelId];
        mapping(bytes32 forkId => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        bytes32 forkId = _getDisputeFork(dispute);
        DisputeWindow storage disputeWindow = disputeWindowMap[forkId];
        bool isThresholdFinal = _isDisputeThresholdFinal(disputeConfirmation);
        if (!isAuditingCalldataProvided && !isThresholdFinal) {
            require(!_isAuditingCalldataRequired(disputeConfirmation), ErrorDisputeAuditingRequired());
        }

        //check if dispute window is created/opened for the disputed fork, otherwise create/open it
        if (disputeWindow.evidence.creationTimestamp == 0) {
            //create the dispute window
            disputeWindow.forkId = forkId;
            disputeWindow.evidence.creationTimestamp = block.timestamp; //challenge period started
        } else {
            require(
                block.timestamp <= disputeWindow.evidence.creationTimestamp + getEvidenceTime(),
                ErrorDisputeChallengePeriodExpired()
            );
            require(!disputeWindow.evidence.hasPosted[dispute.disputer], ErrorDisputeAlreadyPosted());
        }

        if (isThresholdFinal) {
            //finalize the dispute windown by making the kill period expired
            disputeWindow.evidence.creationTimestamp = block.timestamp - getKillTime() - 1;
            //delete all previous commitments - free up storage (gas refund)
            delete disputeWindow.evidence.disputeCommitments;
            //The reduced result is this dispute output. Finalize it by making it expired.
            _commitToDisputeReducedResult(
                disputeWindow, dispute.outputSnapshotDataHash, block.timestamp - getEvidenceTime() - 1, block.timestamp
            );
        }
        disputeWindow.evidence.disputeCommitments.push(keccak256(abi.encode(dispute)));
        disputeWindow.evidence.hasPosted[dispute.disputer] = true; //disputer has posted the dispute
        emit DisputeCommitted(
            dispute.channelId, dispute, block.timestamp, isThresholdFinal, disputeWindow.evidence.creationTimestamp
        );
    }

    function _disputeRaceConditionCheck(Dispute memory dispute) internal view {
        // *********** 1. Timeout *************
        if (dispute.timeout.participant != address(0) && !dispute.timeout.isForced) {
            //check if participant posted calldata commitment
            (bool found, bytes32 blockCalldataCommitment) = getBlockCallDataCommitment(
                dispute.channelId, _getDisputeFork(dispute), dispute.timeout.blockHeight, dispute.timeout.participant
            );
            if (found) {
                revert ErrorDisputeTimeoutCalldataPosted();
            }

            //check if previous block producer posted blockCalldata and if the expectation matches
            if (dispute.timeout.previousBlockProducer != address(0)) {
                (found, blockCalldataCommitment) = getBlockCallDataCommitment(
                    dispute.channelId,
                    _getDisputeFork(dispute),
                    dispute.timeout.blockHeight - 1,
                    dispute.timeout.previousBlockProducer
                );
                if (found != dispute.timeout.previousBlockProducerPostedCalldata) {
                    revert ErrorDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch();
                }
            }
            if (block.timestamp > dispute.timeout.minTimeStamp) {
                revert ErrorDisputeTimeoutNotMinTimestamp();
            }
        }
    }

    function _isDisputeThresholdFinal(DisputeConfirmation memory disputeConfirmation)
        internal
        view
        returns (bool isFinal)
    {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        DisputeData storage disputeData = disputeData[dispute.channelId];
        SnapshotData storage snapshotData = stateSnapshots[dispute.channelId].snapshotData;
        uint256 thresholdCount = snapshotData.participants.length + disputeData.pendingParticipants.length
            - disputeData.onChainSlashes.length;
        if (
            disputeConfirmation.signatures.length + 1
                < snapshotData.participants.length + disputeData.pendingParticipants.length
                    - disputeData.onChainSlashes.length
        ) return false;
        address[] memory thresholdSet = getOnChainThresholdSet(dispute.channelId);
        bytes[] memory signatures = StateChannelUtilLibrary.insertBytesInByteArray(
            disputeConfirmation.signedDispute.signature, disputeConfirmation.signatures
        );
        (bool isThresholdFinal,) = StateChannelUtilLibrary.verifyThresholdSigned(
            thresholdSet, disputeConfirmation.signedDispute.encodedDispute, signatures
        );
        return isThresholdFinal;
    }

    function _isAuditingCalldataRequired(DisputeConfirmation memory disputeConfirmation)
        internal
        view
        returns (bool isRequired)
    {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        DisputeData storage disputeData = disputeData[dispute.channelId];
        if (disputeConfirmation.signatures.length < disputeData.pendingParticipants.length) return true;

        (bool isThresholdFinal,) = StateChannelUtilLibrary.verifyThresholdSigned(
            disputeData.pendingParticipants,
            disputeConfirmation.signedDispute.encodedDispute,
            disputeConfirmation.signatures
        );
        return !isThresholdFinal;
    }

    // ================== Shared Utility Functions ==================

    function _canParticipateInDisputes(bytes32 channelId, address participant) public view returns (bool) {
        StateSnapshot storage stateSnapshot = stateSnapshots[channelId];
        bool isParticipant = false;
        //Check if normal participant
        for (uint256 i = 0; i < stateSnapshot.snapshotData.participants.length; i++) {
            if (stateSnapshot.snapshotData.participants[i] == participant) {
                isParticipant = true;
                break;
            }
        }
        if (!isParticipant) {
            //check pending participants
            DisputeData storage _disputeData = disputeData[channelId];
            for (uint256 i = 0; i < _disputeData.pendingParticipants.length; i++) {
                if (_disputeData.pendingParticipants[i] == participant) {
                    isParticipant = true;
                    break;
                }
            }
            if (!isParticipant) return false;
        }

        address[] memory onChainSlashedParticipants = getOnChainSlashedParticipants(channelId);
        //check if slashed on-chain -> slashed participants can't participate in disputes
        for (uint256 i = 0; i < onChainSlashedParticipants.length; i++) {
            if (onChainSlashedParticipants[i] == participant) {
                return false; //is slashed -> can't participate
            }
        }
        return true; //is participant and not slashed -> can participate
    }

    function _commitToDisputeReducedResult(
        DisputeWindow storage disputeWindow,
        bytes32 reducedForkId,
        uint256 reductionTimestamp,
        uint256 forkGenesisTimestamp
    ) internal {
        require(_isKillPeriodExpired(disputeWindow, getKillTime()), ErrorDisputeKillPeriodNotExpired());
        require(disputeWindow.reducedResult.forkId == bytes32(0), ErrorDisputeAlreadyReduced());
        disputeWindow.reducedResult.forkId = reducedForkId;
        disputeWindow.reducedResult.forkGenesisTimestamp = forkGenesisTimestamp;
        disputeWindow.reducedResult.timestamp = reductionTimestamp;
        disputeWindow.reducedResult.reducer = msg.sender; //calling function should check that msg.sender is part of channel 'can participate'
    }
}
