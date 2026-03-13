pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../types/DisputeTypes.sol";

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

    function retrieveSignerAddress(bytes memory encodedData, bytes memory signature)
        public
        pure
        returns (address, bool)
    {
        bytes32 _hash = keccak256(encodedData);

        // EIP-191 - This is what actually gets signed
        bytes32 signedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash));

        // Use tryRecover to handle invalid signatures (recover reverts if signature is invalid)
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(signedHash, signature);
        if (error != ECDSA.RecoverError.NoError) {
            return (recovered, false);
        }
        return (recovered, true);
    }

    function isAddressInArray(address[] memory array, address adr) public pure returns (bool) {
        for (uint256 i = 0; i < array.length; i++) {
            if (array[i] == adr) return true;
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

    function isGenesisSnapshotWithoutTimeCheck(StateSnapshot memory snapshot) public pure returns (bool) {
        return snapshot.forkId == keccak256(abi.encode(snapshot.snapshotData)) && snapshot.blockHeight == 0;
    }
}
