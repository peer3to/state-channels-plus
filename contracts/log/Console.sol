// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

contract Console {
    address constant CONSOLE_ADDRESS = 0x000000000000000000636F6e736F6c652e6c6f67;

    function log(string memory message) external view {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x41304fac00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 4), 0x20)
            let len := mload(message)
            mstore(add(ptr, 0x24), len)

            let src := add(message, 0x20)
            let padded := and(add(len, 0x1f), not(0x1f))
            for { let i := 0 } lt(i, padded) { i := add(i, 0x20) } {
                mstore(add(add(ptr, 0x44), i), mload(add(src, i)))
            }

            let size := add(0x44, padded)
            pop(staticcall(gas(), CONSOLE_ADDRESS, ptr, size, 0, 0))
        }
    }
}
