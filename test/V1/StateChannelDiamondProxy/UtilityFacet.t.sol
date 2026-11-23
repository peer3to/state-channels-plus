pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {CanonicalMutations} from "../harness/CanonicalMutations.sol";
import {_emptyMessageBlocks} from "../harness/StateProofStaging.sol";
import {
    ErrorBlockDecodeOutOfGas,
    ErrorNonCanonicalEncoding
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {_decodeGasBudget} from "../../../contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol";
import {Balance, Block, Message, MessageBlock} from "../../../contracts/V1/types/DataTypes.sol";

// stateless property fuzz of the pure array helpers of UtilityFacet.sol, plus
// direct cases for the signer-set report the join rejection payload is built from
contract UtilityFacetTest is Test {
    UtilityFacet internal util;

    uint256 internal constant FIRST_SIGNER_PK = 0xA11CE;
    uint256 internal constant THIRD_SIGNER_PK = 0xB0B;

    function setUp() public {
        util = new UtilityFacet();
    }

    function _contains(address[] memory arr, address x) internal pure returns (bool) {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == x) return true;
        }
        return false;
    }

    // result is a subset of a with nothing from b
    function testFuzz_subtractAddressArrays_excludesSubtracted(address[] memory a, address[] memory b) public view {
        address[] memory result = util.subtractAddressArrays(a, b);
        for (uint256 i = 0; i < result.length; i++) {
            assertTrue(_contains(a, result[i]), "result element not from a");
            assertFalse(_contains(b, result[i]), "result element still present in b");
        }
        assertLe(result.length, a.length, "result longer than a");
    }

    // subtracting the empty set preserves length and order
    function testFuzz_subtractAddressArrays_emptyIsIdentity(address[] memory a) public view {
        address[] memory result = util.subtractAddressArrays(a, new address[](0));
        assertEq(result.length, a.length, "length changed");
        for (uint256 i = 0; i < a.length; i++) {
            assertEq(result[i], a[i], "order/element changed");
        }
    }

    // subtracting a set from itself removes everything
    function testFuzz_subtractAddressArrays_selfIsEmpty(address[] memory a) public view {
        assertEq(util.subtractAddressArrays(a, a).length, 0, "self-subtraction not empty");
    }

    // concat preserves total length and element order
    function testFuzz_concatBytesArrays_lengthAndOrder(bytes[] memory a, bytes[] memory b) public view {
        bytes[] memory result = util.concatBytesArrays(a, b);
        assertEq(result.length, a.length + b.length, "length != sum");
        for (uint256 i = 0; i < a.length; i++) {
            assertEq(keccak256(result[i]), keccak256(a[i]), "first half reordered");
        }
        for (uint256 j = 0; j < b.length; j++) {
            assertEq(keccak256(result[a.length + j]), keccak256(b[j]), "second half reordered");
        }
    }

    // after insert x is present, and a duplicate insert does not grow the array
    function testFuzz_insertIntoAddressArrayNoDuplicates_containsAndDedup(address[] memory arr, address x) public view {
        bool wasPresent = _contains(arr, x);
        address[] memory result = util.insertIntoAddressArrayNoDuplicates(arr, x);

        assertTrue(_contains(result, x), "x missing after insert");
        if (wasPresent) {
            assertEq(result.length, arr.length, "grew despite duplicate");
        } else {
            assertEq(result.length, arr.length + 1, "did not grow by exactly one");
            assertEq(result[result.length - 1], x, "x not appended at tail");
        }
    }

    // inserting the same element twice is idempotent
    function testFuzz_insertIntoAddressArrayNoDuplicates_idempotent(address[] memory arr, address x) public view {
        address[] memory once = util.insertIntoAddressArrayNoDuplicates(arr, x);
        address[] memory twice = util.insertIntoAddressArrayNoDuplicates(once, x);
        assertEq(twice.length, once.length, "second insert changed length");
    }

    // equality is reflexive
    function testFuzz_areAddressArraysEqual_reflexive(address[] memory a) public view {
        assertTrue(util.areAddressArraysEqual(a, a), "array not equal to itself");
    }

    // equality is symmetric
    function testFuzz_areAddressArraysEqual_symmetric(address[] memory a, address[] memory b) public view {
        assertEq(util.areAddressArraysEqual(a, b), util.areAddressArraysEqual(b, a), "equality not symmetric");
    }

    // one address per signature, in submission order; a signature that cannot be
    // recovered fills its own slot with address(0) instead of reverting the call,
    // so a rejection payload can still report the whole supplied set
    function test_retrieveSignerAddresses_unrecoverableSignatureYieldsZeroInItsSlot() public view {
        bytes memory encodedData = abi.encode(keccak256("signed payload"));
        bytes[] memory signatures = new bytes[](3);
        signatures[0] = _sign(FIRST_SIGNER_PK, encodedData);
        // 64 bytes: the wrong length for an r, s, v signature, so recovery fails
        signatures[1] = new bytes(64);
        signatures[2] = _sign(THIRD_SIGNER_PK, encodedData);

        address[] memory signers = util.retrieveSignerAddresses(encodedData, signatures);

        assertEq(signers.length, 3, "one slot per signature");
        assertEq(signers[0], vm.addr(FIRST_SIGNER_PK), "first signer not recovered");
        assertEq(signers[1], address(0), "unrecoverable signature must map to address(0)");
        assertEq(signers[2], vm.addr(THIRD_SIGNER_PK), "third signer not recovered");
    }

    // no signatures, no signers: an empty set, not a revert
    function test_retrieveSignerAddresses_noSignaturesYieldsEmptySet() public view {
        address[] memory signers = util.retrieveSignerAddresses(abi.encode(keccak256("signed payload")), new bytes[](0));
        assertEq(signers.length, 0, "empty signature list must yield an empty signer set");
    }

    function _sign(uint256 privateKey, bytes memory encodedData) internal pure returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(encodedData)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // A block with a nonempty dynamic body and a nested message: every dynamic
    // segment below carries data, so padding and offsets exist to corrupt.
    function _canonicalBlock() internal view returns (Block memory b) {
        Message[] memory messages = new Message[](1);
        messages[0] = Message({
            messageType: keccak256("canonical-message-type"),
            participant: address(0xCAFE),
            balance: Balance({amount: 11, data: hex""}),
            data: hex"1234"
        });
        MessageBlock[] memory messageBlocks = new MessageBlock[](1);
        messageBlocks[0] = MessageBlock({
            previousBlockHash: keccak256("canonical-mb-prev"),
            blockHeight: 7,
            messages: messages,
            totalBalance: Balance({amount: 11, data: hex""}),
            timestamp: 9
        });
        b.transaction.header.channelId = keccak256("canonical-channel");
        b.transaction.header.participant = address(0xB10C);
        b.transaction.header.forkId = keccak256("canonical-fork");
        b.transaction.header.transactionCnt = 1;
        b.transaction.header.timestamp = 1;
        b.transaction.body.data = hex"ab";
        b.stateSnapshotHash = keccak256("canonical-snapshot");
        b.previousBlockHash = keccak256("canonical-prev");
        b.messageBlocks = messageBlocks;
    }

    function _assertCanonicalFields(Block memory decoded) internal view {
        assertEq(decoded.transaction.header.channelId, keccak256("canonical-channel"), "channelId changed");
        assertEq(decoded.transaction.header.participant, address(0xB10C), "participant changed");
        assertEq(decoded.transaction.header.forkId, keccak256("canonical-fork"), "forkId changed");
        assertEq(decoded.transaction.header.transactionCnt, 1, "transactionCnt changed");
        assertEq(decoded.transaction.header.timestamp, 1, "timestamp changed");
        assertEq(keccak256(decoded.transaction.body.data), keccak256(hex"ab"), "body data changed");
        assertEq(decoded.messageBlocks.length, 1, "messageBlocks length changed");
        assertEq(decoded.messageBlocks[0].messages.length, 1, "messages length changed");
        assertEq(
            decoded.messageBlocks[0].messages[0].messageType,
            keccak256("canonical-message-type"),
            "nested messageType changed"
        );
        assertEq(keccak256(decoded.messageBlocks[0].messages[0].data), keccak256(hex"1234"), "nested data changed");
    }

    function _assertRevertsWithoutCanonicalityError(bytes memory callData, bytes4 forbiddenSelector) internal view {
        (bool ok, bytes memory revertData) = address(util).staticcall(callData);
        assertFalse(ok, "malformed bytes must revert");
        assertTrue(
            revertData.length < 4 || bytes4(revertData) != forbiddenSelector,
            "malformed bytes must not reach the canonicality check"
        );
    }

    function test_decodeBlock_canonicalRoundTrip() public view {
        bytes memory canonical = abi.encode(_canonicalBlock());
        Block memory decoded = util.decodeBlock(canonical);
        _assertCanonicalFields(decoded);
        assertEq(keccak256(abi.encode(decoded)), keccak256(canonical), "canonical re-encoding changed");
    }

    function test_decodeBlock_rejectsNonCanonical() public {
        bytes memory canonical = abi.encode(_canonicalBlock());
        bytes memory dirty = CanonicalMutations.withDirtyPadding(canonical);
        bytes memory gap = CanonicalMutations.withOffsetGap(canonical);
        bytes memory truncated = new bytes(canonical.length - 1);
        for (uint256 i = 0; i < truncated.length; i++) {
            truncated[i] = canonical[i];
        }
        // Decodable but noncanonical inputs revert with the typed custom error.
        vm.expectRevert(abi.encodeWithSelector(ErrorNonCanonicalEncoding.selector));
        util.decodeBlock(abi.encodePacked(canonical, bytes32(uint256(0x1234))));
        vm.expectRevert(abi.encodeWithSelector(ErrorNonCanonicalEncoding.selector));
        util.decodeBlock(abi.encodePacked(canonical, hex"00"));
        vm.expectRevert(abi.encodeWithSelector(ErrorNonCanonicalEncoding.selector));
        util.decodeBlock(dirty);
        // Malformed inputs revert without the canonicality error.
        _assertRevertsWithoutCanonicalityError(
            abi.encodeCall(UtilityFacet.decodeBlock, (truncated)), ErrorNonCanonicalEncoding.selector
        );
        _assertRevertsWithoutCanonicalityError(
            abi.encodeCall(UtilityFacet.decodeBlock, (hex"")), ErrorNonCanonicalEncoding.selector
        );
        // The offset gap decodes but is rejected as noncanonical.
        vm.expectRevert(abi.encodeWithSelector(ErrorNonCanonicalEncoding.selector));
        util.decodeBlock(gap);
        (bool gapOk,) = util.tryDecodeBlock(gap);
        assertFalse(gapOk, "offset gap must not decode");
    }

    function test_tryDecodeBlock_rejectsNonCanonical() public {
        bytes memory canonical = abi.encode(_canonicalBlock());
        (bool ok, Block memory decoded) = util.tryDecodeBlock(canonical);
        assertTrue(ok, "canonical bytes must decode");
        _assertCanonicalFields(decoded);
        assertEq(keccak256(abi.encode(decoded)), keccak256(canonical), "canonical re-encoding changed");
        bytes memory dirty = CanonicalMutations.withDirtyPadding(canonical);
        bytes[5] memory rejected = [
            abi.encodePacked(canonical, bytes32(uint256(0x1234))),
            abi.encodePacked(canonical, hex"00"),
            dirty,
            CanonicalMutations.withOffsetGap(canonical),
            hex""
        ];
        for (uint256 i = 0; i < rejected.length; i++) {
            (bool decodedOk, Block memory blockData) = util.tryDecodeBlock(rejected[i]);
            assertFalse(decodedOk, "noncanonical bytes must not decode");
            _assertDefaultBlock(blockData);
        }
    }

    /// a canonical block that costs about 2.35M gas to decode: 50 message blocks of 10 empty messages each
    function _heavyBlock() internal view returns (Block memory b) {
        b = _canonicalBlock();
        b.messageBlocks = _emptyMessageBlocks(50, 10);
    }

    function _assertDefaultBlock(Block memory blockData) internal pure {
        assertEq(blockData.transaction.header.participant, address(0), "failure must yield default block");
        assertEq(blockData.messageBlocks.length, 0, "failure must yield default block");
    }

    function test_tryDecodeBlock_outOfGasRevertsInsteadOfUndecodable() public {
        bytes memory heavy = abi.encode(_heavyBlock());
        // too little to fund the decode budget: the decode runs out of gas
        vm.expectRevert(ErrorBlockDecodeOutOfGas.selector);
        util.tryDecodeBlock{gas: 1_000_000}(heavy);

        (bool ok, Block memory decoded) = util.tryDecodeBlock(heavy);
        assertTrue(ok, "the funded decode answers");
        assertEq(keccak256(abi.encode(decoded)), keccak256(heavy), "every field decoded");
        assertEq(decoded.messageBlocks.length, 50, "every message block decoded");
        assertEq(decoded.messageBlocks[49].messages.length, 10, "every message decoded");

        // the budget caps the decode, it is not an entry fee: a 200 KB body (budget about 4.1M) decodes and answers
        // in 7/8 of its budget, about 2.9M being enough
        Block memory large = _canonicalBlock();
        large.messageBlocks[0].messages[0].data = new bytes(200_000);
        bytes memory encodedLarge = abi.encode(large);
        (bool okBelowBudget,) = util.tryDecodeBlock{gas: _decodeGasBudget(encodedLarge.length) * 7 / 8}(encodedLarge);
        assertTrue(okBelowBudget, "a decode that completes inside the gas it received answers");
    }

    function test_tryDecodeBlock_hugeLengthMalformedBlockIsUndecodable() public view {
        bytes memory malformed =
            CanonicalMutations.withMessageBlocksLength(abi.encode(_canonicalBlock()), type(uint64).max);
        uint256 before = gasleft();
        (bool ok, Block memory blockData) = util.tryDecodeBlock{gas: 300_000}(malformed);
        uint256 used = before - gasleft();
        assertFalse(ok, "a length past the bytes does not decode");
        _assertDefaultBlock(blockData);
        assertLt(used, 100_000, "rejected at bounded gas");
    }

    function test_tryDecodeBlock_aliasOffsetBlockIsUndecodableWithinItsBudget() public view {
        Block memory b = _canonicalBlock();
        b.messageBlocks[0].messages[0].data = new bytes(4096);
        // 1,000 head offsets at one 4 KB message block: about 37 KB that decode to 4 MB
        bytes memory aliased = CanonicalMutations.withAliasedMessageBlock(abi.encode(b), 1000);
        uint256 before = gasleft();
        (bool ok, Block memory blockData) = util.tryDecodeBlock{gas: 30_000_000}(aliased);
        uint256 used = before - gasleft();
        assertFalse(ok, "aliased offsets are not the canonical encoding");
        _assertDefaultBlock(blockData);
        assertLt(used, _decodeGasBudget(aliased.length) + 100_000, "judged within the budget of its length");
    }

    /// For each canonical shape with the highest decode cost per byte, at a small, a middle and the largest size
    /// whose decode stays under the 17,916,000 per-transaction cap: the measured decode plus 25% fits its budget.
    function test_decodeGasBudget_coversEveryCanonicalWorstCaseShape() public {
        // shape, then small, middle and largest count
        uint256[4][6] memory sizes = [
            [uint256(0), 64, 2048, 16384], // one large body: words of payload
            [uint256(1), 8, 128, 1900], // empty message blocks
            [uint256(2), 4, 256, 2048], // empty messages in one message block
            [uint256(3), 1, 16, 180], // message blocks of 10 empty messages (the repro's heavy block)
            [uint256(4), 3, 192, 1536], // messages with a one-byte payload and balance data
            [uint256(5), 2, 64, 1024] // message blocks of one empty message
        ];
        for (uint256 i = 0; i < sizes.length; i++) {
            for (uint256 j = 1; j < 4; j++) {
                (uint256 used, uint256 length) = this.measureDecode(sizes[i][0], sizes[i][j]);
                assertLe(
                    used * 125 / 100,
                    _decodeGasBudget(length),
                    string.concat("shape ", vm.toString(sizes[i][0]), " count ", vm.toString(sizes[i][j]))
                );
            }
        }
    }

    /// the gas `decodeBlock` uses on a canonical block of `shape` with `count` elements, in a fresh frame so blocks
    /// built for earlier sizes do not grow this one's memory
    function measureDecode(uint256 shape, uint256 count) external view returns (uint256 used, uint256 length) {
        bytes memory data = abi.encodeCall(UtilityFacet.decodeBlock, (abi.encode(_shape(shape, count))));
        // the encoded block's length word sits after the selector and its offset
        assembly ("memory-safe") {
            length := mload(add(data, 0x44))
        }
        address target = address(util);
        bool ok;
        uint256 before = gasleft();
        assembly ("memory-safe") {
            ok := staticcall(gas(), target, add(data, 0x20), mload(data), 0, 0)
        }
        used = before - gasleft();
        assertTrue(ok, "a canonical block decodes");
    }

    function _shape(uint256 shape, uint256 count) internal pure returns (Block memory b) {
        b.transaction.header.transactionCnt = 1;
        if (shape == 0) {
            b.transaction.body.data = new bytes(count * 32);
        } else if (shape == 1) {
            b.messageBlocks = new MessageBlock[](count);
        } else if (shape == 2) {
            b.messageBlocks = new MessageBlock[](1);
            b.messageBlocks[0].messages = new Message[](count);
        } else if (shape == 4) {
            b.messageBlocks = new MessageBlock[](1);
            b.messageBlocks[0].messages = new Message[](count);
            for (uint256 i = 0; i < count; i++) {
                b.messageBlocks[0].messages[i].data = new bytes(1);
                b.messageBlocks[0].messages[i].balance.data = new bytes(1);
            }
        } else {
            b.messageBlocks = _emptyMessageBlocks(count, shape == 3 ? 10 : 1);
        }
    }
}
