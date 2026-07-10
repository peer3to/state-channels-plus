pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
import "./Errors.sol";
import "./utils/DisputeUtils.sol";
import "./UtilityFacet.sol";

contract DisputeManagerFacet is StateChannelCommon {
    function uploadDispute(DisputeConfirmation memory disputeConfirmation) public {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        require(!dispute.postedAuditingData, ErrorDisputePostedAuditingDataMismatch());
        _uploadDispute(disputeConfirmation);
    }

    function uploadDisputeWithCalldata(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        require(dispute.postedAuditingData, ErrorDisputePostedAuditingDataMismatch());
        bytes32 disputeAuditingDataHash = keccak256(abi.encode(disputeAuditingData));
        require(dispute.input.disputeAuditingDataHash == disputeAuditingDataHash, ErrorAuditingDataHashMismatch());
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
        require(msg.sender == dispute.input.disputer, ErrorDisputerNotMsgSender());
        require(canParticipateInDisputes(dispute.input.channelId, msg.sender), ErrorCantParticipateInDispute());

        // race condition checks
        _disputeRaceConditionCheck(dispute);

        DisputeData storage disputeData = disputeData[dispute.input.channelId];
        mapping(bytes32 forkId => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        bytes32 forkId = _getDisputeFork(dispute);
        DisputeWindow storage disputeWindow = disputeWindowMap[forkId];
        bool isThresholdFinal = _isDisputeThresholdFinal(disputeConfirmation);

        uint256 throttleExpiry = disputerThrottle[dispute.input.channelId][msg.sender];
        require(throttleExpiry == 0 || block.timestamp >= throttleExpiry, ErrorDisputeThrottled());
        disputerThrottle[dispute.input.channelId][msg.sender] = block.timestamp + getEvidenceTime();

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
                !_isEvidencePeriodExpired(disputeWindow, getEvidenceTime()) || hasNoCommitments,
                RaceConditionDisputeEvidencePeriodExpired()
            );

            require(!_hadParticipantPostedEvidence(disputeWindow, dispute.input.disputer), ErrorDisputeAlreadyPosted());

            disputeWindow.evidence.lastEvidenceSubmissionTimestamp = block.timestamp; // kill period recalculated from here
        }

        if (isThresholdFinal) {
            //finalize the dispute window by making the evidence and kill period expire -> which sets the genesisTimestamp to the current block.timestamp
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
            //check if participant posted calldata commitment
            (bool found, bytes32 blockCalldataCommitment) = getBlockCallDataCommitment(
                dispute.input.channelId,
                _getDisputeFork(dispute),
                dispute.input.timeout.blockHeight,
                dispute.input.timeout.participant
            );
            if (found) {
                revert RaceConditionDisputeTimeoutCalldataPosted();
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
                    revert RaceConditionDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch();
                }
            }
            if (block.timestamp < dispute.input.timeout.minTimeStamp) {
                revert RaceConditionDisputeTimeoutNotMinTimestamp();
            }
        }
    }

    function _isDisputeThresholdFinal(DisputeConfirmation memory disputeConfirmation)
        internal
        view
        returns (bool isFinal)
    {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        address[] memory thresholdSet = getOnChainThresholdSet(dispute.input.channelId);
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
