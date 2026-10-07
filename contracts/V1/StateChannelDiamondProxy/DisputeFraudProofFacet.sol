pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./DisputeVerificationFacet.sol";
import "./StateProofFacet.sol";
import "./FraudProofFacet.sol";
import "./Errors.sol";
import "../types/DisputeFraudProofTypes.sol";
import "./utils/DisputeUtils.sol";
import "./utils/GeneralUtils.sol";
import "./utils/BlockUtils.sol";
import "./UtilityFacet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract DisputeFraudProofFacet is StateChannelCommon {
    //This is a bit inefficient, since public/external functions always do a deep copy unlike internal/private that pass by reference, but this shares the context
    function applyDisputeFraudProofs(DisputeFraudProof[] memory proofs) public {
        for (uint256 i = 0; i < proofs.length; i++) {
            Dispute memory dispute = proofs[i].dispute;
            // not committed -> already killed (lost the kill-race) or never committed; no-op.
            if (!isDisputeCommitted(dispute)) continue;
            DisputeWindow storage disputeWindow =
                disputeData[dispute.input.channelId].disputeWindowMap[dispute.input.forkId];
            (bool isExpired, uint256 killPeriodEnd) = _isKillPeriodExpired(disputeWindow, _getEvidenceTime());
            // A successful batch means every committed proof was eligible and applied.
            require(!isExpired, RaceConditionDisputeKillPeriodExpired(killPeriodEnd, block.timestamp));
            address slashedParticipant = _getHandle(proofs[i].proofType)(proofs[i].encodedProof, dispute);
            // zero is the invalid verdict -> never a kill target
            if (slashedParticipant != address(0) && slashedParticipant == proofs[i].participant) {
                _delegatecall(
                    disputeVerificationFacetAddress, abi.encodeCall(DisputeVerificationFacet.killDispute, (dispute))
                );
            } else if (_canParticipateInDisputesNow(dispute.input.channelId, msg.sender)) {
                addOnChainSlashedParticipant(dispute.input.channelId, msg.sender);
            }
        }
    }

    function validateTimeoutCalldataPostedProof(TimeoutCalldataPosted memory proof, Dispute memory dispute)
        public
        returns (bool)
    {
        return _validateTimeoutCalldataPostedProof(proof, dispute);
    }

    function _getHandle(DisputeFraudProofType proofType)
        internal
        pure
        returns (function(bytes memory encodedFraudProof, Dispute memory dispute) internal returns (address))
    {
        if (proofType == DisputeFraudProofType.DisputeNotLatestState) return _handleDisputeNotLatestState;
        if (proofType == DisputeFraudProofType.DisputeInvalidOutputState) return _handleDisputeInvalidOutputState;
        if (proofType == DisputeFraudProofType.DisputeInvalidStateProof) {
            return _handleDisputeInvalidStateProof;
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
        if (proofType == DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData) {
            return _handleDisputeLastMilestoneNotFinalAndNoAuditingData;
        }
        if (proofType == DisputeFraudProofType.InvalidDisputeReason) {
            return _handleInvalidDisputeReason;
        }
        if (proofType == DisputeFraudProofType.DisputeStateProofHeaderMismatch) {
            return _handleDisputeStateProofHeaderMismatch;
        }
        if (proofType == DisputeFraudProofType.DisputeInboundHashNotInChain) {
            return _handleDisputeInboundHashNotInChain;
        }
        if (proofType == DisputeFraudProofType.DisputeInvalidBlockStructure) {
            return _handleDisputeInvalidBlockStructure;
        }
        if (proofType == DisputeFraudProofType.DisputeBlockAuthorNotParticipant) {
            return _handleDisputeBlockAuthorNotParticipant;
        }
        if (proofType == DisputeFraudProofType.DisputeInboundAnchorBehindLatestState) {
            return _handleDisputeInboundAnchorBehindLatestState;
        }
        if (proofType == DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor) {
            return _handleDisputeStateProofBelowOnChainAnchor;
        }
        if (proofType == DisputeFraudProofType.TimeoutSupersededByFinalState) {
            return _handleTimeoutSupersededByFinalState;
        }
        if (proofType == DisputeFraudProofType.DisputeConflictsWithFinalState) {
            return _handleDisputeConflictsWithFinalState;
        }
        return _handleInvalidDisputeFraudProofType;
    }

    /// The disputer when the StateProofFacet `call` answers true, else no one.
    function _delegatedVerdict(Dispute memory dispute, bytes memory call) internal returns (address) {
        if (abi.decode(_delegatecall(stateProofFacetAddress, call), (bool))) return _valid(dispute.input.disputer);
        return _invalid();
    }

    function _valid(address adr) internal pure returns (address) {
        return adr;
    }

    function _invalid() internal pure returns (address) {
        return address(0);
    }

    function _timeoutDeadline(uint256 previousTimestamp, bool hasBlock)
        internal
        view
        returns (bool ok, uint256 deadline)
    {
        uint256 firstBlockGrace = hasBlock ? 0 : _getEvidenceTime();
        return Math.tryAdd(
            previousTimestamp, firstBlockGrace + _getP2pTime() + _getAgreementTime() + _getChainFallbackTime()
        );
    }

    function _handleInvalidDisputeFraudProofType(bytes memory, Dispute memory) internal pure returns (address) {
        return _invalid();
    }

    function _handleDisputeStateProofHeaderMismatch(bytes memory, Dispute memory dispute) internal returns (address) {
        if (_hasStateProofHeaderMismatch(dispute)) return _valid(dispute.input.disputer);
        return _invalid();
    }

    function _handleDisputeInboundHashNotInChain(bytes memory, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        return _isDisputeInboundHashValid(dispute) ? _invalid() : _valid(dispute.input.disputer);
    }

    function _handleDisputeInvalidBlockStructure(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        DisputeInvalidBlockStructure memory proof = abi.decode(encodedFraudProof, (DisputeInvalidBlockStructure));
        if (!_isBlockChallengeEligible(dispute, proof.blockIndex)) return _invalid();
        return _delegatedVerdict(
            dispute,
            abi.encodeCall(
                StateProofFacet.isInvalidBlockStructureInStateProof, (dispute.input.stateProof, proof.blockIndex)
            )
        );
    }

    function _handleDisputeBlockAuthorNotParticipant(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        DisputeBlockAuthorNotParticipant memory proof =
            abi.decode(encodedFraudProof, (DisputeBlockAuthorNotParticipant));
        if (!_isBlockChallengeEligible(dispute, proof.blockIndex)) return _invalid();

        SignedBlock memory signedBlock = _getLastMilestoneBlock(dispute, proof.blockIndex);
        (bool decoded, Block memory invalidBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(signedBlock.encodedBlock);
        if (!decoded || dispute.input.channelId != invalidBlock.transaction.header.channelId) return _invalid();

        (address signer, bool signatureValid) =
            UtilityFacet(utilityFacetAddress).retrieveSignerAddress(signedBlock.encodedBlock, signedBlock.signature);
        if (!signatureValid || signer != invalidBlock.transaction.header.participant) return _invalid();
        if (invalidBlock.stateSnapshotHash != keccak256(abi.encode(proof.resultingStateSnapshot))) return _invalid();

        if (invalidBlock.transaction.header.transactionCnt == 0) {
            if (invalidBlock.previousBlockHash != keccak256(abi.encode(proof.previousStateSnapshot))) {
                return _invalid();
            }
        } else {
            (bool previousDecoded, Block memory previousBlock) =
                UtilityFacet(utilityFacetAddress).tryDecodeBlock(proof.previousBlock.encodedBlock);
            if (!previousDecoded) return _invalid();
            if (invalidBlock.previousBlockHash != keccak256(proof.previousBlock.encodedBlock)) return _invalid();
            if (previousBlock.stateSnapshotHash != keccak256(abi.encode(proof.previousStateSnapshot))) {
                return _invalid();
            }
        }

        if (_isBlockAuthorParticipant(invalidBlock, proof.previousStateSnapshot, proof.resultingStateSnapshot)) {
            return _invalid();
        }
        return _valid(dispute.input.disputer);
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
        if (!_areDisputeAndBlockSameChannel(dispute, newerBlock)) return _invalid();
        // Check newBlock same forkId
        if (!_areDisputeAndBlockSameFork(dispute, newerBlock)) return _invalid();

        if (hasBlock) {
            // Check latestBlock and newerBlock same channelId
            if (!_areBlocksSameChannel(newerBlock, latestBlock)) return _invalid();

            // Check latestBlock and newerBlock same forkId
            if (!_areBlocksSameFork(newerBlock, latestBlock)) return _invalid();

            // Check is block newer
            if (_getBlockHeight(newerBlock) <= _getBlockHeight(latestBlock)) return _invalid();
        }
        // if !hasBlock -> latestState should be genesis state -> if the disputer signed any block this proof is valid

        // Check signature
        (address retrievedAddress, bool isValid) =
            UtilityFacet(utilityFacetAddress).retrieveSignerAddress(proof.encodedBlock, proof.signature);
        if (retrievedAddress != dispute.input.disputer || !isValid) return _invalid();

        return _valid(dispute.input.disputer);
    }

    function _handleDisputeLastMilestoneNotFinalAndNoAuditingData(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal returns (address) {
        abi.decode(encodedFraudProof, (DisputeLastMilestoneNotFinalAndNoAuditingData));

        if (dispute.postedAuditingData) return _invalid();

        if (!_isAuditingDataOmissionAllowed(dispute)) return _valid(dispute.input.disputer);
        return _invalid();
    }

    function _handleInvalidDisputeReason(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        InvalidDisputeReason memory proof = abi.decode(encodedFraudProof, (InvalidDisputeReason));

        if (!_isSnapshotLinkedToLatestBlock(dispute, proof.latestStateSnapshot)) {
            return _invalid();
        }

        if (_hasDisputeReason(dispute.input, proof.latestStateSnapshot)) {
            return _invalid();
        }
        return _valid(dispute.input.disputer);
    }

    function _handleDisputeInboundAnchorBehindLatestState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        DisputeInboundAnchorBehindLatestState memory proof =
            abi.decode(encodedFraudProof, (DisputeInboundAnchorBehindLatestState));

        if (!_isDisputeInboundAnchorBehindLatestState(dispute, proof.latestStateSnapshot)) return _invalid();
        return _valid(dispute.input.disputer);
    }

    function _handleDisputeStateProofBelowOnChainAnchor(bytes memory, Dispute memory dispute)
        internal
        returns (address)
    {
        return _delegatedVerdict(dispute, abi.encodeCall(StateProofFacet.isStateProofBelowOnChainAnchor, (dispute)));
    }

    function _handleTimeoutSupersededByFinalState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        TimeoutSupersededByFinalState memory proof = abi.decode(encodedFraudProof, (TimeoutSupersededByFinalState));
        return _delegatedVerdict(
            dispute, abi.encodeCall(StateProofFacet.isTimeoutSupersededByFinalState, (dispute, proof))
        );
    }

    function _handleDisputeConflictsWithFinalState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        DisputeConflictsWithFinalState memory proof = abi.decode(encodedFraudProof, (DisputeConflictsWithFinalState));
        return _delegatedVerdict(
            dispute, abi.encodeCall(StateProofFacet.isDisputeConflictingWithFinalState, (dispute, proof))
        );
    }

    function _handleDisputeInvalidOutputState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        DisputeInvalidOutputState memory proof = abi.decode(encodedFraudProof, (DisputeInvalidOutputState));
        if (
            !_isDataLinkedToDisputeInput(
                dispute, proof.latestStateSnapshot, proof.latestStateMachineState, proof.inboundMessageBlocks
            )
        ) return _invalid();

        bytes memory result = _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(
                DisputeVerificationFacet.isDisputeOutputCorrect,
                (dispute, proof.latestStateSnapshot, proof.latestStateMachineState, proof.inboundMessageBlocks)
            )
        );
        bool isValid = abi.decode(result, (bool));
        if (!isValid) return _valid(dispute.input.disputer);
        return _invalid();
    }

    /// The pointed step of the state-proof walk fails, or the latest state is not the proof's; see
    /// `StateProofFacet.isStateProofStepInvalid`.
    function _handleDisputeInvalidStateProof(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        DisputeInvalidStateProof memory proof = abi.decode(encodedFraudProof, (DisputeInvalidStateProof));
        return _delegatedVerdict(dispute, abi.encodeCall(StateProofFacet.isStateProofStepInvalid, (dispute, proof)));
    }

    function _handleDisputeInvalidBalanceInvariant(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        DisputeInvalidBalanceInvariant memory proof = abi.decode(encodedFraudProof, (DisputeInvalidBalanceInvariant));
        // the balance invariant is judged on the dispute's latest state
        if (!_isLatestStateLinkedToLatestBlock(dispute, proof.latestStateSnapshot, proof.latestStateMachineState)) {
            return _invalid();
        }

        bytes memory result = _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(
                DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot,
                (dispute.input.channelId, proof.latestStateSnapshot.snapshotData, proof.latestStateMachineState)
            )
        );
        bool isValid = abi.decode(result, (bool));
        if (!isValid) return _valid(dispute.input.disputer);
        return _invalid();
    }

    function _handleDisputeOnChainSlashesNotSubset(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        address[] memory onChainSlashes = _getOnChainSlashedParticipants(dispute.input.channelId);
        address[] memory disputeSlashes = dispute.input.onChainSlashes;
        for (uint256 i = 0; i < disputeSlashes.length; i++) {
            bool found = false;
            for (uint256 j = 0; j < onChainSlashes.length; j++) {
                if (disputeSlashes[i] == onChainSlashes[j]) {
                    found = true;
                    break;
                }
            }
            if (!found) return _valid(dispute.input.disputer);
        }

        revert RaceConditionOnChainSlashes(dispute.input.channelId, disputeSlashes, onChainSlashes);
    }

    function _handleTimeoutThreshold(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        TimeoutThreshold memory proof = abi.decode(encodedFraudProof, (TimeoutThreshold));

        // check is timeout set
        if (dispute.input.timeout.participant == address(0)) return _invalid();

        SignedBlock memory signedBlock = proof.thresholdBlock.signedBlock;
        bytes memory encodedBlock = signedBlock.encodedBlock;
        Block memory thresholdBlock = abi.decode(encodedBlock, (Block));

        // Check channelId
        if (!_areDisputeAndBlockSameChannel(dispute, thresholdBlock)) return _invalid();

        // Check forkId
        if (!_areDisputeAndBlockSameFork(dispute, thresholdBlock)) return _invalid();

        // Check timeout == thresholdBlock
        if (dispute.input.timeout.blockHeight != _getBlockHeight(thresholdBlock)) return _invalid();

        // Check is block author the participant being timed-out
        if (dispute.input.timeout.participant != thresholdBlock.transaction.header.participant) return _invalid();

        if (!_isSnapshotLinkedToLatestBlock(dispute, proof.latestStateSnapshot)) return _invalid();
        if (!_isSnapshotLinkedToBlock(thresholdBlock, proof.thresholdStateSnapshot)) return _invalid();

        //check threshold
        address[] memory thresholdParticipants = UtilityFacet(utilityFacetAddress).concatAddressArraysNoDuplicates(
            proof.latestStateSnapshot.snapshotData.participants, proof.thresholdStateSnapshot.snapshotData.participants
        );
        bytes[] memory signatures = UtilityFacet(utilityFacetAddress).insertBytesInByteArray(
            signedBlock.signature, proof.thresholdBlock.signatures
        );
        (bool isValid,) =
            UtilityFacet(utilityFacetAddress).verifyThresholdSigned(thresholdParticipants, encodedBlock, signatures);
        if (!isValid) return _invalid();

        return _valid(dispute.input.disputer);
    }

    function _handleTimeoutNotLinkedToLatestState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        // check is timeout set
        if (dispute.input.timeout.participant == address(0)) return _invalid();

        (bool hasBlock, Block memory latestBlock) = _getLatestBlock(dispute.input.stateProof);
        uint256 expectedTimeoutHeight = hasBlock ? latestBlock.transaction.header.transactionCnt + 1 : 0;

        // check timeout height
        if (dispute.input.timeout.blockHeight == expectedTimeoutHeight) return _invalid();

        return _valid(dispute.input.disputer);
    }

    function _handleTimeoutParticipantNotNext(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        TimeoutParticipantNotNext memory proof = abi.decode(encodedFraudProof, (TimeoutParticipantNotNext));

        // check is timeout set
        if (dispute.input.timeout.participant == address(0)) return _invalid();

        if (!_isLatestStateLinkedToLatestBlock(dispute, proof.latestStateSnapshot, proof.latestStateStateMachineState))
        {
            return _invalid();
        }

        stateMachineImplementation.setState(proof.latestStateStateMachineState);
        address nextAuthor = stateMachineImplementation.getNextToWrite();

        // check is next author timed-out
        if (dispute.input.timeout.participant == nextAuthor) return _invalid();
        return _valid(dispute.input.disputer);
    }

    function _handleTimeoutTooEarly(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        TimeoutTooEarly memory proof = abi.decode(encodedFraudProof, (TimeoutTooEarly));

        // check is timeout set
        if (dispute.input.timeout.participant == address(0)) return _invalid();

        uint256 timeoutTimestamp = StateChannelManagerInterface(address(this)).getDisputeWindowCreationTimestamp(
            dispute.input.channelId, dispute.input.forkId
        );
        uint256 previousTimestamp;
        (bool hasBlock, SignedBlock memory latestSignedBlock) = _getLatestSignedBlock(dispute.input.stateProof);
        bytes32 channelId = dispute.input.channelId;
        bytes32 forkId = dispute.input.forkId;
        if (!hasBlock) {
            // genesis
            if (!_isGenesisSnapshotDataLinkedToFork(forkId, proof.genesisStateSnapshotData)) return _invalid();
            bytes32 originForkId = proof.genesisStateSnapshotData.originForkId;
            (bool hasGenesis, uint256 genesisTimestamp) = _getGenesisTimestamp(channelId, originForkId, forkId);
            require(hasGenesis, RaceConditionGenesisTimestampNotAvailable(channelId, originForkId, forkId));
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
                (bool found, bytes32 commitment) = _getBlockCallDataCommitment(channelId, forkId, blockHeight, author);
                if (found) {
                    // check is the caller aware of race condition
                    require(
                        proof.previousBlockOnChainTimestamp != 0,
                        RaceConditionUnexpectedBlockCalldataPosted(forkId, blockHeight, author, commitment)
                    );
                    bytes32 _commitment = keccak256(abi.encode(latestSignedBlock, proof.previousBlockOnChainTimestamp));
                    if (commitment != _commitment) return _invalid();
                    else previousTimestamp = proof.previousBlockOnChainTimestamp;
                }
            }
        }
        (bool ok, uint256 minValidTimestamp) = _timeoutDeadline(previousTimestamp, hasBlock);
        if (!ok || timeoutTimestamp < minValidTimestamp) {
            return _valid(dispute.input.disputer);
        }
        return _invalid();
    }

    function _handleTimeoutCalldataPosted(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        TimeoutCalldataPosted memory timeoutCalldataPostedProof = abi.decode(encodedFraudProof, (TimeoutCalldataPosted));
        if (_validateTimeoutCalldataPostedProof(timeoutCalldataPostedProof, dispute)) {
            return _valid(dispute.input.disputer);
        }
        return _invalid();
    }

    function _validateTimeoutCalldataPostedProof(
        TimeoutCalldataPosted memory timeoutCalldataPostedProof,
        Dispute memory dispute
    ) internal returns (bool) {
        SignedBlock memory postedBlock = timeoutCalldataPostedProof.postedBlock;
        Block memory _block = abi.decode(postedBlock.encodedBlock, (Block));
        StateSnapshot memory latestStateSnapshot = timeoutCalldataPostedProof.latestStateSnapshot;

        // Check channelId
        if (!_areDisputeAndBlockSameChannel(dispute, _block)) {
            return false;
        }

        // Check forkId
        if (!_areDisputeAndBlockSameFork(dispute, _block)) return false;

        // Check timeout == postedBlock
        if (dispute.input.timeout.blockHeight != _getBlockHeight(_block)) {
            return false;
        }

        // Check timeout participant == block author
        if (dispute.input.timeout.participant != _getBlockAuthor(_block)) {
            return false;
        }

        // Check block calldata posted
        (bool isFound, bytes32 commitment) = _getBlockCallDataCommitment(
            _getDisputeChannel(dispute),
            _getDisputeFork(dispute),
            dispute.input.timeout.blockHeight,
            dispute.input.timeout.participant
        );
        if (!isFound) return false;
        bytes32 _commitment = keccak256(abi.encode(postedBlock, timeoutCalldataPostedProof.onChainTimestamp));
        if (commitment != _commitment) return false;

        // get previousTimestamp
        // The latest block's identity is the hash of its signed bytes, as in the state proof's
        // chain linkage and in `Block.hash` on the client, not the hash of its re-encoded fields.
        (bool hasBlock, SignedBlock memory latestSignedBlock) = _getLatestSignedBlock(dispute.input.stateProof);
        Block memory latestBlock;
        if (hasBlock) latestBlock = abi.decode(latestSignedBlock.encodedBlock, (Block));
        uint256 previousTimestamp;
        if (!hasBlock) {
            // genesis
            if (
                !_isGenesisSnapshotDataLinkedToFork(
                    dispute.input.forkId, timeoutCalldataPostedProof.genesisStateSnapshotData
                )
            ) {
                return false;
            }
            bytes32 genesisOriginForkId = timeoutCalldataPostedProof.genesisStateSnapshotData.originForkId;
            (bool hasGenesis, uint256 genesisTimestamp) =
                _getGenesisTimestamp(dispute.input.channelId, genesisOriginForkId, dispute.input.forkId);
            require(
                hasGenesis,
                RaceConditionGenesisTimestampNotAvailable(
                    dispute.input.channelId, genesisOriginForkId, dispute.input.forkId
                )
            );
            previousTimestamp = genesisTimestamp;
        } else {
            // check is calldata posted and if block is the same as stateProof latest block
            // Check block calldata posted
            (bool _isFound, bytes32 previousBlockCommitment) = _getBlockCallDataCommitment(
                _getDisputeChannel(dispute),
                _getDisputeFork(dispute),
                latestBlock.transaction.header.transactionCnt,
                latestBlock.transaction.header.participant
            );
            if (!_isFound) {
                previousTimestamp = latestBlock.transaction.header.timestamp;
            } else {
                if (timeoutCalldataPostedProof.previousBlockOnChainTimestamp == 0) {
                    revert RaceConditionUnexpectedBlockCalldataPosted(
                        dispute.input.forkId,
                        latestBlock.transaction.header.transactionCnt,
                        latestBlock.transaction.header.participant,
                        previousBlockCommitment
                    );
                }

                bytes32 _previousBlockCommitment = keccak256(
                    abi.encode(
                        timeoutCalldataPostedProof.previousBlockcalldata,
                        timeoutCalldataPostedProof.previousBlockOnChainTimestamp
                    )
                );
                if (previousBlockCommitment != _previousBlockCommitment) {
                    return false;
                }
                if (
                    keccak256(latestSignedBlock.encodedBlock)
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
        (bool ok, uint256 maxValidTimestamp) = _timeoutDeadline(previousTimestamp, hasBlock);
        if (ok && timeoutCalldataPostedProof.onChainTimestamp > maxValidTimestamp) {
            return false;
        }
        // The replay must start from the dispute's latest state: the snapshot is the latest
        // block's (or the fork's genesis), the machine state is that snapshot's, and the posted
        // block follows that latest block. Without these links the blamed author could post a
        // block built on a made-up state and refute an honest timeout.
        if (!_isSnapshotLinkedToLatestBlock(dispute, latestStateSnapshot)) return false;
        if (
            latestStateSnapshot.snapshotData.stateMachineStateHash
                != keccak256(timeoutCalldataPostedProof.latestStateStateMachineState)
        ) return false;
        if (
            _block.previousBlockHash
                != (hasBlock ? keccak256(latestSignedBlock.encodedBlock) : keccak256(abi.encode(latestStateSnapshot)))
        ) return false;
        // make sure we can do the STF - it's a valid block
        bool isSuccess;
        bytes memory encodedModifiedState;
        Message[] memory outboundMessages;
        (isSuccess, encodedModifiedState, outboundMessages) = StateChannelManagerInterface(address(this))
            .executeStateTransition(
            dispute.input.channelId, timeoutCalldataPostedProof.latestStateStateMachineState, _block.transaction
        );
        if (!isSuccess) {
            return false;
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
            originForkId: latestStateSnapshot.snapshotData.originForkId,
            stateMachineStateHash: keccak256(encodedModifiedState),
            participants: _getStateMachineParticipants(encodedModifiedState),
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
            return false;
        }
        return true;
    }

    function _handleDisputeInvalidBlockInStateProofApplyFraudProof(
        bytes memory encodedFraudProof,
        Dispute memory dispute
    ) internal returns (address) {
        DisputeInvalidBlockInStateProofApplyFraudProof memory proof =
            abi.decode(encodedFraudProof, (DisputeInvalidBlockInStateProofApplyFraudProof));
        if (!_isBlockChallengeEligible(dispute, proof.blockIndex)) return _invalid();

        bytes32 invalidStateProofBlockHash = keccak256(abi.encode(_getLastMilestoneBlock(dispute, proof.blockIndex)));
        FraudProof memory fraudProof = proof.fraudProof;

        // check for the applicable fraud proofs that they actually contain the invalidStateProofBlock inside them
        if (fraudProof.proofType == FraudProofType.BlockInvalidStateTransition) {
            BlockInvalidStateTransitionProof memory _proof =
                abi.decode(fraudProof.encodedProof, (BlockInvalidStateTransitionProof));
            bytes32 blockHash = keccak256(abi.encode(_proof.invalidBlock));
            if (blockHash != invalidStateProofBlockHash) {
                return _invalid();
            }
        } else if (fraudProof.proofType == FraudProofType.WrongGenesis) {
            WrongGenesisProof memory _proof = abi.decode(fraudProof.encodedProof, (WrongGenesisProof));
            bytes32 blockHash = keccak256(abi.encode(_proof.invalidBlock));
            if (blockHash != invalidStateProofBlockHash) {
                return _invalid();
            }
        } else if (fraudProof.proofType == FraudProofType.InvalidTimestamp) {
            InvalidTimestampProof memory _proof = abi.decode(fraudProof.encodedProof, (InvalidTimestampProof));
            bytes32 blockHash = keccak256(abi.encode(_proof.invalidBlock));
            if (blockHash != invalidStateProofBlockHash) {
                return _invalid();
            }
        } else if (fraudProof.proofType == FraudProofType.ForgedInboundMessageBlock) {
            ForgedInboundMessageBlockProof memory _proof =
                abi.decode(fraudProof.encodedProof, (ForgedInboundMessageBlockProof));
            bytes32 blockHash = keccak256(abi.encode(_proof.invalidBlock));
            if (blockHash != invalidStateProofBlockHash) {
                return _invalid();
            }
        } else {
            // FraudProofs like DoubleSign don't prove the stateProof is invalid or has double blocks, so it's a valid dispute, it just leaks information for the participant to be slashed regularly
            return _invalid();
        }

        address adr = runFraudProof(fraudProof, dispute);
        if (adr != address(0)) return _valid(dispute.input.disputer);
        return _invalid();
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

    function _isBlockChallengeEligible(Dispute memory dispute, uint256 blockIndex) internal returns (bool) {
        bytes memory result = _delegatecall(
            stateProofFacetAddress, abi.encodeCall(StateProofFacet.isBlockChallengeEligible, (dispute, blockIndex))
        );
        return abi.decode(result, (bool));
    }

    function _getLastMilestoneBlock(Dispute memory dispute, uint256 blockIndex)
        internal
        pure
        returns (SignedBlock memory)
    {
        MilestoneProof[] memory milestones = dispute.input.stateProof.milestones;
        return milestones[milestones.length - 1].blockConfirmations[blockIndex].signedBlock;
    }

    function isAuditingDataOmissionAllowed(Dispute memory dispute) public returns (bool) {
        return _isAuditingDataOmissionAllowed(dispute);
    }

    function hasStateProofHeaderMismatch(Dispute memory dispute) public returns (bool) {
        return _hasStateProofHeaderMismatch(dispute);
    }

    /// A block after the protected boundary of the last milestone names another channel or fork. History before the
    /// boundary is not judged here; an undecodable block is not eligible and is judged by the state-proof walk.
    function _hasStateProofHeaderMismatch(Dispute memory dispute) internal returns (bool) {
        MilestoneProof[] memory milestones = dispute.input.stateProof.milestones;
        if (milestones.length == 0) return false;
        BlockConfirmation[] memory lastRun = milestones[milestones.length - 1].blockConfirmations;
        for (uint256 i = 0; i < lastRun.length; i++) {
            (bool decoded, Block memory mb) =
                UtilityFacet(utilityFacetAddress).tryDecodeBlock(lastRun[i].signedBlock.encodedBlock);
            if (!decoded) continue;
            if (
                mb.transaction.header.channelId == dispute.input.channelId
                    && mb.transaction.header.forkId == dispute.input.forkId
            ) continue;
            if (_isBlockChallengeEligible(dispute, i)) return true;
        }
        return false;
    }

    function isDisputeInboundHashValid(Dispute memory dispute) public view returns (bool) {
        return _isDisputeInboundHashValid(dispute);
    }

    /// the historic set a dispute commits to at its inbound anchor; `_canParticipateInDisputesNow` is live eligibility
    function _getHistoricThresholdSet(Dispute memory dispute) internal view returns (address[] memory thresholdSet) {
        bytes32 channelId = dispute.input.channelId;
        // the chain set cannot move while a proof can land: adoption targets only the latest undisputed fork, a
        // disputed fork advances only by reduction, and joins and top-ups are refused on a disputed fork
        address[] memory participants = UtilityFacet(utilityFacetAddress).concatAddressArraysNoDuplicates(
            _getSnapshotParticipants(channelId),
            _derivePendingParticipantsFromInboundHash(
                channelId, dispute.input.latestInboundMessageBlockHash, bytes32(0)
            )
        );
        // the disputer picks the slashes; over-listing is provable by DisputeOnChainSlashesNotSubset
        return UtilityFacet(utilityFacetAddress).subtractAddressArrays(participants, dispute.input.onChainSlashes);
    }

    /**
     * Auditing data may be omitted when the proof is empty, when the last milestone contains the same-fork on-chain
     * anchor (its block at the anchor height commits it), or when everyone in the historic threshold set signed the
     * last milestone.
     */
    function _isAuditingDataOmissionAllowed(Dispute memory dispute) internal returns (bool) {
        MilestoneProof[] memory milestones = dispute.input.stateProof.milestones;
        if (milestones.length == 0) return true;
        MilestoneProof memory lastMilestone = milestones[milestones.length - 1];
        if (_doesMilestoneContainAnchor(dispute, lastMilestone)) return true;

        SnapshotData memory thresholdSnapshotData = stateSnapshots[dispute.input.channelId].snapshotData;
        thresholdSnapshotData.participants = _getHistoricThresholdSet(dispute);
        (bool isFinal,) = StateChannelManagerInterface(address(this)).isMilestoneFinal(
            dispute.input.forkId, thresholdSnapshotData, lastMilestone
        );
        return isFinal;
    }

    function _doesMilestoneContainAnchor(Dispute memory dispute, MilestoneProof memory milestone)
        internal
        view
        returns (bool)
    {
        (bool canUseOnChainSnapshot, StateSnapshot memory anchor) =
            _getAnchorSnapshot(dispute.input.channelId, dispute.input.forkId);
        if (!canUseOnChainSnapshot || milestone.blockConfirmations.length == 0) return false;
        (bool decoded, Block memory firstBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(milestone.blockConfirmations[0].signedBlock.encodedBlock);
        if (!decoded || firstBlock.transaction.header.transactionCnt > anchor.blockHeight) return false;
        uint256 offset = anchor.blockHeight - firstBlock.transaction.header.transactionCnt;
        if (offset >= milestone.blockConfirmations.length) return false;
        Block memory anchorBlock;
        (decoded, anchorBlock) = UtilityFacet(utilityFacetAddress).tryDecodeBlock(
            milestone.blockConfirmations[offset].signedBlock.encodedBlock
        );
        return decoded && anchorBlock.transaction.header.forkId == dispute.input.forkId
            && anchorBlock.transaction.header.transactionCnt == anchor.blockHeight
            && anchorBlock.stateSnapshotHash == keccak256(abi.encode(anchor));
    }
}
