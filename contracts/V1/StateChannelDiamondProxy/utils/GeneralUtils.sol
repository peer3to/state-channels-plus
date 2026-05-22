pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
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

function _recoverSigner(bytes memory encodedData, bytes memory signature) pure returns (address, bool) {
    bytes32 _hash = keccak256(encodedData);
    bytes32 signedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash));
    (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(signedHash, signature);
    if (error != ECDSA.RecoverError.NoError) {
        return (recovered, false);
    }
    return (recovered, true);
}
