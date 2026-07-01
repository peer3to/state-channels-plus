pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
import "./DisputeVerificationFacet.sol";
import "./StateProofFacet.sol";
import "./Errors.sol";
import "../types/DisputeFraudProofTypes.sol";
import "./utils/DisputeUtils.sol";
import "./utils/GeneralUtils.sol";
import "./UtilityFacet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract DisputeFraudProofFacet is StateChannelCommon {
    //This is a bit inefficient, since public/external functions always do a deep copy unlike internal/private that pass by reference, but this shares the context
    function applyDisputeFraudProofs(DisputeFraudProof[] memory proofs) public {
        for (uint256 i = 0; i < proofs.length; i++) {
            Dispute memory dispute = proofs[i].dispute;
            // not committed -> already killed (lost the kill-race) or never committed; no-op.
            if (!isDisputeCommitted(dispute)) continue;
            address slashedParticipant = _getHandle(proofs[i].proofType)(proofs[i].encodedProof, dispute);
            if (slashedParticipant == proofs[i].participant) {
                _delegatecall(
                    disputeVerificationFacetAddress, abi.encodeCall(DisputeVerificationFacet.killDispute, (dispute))
                );
            } else if (canParticipateInDisputes(dispute.input.channelId, msg.sender)) {
                addOnChainSlashedParticipant(dispute.input.channelId, msg.sender);
            }
        }
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
        return _handleInvalidDisputeFraudProofType;
    }

    function _valid(address adr) internal pure returns (address) {
        return adr;
    }

    function _invalid() internal pure returns (address) {
        return address(0);
    }

    function _handleInvalidDisputeFraudProofType(bytes memory, Dispute memory) internal pure returns (address) {
        return _invalid();
    }

    function _handleDisputeStateProofHeaderMismatch(bytes memory, Dispute memory dispute)
        internal
        pure
        returns (address)
    {
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

        bool isFinal = _isLastMilestoneFinalByEveryone(dispute);
        if (!isFinal) return _valid(dispute.input.disputer);
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

    function _handleDisputeInvalidStateProof(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        DisputeInvalidStateProof memory proof = abi.decode(encodedFraudProof, (DisputeInvalidStateProof));

        // TODO extract this into its own fraud proof and test it
        if (!dispute.postedAuditingData) {
            // fraud prover supplies the genesis reference -> it must be linked to the fork
            if (!_isGenesisSnapshotDataLinkedToFork(dispute.input.forkId, proof.auditingData.genesisStateSnapshotData))
            {
                return _invalid();
            }
            if (!_isLastMilestoneFinalByEveryone(dispute)) return _invalid();

            if (dispute.input.stateProof.signedBlocks.length != 0) {
                bytes memory linkReturnData = _delegatecall(
                    stateProofFacetAddress,
                    abi.encodeCall(
                        StateProofFacet.areSignedBlocksLinkedAndVerified, (dispute.input.stateProof.signedBlocks)
                    )
                );
                if (!abi.decode(linkReturnData, (bool))) return _valid(dispute.input.disputer);
            }

            bytes memory latestStateData = abi.encodeCall(
                StateProofFacet.isCorrectLatestState, (dispute, proof.auditingData.genesisStateSnapshotData)
            );
            (bool latestStateSuccess, bytes memory latestStateReturnData) =
                stateProofFacetAddress.delegatecall(latestStateData);
            if (!latestStateSuccess) return _invalid();

            bool isCorrectLatestState_ = abi.decode(latestStateReturnData, (bool));
            if (!isCorrectLatestState_) return _valid(dispute.input.disputer);
            return _invalid();
        }

        if (dispute.input.disputeAuditingDataHash != keccak256(abi.encode(proof.auditingData))) return _invalid();

        bytes memory returnData = _delegatecall(
            stateProofFacetAddress, abi.encodeCall(StateProofFacet.verifyStateProof, (dispute, proof.auditingData))
        );
        bool isValidStateProof = abi.decode(returnData, (bool));

        // false -> the state proof really is invalid -> slash disputer
        // true  -> fraud proof lied, the state proof is fine -> slash prover
        if (!isValidStateProof) return _valid(dispute.input.disputer);
        return _invalid();
    }

    function _handleDisputeInvalidBalanceInvariant(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        returns (address)
    {
        DisputeInvalidBalanceInvariant memory proof = abi.decode(encodedFraudProof, (DisputeInvalidBalanceInvariant));
        if (
            !_isLatestFinalizedStateLinkedToLatestFinalizedBlock(
                dispute, proof.latestStateSnapshot, proof.latestStateMachineState
            )
        ) {
            return _invalid();
        }

        bytes32 channelId = dispute.input.channelId;
        SnapshotData memory latestSnapshotData = proof.latestStateSnapshot.snapshotData;

        bytes memory result = _delegatecall(
            disputeVerificationFacetAddress,
            abi.encodeCall(
                DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot,
                (channelId, latestSnapshotData, proof.latestStateMachineState)
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
        address[] memory onChainSlashes = getOnChainSlashedParticipants(dispute.input.channelId);
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

        revert RaceConditionOnChainSlashes();
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

        uint256 timeoutTimestamp = StateChannelManagerProxy(address(this)).getDisputeWindowCreationTimestamp(
            dispute.input.channelId, dispute.input.forkId
        );
        uint256 previousTimestamp;
        (bool hasBlock, SignedBlock memory latestSignedBlock) = _getLatestSignedBlock(dispute.input.stateProof);
        bytes32 channelId = dispute.input.channelId;
        bytes32 forkId = dispute.input.forkId;
        if (!hasBlock) {
            // genesis
            if (!_isGenesisSnapshotDataLinkedToFork(forkId, proof.genesisStateSnapshotData)) return _invalid();
            (bool hasGenesis, uint256 genesisTimestamp) =
                getGenesisTimestamp(channelId, proof.genesisStateSnapshotData.originForkId, forkId);
            require(hasGenesis, RaceConditionGenesisTimestampNotAvailable());
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
                    require(proof.previousBlockOnChainTimestamp != 0, RaceConditionUnexpectedBlockCalldataPosted());
                    bytes32 _commitment = keccak256(abi.encode(latestSignedBlock, proof.previousBlockOnChainTimestamp));
                    if (commitment != _commitment) return _invalid();
                    else previousTimestamp = proof.previousBlockOnChainTimestamp;
                }
            }
        }
        (bool ok, uint256 minValidTimestamp) =
            Math.tryAdd(previousTimestamp, getP2pTime() + getAgreementTime() + getChainFallbackTime());
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
        SignedBlock memory postedBlock = timeoutCalldataPostedProof.postedBlock;
        Block memory _block = abi.decode(postedBlock.encodedBlock, (Block));
        StateSnapshot memory latestStateSnapshot = timeoutCalldataPostedProof.latestStateSnapshot;

        // Check channelId
        if (!_areDisputeAndBlockSameChannel(dispute, _block)) return _invalid();

        // Check forkId
        if (!_areDisputeAndBlockSameFork(dispute, _block)) return _invalid();

        // Check timeout == postedBlock
        if (dispute.input.timeout.blockHeight != _getBlockHeight(_block)) return _invalid();

        // Check timeout participant == block author
        if (dispute.input.timeout.participant != _getBlockAuthor(_block)) return _invalid();

        // Check block calldata posted
        (bool isFound, bytes32 commitment) = getBlockCallDataCommitment(
            _getDisputeChannel(dispute),
            _getDisputeFork(dispute),
            dispute.input.timeout.blockHeight,
            dispute.input.timeout.participant
        );
        if (!isFound) return _invalid();
        bytes32 _commitment = keccak256(abi.encode(postedBlock, timeoutCalldataPostedProof.onChainTimestamp));
        if (commitment != _commitment) return _invalid();

        // get previousTimestamp
        (bool hasBlock, Block memory latestBlock) = _getLatestBlock(dispute.input.stateProof);
        uint256 previousTimestamp;
        if (!hasBlock) {
            // genesis
            if (
                !_isGenesisSnapshotDataLinkedToFork(
                    dispute.input.forkId, timeoutCalldataPostedProof.genesisStateSnapshotData
                )
            ) {
                return _invalid();
            }
            (bool hasGenesis, uint256 genesisTimestamp) = getGenesisTimestamp(
                dispute.input.channelId,
                timeoutCalldataPostedProof.genesisStateSnapshotData.originForkId,
                dispute.input.forkId
            );
            require(hasGenesis, RaceConditionGenesisTimestampNotAvailable());
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
                    revert RaceConditionUnexpectedBlockCalldataPosted();
                }

                bytes32 _previousBlockCommitment = keccak256(
                    abi.encode(
                        timeoutCalldataPostedProof.previousBlockcalldata,
                        timeoutCalldataPostedProof.previousBlockOnChainTimestamp
                    )
                );
                if (previousBlockCommitment != _previousBlockCommitment) return _invalid();
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
        (bool ok, uint256 maxValidTimestamp) =
            Math.tryAdd(previousTimestamp, getP2pTime() + getAgreementTime() + getChainFallbackTime());
        if (ok && timeoutCalldataPostedProof.onChainTimestamp > maxValidTimestamp) {
            return _invalid();
        }
        // make sure we can do the STF - it's a valid block
        bool isSuccess;
        bytes memory encodedModifiedState;
        Message[] memory outboundMessages;
        (isSuccess, encodedModifiedState, outboundMessages) = StateChannelManagerProxy(address(this))
            .executeStateTransition(
            dispute.input.channelId, timeoutCalldataPostedProof.latestStateStateMachineState, _block.transaction
        );
        if (!isSuccess) {
            return _invalid();
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
            return _invalid();
        }
        return _valid(dispute.input.disputer);
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

        if (blockIndexInUnfinalizedPartOfStateProof >= blockConfirmations.length) {
            return _invalid();
        }

        bytes32 invalidStateProofBlockHash =
            keccak256(abi.encode(blockConfirmations[blockIndexInUnfinalizedPartOfStateProof].signedBlock));
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

    function isLastMilestoneFinalByEveryone(Dispute memory dispute) public returns (bool isFinal) {
        return _isLastMilestoneFinalByEveryone(dispute);
    }

    function hasStateProofHeaderMismatch(Dispute memory dispute) public pure returns (bool) {
        return _hasStateProofHeaderMismatch(dispute);
    }

    function isDisputeInboundHashValid(Dispute memory dispute) public view returns (bool) {
        return _isDisputeInboundHashValid(dispute);
    }

    function _deriveExpectedParticipantsForDispute(Dispute memory dispute)
        internal
        view
        returns (address[] memory expectedParticipants)
    {
        return _deriveEligibleParticipantsFromInboundHash(
            dispute.input.channelId, dispute.input.latestInboundMessageBlockHash
        );
    }

    function _isLastMilestoneFinalByEveryone(Dispute memory dispute) internal returns (bool isFinal) {
        if (dispute.input.stateProof.milestones.length == 0) {
            return true;
        }

        address[] memory expectedParticipants = _deriveExpectedParticipantsForDispute(dispute);

        MilestoneProof memory lastMilestone =
            dispute.input.stateProof.milestones[dispute.input.stateProof.milestones.length - 1];

        SnapshotData memory thresholdSnapshotData = stateSnapshots[dispute.input.channelId].snapshotData;
        thresholdSnapshotData.participants = expectedParticipants;

        (isFinal,) = StateChannelManagerProxy(address(this)).isMilestoneFinal(
            dispute.input.forkId, thresholdSnapshotData, lastMilestone
        );
    }
}
