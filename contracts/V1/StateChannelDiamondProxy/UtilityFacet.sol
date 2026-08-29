pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../types/DisputeTypes.sol";
import "./utils/GeneralUtils.sol";
import "./StateChannelCommon.sol";
import "./UtilityFacetInterface.sol";

/// @dev The pure helpers are called externally on the deployed facet (see
/// `StateChannelCommon`), the view wrappers are delegatecalled by
/// `StateChannelManagerProxy`'s selector routing and therefore read the proxy's
/// storage - hence the `StateChannelCommon` base.
contract UtilityFacet is UtilityFacetInterface, StateChannelCommon {
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

    function retrieveSignerAddress(bytes memory encodedData, bytes memory signature)
        public
        pure
        override
        returns (address, bool)
    {
        bytes32 _hash = keccak256(encodedData);
        // EIP-191
        bytes32 signedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash));
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(signedHash, signature);
        if (error != ECDSA.RecoverError.NoError) {
            return (recovered, false);
        }
        return (recovered, true);
    }

    function decodeBlock(bytes memory encodedBlock) external pure returns (Block memory) {
        return abi.decode(encodedBlock, (Block));
    }

    function tryDecodeBlock(bytes memory encodedBlock)
        public
        view
        override
        returns (bool decoded, Block memory blockData)
    {
        try this.decodeBlock(encodedBlock) returns (Block memory decodedBlock) {
            return (true, decodedBlock);
        } catch {
            return (false, blockData);
        }
    }

    function isAddressInArray(address[] memory array, address adr) public pure override returns (bool) {
        return _isAddressInArray(array, adr);
    }

    function inParticipantUnion(
        address participant,
        address[] memory snapshotParticipants,
        address[] memory pendingParticipants
    ) public pure returns (bool) {
        for (uint256 i = 0; i < snapshotParticipants.length; i++) {
            if (snapshotParticipants[i] == participant) return true;
        }
        for (uint256 i = 0; i < pendingParticipants.length; i++) {
            if (pendingParticipants[i] == participant) return true;
        }
        return false;
    }

    function insertBytesInByteArray(bytes memory b, bytes[] memory array) public pure returns (bytes[] memory) {
        bytes[] memory result = new bytes[](array.length + 1);
        for (uint256 i = 0; i < array.length; i++) {
            result[i] = array[i];
        }
        result[array.length] = b;
        return result;
    }

    function subtractAddressArrays(address[] memory array1, address[] memory array2)
        public
        pure
        override
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
        return _shrinkAddressArray(result, actualCount);
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
        override
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

        // Otherwise shrink to the deduplicated size
        return _shrinkAddressArray(result, uniqueCount);
    }

    function insertIntoAddressArrayNoDuplicates(address[] memory array, address newAddress)
        public
        pure
        override
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

    function isGenesisSnapshotWithoutTimeCheck(StateSnapshot memory snapshot) public pure override returns (bool) {
        return snapshot.forkId == keccak256(abi.encode(snapshot.snapshotData)) && snapshot.blockHeight == 0;
    }

    function isSnapshotNewer(StateSnapshot memory newSnapshot, StateSnapshot memory currentSnapshot)
        public
        pure
        returns (bool)
    {
        if (newSnapshot.blockHeight > currentSnapshot.blockHeight) return true;
        if (
            newSnapshot.blockHeight == 0 && currentSnapshot.blockHeight == 0
                && isGenesisSnapshotWithoutTimeCheck(currentSnapshot)
                && keccak256(abi.encode(newSnapshot)) != keccak256(abi.encode(currentSnapshot))
        ) return true;
        return false;
    }

    // ********** proxy storage views - delegatecalled through the proxy's selector routing **********

    function getParticipants(bytes32 channelId) public view returns (address[] memory) {
        return _getSnapshotParticipants(channelId);
    }

    function getP2pTime() public view returns (uint256) {
        return _getP2pTime();
    }

    function getAgreementTime() public view returns (uint256) {
        return _getAgreementTime();
    }

    function getChainFallbackTime() public view returns (uint256) {
        return _getChainFallbackTime();
    }

    function getEvidenceTime() public view returns (uint256) {
        return _getEvidenceTime();
    }

    function getGasLimit() public view returns (uint256) {
        return _getGasLimit();
    }

    function getAllTimes() public view returns (uint256, uint256, uint256, uint256) {
        return _getAllTimes();
    }

    function getBlockCallDataCommitment(bytes32 channelId, bytes32 forkId, uint256 blockHeight, address participant)
        public
        view
        returns (bool found, bytes32 blockCalldataCommitment)
    {
        return _getBlockCallDataCommitment(channelId, forkId, blockHeight, participant);
    }

    function hasInboundMessageBlock(bytes32 channelId, bytes32 messageBlockHash) public view returns (bool) {
        return _hasInboundMessageBlock(channelId, messageBlockHash);
    }

    function getOnChainSlashedParticipantsUpToTimestamp(bytes32 channelId, uint256 timestamp)
        public
        view
        returns (address[] memory)
    {
        return _getOnChainSlashedParticipantsUpToTimestamp(channelId, timestamp);
    }

    function getOnChainSlashedParticipants(bytes32 channelId) public view returns (address[] memory) {
        return _getOnChainSlashedParticipants(channelId);
    }

    function isParticipantSlashedOnChain(bytes32 channelId, address participant) public view returns (bool) {
        return _isParticipantSlashedOnChain(channelId, participant);
    }

    function getOnChainThresholdSet(bytes32 channelId) public view returns (address[] memory) {
        return _getOnChainThresholdSet(channelId);
    }

    function getSnapshotParticipants(bytes32 channelId) public view returns (address[] memory) {
        return _getSnapshotParticipants(channelId);
    }

    function getPendingParticipants(bytes32 channelId) public view returns (address[] memory) {
        return _getPendingParticipants(channelId);
    }

    function getStateSnapshot(bytes32 channelId) public view returns (StateSnapshot memory) {
        return _getStateSnapshot(channelId);
    }

    function getChannelBalance(bytes32 channelId) public view returns (ChannelBalance memory) {
        return _getChannelBalance(channelId);
    }

    function isBlockAuthentic(SignedBlock memory _block) public view returns (bool) {
        return _isBlockAuthentic(_block);
    }

    function canParticipateInDisputes(bytes32 channelId, address participant) public view returns (bool) {
        return _canParticipateInDisputes(channelId, participant);
    }

    function isChannelOpen(bytes32 channelId) public view returns (bool, StateSnapshot memory) {
        return _isChannelOpen(channelId);
    }

    function isForkDisputed(bytes32 channelId, bytes32 forkId) public view returns (bool) {
        return _isForkDisputed(channelId, forkId);
    }

    function getWindowCommitments(bytes32 channelId, bytes32 forkId)
        public
        view
        returns (bytes32[] memory disputeCommitments)
    {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[forkId];
        return disputeWindow.evidence.disputeCommitments;
    }

    function getDisputeWindowCreationTimestamp(bytes32 channelId, bytes32 forkId)
        public
        view
        returns (uint256 creationTimestamp)
    {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[forkId];
        return disputeWindow.evidence.creationTimestamp;
    }

    function getReducedResult(bytes32 channelId, bytes32 forkId)
        public
        view
        returns (bytes32 reducedForkId, uint256 timestamp, address reducer)
    {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[forkId];
        DisputeWindowReducedResult storage reducedResult = disputeWindow.reducedResult;
        return (reducedResult.forkId, reducedResult.timestamp, reducedResult.reducer);
    }

    function isKillPeriodExpired(bytes32 channelId, bytes32 forkId)
        public
        view
        returns (bool windowExists, bool isExpired, uint256 killPeriodEnd, uint256 blockTimestamp)
    {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[forkId];
        windowExists = _isDisputeWidnowCreated(disputeWindow);
        (isExpired, killPeriodEnd) = _isKillPeriodExpired(disputeWindow, _getEvidenceTime());
        return (windowExists, isExpired, killPeriodEnd, block.timestamp);
    }

    function isReduceChallengePeriodExpired(bytes32 channelId, bytes32 forkId) public view returns (bool) {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[forkId];
        return _isReduceChallengePeriodExpired(disputeWindow, _getEvidenceTime());
    }

    function getDisputeWindows(bytes32 channelId, bytes32[] memory forkIds)
        public
        view
        returns (DisputeWindow[] memory)
    {
        DisputeWindow[] memory disputeWindows = new DisputeWindow[](forkIds.length);
        DisputeData storage disputeData = disputeData[channelId];
        for (uint256 i = 0; i < forkIds.length; i++) {
            disputeWindows[i] = disputeData.disputeWindowMap[forkIds[i]];
        }
        return disputeWindows;
    }

    function verifyOutboundMessageBlocks(
        MessageBlock[] memory outboundMessageBlocks,
        SnapshotData memory lowerSnapshot,
        SnapshotData memory upperSnapshot
    ) public view returns (bool) {
        return _verifyOutboundMessageBlocks(outboundMessageBlocks, lowerSnapshot, upperSnapshot);
    }

    function pruneOutboundMessageBlocks(MessageBlock[] memory outboundMessageBlocks, bytes32 lowerHash)
        public
        pure
        returns (MessageBlock[] memory)
    {
        return _pruneOutboundMessageBlocks(outboundMessageBlocks, lowerHash);
    }
}
