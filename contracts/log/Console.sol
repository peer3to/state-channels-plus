// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

contract Console {
    // Well-known console precompile address.
    // The hex literal encodes "console.log" in ASCII and matches Hardhat’s console.
    address constant CONSOLE_ADDRESS = 0x000000000000000000636F6e736F6c652e6c6f67;

    function log(string memory message) external view {
        assembly {
            // Free memory pointer
            let ptr := mload(0x40)

            // Function selector for log(string)
            // bytes4(keccak256("log(string)")) == 0x41304facu
            mstore(ptr, 0x41304fac00000000000000000000000000000000000000000000000000000000)
            // ABI offset to string data (starts after selector + offset word)
            mstore(add(ptr, 4), 0x20)
            let len := mload(message)
            mstore(add(ptr, 0x24), len)

            // Copy string bytes
            let src := add(message, 0x20)
            let padded := and(add(len, 0x1f), not(0x1f))
            for { let i := 0 } lt(i, padded) { i := add(i, 0x20) } {
                mstore(add(add(ptr, 0x44), i), mload(add(src, i)))
            }
            // Total calldata size:
            // 4 (selector) + 32 (offset) + 32 (length) + padded string bytes
            let size := add(0x44, padded)

            // STATICCALL into the console precompile
            // Return value is ignored
            pop(staticcall(gas(), CONSOLE_ADDRESS, ptr, size, 0, 0))
        }
    }
}
