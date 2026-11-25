// @spec-test-coverage-ignore: shared Foundry canonical-encoding mutations exercised by owning mapped test declarations
pragma solidity ^0.8.8;

library CanonicalMutations {
    // Insert a top-level offset gap: a 0x40 head word plus a zero word ahead of
    // the original body, the same shape the differential corpus uses.
    function withOffsetGap(bytes memory canonical) internal pure returns (bytes memory gap) {
        gap = new bytes(canonical.length + 32);
        assembly ("memory-safe") {
            mstore(add(gap, 0x20), 0x40)
            mstore(add(gap, 0x40), 0x00)
        }
        for (uint256 i = 32; i < canonical.length; i++) {
            gap[i + 32] = canonical[i];
        }
    }

    // Corrupt one ignored padding byte of the 0xab body-data word: the decoder
    // reads a single length-delimited byte and ignores the tail, so the input
    // stays decodable yet no longer re-encodes to itself.
    function withDirtyPadding(bytes memory canonical) internal pure returns (bytes memory dirty) {
        bytes32 target = bytes32(uint256(0xab) << 248);
        uint256 n = canonical.length;
        for (uint256 i = 0; i + 32 <= n; i++) {
            bytes32 word;
            assembly ("memory-safe") {
                word := mload(add(add(canonical, 0x20), i))
            }
            if (word == target) {
                dirty = new bytes(n);
                for (uint256 j = 0; j < n; j++) {
                    dirty[j] = canonical[j];
                }
                dirty[i + 31] = bytes1(0x01);
                return dirty;
            }
        }
        revert("no dirty-padding word found");
    }

    // `messageBlocks` length word claims `length` entries -> runs past the bytes
    function withMessageBlocksLength(bytes memory encodedBlock, uint256 length)
        internal
        pure
        returns (bytes memory malformed)
    {
        malformed = bytes.concat(encodedBlock);
        uint256 lengthAt = _messageBlocksAt(encodedBlock);
        assembly ("memory-safe") {
            mstore(add(add(malformed, 0x20), lengthAt), length)
        }
    }

    // `n` head offsets point at one message block -> decoder copies it `n` times before rejecting
    function withAliasedMessageBlock(bytes memory encodedBlock, uint256 n)
        internal
        pure
        returns (bytes memory aliased)
    {
        uint256 lengthAt = _messageBlocksAt(encodedBlock);
        // after the length word and the single offset
        uint256 elementAt = lengthAt + 0x40;
        uint256 elementLength = encodedBlock.length - elementAt;
        aliased = new bytes(lengthAt + 0x20 + n * 0x20 + elementLength);
        for (uint256 i = 0; i < lengthAt; i++) {
            aliased[i] = encodedBlock[i];
        }
        assembly ("memory-safe") {
            mstore(add(add(aliased, 0x20), lengthAt), n)
        }
        for (uint256 i = 0; i < n; i++) {
            uint256 offset = n * 0x20;
            uint256 at = lengthAt + 0x20 + i * 0x20;
            assembly ("memory-safe") {
                mstore(add(add(aliased, 0x20), at), offset)
            }
        }
        uint256 to = lengthAt + 0x20 + n * 0x20;
        for (uint256 i = 0; i < elementLength; i++) {
            aliased[to + i] = encodedBlock[elementAt + i];
        }
    }

    // start of the `messageBlocks` length word (fourth member's head offset)
    function _messageBlocksAt(bytes memory encodedBlock) private pure returns (uint256 lengthAt) {
        uint256 offset;
        assembly ("memory-safe") {
            offset := mload(add(encodedBlock, 0xa0))
        }
        lengthAt = 0x20 + offset;
    }
}
