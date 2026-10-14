pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {
    ErrorNonCanonicalBlock,
    ErrorNonCanonicalEncoding
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {
    Balance,
    Block,
    JoinChannel,
    Message,
    MessageBlock,
    OpenChannel
} from "../../../contracts/V1/types/DataTypes.sol";
import {Dispute} from "../../../contracts/V1/types/DisputeTypes.sol";

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
        b.transaction.body.encodedData = hex"123456";
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
        assertEq(keccak256(decoded.transaction.body.encodedData), keccak256(hex"123456"), "encodedData changed");
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

    // Insert a top-level offset gap: a 0x40 head word plus a zero word ahead of
    // the original body, the same shape the differential corpus uses.
    function _withOffsetGap(bytes memory canonical) internal pure returns (bytes memory gap) {
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
    function _withDirtyPadding(bytes memory canonical) internal pure returns (bytes memory dirty) {
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

    function _assertRevertsWithoutCanonicalityError(bytes memory encodedBlock) internal view {
        (bool ok, bytes memory revertData) =
            address(util).staticcall(abi.encodeCall(UtilityFacet.decodeBlock, (encodedBlock)));
        assertFalse(ok, "malformed bytes must revert");
        assertTrue(
            revertData.length < 4 || bytes4(revertData) != ErrorNonCanonicalBlock.selector,
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
        bytes memory dirty = _withDirtyPadding(canonical);
        bytes memory gap = _withOffsetGap(canonical);
        bytes memory truncated = new bytes(canonical.length - 1);
        for (uint256 i = 0; i < truncated.length; i++) {
            truncated[i] = canonical[i];
        }
        // Decodable but noncanonical inputs revert with the typed custom error.
        vm.expectRevert(abi.encodeWithSelector(ErrorNonCanonicalBlock.selector));
        util.decodeBlock(abi.encodePacked(canonical, bytes32(uint256(0x1234))));
        vm.expectRevert(abi.encodeWithSelector(ErrorNonCanonicalBlock.selector));
        util.decodeBlock(abi.encodePacked(canonical, hex"00"));
        vm.expectRevert(abi.encodeWithSelector(ErrorNonCanonicalBlock.selector));
        util.decodeBlock(dirty);
        // Malformed inputs revert without the canonicality error.
        _assertRevertsWithoutCanonicalityError(truncated);
        _assertRevertsWithoutCanonicalityError(hex"");
        // The offset gap decodes but is rejected as noncanonical.
        vm.expectRevert(abi.encodeWithSelector(ErrorNonCanonicalBlock.selector));
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
        bytes memory dirty = _withDirtyPadding(canonical);
        bytes[5] memory rejected = [
            abi.encodePacked(canonical, bytes32(uint256(0x1234))),
            abi.encodePacked(canonical, hex"00"),
            dirty,
            _withOffsetGap(canonical),
            hex""
        ];
        for (uint256 i = 0; i < rejected.length; i++) {
            (bool decodedOk, Block memory blockData) = util.tryDecodeBlock(rejected[i]);
            assertFalse(decodedOk, "noncanonical bytes must not decode");
            assertEq(blockData.transaction.header.participant, address(0), "failure must yield default block");
            assertEq(blockData.messageBlocks.length, 0, "failure must yield default block");
        }
    }

    function test_decodeOpenChannel_canonicalRoundTripAndRejectsNonCanonical() public {
        OpenChannel memory openChannel;
        openChannel.channelId = keccak256("open-channel");
        openChannel.participants = new address[](2);
        openChannel.participants[0] = address(0xA11CE);
        openChannel.participants[1] = address(0xB0B);
        openChannel.balances = new Balance[](2);
        openChannel.balances[0] = Balance({amount: 500, data: hex"1234"});
        openChannel.balances[1] = Balance({amount: 700, data: ""});
        openChannel.deadlineTimestamp = 1_000_000;
        openChannel.isAtomic = true;
        openChannel.data = hex"abcd";
        bytes memory canonical = abi.encode(openChannel);

        OpenChannel memory decoded = util.decodeOpenChannel(canonical);
        assertEq(decoded.channelId, openChannel.channelId, "channel id changed");
        assertEq(decoded.participants.length, 2, "participant count changed");
        assertEq(decoded.participants[0], openChannel.participants[0], "first participant changed");
        assertEq(decoded.participants[1], openChannel.participants[1], "second participant changed");
        assertEq(decoded.balances[0].amount, 500, "first balance changed");
        assertEq(decoded.balances[1].amount, 700, "second balance changed");
        assertEq(decoded.deadlineTimestamp, openChannel.deadlineTimestamp, "deadline changed");
        assertTrue(decoded.isAtomic, "atomic flag changed");
        assertEq(keccak256(abi.encode(decoded)), keccak256(canonical), "canonical re-encoding changed");

        vm.expectRevert(abi.encodeWithSelector(ErrorNonCanonicalEncoding.selector));
        util.decodeOpenChannel(bytes.concat(canonical, abi.encode(uint256(0))));
    }

    function test_decodeJoinChannel_canonicalRoundTripAndRejectsNonCanonical() public {
        JoinChannel memory joinChannel;
        joinChannel.channelId = keccak256("join-channel");
        joinChannel.participant = address(0xCAFE);
        joinChannel.deadlineTimestamp = 2_000_000;
        joinChannel.balance = Balance({amount: 900, data: hex"99"});
        bytes memory canonical = abi.encode(joinChannel);

        JoinChannel memory decoded = util.decodeJoinChannel(canonical);
        assertEq(decoded.channelId, joinChannel.channelId, "channel id changed");
        assertEq(decoded.participant, joinChannel.participant, "participant changed");
        assertEq(decoded.deadlineTimestamp, joinChannel.deadlineTimestamp, "deadline changed");
        assertEq(decoded.balance.amount, 900, "balance changed");
        assertEq(keccak256(abi.encode(decoded)), keccak256(canonical), "canonical re-encoding changed");

        vm.expectRevert(abi.encodeWithSelector(ErrorNonCanonicalEncoding.selector));
        util.decodeJoinChannel(bytes.concat(canonical, abi.encode(uint256(0))));
    }

    function test_isCanonicalDispute_reportsCanonicalAndNonCanonical() public view {
        Dispute memory dispute;
        dispute.input.channelId = keccak256("dispute-channel");
        dispute.input.forkId = keccak256("dispute-fork");
        dispute.input.disputer = address(0xD15);
        dispute.postedAuditingData = true;
        dispute.outputSnapshotDataHash = keccak256("output");
        bytes memory canonical = abi.encode(dispute);

        assertTrue(util.isCanonicalDispute(canonical), "canonical dispute must be canonical");
        assertFalse(
            util.isCanonicalDispute(bytes.concat(canonical, abi.encode(uint256(0)))),
            "trailing word must not be canonical"
        );
    }
}
