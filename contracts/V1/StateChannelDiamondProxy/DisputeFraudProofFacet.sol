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
        if (proofType == DisputeFraudProofType.DisputeOnChainSlashesNotSubset) {
            return _handleDisputeOnChainSlashesNotSubset;
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
        returns (address)
    {
        DisputeNotLatestState memory proof = abi.decode(encodedFraudProof, (DisputeNotLatestState));
        Block memory newerBlock = abi.decode(proof.encodedBlock, (Block));
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
        address retrivedAddress = StateChannelUtilLibrary.retriveSignerAddress(proof.encodedBlock, proof.signature);
        if (retrivedAddress != dispute.input.disputer) revert();

        return dispute.input.disputer;
    }

    function _handleDisputeInvalidOutputState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        DisputeInvalidOutputState memory proof = abi.decode(encodedFraudProof, (DisputeInvalidOutputState));
        // Requires correct auditing data
        require(_checkDisputeAuditingDataCommitment(dispute, proof.auditingData), ErrorAuditingDataHashMismatch());

        bytes memory result = _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(DisputeVerificationFacet.isDisputeOutputCorrect, (dispute, proof.auditingData))
        );
        bool isValid = abi.decode(result, (bool));
        if (!isValid) return dispute.input.disputer; // slash the disputer
        return address(0); // all good - the calling context may decide to slash the caller
    }

    function _handleDisputeInvalidStateProofWithoutAuditingDataIntegrityVerifed(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal returns (address) {
        DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifed memory proof =
            abi.decode(encodedFraudProof, (DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifed));

        bytes memory result = _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(DisputeVerificationFacet.verifyStateProof, (dispute, proof.auditingData, false))
        );
        bool isValid = abi.decode(result, (bool));
        if (!isValid) return dispute.input.disputer; // slash the disputer
        return address(0); // all good - the calling context may decide to slash the caller
    }

    function _handleDisputeInvalidStateProofWithAuditingDataIntegrityVerifed(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal returns (address) {
        DisputeInvalidStateProofWithAuditingDataIntegrityVerifed memory proof =
            abi.decode(encodedFraudProof, (DisputeInvalidStateProofWithAuditingDataIntegrityVerifed));
        // Requires correct auditing data
        require(_checkDisputeAuditingDataCommitment(dispute, proof.auditingData), ErrorAuditingDataHashMismatch());

        bytes memory result = _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(DisputeVerificationFacet.verifyStateProof, (dispute, proof.auditingData, true))
        );
        bool isValid = abi.decode(result, (bool));
        if (!isValid) return dispute.input.disputer; // slash the disputer
        return address(0); // all good - the calling context may decide to slash the caller
    }

    function _handleDisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidExitChannelBlocks(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal returns (address) {
        DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidExitChannelBlocks memory proof = abi.decode(
            encodedFraudProof, (DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidExitChannelBlocks)
        );
        // Expect commitment to be invalid/junk
        if (_checkDisputeAuditingDataCommitment(dispute, proof.auditingData)) return address(0); // the calling context may decide to slash the caller

        bytes memory result = _delegatecall(
            disputeVerificationFacetAddress,
            // Will recheck everything, but we're mostly interested in exitBlocks
            abi.encodeCall(DisputeVerificationFacet.isCorrectAuditingData, (dispute, proof.auditingData))
        );
        bool isValid = abi.decode(result, (bool));
        if (!isValid) return address(0); // the calling context may decide to slash the caller

        result = _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(DisputeVerificationFacet.verifyStateProof, (dispute, proof.auditingData, false))
        );
        isValid = abi.decode(result, (bool));
        if (!isValid) return address(0); // the calling context may decide to slash the caller

        // dispute.input.auditingDataHash is junk, stateProof is valid and auditingData is correct
        return dispute.input.disputer; // slash the disputer
    }

    function _handleDisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifed(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal returns (address) {
        DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifed memory proof =
            abi.decode(encodedFraudProof, (DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifed));
        // Requires correct auditing data
        require(_checkDisputeAuditingDataCommitment(dispute, proof.auditingData), ErrorAuditingDataHashMismatch());

        bytes memory result = _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(DisputeVerificationFacet.isCorrectAuditingData, (dispute, proof.auditingData))
        );
        bool isValid = abi.decode(result, (bool));
        if (!isValid) return dispute.input.disputer; // slash the disputer
        return address(0); // all good - the calling context may decide to slash the caller
    }

    function _handleDisputeInvalidBalanceInvariant(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifed memory proof =
            abi.decode(encodedFraudProof, (DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifed));
        // Requires correct auditing data
        require(_checkDisputeAuditingDataCommitment(dispute, proof.auditingData), ErrorAuditingDataHashMismatch());

        bytes32 channelId = dispute.input.channelId;
        SnapshotData memory latestSnapshotData = proof.auditingData.latestStateSnapshot.snapshotData;

        bytes memory result = _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(
                DisputeVerificationFacet.verifyBalanceInvariantCheck,
                (
                    channelId,
                    latestSnapshotData.totalDeposits,
                    latestSnapshotData.totalWithdrawals,
                    latestSnapshotData.latestJoinChannelBlockHash
                )
            )
        );
        bool isValid = abi.decode(result, (bool));
        if (!isValid) return dispute.input.disputer; // slash the disputer
        return address(0); // all good - the calling context may decide to slash the caller
    }

    function _handleDisputeOnChainSlashesNotSubset(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        DisputeOnChainSlashesNotSubset memory proof = abi.decode(encodedFraudProof, (DisputeOnChainSlashesNotSubset));
        // Requires correct auditing data
        require(_checkDisputeAuditingDataCommitment(dispute, proof.auditingData), ErrorAuditingDataHashMismatch());

        uint256 timestamp = StateChannelManagerProxy(address(this)).getDisputeWindowCreationTimestamp(
            dispute.input.channelId, proof.auditingData.genesisStateSnapshotData.originForkId
        );

        address[] memory onChainSlashes = getOnChainSlashedParticipantsUpToTimestamp(dispute.input.channelId, timestamp);
        address[] memory disputeSlashes = dispute.input.onChainSlashes;
        for (uint256 i = 0; i < disputeSlashes.length; i++) {
            bool found = false;
            for (uint256 j = 0; j < onChainSlashes.length; j++) {
                if (disputeSlashes[i] == onChainSlashes[j]) {
                    found = true;
                    break;
                }
            }
            if (!found) return dispute.input.disputer;
        }

        return address(0); // the calling context may decide to slash the caller
    }

    function _handleTimeoutThreshold(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        TimeoutThreshold memory proof = abi.decode(encodedFraudProof, (TimeoutThreshold));
        // Requires correct auditing data
        require(_checkDisputeAuditingDataCommitment(dispute, proof.auditingData), ErrorAuditingDataHashMismatch());

        // check is timeout set
        if (dispute.input.timeout.participant == address(0)) return address(0); // the calling context may decide to slash the caller

        SignedBlock memory signedBlock = proof.thresholdBlock.signedBlock;
        bytes memory encodedBlock = signedBlock.encodedBlock;
        Block memory thresholdBlock = abi.decode(encodedBlock, (Block));

        // Check channelId
        if (!_areDisputeAndBlockSameChannel(dispute, thresholdBlock)) return address(0); // the calling context may decide to slash the caller

        // Check forkId
        if (!_areDisputeAndBlockSameFork(dispute, thresholdBlock)) return address(0); // the calling context may decide to slash the caller

        // Check timeout == thresholdBlock
        if (dispute.input.timeout.blockHeight != _getBlockHeight(thresholdBlock)) return address(0); // the calling context may decide to slash the caller

        // Check is block author the participant being timedout
        if (dispute.input.timeout.participant != thresholdBlock.transaction.header.participant) return address(0); // the calling context may decide to slash the caller

        //check threshold
        address[] memory thresholdParticipants = proof.auditingData.latestStateSnapshot.snapshotData.participants;
        bytes[] memory signatures =
            StateChannelUtilLibrary.insertBytesInByteArray(signedBlock.signature, proof.thresholdBlock.signatures);
        (bool isValid,) = StateChannelUtilLibrary.verifyThresholdSigned(thresholdParticipants, encodedBlock, signatures);
        if (!isValid) return address(0); // the calling context may decide to slash the caller

        return dispute.input.disputer;
    }

    function _handleTimeoutNotLinkedToLatestState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        // check is timeout set
        if (dispute.input.timeout.participant == address(0)) return address(0); // the calling context may decide to slash the caller

        (bool hasBlock, Block memory latestBlock) = _getLatestBlock(dispute.input.stateProof);
        uint256 expectedTimeoutHeight = hasBlock ? latestBlock.transaction.header.transactionCnt + 1 : 0;

        // check timeout height
        if (dispute.input.timeout.blockHeight != expectedTimeoutHeight) return address(0); // the calling context may decide to slash the caller

        return dispute.input.disputer;
    }

    function _handleTimeoutParticipantNotNext(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
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
        returns (address)
    {
        //TODO
        return dispute.input.disputer;
    }

    function _handleTimeoutCalldataPosted(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
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

    function _checkDisputeAuditingDataCommitment(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        internal
        returns (bool)
    {
        bytes memory result = _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(DisputeVerificationFacet.checkDisputeAuditingDataCommitment, (dispute, disputeAuditingData))
        );
        return abi.decode(result, (bool));
    }
}
