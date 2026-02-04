pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
import "./Errors.sol";
import "../types/FraudProofTypes.sol";
import "./UtilityFacet.sol";

contract FraudProofFacet is StateChannelCommon {
    //This is a bit inefficient, since public/external functions always do a deep copy unlike internal/private that pas by reference, but this shares the context
    function applyFraudProofs(
        FraudProof[] memory fraudProofs,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) public {
        FraudProof[] memory proofs = fraudProofs;
        for (uint256 i = 0; i < proofs.length; i++) {
            if (!isParticipantSlashedOnChain(fraudProofVerificationContext.channelId, proofs[i].participant)) {
                address slashedParticipant = runFraudProof(proofs[i], fraudProofVerificationContext);
                if (slashedParticipant == address(0) || slashedParticipant != proofs[i].participant) {
                    // slash the disputer
                    slashedParticipant = msg.sender;
                }
                // if in (participants || pendingParticipants) && !slashedOnChain
                if (canParticipateInDisputes(fraudProofVerificationContext.channelId, slashedParticipant)) {
                    addOnChainSlashedParticipant(fraudProofVerificationContext.channelId, slashedParticipant);
                }
            }
        }
    }

    function runFraudProof(
        FraudProof memory fraudProof,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) public returns (address) {
        return _getHandle(fraudProof.proofType)(fraudProof, fraudProofVerificationContext);
    }

    function _getHandle(FraudProofType proofType)
        internal
        pure
        returns (function(FraudProof memory, FraudProofVerificationContext memory) internal returns (address))
    {
        if (proofType == FraudProofType.BlockDoubleSign) return _handleBlockDoubleSign;
        if (proofType == FraudProofType.BlockInvalidStateTransition) return _handleBlockInvalidStateTransition;
        if (proofType == FraudProofType.WrongGenesis) return _handleWrongGenesis;
        if (proofType == FraudProofType.ForgedInboundMessageBlock) return _handleForgedInboundMessageBlock;
        return _handleInvalidFraudProofType;
    }

    function _valid(address adr) internal pure returns (address) {
        return adr;
    }

    function _invalid() internal pure returns (address) {
        return address(0);
    }

    function _handleInvalidFraudProofType(FraudProof memory, FraudProofVerificationContext memory)
        internal
        pure
        returns (address)
    {
        return _invalid();
    }

    // ******************************* FRAUD PROOF IMPLEMENTATION *******************************

    // ------------------------------- Block Fraud Proofs ---------------------------------------
    function _handleBlockDoubleSign(
        FraudProof memory fraudProof,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) internal view returns (address) {
        BlockDoubleSignProof memory blockDoubleSignProof = abi.decode(fraudProof.encodedProof, (BlockDoubleSignProof));

        Block memory block1 = abi.decode(blockDoubleSignProof.block1.encodedBlock, (Block));
        Block memory block2 = abi.decode(blockDoubleSignProof.block2.encodedBlock, (Block));

        if (
            fraudProofVerificationContext.channelId != block1.transaction.header.channelId
                || fraudProofVerificationContext.channelId != block2.transaction.header.channelId
        ) {
            return _invalid();
        }

        if (!(block1.transaction.header.forkId == block2.transaction.header.forkId
                    && block1.transaction.header.transactionCnt == block2.transaction.header.transactionCnt
                    && keccak256(abi.encode(block1)) != keccak256(abi.encode(block2)))) {
            return _invalid();
        }

        (address signer1,) = UtilityFacet(utilityFacetAddress)
            .retrieveSignerAddress(blockDoubleSignProof.block1.encodedBlock, blockDoubleSignProof.block1.signature);
        (address signer2,) = UtilityFacet(utilityFacetAddress)
            .retrieveSignerAddress(blockDoubleSignProof.block2.encodedBlock, blockDoubleSignProof.block2.signature);
        if (signer1 != signer2) {
            return _invalid();
        }
        return _valid(signer1);
    }

    function _handleBlockInvalidStateTransition(
        FraudProof memory fraudProof,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) internal returns (address) {
        BlockInvalidStateTransitionProof memory
            blockInvalidSTProof = abi.decode(fraudProof.encodedProof, (BlockInvalidStateTransitionProof));
        Block memory fraudBlock = abi.decode(blockInvalidSTProof.invalidBlock.encodedBlock, (Block));
        StateSnapshot memory previousStateSnapshot = blockInvalidSTProof.previousBlockStateSnapshot;
        bytes memory previousStateStateMachineState = blockInvalidSTProof.previousStateStateMachineState;

        (address signer,) = UtilityFacet(utilityFacetAddress)
            .retrieveSignerAddress(
                blockInvalidSTProof.invalidBlock.encodedBlock, blockInvalidSTProof.invalidBlock.signature
            );

        bool isSuccess;
        bytes memory encodedModifiedState;
        Message[] memory outboundMessages;
        if (fraudProofVerificationContext.channelId != fraudBlock.transaction.header.channelId) {
            return _invalid();
        }

        if (previousStateSnapshot.forkId != fraudBlock.transaction.header.forkId) return _valid(signer);
        if (fraudBlock.transaction.header.transactionCnt == 0) {
            if (fraudBlock.previousBlockHash != keccak256(abi.encode(previousStateSnapshot))) return _invalid();
            if (previousStateSnapshot.snapshotData.stateMachineStateHash != keccak256(previousStateStateMachineState)) {
                return _invalid();
            }
        } else {
            Block memory previousBlock = abi.decode(blockInvalidSTProof.previousBlock.encodedBlock, (Block));
            if (fraudBlock.previousBlockHash != keccak256(abi.encode(previousBlock))) return _invalid();

            if (
                previousStateSnapshot.snapshotData.stateMachineStateHash != keccak256(previousStateStateMachineState)
                    || previousBlock.stateSnapshotHash != keccak256(abi.encode(previousStateSnapshot))
            ) {
                return _invalid();
            }
        }

        (isSuccess, encodedModifiedState, outboundMessages) = StateChannelManagerProxy(address(this))
            .executeStateTransition(
                fraudProofVerificationContext.channelId, previousStateStateMachineState, fraudBlock.transaction
            );
        if (!isSuccess) {
            return _valid(signer);
        }

        SnapshotData memory newSnapshotData = previousStateSnapshot.snapshotData;
        if (outboundMessages.length > 0) {
            for (uint256 i = 0; i < outboundMessages.length; i++) {
                newSnapshotData.totalWithdrawals = stateMachineImplementation.addBalance(
                    newSnapshotData.totalWithdrawals, outboundMessages[i].balance
                );
            }

            newSnapshotData.latestOutboundMessageBlockHeight += 1;

            MessageBlock memory outboundMessageBlock;
            outboundMessageBlock.previousBlockHash = newSnapshotData.latestOutboundMessageBlockHash;
            outboundMessageBlock.blockHeight = newSnapshotData.latestOutboundMessageBlockHeight;
            outboundMessageBlock.messages = outboundMessages;
            outboundMessageBlock.totalBalance = newSnapshotData.totalWithdrawals;
            outboundMessageBlock.timestamp = fraudBlock.transaction.header.timestamp;
            newSnapshotData.latestOutboundMessageBlockHash = keccak256(abi.encode(outboundMessageBlock));
        }

        if (fraudBlock.messageBlocks.length > 0) {
            for (uint256 i = 0; i < fraudBlock.messageBlocks.length; i++) {
                if (fraudBlock.messageBlocks[i].previousBlockHash != newSnapshotData.latestInboundMessageBlockHash) {
                    return _valid(signer);
                }
                uint256 expectedInboundHeight = newSnapshotData.latestInboundMessageBlockHeight + 1;
                if (fraudBlock.messageBlocks[i].blockHeight != expectedInboundHeight) {
                    return _valid(signer);
                }
                newSnapshotData.latestInboundMessageBlockHeight = expectedInboundHeight;
                newSnapshotData.latestInboundMessageBlockHash = keccak256(abi.encode(fraudBlock.messageBlocks[i]));
            }
            (encodedModifiedState, newSnapshotData.totalDeposits) =
                _applyInboundMessages(encodedModifiedState, fraudBlock.messageBlocks, newSnapshotData.totalDeposits);
        }

        newSnapshotData.stateMachineStateHash = keccak256(encodedModifiedState);
        newSnapshotData.participants = getStateMachineParticipants(encodedModifiedState);
        newSnapshotData.originForkId = previousStateSnapshot.forkId;

        StateSnapshot memory newStateSnapshot = StateSnapshot({
            snapshotData: newSnapshotData,
            forkId: previousStateSnapshot.forkId,
            blockHeight: previousStateSnapshot.blockHeight + 1,
            timestamp: fraudBlock.transaction.header.timestamp
        });
        if (fraudBlock.stateSnapshotHash == keccak256(abi.encode(newStateSnapshot))) {
            return _invalid();
        } // valid state transition

        return _valid(signer);
    }

    function _handleWrongGenesis(FraudProof memory fraudProof, FraudProofVerificationContext memory)
        internal
        view
        returns (address)
    {
        WrongGenesisProof memory proof = abi.decode(fraudProof.encodedProof, (WrongGenesisProof));
        SignedBlock memory signedBlock = proof.invalidBlock;
        if (!isBlockAuthentic(signedBlock)) return _invalid();
        Block memory _block = abi.decode(signedBlock.encodedBlock, (Block));
        if (_block.transaction.header.transactionCnt != 0) return _invalid();

        bytes32 channelId = _block.transaction.header.channelId;
        bytes32 forkId = _block.transaction.header.forkId;
        address blockAuthor = _block.transaction.header.participant;
        StateSnapshot memory correctGenesisSnapshot = proof.genesisSnapshot;
        bytes32 originForkId = correctGenesisSnapshot.snapshotData.originForkId;
        StateSnapshot memory onChainSnapshot = getStateSnapshot(channelId);

        if (onChainSnapshot.forkId == forkId) {
            if (!UtilityFacet(utilityFacetAddress).isGenesisSnapshotWithoutTimeCheck(onChainSnapshot)) {
                return _invalid();
            }
            if (_block.previousBlockHash != keccak256(abi.encode(onChainSnapshot))) return _valid(blockAuthor);
        }

        // not onChainSnapshot -> need dispute window
        if (forkId != keccak256(abi.encode(correctGenesisSnapshot.snapshotData))) return _invalid();
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow =
            _disputeData.disputeWindowMap[correctGenesisSnapshot.snapshotData.originForkId];
        (bool isExpired,) = _isKillPeriodExpired(disputeWindow, getEvidenceTime());
        require(isExpired, RaceConditionDisputeKillPeriodNotExpired());
        (bool isAvailable, uint256 timestamp) = getGenesisTimestamp(channelId, originForkId, forkId);
        require(isAvailable, RaceConditionGenesisTimestampNotAvailable());
        if (timestamp != correctGenesisSnapshot.timestamp) return _invalid();
        if (!UtilityFacet(utilityFacetAddress).isGenesisSnapshotWithoutTimeCheck(correctGenesisSnapshot)) {
            return _invalid();
        }
        if (_block.previousBlockHash != keccak256(abi.encode(correctGenesisSnapshot))) return _valid(blockAuthor);
        return _invalid();
    }

    function _handleForgedInboundMessageBlock(
        FraudProof memory fraudProof,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) internal view returns (address) {
        ForgedInboundMessageBlockProof memory proof =
            abi.decode(fraudProof.encodedProof, (ForgedInboundMessageBlockProof));

        if (!isBlockAuthentic(proof.invalidBlock)) return _invalid();

        Block memory fraudBlock = abi.decode(proof.invalidBlock.encodedBlock, (Block));
        if (fraudBlock.transaction.header.channelId != fraudProofVerificationContext.channelId) {
            return _invalid();
        }

        bytes32 messageBlockHash = keccak256(abi.encode(proof.forgedInboundMessageBlock));
        bool isIncluded = false;
        for (uint256 i = 0; i < fraudBlock.messageBlocks.length; i++) {
            if (keccak256(abi.encode(fraudBlock.messageBlocks[i])) == messageBlockHash) {
                isIncluded = true;
                break;
            }
        }
        if (!isIncluded) {
            return _invalid();
        }

        MessageBlock storage persistedBlock =
            inboundMessageBlockMap[fraudProofVerificationContext.channelId][messageBlockHash];
        if (persistedBlock.timestamp != 0 || persistedBlock.messages.length != 0) {
            return _invalid();
        }

        StateSnapshot memory onChainSnapshot = getStateSnapshot(fraudProofVerificationContext.channelId);
        if (onChainSnapshot.snapshotData.latestInboundMessageBlockHash == messageBlockHash) {
            return _invalid();
        }

        return _valid(fraudBlock.transaction.header.participant); // true, since block is authentic
    }
}
