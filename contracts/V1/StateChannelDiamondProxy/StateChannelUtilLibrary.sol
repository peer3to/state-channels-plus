pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

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
        uint currentSetLength,
        address[] memory expectedAddresses
    ) internal pure returns (uint) {
        bool found = false;
        //Check is address in expectedAddresses
        for (uint i = 0; i < expectedAddresses.length; i++) {
            if (expectedAddresses[i] == adr) {
                found = true;
                break;
            }
        }
        if (!found) return currentSetLength;
        //Try and insert
        for (uint i = 0; i < currentSetLength; i++) {
            if (set[i] == adr) return currentSetLength;
        }
        set[currentSetLength] = adr;
        return currentSetLength + 1;
    }

    /// @dev Concatenates two address arrays, but it does not add duplicates
    function concatAddressArrays(address[] memory array1, address[] memory array2, uint array1Length) internal pure returns (address[] memory) {
       address[] memory result = new address[](array1Length);
       
       for(uint i = 0; i < array2.length; i++) {
        result[i] = array2[i];
       }
       return result;
    }
}
