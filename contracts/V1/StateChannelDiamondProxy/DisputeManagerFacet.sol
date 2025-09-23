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
        require(dispute.input.disputeAuditingDataHash == disputeAuditingDataHash, ErrorAuditingDataHashMismatch());
        _uploadDispute(disputeConfirmation, true);
        bytes32 forkId = _getDisputeFork(dispute);

        DisputeWindow storage disputeWindow = disputeData[dispute.input.channelId].disputeWindowMap[forkId];

        emit DisputeCommittedWithAuditingData(
            dispute.input.channelId,
            dispute,
            block.timestamp,
            true,
            disputeWindow.evidence.creationTimestamp,
            disputeAuditingData
        );
    }

    function commitToReducedResult(bytes32 channelId, bytes32 disputedForkId, bytes32 reducedForkId) public {
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[disputedForkId];
        require(_canParticipateInDisputes(channelId, msg.sender), ErrorCantParticipateInDispute());
        _commitToDisputeReducedResult(channelId, disputeWindow, reducedForkId, block.timestamp);
    }

    // ********************** Internal/private functions

    function _uploadDispute(DisputeConfirmation memory disputeConfirmation, bool isAuditingCalldataProvided) internal {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        require(msg.sender == dispute.input.disputer, ErrorDisputerNotMsgSender());
        require(_canParticipateInDisputes(dispute.input.channelId, msg.sender), ErrorCantParticipateInDispute());

        // race condition checks
        _disputeRaceConditionCheck(dispute);

        DisputeData storage disputeData = disputeData[dispute.input.channelId];
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
            disputeWindow.evidence.creationTimestamp = block.timestamp; // evidence period started
            disputeWindow.evidence.lastEvidenceSubmissionTimestamp = block.timestamp; // kill period recalculated from here
        } else {
            require(!_isEvidencePeriodExpired(disputeWindow, getEvidenceTime()), ErrorDisputeEvidencePeriodExpired());
            require(!disputeWindow.evidence.hasPosted[dispute.input.disputer], ErrorDisputeAlreadyPosted());
            disputeWindow.evidence.lastEvidenceSubmissionTimestamp = block.timestamp; // kill period recalculated from here
        }

        if (isThresholdFinal) {
            //finalize the dispute windown by making the evidence and kill period expire -> which sets the genesisTimestamp to the current block.timestamp
            disputeWindow.evidence.creationTimestamp = block.timestamp - getEvidenceTime();
            disputeWindow.evidence.lastEvidenceSubmissionTimestamp = block.timestamp - getEvidenceTime(); // this implicitly sets the genesisTimestamp
            //delete all previous commitments - free up storage (gas refund)
            delete disputeWindow.evidence.disputeCommitments;
            //The reduced result is this dispute output. Finalize it by making it expired.
            _commitToDisputeReducedResult(
                dispute.input.channelId,
                disputeWindow,
                dispute.outputSnapshotDataHash,
                block.timestamp - getEvidenceTime()
            );
        }
        {
            bytes32 c = keccak256(abi.encode(dispute));
            disputeWindow.evidence.disputeCommitments.push(c);
        }
        disputeWindow.evidence.hasPosted[dispute.input.disputer] = true; //disputer has posted the dispute

        emit DisputeCommitted(
            dispute.input.channelId,
            dispute,
            block.timestamp,
            isThresholdFinal,
            disputeWindow.evidence.creationTimestamp
        );
    }

    function _disputeRaceConditionCheck(Dispute memory dispute) internal view {
        // *********** 1. Timeout *************
        if (dispute.input.timeout.participant != address(0) && !dispute.input.timeout.isForced) {
            //check if participant posted calldata commitment
            (bool found, bytes32 blockCalldataCommitment) = getBlockCallDataCommitment(
                dispute.input.channelId,
                _getDisputeFork(dispute),
                dispute.input.timeout.blockHeight,
                dispute.input.timeout.participant
            );
            if (found) {
                revert ErrorDisputeTimeoutCalldataPosted();
            }

            //check if previous block producer posted blockCalldata and if the expectation matches
            if (dispute.input.timeout.previousBlockProducer != address(0)) {
                (found, blockCalldataCommitment) = getBlockCallDataCommitment(
                    dispute.input.channelId,
                    _getDisputeFork(dispute),
                    dispute.input.timeout.blockHeight - 1,
                    dispute.input.timeout.previousBlockProducer
                );
                if (found != dispute.input.timeout.previousBlockProducerPostedCalldata) {
                    revert ErrorDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch();
                }
            }
            if (block.timestamp > dispute.input.timeout.minTimeStamp) {
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
        DisputeData storage disputeData = disputeData[dispute.input.channelId];
        SnapshotData storage snapshotData = stateSnapshots[dispute.input.channelId].snapshotData;
        uint256 thresholdCount = snapshotData.participants.length + disputeData.pendingParticipants.length
            - disputeData.onChainSlashes.length;
        if (
            disputeConfirmation.signatures.length + 1
                < snapshotData.participants.length + disputeData.pendingParticipants.length
                    - disputeData.onChainSlashes.length
        ) return false;
        address[] memory thresholdSet = getOnChainThresholdSet(dispute.input.channelId);
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
        DisputeData storage disputeData = disputeData[dispute.input.channelId];
        if (disputeConfirmation.signatures.length < disputeData.pendingParticipants.length) return true;

        (bool isThresholdFinal,) = StateChannelUtilLibrary.verifyThresholdSigned(
            disputeData.pendingParticipants,
            disputeConfirmation.signedDispute.encodedDispute,
            disputeConfirmation.signatures
        );
        return !isThresholdFinal;
    }
}
