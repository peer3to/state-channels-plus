// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

/**
 * @title SimpleNumberStorage
 * @dev A simple contract for storing and retrieving numeric values
 */
contract SimpleNumberStorage {
    uint256 private value;

    function setValue(uint256 _value) public {
        value = _value;
    }

    function getValue() public view returns (uint256) {
        return value;
    }

    function setState(bytes calldata _state) public {
        value = abi.decode(_state, (uint256));
    }

    function getState() public view returns (bytes memory) {
        return abi.encode(value);
    }

    function revertWithMessage(string calldata _errorMessage) public pure {
        revert(_errorMessage);
    }
}
