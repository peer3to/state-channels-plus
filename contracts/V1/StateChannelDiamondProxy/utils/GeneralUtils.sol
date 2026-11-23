pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../../types/DisputeTypes.sol";
import "../Errors.sol";

function _delegatecall(address target, bytes memory data) returns (bytes memory) {
    (bool success, bytes memory result) = target.delegatecall(data);
    if (!success) {
        if (result.length == 0) {
            revert("StateChannelManagerProxy - Delegatecall failed");
        }
        assembly ("memory-safe") {
            let returndata_size := mload(result)
            revert(add(32, result), returndata_size)
        }
    }
    return result;
}

function _isAddressInArray(address[] memory array, address adr) pure returns (bool) {
    for (uint256 i = 0; i < array.length; i++) {
        if (array[i] == adr) return true;
    }
    return false;
}

/// EIP-191 - the digest every signature over `encodedData` is actually made
/// over. Single owner: `verifyThresholdSigned`, `retrieveSignerAddress` and
/// `retrieveSignerAddresses` must agree on it or a recovered signer set
/// would not match the set the threshold check compared.
function _eip191SignedHash(bytes memory encodedData) pure returns (bytes32) {
    return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(encodedData)));
}

/// The address `signature` recovers to over `signedHash`; `isValid` false when it does not recover.
function _recoverSigner(bytes32 signedHash, bytes memory signature) pure returns (address signer, bool isValid) {
    ECDSA.RecoverError error;
    (signer, error,) = ECDSA.tryRecover(signedHash, signature);
    isValid = error == ECDSA.RecoverError.NoError;
}

function _concatAddressArraysNoDuplicates(address[] memory array1, address[] memory array2)
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
        if (!_isAddressInArray(result, array2[i])) {
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

/// @dev In-place length truncation of a memory array is safe when shrinking:
/// the tail elements become unreachable waste; the allocator never reclaims them.
/// Callers must not read the array again through a still-full-length reference.
function _shrinkAddressArray(address[] memory arr, uint256 newLength) pure returns (address[] memory) {
    assembly ("memory-safe") {
        mstore(arr, newLength)
    }
    return arr;
}

function _shrinkExitChannelArray(ExitChannel[] memory arr, uint256 newLength) pure returns (ExitChannel[] memory) {
    assembly ("memory-safe") {
        mstore(arr, newLength)
    }
    return arr;
}

function _shrinkJoinChannelArray(JoinChannel[] memory arr, uint256 newLength) pure returns (JoinChannel[] memory) {
    assembly ("memory-safe") {
        mstore(arr, newLength)
    }
    return arr;
}
