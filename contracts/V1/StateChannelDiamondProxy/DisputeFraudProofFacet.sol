pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
import "./Errors.sol";
import "../types/DisputeFraudProofTypes.sol";
import "./utils/DisputeUtils.sol";
import "./utils/GeneralUtils.sol";
import "./UtilityFacet.sol";

contract DisputeFraudProofFacet is StateChannelCommon {
    //This is a bit inefficient, since public/external functions always do a deep copy unlike internal/private that pass by reference, but this shares the context
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
                revert ErrorInvalidFraudProof(slashedParticipant, disputeFraudProofs[i].participant);
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
        pure
        returns (function(bytes memory encodedFraudProof, Dispute memory dispute) internal returns (address))
    {
        if (proofType == DisputeFraudProofType.DisputeNotLatestState) return _handleDisputeNotLatestState;
        if (proofType == DisputeFraudProofType.DisputeInvalidOutputState) return _handleDisputeInvalidOutputState;
        if (proofType == DisputeFraudProofType.DisputeInvalidStateProofWithoutAuditingDataIntegrityVerified) {
            return _handleDisputeInvalidStateProofWithoutAuditingDataIntegrityVerified;
        }
        if (proofType == DisputeFraudProofType.DisputeInvalidStateProofWithAuditingDataIntegrityVerified) {
            return _handleDisputeInvalidStateProofWithAuditingDataIntegrityVerified;
        }
        if (
            proofType
                == DisputeFraudProofType
                    .DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocks
        ) {
            return _handleDisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocks;
        }
        if (proofType == DisputeFraudProofType.DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified) {
            return _handleDisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified;
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
        if (proofType == DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof) {
            return _handleDisputeInvalidBlockInStateProofApplyFraudProof;
        }
        revert ErrorInvalidFraudProofType();
    }

    function _handleDisputeNotLatestState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
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

        // Check signature
        (address retrievedAddress, bool isValid) =
            UtilityFacet(utilityFacetAddress).retrieveSignerAddress(proof.encodedBlock, proof.signature);
        if (retrievedAddress != dispute.input.disputer || !isValid) revert();

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

    function _handleDisputeInvalidStateProofWithoutAuditingDataIntegrityVerified(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal view returns (address) {
        DisputeInvalidStateProofWithoutAuditingDataIntegrityVerified memory proof =
            abi.decode(encodedFraudProof, (DisputeInvalidStateProofWithoutAuditingDataIntegrityVerified));

        bool isValid = UtilityFacet(utilityFacetAddress).verifyStateProof(dispute, proof.auditingData, false);

        if (!isValid) return dispute.input.disputer; // slash the disputer
        return address(0); // all good - the calling context may decide to slash the caller
    }

    function _handleDisputeInvalidStateProofWithAuditingDataIntegrityVerified(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal returns (address) {
        DisputeInvalidStateProofWithAuditingDataIntegrityVerified memory proof =
            abi.decode(encodedFraudProof, (DisputeInvalidStateProofWithAuditingDataIntegrityVerified));
        // Requires correct auditing data
        require(_checkDisputeAuditingDataCommitment(dispute, proof.auditingData), ErrorAuditingDataHashMismatch());

        bool isValid = UtilityFacet(utilityFacetAddress).verifyStateProof(dispute, proof.auditingData, true);
        if (!isValid) return dispute.input.disputer; // slash the disputer
        return address(0); // all good - the calling context may decide to slash the caller
    }

    function _handleDisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocks(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal returns (address) {
        DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocks memory proof = abi.decode(
            encodedFraudProof, (DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocks)
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

        isValid = UtilityFacet(utilityFacetAddress).verifyStateProof(dispute, proof.auditingData, false);
        if (!isValid) return address(0); // the calling context may decide to slash the caller

        // dispute.input.auditingDataHash is junk, stateProof is valid and auditingData is correct
        return dispute.input.disputer; // slash the disputer
    }

    function _handleDisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal returns (address) {
        DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified memory proof =
            abi.decode(encodedFraudProof, (DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified));
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
        DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified memory proof =
            abi.decode(encodedFraudProof, (DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified));
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
            dispute.input.channelId, dispute.input.forkId
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

        // Check is block author the participant being timed-out
        if (dispute.input.timeout.participant != thresholdBlock.transaction.header.participant) return address(0); // the calling context may decide to slash the caller

        //check threshold
        address[] memory thresholdParticipants = proof.auditingData.latestStateSnapshot.snapshotData.participants;
        bytes[] memory signatures = UtilityFacet(utilityFacetAddress).insertBytesInByteArray(
            signedBlock.signature, proof.thresholdBlock.signatures
        );
        (bool isValid,) =
            UtilityFacet(utilityFacetAddress).verifyThresholdSigned(thresholdParticipants, encodedBlock, signatures);
        if (!isValid) return address(0); // the calling context may decide to slash the caller

        return dispute.input.disputer;
    }

    function _handleTimeoutNotLinkedToLatestState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        // check is timeout set
        if (dispute.input.timeout.participant == address(0)) return address(0); // the calling context may decide to slash the caller

        (bool hasBlock, Block memory latestBlock) = _getLatestBlock(dispute.input.stateProof);
        uint256 expectedTimeoutHeight = hasBlock ? latestBlock.transaction.header.transactionCnt + 1 : 0;

        // check timeout height
        if (dispute.input.timeout.blockHeight == expectedTimeoutHeight) return address(0); // the calling context may decide to slash the caller

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

        stateMachineImplementation.setState(proof.auditingData.latestStateStateMachineState);
        address nextAuthor = stateMachineImplementation.getNextToWrite();

        // check is next author timed-out
        if (dispute.input.timeout.participant == nextAuthor) return address(0);
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
            dispute.input.channelId, dispute.input.forkId
        );
        uint256 previousTimestamp;
        (bool hasBlock, SignedBlock memory latestSignedBlock) = _getLatestSignedBlock(dispute.input.stateProof);
        bytes32 channelId = dispute.input.channelId;
        bytes32 forkId = dispute.input.forkId;
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
            bool hasForfeitedRightToExtraTime = false;
            if (dispute.input.timeout.participantSignatureOnPreviousBlock.length > 0) {
                (address signerAddress, bool isValid) = UtilityFacet(utilityFacetAddress).retrieveSignerAddress(
                    latestSignedBlock.encodedBlock, dispute.input.timeout.participantSignatureOnPreviousBlock
                );
                if (signerAddress == dispute.input.timeout.participant && isValid) hasForfeitedRightToExtraTime = true;
            }
            if (!hasForfeitedRightToExtraTime) {
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
        SignedBlock memory postedBlock = timeoutCalldataPostedProof.postedBlock;
        Block memory _block = abi.decode(postedBlock.encodedBlock, (Block));
        StateSnapshot memory latestStateSnapshot = timeoutCalldataPostedProof.auditingData.latestStateSnapshot;

        // Requires correct auditing data
        require(
            _checkDisputeAuditingDataCommitment(dispute, timeoutCalldataPostedProof.auditingData),
            ErrorAuditingDataHashMismatch()
        );

        // Check channelId
        if (!_areDisputeAndBlockSameChannel(dispute, _block)) return address(0); // the calling context may decide to slash the caller

        // Check forkId
        if (!_areDisputeAndBlockSameFork(dispute, _block)) return address(0); // the calling context may decide to slash the caller

        // Check timeout == postedBlock
        if (dispute.input.timeout.blockHeight != _getBlockHeight(_block)) return address(0); // the calling context may decide to slash the caller

        // Check timeout participant == block author
        if (dispute.input.timeout.participant != _getBlockAuthor(_block)) return address(0); // the calling context may decide to slash the caller

        // Check block calldata posted
        (bool isFound, bytes32 commitment) = getBlockCallDataCommitment(
            _getDisputeChannel(dispute),
            _getDisputeFork(dispute),
            dispute.input.timeout.blockHeight,
            dispute.input.timeout.participant
        );
        if (!isFound) return address(0); // the calling context may decide to slash the caller
        bytes32 _commitment = keccak256(abi.encode(postedBlock, timeoutCalldataPostedProof.onChainTimestamp));
        if (commitment != _commitment) return address(0); // the calling context may decide to slash the caller

        // get previousTimestamp
        (bool hasBlock, Block memory latestBlock) = _getLatestBlock(dispute.input.stateProof);
        uint256 previousTimestamp;
        if (!hasBlock) {
            // genesis
            bytes32 originForkId = timeoutCalldataPostedProof.auditingData.genesisStateSnapshotData.originForkId;
            (bool hasGenesis, uint256 genesisTimestamp) =
                getGenesisTimestamp(dispute.input.channelId, originForkId, dispute.input.forkId);
            require(hasGenesis, ErrorGenesisTimestampNotAvailable());
            previousTimestamp = genesisTimestamp;
        } else {
            // check is calldata posted and if block is the same as stateProof latest block
            // Check block calldata posted
            (bool _isFound, bytes32 previousBlockCommitment) = getBlockCallDataCommitment(
                _getDisputeChannel(dispute),
                _getDisputeFork(dispute),
                latestBlock.transaction.header.transactionCnt,
                latestBlock.transaction.header.participant
            );
            if (!_isFound) {
                previousTimestamp = latestBlock.transaction.header.timestamp;
            } else {
                if (timeoutCalldataPostedProof.previousBlockOnChainTimestamp == 0) {
                    revert ErrorUnexpectedBlockCalldataPosted();
                }

                bytes32 _previousBlockCommitment = keccak256(
                    abi.encode(
                        timeoutCalldataPostedProof.previousBlockcalldata,
                        timeoutCalldataPostedProof.previousBlockOnChainTimestamp
                    )
                );
                if (previousBlockCommitment != _previousBlockCommitment) return address(0); // the calling context may decide to slash the caller
                if (
                    keccak256(abi.encode(latestBlock))
                        == keccak256(timeoutCalldataPostedProof.previousBlockcalldata.encodedBlock)
                ) {
                    // only if the uploaded calldata matches the stateProof latest block, we grant extra time, otherwise the caller can forge a double sign or something else
                    previousTimestamp = timeoutCalldataPostedProof.previousBlockOnChainTimestamp;
                } else {
                    previousTimestamp = latestBlock.transaction.header.timestamp;
                }
            }
        }
        //TODO think >= or >
        if (
            timeoutCalldataPostedProof.onChainTimestamp
                > previousTimestamp + getP2pTime() + getAgreementTime() + getChainFallbackTime()
        ) {
            // invalid onChainTimestamp
            return address(0); // the calling context may decide to slash the caller
        }
        // make sure we can do the STF - it's a valid block
        bool isSuccess;
        bytes memory encodedModifiedState;
        Message[] memory outboundMessages;
        (isSuccess, encodedModifiedState, outboundMessages) = StateChannelManagerProxy(address(this))
            .executeStateTransition(
            dispute.input.channelId,
            timeoutCalldataPostedProof.auditingData.latestStateStateMachineState,
            _block.transaction
        );
        if (!isSuccess) {
            return address(0); // the calling context may decide to slash the caller
        }

        Balance memory updatedTotalWithdrawals = latestStateSnapshot.snapshotData.totalWithdrawals;
        bytes32 nextOutboundMessageBlockHash = latestStateSnapshot.snapshotData.latestOutboundMessageBlockHash;
        uint256 outboundHeight = latestStateSnapshot.snapshotData.latestOutboundMessageBlockHeight;
        if (outboundMessages.length > 0) {
            for (uint256 i = 0; i < outboundMessages.length; i++) {
                updatedTotalWithdrawals =
                    stateMachineImplementation.addBalance(updatedTotalWithdrawals, outboundMessages[i].balance);
            }

            outboundHeight += 1;

            MessageBlock memory outboundMessageBlock;
            outboundMessageBlock.previousBlockHash = nextOutboundMessageBlockHash;
            outboundMessageBlock.blockHeight = outboundHeight;
            outboundMessageBlock.messages = outboundMessages;
            outboundMessageBlock.totalBalance = updatedTotalWithdrawals;
            outboundMessageBlock.timestamp = _block.transaction.header.timestamp;
            nextOutboundMessageBlockHash = keccak256(abi.encode(outboundMessageBlock));
        }

        SnapshotData memory newSnapshotData = SnapshotData({
            originForkId: latestStateSnapshot.forkId,
            stateMachineStateHash: keccak256(encodedModifiedState),
            participants: getStateMachineParticipants(encodedModifiedState),
            latestInboundMessageBlockHash: latestStateSnapshot.snapshotData.latestInboundMessageBlockHash,
            latestInboundMessageBlockHeight: latestStateSnapshot.snapshotData.latestInboundMessageBlockHeight,
            latestOutboundMessageBlockHash: nextOutboundMessageBlockHash,
            latestOutboundMessageBlockHeight: outboundHeight,
            totalDeposits: latestStateSnapshot.snapshotData.totalDeposits,
            totalWithdrawals: updatedTotalWithdrawals
        });

        StateSnapshot memory recomputedSnapshot = StateSnapshot({
            snapshotData: newSnapshotData,
            forkId: latestStateSnapshot.forkId,
            blockHeight: latestStateSnapshot.blockHeight + 1,
            timestamp: _block.transaction.header.timestamp
        });

        if (_block.stateSnapshotHash != keccak256(abi.encode(recomputedSnapshot))) {
            return address(0); // the calling context may decide to slash the caller
        }
        return dispute.input.disputer;
    }

    function _handleDisputeInvalidBlockInStateProofApplyFraudProof(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal returns (address) {
        DisputeInvalidBlockInStateProofApplyFraudProof memory proof =
            abi.decode(encodedFraudProof, (DisputeInvalidBlockInStateProofApplyFraudProof));
        BlockConfirmation[] memory blockConfirmations =
            _getUnfinalizedBlockConfirmationsFromStateProof(dispute.input.stateProof);
        uint256 blockIndexInUnfinalizedPartOfStateProof = proof.blockIndexInUnfinalizedPartOfStateProof;

        bytes32 invalidStateProofBlockHash =
            keccak256(abi.encode(blockConfirmations[blockIndexInUnfinalizedPartOfStateProof].signedBlock));
        FraudProof memory fraudProof = proof.fraudProof;

        // check for the applicable fraud proofs that they actually contain the invalidStateProofBlock inside them
        if (fraudProof.proofType == FraudProofType.BlockInvalidStateTransition) {
            BlockInvalidStateTransitionProof memory _proof =
                abi.decode(fraudProof.encodedProof, (BlockInvalidStateTransitionProof));
            bytes32 blockHash = keccak256(abi.encode(_proof.invalidBlock));
            if (blockHash != invalidStateProofBlockHash) {
                return address(0); // the calling context may decide to slash the caller
            }
        } else if (fraudProof.proofType == FraudProofType.WrongGenesis) {
            WrongGenesisProof memory _proof = abi.decode(fraudProof.encodedProof, (WrongGenesisProof));
            bytes32 blockHash = keccak256(abi.encode(_proof.invalidBlock));
            if (blockHash != invalidStateProofBlockHash) {
                return address(0); // the calling context may decide to slash the caller
            }
        } else if (fraudProof.proofType == FraudProofType.InvalidTimestamp) {
            InvalidTimestampProof memory _proof = abi.decode(fraudProof.encodedProof, (InvalidTimestampProof));
            bytes32 blockHash = keccak256(abi.encode(_proof.invalidBlock));
            if (blockHash != invalidStateProofBlockHash) {
                return address(0); // the calling context may decide to slash the caller
            }
        } else if (fraudProof.proofType == FraudProofType.ForgedInboundMessageBlock) {
            ForgedInboundMessageBlockProof memory _proof =
                abi.decode(fraudProof.encodedProof, (ForgedInboundMessageBlockProof));
            bytes32 blockHash = keccak256(abi.encode(_proof.invalidBlock));
            if (blockHash != invalidStateProofBlockHash) {
                return address(0); // the calling context may decide to slash the caller
            }
        } else {
            // FraudProofs like DoubleSign don't prove the stateProof is invalid or has double blocks, so it's a valid dispute, it just leaks information for the participant to be slashed regularly
            revert ErrorInvalidFraudProofType();
        }

        address adr = runFraudProof(fraudProof, dispute);
        if (adr != address(0)) return dispute.input.disputer; // slash the disputer
        return address(0); // all good - the calling context may decide to slash the caller
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

    function runFraudProof(FraudProof memory fraudProof, Dispute memory dispute) internal returns (address) {
        bytes memory result = _delegatecall(
            fraudProofFacetAddress,
            abi.encodeCall(
                FraudProofFacet.runFraudProof,
                (fraudProof, FraudProofVerificationContext({channelId: dispute.input.channelId}))
            )
        );
        return abi.decode(result, (address));
    }
}
