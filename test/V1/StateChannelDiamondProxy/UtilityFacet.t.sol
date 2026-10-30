pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {CanonicalMutations} from "../harness/CanonicalMutations.sol";
import {ErrorNonCanonicalEncoding} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
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
            assertEq(blockData.transaction.header.participant, address(0), "failure must yield default block");
            assertEq(blockData.messageBlocks.length, 0, "failure must yield default block");
        }
    }
}
