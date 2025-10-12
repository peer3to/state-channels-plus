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
                address slashedParticipant = _getHandle(proofs[i].proofType)(proofs[i], fraudProofVerificationContext);
                if (slashedParticipant == address(0) || slashedParticipant != proofs[i].participant) {
                    // slash the disputer
                    slashedParticipant = msg.sender;
                }
                // if in (participants || pendingParticipants) && !slashedOnChain
                if (_canParticipateInDisputes(fraudProofVerificationContext.channelId, slashedParticipant)) {
                    addOnChainSlashedParticipant(fraudProofVerificationContext.channelId, slashedParticipant);
                }
            }
        }
    }

    function _getHandle(FraudProofType proofType)
        internal
        returns (
            function(FraudProof memory fraudProof, FraudProofVerificationContext memory fraudProofVerificationContext) internal returns (address)
        )
    {
        if (proofType == FraudProofType.BlockDoubleSign) return _handleBlockDoubleSign;
        if (proofType == FraudProofType.BlockInvalidStateTransition) return _handleBlockInvalidStateTransition;
        if (proofType == FraudProofType.WrongGenesis) return _handleWrongGenesis;
        revert ErrorInvalidFraudProofType();
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
            revert ErrorNotSameChannelId();
        }

        if (
            !(
                block1.transaction.header.forkId == block2.transaction.header.forkId
                    && block1.transaction.header.transactionCnt == block2.transaction.header.transactionCnt
                    && keccak256(abi.encode(block1)) != keccak256(abi.encode(block2))
            )
        ) {
            revert ErrorDoubleSignBlocksNotSame();
        }

        address signer1 = UtilityFacet(utilityFacetAddress).retrieveSignerAddress(
            blockDoubleSignProof.block1.encodedBlock, blockDoubleSignProof.block1.signature
        );
        address signer2 = UtilityFacet(utilityFacetAddress).retrieveSignerAddress(
            blockDoubleSignProof.block2.encodedBlock, blockDoubleSignProof.block2.signature
        );
        if (signer1 != signer2) {
            return address(0);
        }
        return signer1;
    }

    function _handleBlockInvalidStateTransition(
        FraudProof memory fraudProof,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) internal returns (address) {
        BlockInvalidStateTransitionProof memory blockInvalidSTProof =
            abi.decode(fraudProof.encodedProof, (BlockInvalidStateTransitionProof));
        Block memory fraudBlock = abi.decode(blockInvalidSTProof.invalidBlock.encodedBlock, (Block));
        StateSnapshot memory previousStateSnapshot = blockInvalidSTProof.previousBlockStateSnapshot;
        bytes memory previousStateStateMachineState = blockInvalidSTProof.previousStateStateMachineState;

        address signer = UtilityFacet(utilityFacetAddress).retrieveSignerAddress(
            blockInvalidSTProof.invalidBlock.encodedBlock, blockInvalidSTProof.invalidBlock.signature
        );

        if (fraudProofVerificationContext.channelId != fraudBlock.transaction.header.channelId) {
            revert ErrorNotSameChannelId();
        }

        if (previousStateSnapshot.forkId != fraudBlock.transaction.header.forkId) return signer;
        if (fraudBlock.transaction.header.transactionCnt == 0) {
            require(fraudBlock.previousBlockHash == keccak256(abi.encode(previousStateSnapshot)));
            require(
                previousStateSnapshot.snapshotData.stateMachineStateHash == keccak256(previousStateStateMachineState),
                ErrorInvalidStateSnapshot()
            );
        } else {
            Block memory previousBlock = abi.decode(blockInvalidSTProof.previousBlock.encodedBlock, (Block));
            require(fraudBlock.previousBlockHash == keccak256(abi.encode(previousBlock)), ErrorLinkingPreviousBlock());

            require(
                previousStateSnapshot.snapshotData.stateMachineStateHash == keccak256(previousStateStateMachineState)
                    && previousBlock.stateSnapshotHash == keccak256(abi.encode(previousStateSnapshot)),
                ErrorInvalidStateSnapshotHash()
            );
        }

        (bool isSuccess, bytes memory encodedModifiedState) = StateChannelManagerProxy(address(this))
            .executeStateTransition(
            fraudProofVerificationContext.channelId, previousStateStateMachineState, fraudBlock.transaction
        );
        if (!isSuccess) {
            return signer;
        }
        SnapshotData memory newSnapshotData = SnapshotData({
            originForkId: previousStateSnapshot.forkId,
            stateMachineStateHash: keccak256(encodedModifiedState),
            participants: getStateMachineParticipants(encodedModifiedState),
            latestJoinChannelBlockHash: previousStateSnapshot.snapshotData.latestJoinChannelBlockHash,
            latestExitChannelBlockHash: previousStateSnapshot.snapshotData.latestExitChannelBlockHash,
            totalDeposits: previousStateSnapshot.snapshotData.totalDeposits,
            totalWithdrawals: previousStateSnapshot.snapshotData.totalWithdrawals
        });

        StateSnapshot memory newStateSnapshot = StateSnapshot({
            snapshotData: newSnapshotData,
            forkId: previousStateSnapshot.forkId,
            blockHeight: previousStateSnapshot.blockHeight + 1,
            timestamp: fraudBlock.transaction.header.timestamp
        });
        require(fraudBlock.stateSnapshotHash == keccak256(abi.encode(newStateSnapshot)), ErrorValidStateTransition());

        return signer;
    }

    function _handleWrongGenesis(
        FraudProof memory fraudProof,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) internal view returns (address) {
        WrongGenesisProof memory proof = abi.decode(fraudProof.encodedProof, (WrongGenesisProof));
        SignedBlock memory signedBlock = proof.invalidBlock;
        if (!isBlockAuthentic(signedBlock)) return address(0); // slash the caller
        Block memory _block = abi.decode(signedBlock.encodedBlock, (Block));
        if (_block.transaction.header.transactionCnt != 0) return address(0); // slash the caller

        bytes32 channelId = _block.transaction.header.channelId;
        bytes32 forkId = _block.transaction.header.forkId;
        address blockAuthor = _block.transaction.header.participant;
        StateSnapshot memory correctGenesisSnapshot = proof.genesisSnapshot;
        bytes32 originForkId = correctGenesisSnapshot.snapshotData.originForkId;
        StateSnapshot memory onChainSnapshot = getStateSnapshot(channelId);

        if (onChainSnapshot.forkId == forkId) {
            require(
                UtilityFacet(utilityFacetAddress).isGenesisSnapshotWithoutTimeCheck(onChainSnapshot),
                ErrorNotGenesisSnapshot()
            );
            if (_block.previousBlockHash != keccak256(abi.encode(onChainSnapshot))) return blockAuthor;
        }

        // not onChainSnapshot -> need dispute window
        if (forkId != keccak256(abi.encode(correctGenesisSnapshot.snapshotData))) return address(0);
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow =
            _disputeData.disputeWindowMap[correctGenesisSnapshot.snapshotData.originForkId];
        (bool isExpired,) = _isKillPeriodExpired(disputeWindow, getEvidenceTime());
        require(isExpired, ErrorDisputeKillPeriodNotExpired());
        (bool isAvailable, uint256 timestamp) = getGenesisTimestamp(channelId, originForkId, forkId);
        require(isAvailable, ErrorGenesisTimestampNotAvailable());
        if (timestamp != correctGenesisSnapshot.timestamp) return address(0);
        if (!UtilityFacet(utilityFacetAddress).isGenesisSnapshotWithoutTimeCheck(correctGenesisSnapshot)) {
            return address(0);
        }
        if (_block.previousBlockHash != keccak256(abi.encode(correctGenesisSnapshot))) return blockAuthor;
        return address(0);
    }
}
