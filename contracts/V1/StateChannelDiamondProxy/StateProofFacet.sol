pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./UtilityFacet.sol";
import "./Errors.sol";
import "hardhat/console.sol";

contract StateProofFacet is StateChannelCommon {
    function isCorrectLatestState(Dispute memory dispute, SnapshotData memory genesisStateSnapshotData)
        public
        view
        virtual
        returns (bool)
    {
        if (dispute.input.stateProof.milestones.length != 0 && dispute.input.stateProof.signedBlocks.length != 0) {
            return false;
        }

        (bool validLatestBlock, bool hasBlock, Block memory latestBlock) = _tryGetLatestBlock(dispute.input.stateProof);
        if (!validLatestBlock) {
            return false;
        }
        if (hasBlock) {
            return (latestBlock.stateSnapshotHash == dispute.input.latestStateSnapshotHash);
        }

        if (!_isGenesisSnapshotDataLinkedToFork(dispute.input.forkId, genesisStateSnapshotData)) {
            return false;
        }

        (bool hasGenesisTimestamp, uint256 genesisTimestamp) =
            getGenesisTimestamp(dispute.input.channelId, genesisStateSnapshotData.originForkId, dispute.input.forkId);
        if (!hasGenesisTimestamp) {
            return false;
        }

        StateSnapshot memory genesisStateSnapshot = StateSnapshot({
            snapshotData: genesisStateSnapshotData,
            forkId: dispute.input.forkId,
            blockHeight: 0,
            timestamp: genesisTimestamp
        });
        return (dispute.input.latestStateSnapshotHash == keccak256(abi.encode(genesisStateSnapshot)));
    }

    function verifyStateProof(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        virtual
        returns (bool)
    {
        // reference check - is this the auditingData the dispute committed to?
        if (dispute.input.disputeAuditingDataHash != keccak256(abi.encode(disputeAuditingData))) {
            return false;
        }

        if (!_isGenesisSnapshotDataLinkedToFork(dispute.input.forkId, disputeAuditingData.genesisStateSnapshotData)) {
            return false;
        }
        if (dispute.input.stateProof.milestones.length != 0 && dispute.input.stateProof.signedBlocks.length != 0) {
            return false;
        }

        if (!_tryVerifyMilestones(dispute, disputeAuditingData)) {
            return false;
        }

        if (dispute.input.stateProof.signedBlocks.length != 0) {
            if (!_areSignedBlocksLinkedAndVerified(dispute.input.stateProof.signedBlocks)) {
                return false;
            }
        }

        if (!isCorrectLatestState(dispute, disputeAuditingData.genesisStateSnapshotData)) {
            return false;
        }

        //check commitment to latestStateSnapshot
        if (dispute.input.latestStateSnapshotHash != keccak256(abi.encode(disputeAuditingData.latestStateSnapshot))) {
            return false;
        }
        return true;
    }

    function _tryGetLatestBlock(StateProof memory stateProof)
        internal
        view
        returns (bool isValid, bool hasBlock, Block memory blockData)
    {
        SignedBlock memory latestSignedBlock;
        (hasBlock, latestSignedBlock) = _getLatestSignedBlock(stateProof);
        if (!hasBlock) {
            return (true, false, blockData);
        }

        (bool decoded, Block memory latestBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(latestSignedBlock.encodedBlock);
        if (!decoded) {
            return (false, true, blockData);
        }
        return (true, true, latestBlock);
    }

    function _tryVerifyMilestones(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        internal
        returns (bool isValid)
    {
        StateSnapshot memory genesisStateSnapshot = StateSnapshot({
            snapshotData: disputeAuditingData.genesisStateSnapshotData,
            forkId: dispute.input.forkId,
            blockHeight: 0,
            timestamp: 0
        });

        try StateChannelManagerInterface(address(this)).verifyMilestones(
            dispute.input.forkId,
            dispute.input.stateProof.milestones,
            disputeAuditingData.milestoneSnapshots,
            genesisStateSnapshot
        ) returns (bool milestoneProofsValid) {
            return milestoneProofsValid;
        } catch {
            return false;
        }
    }

    function areSignedBlocksLinkedAndVerified(SignedBlock[] memory signedBlocks) public view returns (bool) {
        return _areSignedBlocksLinkedAndVerified(signedBlocks);
    }

    function isInvalidBlockStructureInStateProof(StateProof memory stateProof, uint256 blockIndex)
        public
        view
        returns (bool)
    {
        BlockConfirmation[] memory unfinalized = _getUnfinalizedBlockConfirmationsFromStateProof(stateProof);
        if (blockIndex >= unfinalized.length) return false;

        return _isInvalidBlockStructureInStateProof(stateProof, unfinalized, blockIndex);
    }

    function findFirstInvalidBlockStructureInStateProof(StateProof memory stateProof)
        public
        view
        returns (bool found, uint256 blockIndex)
    {
        BlockConfirmation[] memory unfinalized = _getUnfinalizedBlockConfirmationsFromStateProof(stateProof);
        for (uint256 i = 0; i < unfinalized.length; i++) {
            if (_isInvalidBlockStructureInStateProof(stateProof, unfinalized, i)) return (true, i);
        }
        return (false, 0);
    }

    function _isInvalidBlockStructureInStateProof(
        StateProof memory stateProof,
        BlockConfirmation[] memory unfinalized,
        uint256 blockIndex
    ) internal view returns (bool) {
        SignedBlock memory currentSignedBlock = unfinalized[blockIndex].signedBlock;
        if (!isBlockAuthentic(currentSignedBlock)) return true;

        (bool currentDecoded, Block memory currentBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(currentSignedBlock.encodedBlock);
        if (!currentDecoded) return true;

        if (stateProof.milestones.length == 0 && blockIndex == 0) {
            return currentBlock.transaction.header.transactionCnt != 0;
        }

        SignedBlock memory previousSignedBlock;
        if (stateProof.milestones.length > 0) {
            MilestoneProof memory lastMilestone = stateProof.milestones[stateProof.milestones.length - 1];
            previousSignedBlock = lastMilestone.blockConfirmations[blockIndex].signedBlock;
        } else {
            previousSignedBlock = stateProof.signedBlocks[blockIndex - 1];
        }

        (bool previousDecoded, Block memory previousBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(previousSignedBlock.encodedBlock);
        if (!previousDecoded) return true;

        return currentBlock.previousBlockHash != keccak256(previousSignedBlock.encodedBlock)
            || currentBlock.transaction.header.transactionCnt != previousBlock.transaction.header.transactionCnt + 1;
    }

    function _areSignedBlocksLinkedAndVerified(SignedBlock[] memory signedBlocks)
        internal
        view
        returns (bool isLinked)
    {
        bytes32 previousBlockHash;
        for (uint256 i = 0; i < signedBlocks.length; i++) {
            bytes memory currentBlockEncoded = signedBlocks[i].encodedBlock;
            (bool decoded, Block memory currentBlock) =
                UtilityFacet(utilityFacetAddress).tryDecodeBlock(currentBlockEncoded);
            if (!decoded) {
                return false;
            }
            //check is linked
            if (i == 0 && currentBlock.transaction.header.transactionCnt != 0) {
                return false;
            }
            if (i != 0 && previousBlockHash != currentBlock.previousBlockHash) {
                return false;
            }
            previousBlockHash = keccak256(currentBlockEncoded);
            //verify original signature
            (address signer, bool isValid) =
                UtilityFacet(utilityFacetAddress).retrieveSignerAddress(currentBlockEncoded, signedBlocks[i].signature);
            if (!isValid) {
                return false;
            }
            if (signer != currentBlock.transaction.header.participant) {
                return false;
            }

            // This doesn't check if the signer is a participant -> if it's a dishonest block it will fail on the STF and the dispute will be slashed
        }
        return true;
    }

    function _deriveMilestoneUnionParticipants(
        bytes32 channelId,
        SnapshotData memory previousSnapshotData,
        SnapshotData memory resultingSnapshotData
    ) internal view returns (address[] memory expectedParticipants) {
        expectedParticipants = UtilityFacet(utilityFacetAddress).concatAddressArraysNoDuplicates(
            previousSnapshotData.participants, resultingSnapshotData.participants
        );

        if (channelId == bytes32(0)) {
            return expectedParticipants;
        }

        address[] memory pendingParticipants = _derivePendingParticipantsFromInboundHash(
            channelId,
            resultingSnapshotData.latestInboundMessageBlockHash,
            previousSnapshotData.latestInboundMessageBlockHash
        );
        expectedParticipants =
            UtilityFacet(utilityFacetAddress).concatAddressArraysNoDuplicates(expectedParticipants, pendingParticipants);
        return expectedParticipants;
    }

    function _isMilestoneFinalWithExpectedParticipants(
        bytes32 forkId,
        address[] memory expectedParticipants,
        MilestoneProof memory milestone
    ) internal view returns (bool isFinal, bytes32 finalizedSnapshotHash) {
        address[] memory thresholdSet = new address[](expectedParticipants.length);
        uint256 thresholdCount = 0;
        bytes memory previousEncodedBlock;
        BlockConfirmation memory currentBlockConfirmation;
        Block memory currentBlock;
        address adr;
        bool isValid;
        console.log("_isMilestoneFinal: forkId");
        console.logBytes32(forkId);
        console.log("_isMilestoneFinal: expectedParticipants", expectedParticipants.length);
        console.log("_isMilestoneFinal: confirmations", milestone.blockConfirmations.length);
        if (milestone.blockConfirmations.length == 0) {
            return (false, bytes32(0));
        }
        for (uint256 i = 0; i < milestone.blockConfirmations.length; i++) {
            currentBlockConfirmation = milestone.blockConfirmations[i];
            (bool decoded, Block memory decodedBlock) =
                UtilityFacet(utilityFacetAddress).tryDecodeBlock(currentBlockConfirmation.signedBlock.encodedBlock);
            if (!decoded) {
                return (false, bytes32(0));
            }
            currentBlock = decodedBlock;
            if (currentBlock.transaction.header.forkId != forkId) {
                console.log("_isMilestoneFinal: fail forkId mismatch at i", i);
                console.logBytes32(currentBlock.transaction.header.forkId);
                return (false, bytes32(0));
            }
            //check linked
            if (i != 0) {
                if (currentBlock.previousBlockHash != keccak256(previousEncodedBlock)) {
                    console.log("_isMilestoneFinal: fail not linked at i", i);
                    return (false, bytes32(0));
                }
            } else {
                finalizedSnapshotHash = currentBlock.stateSnapshotHash;
            }
            // Collect signatures
            (adr, isValid) = UtilityFacet(utilityFacetAddress).retrieveSignerAddress(
                currentBlockConfirmation.signedBlock.encodedBlock, currentBlockConfirmation.signedBlock.signature
            );
            if (!isValid || adr != currentBlock.transaction.header.participant) {
                console.log("_isMilestoneFinal: fail invalid author signature at i", i);
                return (false, bytes32(0));
            }
            bool isParticipant = UtilityFacet(utilityFacetAddress).isAddressInArray(expectedParticipants, adr);
            if (isParticipant) {
                // TODO - need a gas limit on verifyMilestone and on verifyStateProof, so large proofs that can't be verified won't be spamed
                thresholdCount =
                    _tryInsertAddressInThresholdSet(adr, thresholdSet, thresholdCount, expectedParticipants);
            }

            for (uint256 j = 0; j < currentBlockConfirmation.signatures.length; j++) {
                (adr, isValid) = UtilityFacet(utilityFacetAddress).retrieveSignerAddress(
                    currentBlockConfirmation.signedBlock.encodedBlock, currentBlockConfirmation.signatures[j]
                );
                if (!isValid) {
                    console.log("_isMilestoneFinal: fail invalid confirmation signature at i", i);
                    return (false, bytes32(0));
                }
                isParticipant = UtilityFacet(utilityFacetAddress).isAddressInArray(expectedParticipants, adr);
                if (isParticipant) {
                    // TODO - need a gas limit on verifyMilestone and on verifyStateProof, so large proofs that can't be verified won't be spamed
                    thresholdCount =
                        _tryInsertAddressInThresholdSet(adr, thresholdSet, thresholdCount, expectedParticipants);
                }
            }
            previousEncodedBlock = currentBlockConfirmation.signedBlock.encodedBlock;
        }

        console.log("_isMilestoneFinal: thresholdCount", thresholdCount);
        return (thresholdCount == expectedParticipants.length, finalizedSnapshotHash);
    }

    //Return set length after tryInsert

    function _tryInsertAddressInThresholdSet(
        address adr,
        address[] memory thresholdSet,
        uint256 currentThresholdCount,
        address[] memory expectedParticipants
    ) internal pure returns (uint256) {
        for (uint256 i = 0; i < expectedParticipants.length; i++) {
            if (expectedParticipants[i] == adr && thresholdSet[i] != adr) {
                thresholdSet[i] = adr;
                return currentThresholdCount + 1;
            }
        }

        return currentThresholdCount;
    }

    function isMilestoneFinal(
        bytes32 forkId,
        SnapshotData memory thresholdSnapshotData,
        MilestoneProof memory milestone
    ) public virtual returns (bool isFinal, bytes32 finalizedSnapshotHash) {
        return _isMilestoneFinalWithExpectedParticipants(forkId, thresholdSnapshotData.participants, milestone);
    }

    function verifyMilestones(
        bytes32 forkId,
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        StateSnapshot memory thresholdStateSnapshot
    ) public virtual returns (bool isValid) {
        return _verifyMilestones(forkId, milestoneProofs, milestoneSnapshots, thresholdStateSnapshot);
    }

    function _verifyMilestones(
        bytes32 forkId,
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        StateSnapshot memory thresholdStateSnapshot
    ) internal returns (bool isValid) {
        SnapshotData memory snapshotData = thresholdStateSnapshot.snapshotData;
        uint256 startIndex = 0;
        bool skippedMilestone = false;
        MilestoneProof memory lastSkippedMilestone;

        console.log("verifyMilestones: milestones", milestoneProofs.length);
        console.log("verifyMilestones: snapshots", milestoneSnapshots.length);

        // For K milestones, K snapshots are provided where each snapshot corresponds to each milestone finalization
        if (milestoneProofs.length != milestoneSnapshots.length) {
            console.log("verifyMilestones: fail length mismatch");
            return false;
        }

        for (uint256 i = 0; i < milestoneProofs.length; i++) {
            MilestoneProof memory milestone = milestoneProofs[i];
            if (milestone.blockConfirmations.length == 0) {
                return false;
            }

            (bool decoded, Block memory firstMilestoneBlock) = UtilityFacet(utilityFacetAddress).tryDecodeBlock(
                milestone.blockConfirmations[0].signedBlock.encodedBlock
            );
            if (!decoded) {
                return false;
            }
            if (
                firstMilestoneBlock.transaction.header.forkId == thresholdStateSnapshot.forkId
                    && firstMilestoneBlock.transaction.header.transactionCnt < thresholdStateSnapshot.blockHeight
            ) {
                skippedMilestone = true;
                lastSkippedMilestone = milestone;
                startIndex = i + 1;
                continue;
            }
            break;
        }

        if (startIndex == milestoneProofs.length) {
            if (!skippedMilestone) {
                return true;
            }

            bytes memory previousEncodedBlock;
            Block memory currentBlock;
            for (uint256 i = 0; i < lastSkippedMilestone.blockConfirmations.length; i++) {
                (bool decoded, Block memory decodedBlock) = UtilityFacet(utilityFacetAddress).tryDecodeBlock(
                    lastSkippedMilestone.blockConfirmations[i].signedBlock.encodedBlock
                );
                if (!decoded) {
                    return false;
                }
                currentBlock = decodedBlock;
                if (i != 0 && currentBlock.previousBlockHash != keccak256(previousEncodedBlock)) {
                    return false;
                }
                if (currentBlock.transaction.header.transactionCnt == thresholdStateSnapshot.blockHeight) {
                    if (currentBlock.stateSnapshotHash != keccak256(abi.encode(thresholdStateSnapshot))) {
                        return false;
                    }
                }
                previousEncodedBlock = lastSkippedMilestone.blockConfirmations[i].signedBlock.encodedBlock;
            }

            return true;
        }

        for (uint256 i = startIndex; i < milestoneProofs.length; i++) {
            MilestoneProof memory milestone = milestoneProofs[i];
            bytes32 channelId = bytes32(0);
            if (milestone.blockConfirmations.length > 0) {
                (bool decoded, Block memory firstMilestoneBlock) = UtilityFacet(utilityFacetAddress).tryDecodeBlock(
                    milestone.blockConfirmations[0].signedBlock.encodedBlock
                );
                if (!decoded) {
                    return false;
                }
                channelId = firstMilestoneBlock.transaction.header.channelId;
            } else {
                return false;
            }
            address[] memory expectedParticipants =
                _deriveMilestoneUnionParticipants(channelId, snapshotData, milestoneSnapshots[i].snapshotData);
            console.log("verifyMilestones: i", i);
            console.log("verifyMilestones: expectedParticipants", expectedParticipants.length);
            console.log("verifyMilestones: confirmations", milestone.blockConfirmations.length);
            (bool milestoneFinal, bytes32 finalizedSnapshotHash) =
                _isMilestoneFinalWithExpectedParticipants(forkId, expectedParticipants, milestone);
            if (!milestoneFinal) {
                console.log("verifyMilestones: fail milestone not final at i", i);
                return false;
            }
            // isFinal - since this runs in isolation now (not atomically with auditing where everything is checked), revert the transaction if the disputer didn't provide the correct snapshot
            // Since it's final, the disputer for sure has the correct snapshot, so we can just revert if it's not provided
            if (keccak256(abi.encode(milestoneSnapshots[i])) != finalizedSnapshotHash) {
                console.log("verifyMilestones: snapshot hash doesn't match");
                return false;
            }

            snapshotData = milestoneSnapshots[i].snapshotData;
        }
        return true;
    }
}
