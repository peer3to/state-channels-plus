pragma solidity ^0.8.8;

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
