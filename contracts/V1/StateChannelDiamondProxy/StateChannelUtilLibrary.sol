pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../DataTypes.sol";
library StateChannelUtilLibrary {
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
        //It's fine if you send more signatures than in the treshold - you'll just pay more gas
        if (addressesInThreshold.length > signatures.length)
            return (false, "Cryptography: Not enought signatures provided");

        uint threshold = addressesInThreshold.length;
        bytes32 _hash = keccak256(encodedData);
        uint count = 0;

        // EIP-191 - This is what actually gets signed
        bytes32 signedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash)
        );

        //Every address can be counted once
        uint8[] memory countRemaining = new uint8[](threshold);
        for (uint i = 0; i < threshold; i++) {
            countRemaining[i] = 1;
        }

        for (uint i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(signedHash, signatures[i]);
            //Hopefully the caller will sort signatures so this matches
            if (
                i < threshold &&
                signer == addressesInThreshold[i] &&
                countRemaining[i] == 1
            ) {
                count++;
                countRemaining[i] = 0;
            } else {
                // Still possible to work in N^2 time - sadly no memory maps (hash tables) in solidity
                for (uint j = 0; j < threshold; j++) {
                    if (
                        signer == addressesInThreshold[j] &&
                        countRemaining[j] == 1
                    ) {
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

    function retriveSignerAddress(
        bytes memory encodedData,
        bytes memory signature
    ) public pure returns (address) {
        bytes32 _hash = keccak256(encodedData);

        // EIP-191 - This is what actually gets signed
        bytes32 signedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash)
        );

        return ECDSA.recover(signedHash, signature);
    }

    function isAddressInArray(
        address[] memory array,
        address adr
    ) public pure returns (bool) {
        for (uint i = 0; i < array.length; i++) {
            if (array[i] == adr) return true;
        }
        return false;
    }

    //Return set length after tryInsert
    function tryInsertAddressInThresholdSet(
        address adr,
        address[] memory set,
        uint currentThresholdCount,
        address[] memory expectedAddresses
    ) internal pure returns (uint) {
        //Check is address in expectedAddresses
        for (uint i = 0; i < expectedAddresses.length; i++) {
            if (expectedAddresses[i] == adr) {
                if(set[i] != adr) {
                    set[i] = adr;
                    currentThresholdCount++;
                    break;
                }
            }
        }
        return currentThresholdCount;
    }

    function concatAddressArrays(address[] memory array1, address[] memory array2) internal pure returns (address[] memory) {
        address[] memory result = new address[](array1.length + array2.length);
        for (uint i = 0; i < array1.length; i++) {
            result[i] = array1[i];
        }
        for (uint i = 0; i < array2.length; i++) {
            result[array1.length + i] = array2[i];
        }
        return result;
    }

    function concatExitChannelArrays(ExitChannel[] memory array1, ExitChannel[] memory array2) internal pure returns (ExitChannel[] memory) {
        ExitChannel[] memory result = new ExitChannel[](array1.length + array2.length);
        for (uint i = 0; i < array1.length; i++) {
            result[i] = array1[i];
        }
        for (uint i = 0; i < array2.length; i++) {
            result[array1.length + i] = array2[i];
        }
        return result;
    }

    function areAddressArraysEqual(
        address[] memory array1,
        address[] memory array2
    ) internal pure returns (bool) {
        if (array1.length != array2.length) {
            return false;
        }
        for (uint i = 0; i < array1.length; i++) {
            if (array1[i] != array2[i]) {
                return false;
            }
        }
        return true;
    }

    function concatAddressArraysNoDuplicates(
        address[] memory array1,
        address[] memory array2
    ) internal pure returns (address[] memory) {
        // array1 is assumed to contain no duplicates
        // Create the result array with maximum possible size
        address[] memory result = new address[](array1.length + array2.length);

        // Copy all items from first array directly to the result
        for (uint i = 0; i < array1.length; i++) {
            result[i] = array1[i];
        }

        uint uniqueCount = array1.length;

        // Add items from second array, skipping duplicates
        for (uint i = 0; i < array2.length; i++) {
            // Check if item already exists in rarray1
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
        for (uint i = 0; i < uniqueCount; i++) {
            finalResult[i] = result[i];
        }

        return finalResult;
    }
}
