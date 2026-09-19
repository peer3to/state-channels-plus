pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";

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
    function testFuzz_insertIntoAddressArrayNoDuplicates_containsAndDedup(address[] memory arr, address x)
        public
        view
    {
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
}
