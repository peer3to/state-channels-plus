pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";
import "../types/DisputeFraudProofTypes.sol";
import "./utils/DisputeUtils.sol";

contract DisputeFraudProofFacet is StateChannelCommon {
    //This is a bit inefficient, since public/external functions always do a deep copy unlike internal/private that pas by reference, but this shares the context
    function verifyDisputeFraudProofs(DisputeFraudProof[] memory disputeFraudProofs)
        public
        returns (Dispute[] memory maliciousDisputes)
    {
        maliciousDisputes = new Dispute[](disputeFraudProofs.length);
        uint256 slashCount = 0;
        for (uint256 i = 0; i < disputeFraudProofs.length; i++) {
            Dispute memory dispute = disputeFraudProofs[i].dispute;
            if (!isDisputeCommitted(dispute)) continue;
            address slashedParticipant =
                _getHandle(disputeFraudProofs[i].proofType)(disputeFraudProofs[i].encodedProof, dispute);
            if (slashedParticipant == address(0) || slashedParticipant != disputeFraudProofs[i].participant) {
                revert ErrorInvalidFraudProof();
            }
            maliciousDisputes[slashCount] = dispute;
            slashCount++;
        }
        Dispute[] memory finalDisputes = new Dispute[](slashCount);
        for (uint256 i = 0; i < slashCount; i++) {
            finalDisputes[i] = maliciousDisputes[i];
        }
        return finalDisputes;
    }

    function _getHandle(DisputeFraudProofType proofType)
        internal
        returns (function(bytes memory encodedFraudProof, Dispute memory dispute) internal returns (address))
    {
        if (proofType == DisputeFraudProofType.DisputeNotLatestState) return _handleDisputeNotLatestState;
        if (proofType == DisputeFraudProofType.DisputeInvalidOutputState) return _handleDisputeInvalidOutputState;
        if (proofType == DisputeFraudProofType.DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifed) {
            return _handleDisputeInvalidStateProofWithoutAuditingDataIntegrityVerifed;
        }
        if (proofType == DisputeFraudProofType.DisputeInvalidStateProofWithAuditingDataIntegrityVerifed) {
            return _handleDisputeInvalidStateProofWithAuditingDataIntegrityVerifed;
        }
        if (
            proofType
                == DisputeFraudProofType.DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidExitChannelBlocks
        ) return _handleDisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidExitChannelBlocks;
        if (proofType == DisputeFraudProofType.DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifed) {
            return _handleDisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifed;
        }
        if (proofType == DisputeFraudProofType.DisputeInvalidBalanceInvariant) {
            return _handleDisputeInvalidBalanceInvariant;
        }
        if (proofType == DisputeFraudProofType.TimeoutThreshold) return _handleTimeoutThreshold;
        if (proofType == DisputeFraudProofType.TimeoutCalldataPosted) return _handleTimeoutCalldataPosted;
        if (proofType == DisputeFraudProofType.TimeoutNotLinkedToLatestState) {
            return _handleTimeoutNotLinkedToLatestState;
        }
        if (proofType == DisputeFraudProofType.TimeoutParticipantNotNext) return _handleTimeoutParticipantNotNext;
        if (proofType == DisputeFraudProofType.TimeoutTooEarly) return _handleTimeoutTooEarly;
        revert ErrorInvalidFraudProofType();
    }

    function _handleDisputeNotLatestState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        DisputeNotLatestState memory disputeNotLatestStateProof = abi.decode(encodedFraudProof, (DisputeNotLatestState));
        Block memory newerBlock = abi.decode(disputeNotLatestStateProof.encodedBlock, (Block));
        (bool hasBlock, Block memory latestBlock) = _getLatestBlock(dispute.input.stateProof);

        // Check newBlock same channelId
        if (!_areDisputeAndBlockSameChannel(dispute, newerBlock)) revert();
        // Check newBlock same forkId
        if (!_areDisputeAndBlockSameFork(dispute, newerBlock)) revert();

        if (hasBlock) {
            // Check latestBlock and newerBlock same channelId
            if (!_areBlocksSameChannel(newerBlock, latestBlock)) revert();

            // Check latestBlock and newerBlock same forkId
            if (!_areBlocksSameFork(newerBlock, latestBlock)) revert();

            // Check is block newer
            if (_getBlockHeight(newerBlock) <= _getBlockHeight(latestBlock)) revert();
        }
        // if !hasBlock -> latestState should be genesis state -> if the disputer signed any block this proof is valid

        // Check siganture
        address retrivedAddress = StateChannelUtilLibrary.retriveSignerAddress(
            disputeNotLatestStateProof.encodedBlock, disputeNotLatestStateProof.signature
        );
        if (retrivedAddress != dispute.input.disputer) revert();

        return dispute.input.disputer;
    }

    function _handleDisputeInvalidOutputState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        //TODO
        return dispute.input.disputer;
    }

    function _handleDisputeInvalidStateProofWithoutAuditingDataIntegrityVerifed(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal view returns (address) {
        //TODO
        return dispute.input.disputer;
    }

    function _handleDisputeInvalidStateProofWithAuditingDataIntegrityVerifed(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal view returns (address) {
        //TODO
        return dispute.input.disputer;
    }

    function _handleDisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidExitChannelBlocks(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal view returns (address) {
        //TODO
        return dispute.input.disputer;
    }

    function _handleDisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifed(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal view returns (address) {
        //TODO
        return dispute.input.disputer;
    }

    function _handleDisputeInvalidBalanceInvariant(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        //TODO
        return dispute.input.disputer;
    }

    function _handleTimeoutThreshold(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        TimeoutThreshold memory timeoutThresholdProof = abi.decode(encodedFraudProof, (TimeoutThreshold));
        SignedBlock memory signedBlock = timeoutThresholdProof.thresholdBlock.signedBlock;
        bytes memory encodedBlock = signedBlock.encodedBlock;
        Block memory thresholdBlock = abi.decode(encodedBlock, (Block));

        // Check channelId
        if (!_areDisputeAndBlockSameChannel(dispute, thresholdBlock)) revert();

        // Check forkId
        if (!_areDisputeAndBlockSameFork(dispute, thresholdBlock)) revert();

        // Check timeout == thresholdBlock
        if (dispute.input.timeout.blockHeight != _getBlockHeight(thresholdBlock)) revert();

        //check correct snapshot
        if (!_doesBlockCommitToSnapshot(thresholdBlock, timeoutThresholdProof.auditingData.latestStateSnapshot)) {
            revert();
        }

        //check threshold
        address[] memory thresholdParticipants =
            timeoutThresholdProof.auditingData.latestStateSnapshot.snapshotData.participants;
        bytes[] memory signatures = StateChannelUtilLibrary.insertBytesInByteArray(
            signedBlock.signature, timeoutThresholdProof.thresholdBlock.signatures
        );
        (bool isValid,) = StateChannelUtilLibrary.verifyThresholdSigned(thresholdParticipants, encodedBlock, signatures);
        if (!isValid) revert();

        return dispute.input.disputer;
    }

    function _handleTimeoutCalldataPosted(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        TimeoutCalldataPosted memory timeoutCalldataPostedProof = abi.decode(encodedFraudProof, (TimeoutCalldataPosted));
        Block memory postedBlock = timeoutCalldataPostedProof.postedBlock;

        // Check channelId
        if (!_areDisputeAndBlockSameChannel(dispute, postedBlock)) revert();

        // Check forkId
        if (!_areDisputeAndBlockSameFork(dispute, postedBlock)) revert();

        // Check timeout == postedBlock
        if (dispute.input.timeout.blockHeight != _getBlockHeight(postedBlock)) revert();

        // Check timeout participant == block author
        if (dispute.input.timeout.participant != _getBlockAuthor(postedBlock)) revert();

        // Check block calldata posted
        (bool isFound,) = getBlockCallDataCommitment(
            _getDisputeChannel(dispute),
            _getDisputeFork(dispute),
            dispute.input.timeout.blockHeight,
            dispute.input.timeout.participant
        );
        if (!isFound) revert();

        return dispute.input.disputer;
    }

    function _handleTimeoutNotLinkedToLatestState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        //TODO
        return dispute.input.disputer;
    }

    function _handleTimeoutParticipantNotNext(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        // //Can be part of auditing instead of doing it here
        // bool hasBlock;
        // Block memory latestBlock;
        // (hasBlock, latestBlock) = _getLatestBlock(dispute.input.stateProof);
        // if (!hasBlock || _getBlockAuthor(latestBlock) == dispute.input.timeout.participant) revert();

        // TODO - the check is -> proove latest state that the dispute commits to -> prove getNextToWrite(latestState) != dispute.input.timeout.participant
        return dispute.input.disputer;
    }

    function _handleTimeoutTooEarly(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        //TODO
        return dispute.input.disputer;
    }
}
