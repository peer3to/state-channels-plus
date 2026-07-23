pragma solidity ^0.8.8;

import "../../types/DisputeTypes.sol";
import "../Errors.sol";
import "./BlockUtils.sol";

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

function _isBlockAuthorParticipant(
    Block memory _block,
    StateSnapshot memory previousSnapshot,
    StateSnapshot memory resultingSnapshot
) pure returns (bool) {
    address author = _getBlockAuthor(_block);
    if (_isAddressInArray(previousSnapshot.snapshotData.participants, author)) {
        return true;
    }

    if (
        resultingSnapshot.blockHeight == _getBlockHeight(_block) && resultingSnapshot.forkId == _getBlockFork(_block)
            && _isAddressInArray(resultingSnapshot.snapshotData.participants, author)
    ) {
        return true;
    }
    return false;
}
