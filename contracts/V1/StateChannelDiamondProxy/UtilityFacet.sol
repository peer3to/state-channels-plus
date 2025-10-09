pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../types/DisputeTypes.sol";
import "./Errors.sol";

contract UtilityFacet {
    /**
     * @param addressesInThreshold - The public EOA addresses of the signers in the threshold
     * @param encodedData - The encoded data, which keccak256 hash was signed
     * @param signatures - Signatures from `addressesInThreshold` signers on keccak256(data)
     */
    function verifyThresholdSigned(
        address[] memory addressesInThreshold,
        bytes memory encodedData,
        bytes[] memory signatures
    ) public pure returns (bool, string memory) {
        //It's fine if you send more signatures than in the threshold - you'll just pay more gas
        if (addressesInThreshold.length > signatures.length) {
            return (false, "Cryptography: Not enough signatures provided");
        }

        uint256 threshold = addressesInThreshold.length;
        bytes32 _hash = keccak256(encodedData);
        uint256 count = 0;

        // EIP-191 - This is what actually gets signed
        bytes32 signedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash));

        //Every address can be counted once
        uint8[] memory countRemaining = new uint8[](threshold);
        for (uint256 i = 0; i < threshold; i++) {
            countRemaining[i] = 1;
        }

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(signedHash, signatures[i]);
            //Hopefully the caller will sort signatures so this matches
            if (i < threshold && signer == addressesInThreshold[i] && countRemaining[i] == 1) {
                count++;
                countRemaining[i] = 0;
            } else {
                // Still possible to work in N^2 time - sadly no memory maps (hash tables) in solidity
                for (uint256 j = 0; j < threshold; j++) {
                    if (signer == addressesInThreshold[j] && countRemaining[j] == 1) {
                        count++;
                        countRemaining[j] = 0;
                        break;
                    }
                }
            }
        }
        if (count != threshold) {
            return (false, "Cryptography: Not enough valid signatures");
        }
        return (true, "");
    }

    function retrieveSignerAddress(bytes memory encodedData, bytes memory signature) public pure returns (address) {
        bytes32 _hash = keccak256(encodedData);

        // EIP-191 - This is what actually gets signed
        bytes32 signedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash));

        return ECDSA.recover(signedHash, signature);
    }

    function isAddressInArray(address[] memory array, address adr) public pure returns (bool) {
        for (uint256 i = 0; i < array.length; i++) {
            if (array[i] == adr) return true;
        }
        return false;
    }

    //Return set length after tryInsert
    function tryInsertAddressInThresholdSet(
        address adr,
        address[] memory set,
        uint256 currentThresholdCount,
        address[] memory expectedAddresses
    ) public pure returns (uint256) {
        //Check is address in expectedAddresses
        for (uint256 i = 0; i < expectedAddresses.length; i++) {
            if (expectedAddresses[i] == adr) {
                if (set[i] != adr) {
                    set[i] = adr;
                    currentThresholdCount++;
                    break;
                }
            }
        }
        return currentThresholdCount;
    }

    function insertBytesInByteArray(bytes memory b, bytes[] memory array) public pure returns (bytes[] memory) {
        bytes[] memory result = new bytes[](array.length + 1);
        for (uint256 i = 0; i < array.length; i++) {
            result[i] = array[i];
        }
        result[array.length] = b;
        return result;
    }

    function concatAddressArrays(address[] memory array1, address[] memory array2)
        public
        pure
        returns (address[] memory)
    {
        address[] memory result = new address[](array1.length + array2.length);
        for (uint256 i = 0; i < array1.length; i++) {
            result[i] = array1[i];
        }
        for (uint256 i = 0; i < array2.length; i++) {
            result[array1.length + i] = array2[i];
        }
        return result;
    }

    function subtractAddressArrays(address[] memory array1, address[] memory array2)
        public
        pure
        returns (address[] memory)
    {
        address[] memory result = new address[](array1.length);
        uint256 actualCount = 0;
        for (uint256 i = 0; i < array1.length; i++) {
            bool found = false;
            for (uint256 j = 0; j < array2.length; j++) {
                if (array1[i] == array2[j]) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                result[actualCount++] = array1[i];
            }
        }
        address[] memory finalResult = new address[](actualCount);
        for (uint256 i = 0; i < actualCount; i++) {
            finalResult[i] = result[i];
        }
        return finalResult;
    }

    function concatBytesArrays(bytes[] memory array1, bytes[] memory array2) public pure returns (bytes[] memory) {
        bytes[] memory result = new bytes[](array1.length + array2.length);
        for (uint256 i = 0; i < array1.length; i++) {
            result[i] = array1[i];
        }
        for (uint256 i = 0; i < array2.length; i++) {
            result[array1.length + i] = array2[i];
        }
        return result;
    }

    function concatExitChannelArrays(ExitChannel[] memory array1, ExitChannel[] memory array2)
        public
        pure
        returns (ExitChannel[] memory)
    {
        ExitChannel[] memory result = new ExitChannel[](array1.length + array2.length);
        for (uint256 i = 0; i < array1.length; i++) {
            result[i] = array1[i];
        }
        for (uint256 i = 0; i < array2.length; i++) {
            result[array1.length + i] = array2[i];
        }
        return result;
    }

    function areAddressArraysEqual(address[] memory array1, address[] memory array2) public pure returns (bool) {
        if (array1.length != array2.length) {
            return false;
        }
        for (uint256 i = 0; i < array1.length; i++) {
            if (array1[i] != array2[i]) {
                return false;
            }
        }
        return true;
    }

    function concatAddressArraysNoDuplicates(address[] memory array1, address[] memory array2)
        public
        pure
        returns (address[] memory)
    {
        // array1 is assumed to contain no duplicates
        // Create the result array with maximum possible size
        address[] memory result = new address[](array1.length + array2.length);

        // Copy all items from first array directly to the result
        for (uint256 i = 0; i < array1.length; i++) {
            result[i] = array1[i];
        }

        uint256 uniqueCount = array1.length;

        // Add items from second array, skipping duplicates
        for (uint256 i = 0; i < array2.length; i++) {
            // Check if item already exists in array1
            if (!isAddressInArray(result, array2[i])) {
                result[uniqueCount] = array2[i];
                uniqueCount++;
            }
        }

        // If we didn't find any duplicates, we can return the result as is
        if (uniqueCount == array1.length + array2.length) {
            return result;
        }

        // Otherwise we need to create a sized-down copy
        address[] memory finalResult = new address[](uniqueCount);
        for (uint256 i = 0; i < uniqueCount; i++) {
            finalResult[i] = result[i];
        }

        return finalResult;
    }

    function insertIntoAddressArrayNoDuplicates(address[] memory array, address newAddress)
        public
        pure
        returns (address[] memory)
    {
        // Check if the address is already in the array
        for (uint256 i = 0; i < array.length; i++) {
            if (array[i] == newAddress) {
                return array; // Address already exists, return the original array
            }
        }

        // If not found, create a new array with one additional slot
        address[] memory newArray = new address[](array.length + 1);
        for (uint256 i = 0; i < array.length; i++) {
            newArray[i] = array[i];
        }
        newArray[array.length] = newAddress; // Add the new address at the end

        return newArray;
    }

    function verifyStateProof(
        Dispute memory dispute,
        DisputeAuditingData memory disputeAuditingData,
        bool auditingDataIntegrityVerified
    ) public pure returns (bool) {
        if (auditingDataIntegrityVerified) {
            if (
                dispute.input.genesisSnapshotDataHash
                    != keccak256(abi.encode(disputeAuditingData.genesisStateSnapshotData))
            ) return false;
        } else {
            require(
                dispute.input.genesisSnapshotDataHash
                    == keccak256(abi.encode(disputeAuditingData.genesisStateSnapshotData)),
                ErrorDisputeGenesisInvalid()
            );
        }

        bytes32 latestSnapshotDataHash = keccak256(abi.encode(disputeAuditingData.latestStateSnapshot.snapshotData));
        bytes32 latestSnapshotHash = keccak256(abi.encode(disputeAuditingData.latestStateSnapshot));

        if (dispute.input.stateProof.milestones.length != 0 && dispute.input.stateProof.signedBlocks.length != 0) {
            return false;
        }

        // Milestone checking
        (bool isValid, bytes memory lastBlockEncoded) = verifyMilestones(
            dispute.input.stateProof.milestones,
            disputeAuditingData.milestoneSnapshots,
            disputeAuditingData.genesisStateSnapshotData
        );
        if (!isValid) {
            return false;
        }
        // If no blocks in milestones
        if (lastBlockEncoded.length == 0) {
            if (dispute.input.stateProof.signedBlocks.length == 0) {
                // no blocks at all => genesis == latest
                if (auditingDataIntegrityVerified) {
                    if (
                        dispute.input.genesisSnapshotDataHash != latestSnapshotDataHash
                            || dispute.input.latestStateSnapshotHash != latestSnapshotHash
                    ) return false;
                } else {
                    require(
                        dispute.input.genesisSnapshotDataHash == latestSnapshotDataHash
                            && dispute.input.latestStateSnapshotHash == latestSnapshotHash,
                        ErrorIncorrectSnapshotProvided()
                    );
                }
            } else {
                //check if signedBlocks are linked, signed and built on genesis
                if (
                    !_areSignedBlocksLinkedAndVerified(
                        dispute.input.stateProof.signedBlocks, dispute.input.genesisSnapshotDataHash
                    )
                ) return false;

                Block memory lastBlock = abi.decode(
                    dispute.input.stateProof.signedBlocks[dispute.input.stateProof.signedBlocks.length - 1].encodedBlock,
                    (Block)
                );
                //check if lastBlock commits to the latestStateSnapshot
                if (lastBlock.stateSnapshotHash != dispute.input.latestStateSnapshotHash) return false;
            }
        } else {
            // - At least one milestone with at least one block -
            // Think this will never trigger, since we only build signedBlocks if there is not finality (linked to genesis), otherwise the latest state is included in a milestone
            // TODO - think could this be exploited

            // This check is redundant since we already have this check at the beginning of the function, but have it here for clarity
            if (dispute.input.stateProof.signedBlocks.length != 0) return false;

            Block memory lastBlock = abi.decode(lastBlockEncoded, (Block));
            //check if lastBlock commits to the latestStateSnapshot
            if (lastBlock.stateSnapshotHash != dispute.input.latestStateSnapshotHash) {
                return false;
            }
        }
        if (auditingDataIntegrityVerified) {
            //check commitment to latestStateSnapshot
            if (dispute.input.latestStateSnapshotHash != keccak256(abi.encode(disputeAuditingData.latestStateSnapshot)))
            {
                return false;
            }
        }
        return true;
    }

    function _isMilestoneFinal(SnapshotData memory genesisSnapshotData, MilestoneProof memory milestone)
        public
        pure
        returns (bool isFinal, bytes32 finalizedSnapshotHash)
    {
        bytes32 genesisForkId = keccak256(abi.encode(genesisSnapshotData));
        address[] memory expectedParticipants = genesisSnapshotData.participants;
        address[] memory thresholdSet = new address[](expectedParticipants.length);
        uint256 thresholdCount = 0;
        bytes memory previousEncodedBlock;
        BlockConfirmation memory currentBlockConfirmation;
        Block memory currentBlock;
        address adr;
        if (milestone.blockConfirmations.length == 0) {
            return (false, bytes32(0));
        }
        for (uint256 i = 0; i < milestone.blockConfirmations.length; i++) {
            currentBlockConfirmation = milestone.blockConfirmations[i];
            currentBlock = abi.decode(currentBlockConfirmation.signedBlock.encodedBlock, (Block));
            if (currentBlock.transaction.header.forkId != genesisForkId) return (false, bytes32(0));
            //check linked
            if (i != 0) {
                if (currentBlock.previousBlockHash != keccak256(previousEncodedBlock)) {
                    return (false, bytes32(0));
                }
            } else {
                finalizedSnapshotHash = currentBlock.stateSnapshotHash;
            }
            // Collect signatures
            adr = retrieveSignerAddress(
                currentBlockConfirmation.signedBlock.encodedBlock, currentBlockConfirmation.signedBlock.signature
            );
            if (adr != currentBlock.transaction.header.participant) {
                return (false, bytes32(0));
            }
            thresholdCount = tryInsertAddressInThresholdSet(adr, thresholdSet, thresholdCount, expectedParticipants);
            for (uint256 j = 0; j < currentBlockConfirmation.signatures.length; j++) {
                adr = retrieveSignerAddress(
                    currentBlockConfirmation.signedBlock.encodedBlock, currentBlockConfirmation.signatures[j]
                );
                thresholdCount = tryInsertAddressInThresholdSet(adr, thresholdSet, thresholdCount, expectedParticipants);
            }
            previousEncodedBlock = currentBlockConfirmation.signedBlock.encodedBlock;
        }

        return (thresholdCount == expectedParticipants.length, finalizedSnapshotHash);
    }

    /// @dev Verifies ForkMilestoneBlock along with BlockConfirmations and taking into account Virtual Voting
    function verifyMilestones(
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        SnapshotData memory genesisSnapshotData
    ) public pure returns (bool isValid, bytes memory lastBlockEncoded) {
        SnapshotData memory snapshotData = genesisSnapshotData;
        lastBlockEncoded = "";

        // For K milestones, K-1 snapshots are needed to prove the last milestone is final, but for cleaner code we include the K-th snapshot too, even though it doesn't have to be used
        if (milestoneProofs.length != milestoneSnapshots.length) {
            return (false, lastBlockEncoded);
        }

        for (uint256 i = 0; i < milestoneProofs.length; i++) {
            MilestoneProof memory milestone = milestoneProofs[i];
            (bool isFinal, bytes32 finalizedSnapshotHash) = _isMilestoneFinal(snapshotData, milestone);
            if (!isFinal) {
                return (false, lastBlockEncoded);
            }
            // isFinal - since this runs in isolation now (not atomically with auditing where everything is checked), revert the transaction if the disputer didn't provide the correct snapshot
            // Since it's final, the disputer for sure has the correct snapshot, so we can just revert if it's not provided
            require(
                keccak256(abi.encode(milestoneSnapshots[i])) == finalizedSnapshotHash, ErrorIncorrectSnapshotProvided()
            );

            snapshotData = milestoneSnapshots[i].snapshotData;
            if (i == milestoneProofs.length - 1 && milestone.blockConfirmations.length > 0) {
                lastBlockEncoded =
                    milestone.blockConfirmations[milestone.blockConfirmations.length - 1].signedBlock.encodedBlock;
            }
        }
        return (true, lastBlockEncoded);
    }

    function _areSignedBlocksLinkedAndVerified(SignedBlock[] memory signedBlocks, bytes32 optionalPreviousHash)
        public
        pure
        returns (bool isLinked)
    {
        bytes32 previousBlockHash = optionalPreviousHash;
        for (uint256 i = 0; i < signedBlocks.length; i++) {
            bytes memory currentBlockEncoded = signedBlocks[i].encodedBlock;
            Block memory currentBlock = abi.decode(currentBlockEncoded, (Block));
            //check is linked
            if (previousBlockHash != bytes32(0) && previousBlockHash != currentBlock.previousBlockHash) {
                return false;
            }
            previousBlockHash = keccak256(currentBlockEncoded);
            //verify original signature
            address signer = retrieveSignerAddress(currentBlockEncoded, signedBlocks[i].signature);
            if (signer != currentBlock.transaction.header.participant) {
                return false;
            }
        }
        return true;
    }

    function isGenesisSnapshotWithoutTimeCheck(StateSnapshot memory snapshot) public pure returns (bool) {
        return snapshot.forkId == keccak256(abi.encode(snapshot.snapshotData)) && snapshot.blockHeight == 0;
    }
}
