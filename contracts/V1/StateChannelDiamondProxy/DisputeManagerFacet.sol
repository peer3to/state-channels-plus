pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./Errors.sol";
import "./utils/DisputeUtils.sol";
import "./UtilityFacet.sol";

contract DisputeManagerFacet is StateChannelCommon {
    function uploadDispute(DisputeConfirmation memory disputeConfirmation) public {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        require(!dispute.postedAuditingData, ErrorDisputePostedAuditingDataMismatch(false, dispute.postedAuditingData));
        _uploadDispute(disputeConfirmation);
    }

    function uploadDisputeWithCalldata(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        require(dispute.postedAuditingData, ErrorDisputePostedAuditingDataMismatch(true, dispute.postedAuditingData));
        bytes32 disputeAuditingDataHash = keccak256(abi.encode(disputeAuditingData));
        require(
            dispute.input.disputeAuditingDataHash == disputeAuditingDataHash,
            ErrorAuditingDataHashMismatch(dispute.input.disputeAuditingDataHash, disputeAuditingDataHash)
        );
        (bool isFinal, uint256 creationTimestamp) = _uploadDispute(disputeConfirmation);

        emit DisputeCommittedWithAuditingData(
            dispute.input.channelId,
            disputeConfirmation,
            block.timestamp,
            isFinal,
            creationTimestamp,
            disputeAuditingData
        );
    }

    // ********************** Internal/private functions

    function _uploadDispute(DisputeConfirmation memory disputeConfirmation)
        internal
        returns (bool isFinal, uint256 disputeWindowCreationTimestamp)
    {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        require(msg.sender == dispute.input.disputer, ErrorDisputerNotMsgSender(dispute.input.disputer, msg.sender));
        require(
            _canParticipateInDisputes(dispute.input.channelId, msg.sender),
            ErrorCantParticipateInDispute(dispute.input.channelId, msg.sender)
        );

        // race condition checks
        _disputeRaceConditionCheck(dispute);

        DisputeData storage disputeData = disputeData[dispute.input.channelId];
        mapping(bytes32 forkId => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        bytes32 forkId = _getDisputeFork(dispute);
        DisputeWindow storage disputeWindow = disputeWindowMap[forkId];
        bool isThresholdFinal = _isDisputeThresholdFinal(disputeConfirmation);

        uint256 throttleExpiry = disputerThrottle[dispute.input.channelId][msg.sender];
        require(
            throttleExpiry == 0 || block.timestamp >= throttleExpiry,
            ErrorDisputeThrottled(msg.sender, throttleExpiry, block.timestamp)
        );
        disputerThrottle[dispute.input.channelId][msg.sender] = block.timestamp + _getEvidenceTime();

        //check if dispute window is created/opened for the disputed fork, otherwise create/open it
        if (disputeWindow.evidence.creationTimestamp == 0) {
            //create the dispute window
            disputeWindow.forkId = forkId;
            disputeWindow.evidence.creationTimestamp = block.timestamp; // evidence period started
            disputeWindow.evidence.lastEvidenceSubmissionTimestamp = block.timestamp; // kill period recalculated from here
            disputeData.disputedForks.push(forkId); // add the disputed fork to the list
        } else {
            bool hasNoCommitments = disputeWindow.evidence.disputeCommitments.length == 0;

            require(
                !_isEvidencePeriodExpired(disputeWindow, _getEvidenceTime()) || hasNoCommitments,
                RaceConditionDisputeEvidencePeriodExpired()
            );

            require(
                !_hadParticipantPostedEvidence(disputeWindow, dispute.input.disputer),
                ErrorDisputeAlreadyPosted(forkId, dispute.input.disputer)
            );

            disputeWindow.evidence.lastEvidenceSubmissionTimestamp = block.timestamp; // kill period recalculated from here
        }

        if (isThresholdFinal) {
            //finalize the dispute window by making the evidence and kill period expire -> which sets the genesisTimestamp to the current block.timestamp
            disputeWindow.evidence.creationTimestamp = block.timestamp - _getEvidenceTime();
            disputeWindow.evidence.lastEvidenceSubmissionTimestamp = block.timestamp - _getEvidenceTime(); // this implicitly sets the genesisTimestamp
            //delete all previous commitments - free up storage (gas refund)
            delete disputeWindow.evidence.disputeCommitments;
            //The reduced result is this dispute output. Finalize it by making it expired.
            _commitToDisputeReducedResult(
                dispute.input.channelId,
                disputeWindow,
                dispute.outputSnapshotDataHash,
                block.timestamp - _getEvidenceTime()
            );
        }
        {
            bytes32 c = keccak256(abi.encode(dispute));
            disputeWindow.evidence.disputeCommitments.push(c);
        }
        disputeWindow.evidence.hasPosted.push(dispute.input.disputer); //disputer has posted the dispute

        if (!dispute.postedAuditingData) {
            emit DisputeCommitted(
                dispute.input.channelId,
                disputeConfirmation,
                block.timestamp,
                isThresholdFinal,
                disputeWindow.evidence.creationTimestamp
            );
        }
        return (isThresholdFinal, disputeWindow.evidence.creationTimestamp);
    }

    function _disputeRaceConditionCheck(Dispute memory dispute) internal view {
        // *********** 1. Timeout *************
        if (dispute.input.timeout.participant != address(0) && !dispute.input.timeout.isForced) {
            bytes32 forkId = _getDisputeFork(dispute);
            //check if participant posted calldata commitment
            (bool found, bytes32 blockCalldataCommitment) = _getBlockCallDataCommitment(
                dispute.input.channelId, forkId, dispute.input.timeout.blockHeight, dispute.input.timeout.participant
            );
            if (found) {
                revert RaceConditionDisputeTimeoutCalldataPosted(
                    forkId,
                    dispute.input.timeout.blockHeight,
                    dispute.input.timeout.participant,
                    blockCalldataCommitment
                );
            }

            //check if previous block producer posted blockCalldata and if the expectation matches
            if (dispute.input.timeout.previousBlockProducer != address(0)) {
                (found, blockCalldataCommitment) = _getBlockCallDataCommitment(
                    dispute.input.channelId,
                    forkId,
                    dispute.input.timeout.blockHeight - 1,
                    dispute.input.timeout.previousBlockProducer
                );
                if (found != dispute.input.timeout.previousBlockProducerPostedCalldata) {
                    revert RaceConditionDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch(
                        dispute.input.timeout.previousBlockProducer,
                        dispute.input.timeout.blockHeight - 1,
                        dispute.input.timeout.previousBlockProducerPostedCalldata,
                        found
                    );
                }
            }
            if (block.timestamp < dispute.input.timeout.minTimeStamp) {
                revert RaceConditionDisputeTimeoutNotMinTimestamp(dispute.input.timeout.minTimeStamp, block.timestamp);
            }

            uint256 windowCreationTimestamp =
                disputeData[dispute.input.channelId].disputeWindowMap[forkId].evidence.creationTimestamp;
            if (windowCreationTimestamp != 0 && windowCreationTimestamp < dispute.input.timeout.minTimeStamp) {
                revert RaceConditionDisputeTimeoutWindowCreatedTooEarly(
                    windowCreationTimestamp, dispute.input.timeout.minTimeStamp
                );
            }
        }
    }

    function _isDisputeThresholdFinal(DisputeConfirmation memory disputeConfirmation)
        internal
        view
        returns (bool isFinal)
    {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        address[] memory thresholdSet = _getOnChainThresholdSet(dispute.input.channelId);
        if (thresholdSet.length == 0) {
            return false;
        }
        if (disputeConfirmation.signatures.length + 1 < thresholdSet.length) {
            return false;
        }
        bytes[] memory signatures = UtilityFacet(utilityFacetAddress).insertBytesInByteArray(
            disputeConfirmation.signedDispute.signature, disputeConfirmation.signatures
        );
        (bool isThresholdFinal,) = UtilityFacet(utilityFacetAddress).verifyThresholdSigned(
            thresholdSet, disputeConfirmation.signedDispute.encodedDispute, signatures
        );
        return isThresholdFinal;
    }
}
