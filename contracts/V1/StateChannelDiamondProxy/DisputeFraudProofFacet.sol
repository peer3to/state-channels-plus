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
                DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot,
                (channelId, latestSnapshotData, proof.auditingData.latestStateStateMachineState)
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
            dispute.input.channelId, dispute.input.genesisSnapshotDataHash
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
        TimeoutParticipantNotNext memory proof = abi.decode(encodedFraudProof, (TimeoutParticipantNotNext));
        // Requires correct auditing data
        require(_checkDisputeAuditingDataCommitment(dispute, proof.auditingData), ErrorAuditingDataHashMismatch());

        // check is timeout set
        if (dispute.input.timeout.participant == address(0)) return address(0); // the calling context may decide to slash the caller

        address nextAuthor = getNextToWrite(dispute.input.channelId, proof.auditingData.latestStateStateMachineState);
        // check is next author timedout
        if (dispute.input.timeout.participant != nextAuthor) return address(0); // the calling context may decide to slash the caller
        return dispute.input.disputer;
    }

    function _handleTimeoutTooEarly(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        TimeoutTooEarly memory proof = abi.decode(encodedFraudProof, (TimeoutTooEarly));
        // Requires correct auditing data
        require(_checkDisputeAuditingDataCommitment(dispute, proof.auditingData), ErrorAuditingDataHashMismatch());

        // check is timeout set
        if (dispute.input.timeout.participant == address(0)) return address(0); // the calling context may decide to slash the caller

        uint256 timeoutTimestamp = StateChannelManagerProxy(address(this)).getDisputeWindowCreationTimestamp(
            dispute.input.channelId, dispute.input.genesisSnapshotDataHash
        );
        uint256 previousTimestamp;
        (bool hasBlock, SignedBlock memory latestSignedBlock) = _getLatestSignedBlock(dispute.input.stateProof);
        bytes32 channelId = dispute.input.channelId;
        bytes32 forkId = dispute.input.genesisSnapshotDataHash;
        bytes32 originForkId = proof.auditingData.genesisStateSnapshotData.originForkId;
        if (!hasBlock) {
            // genesis
            (bool hasGenesis, uint256 genesisTimestamp) = getGenesisTimestamp(channelId, originForkId, forkId);
            require(hasGenesis, ErrorGenesisTimestampNotAvailable());
            previousTimestamp = genesisTimestamp;
        } else {
            // at least 1 block exists
            Block memory latestBlock = abi.decode(latestSignedBlock.encodedBlock, (Block));
            previousTimestamp = latestBlock.transaction.header.timestamp;

            // ****** check has forfeit right to extra time
            bool hasForfeightRightToExtraTime = false;
            if (dispute.input.timeout.participantSignatureOnPreviousBlock.length > 0) {
                address signerAddress = StateChannelUtilLibrary.retriveSignerAddress(
                    latestSignedBlock.encodedBlock, dispute.input.timeout.participantSignatureOnPreviousBlock
                );
                if (signerAddress == dispute.input.timeout.participant) hasForfeightRightToExtraTime = true;
            }
            if (!hasForfeightRightToExtraTime) {
                uint256 blockHeight = latestBlock.transaction.header.transactionCnt;
                address author = latestBlock.transaction.header.participant;
                (bool found, bytes32 commitment) = getBlockCallDataCommitment(channelId, forkId, blockHeight, author);
                if (found) {
                    // check is the caller aware of race condition
                    require(proof.previousBlockOnChainTimestamp != 0, ErrorUnexpectedBlockCalldataPosted());
                    bytes32 _commitment = keccak256(abi.encode(latestSignedBlock, proof.previousBlockOnChainTimestamp));
                    if (commitment != _commitment) return address(0); // the calling context may decide to slash the caller

                    else previousTimestamp = proof.previousBlockOnChainTimestamp;
                }
            }
        }
        if (timeoutTimestamp <= previousTimestamp + getP2pTime() + getAgreementTime() + getChainFallbackTime()) {
            return dispute.input.disputer;
        }
        return address(0); // the calling context may decide to slash the caller
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
