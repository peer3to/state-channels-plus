// SPDX-License-Identifier: UNLICENSED

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerProxy} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/FraudProofTypes.sol";

// test naming: testFuzz_<targetFunction>_<property>
contract FraudProofFacetTest is DiamondHarness {
    StateChannelManagerProxy internal diamond;

    uint256 internal constant AUTHOR_PK = 0xA11CE;
    bytes32 internal constant CHANNEL_ID = keccak256("channel");
    bytes32 internal constant FORK_ID = keccak256("fork");

    function setUp() public {
        diamond = deployDiamond();
    }

    function _genesisProof(uint256 fraudTimestamp, uint256 prevSnapshotTimestamp, bytes32 channelId, bytes32 forkId)
        internal
        pure
        returns (InvalidTimestampProof memory proof)
    {
        StateSnapshot memory prevSnapshot;
        prevSnapshot.timestamp = prevSnapshotTimestamp;
        bytes32 prevHash = keccak256(abi.encode(prevSnapshot));
        proof.invalidBlock = _makeSignedGenesisBlock(AUTHOR_PK, channelId, forkId, fraudTimestamp, prevHash);
        proof.previousStateSnapshot = prevSnapshot;
    }

    function _isFraud(uint256 fraudTimestamp, uint256 prevSnapshotTimestamp) internal returns (bool) {
        return diamond.hasInvalidTimestamp(_genesisProof(fraudTimestamp, prevSnapshotTimestamp, CHANNEL_ID, FORK_ID));
    }

    // genesis branch must never revert on attacker-influenceable input
    function testFuzz_hasInvalidTimestamp_genesisNeverReverts(uint256 fraudTimestamp, uint256 prevSnapshotTimestamp)
        public
    {
        diamond.hasInvalidTimestamp(_genesisProof(fraudTimestamp, prevSnapshotTimestamp, CHANNEL_ID, FORK_ID));
    }

    // non-genesis branch (txCnt > 0) must never revert
    function testFuzz_hasInvalidTimestamp_nonGenesisNeverReverts(uint256 fraudTimestamp, uint256 prevBlockTimestamp)
        public
    {
        SignedBlock memory prevBlock =
            _makeSignedBlock(AUTHOR_PK, CHANNEL_ID, FORK_ID, 0, prevBlockTimestamp, bytes32(0));
        bytes32 prevHash = keccak256(prevBlock.encodedBlock);
        SignedBlock memory fraudBlock = _makeSignedBlock(AUTHOR_PK, CHANNEL_ID, FORK_ID, 1, fraudTimestamp, prevHash);

        InvalidTimestampProof memory proof;
        proof.invalidBlock = fraudBlock;
        proof.previousBlock = prevBlock;
        diamond.hasInvalidTimestamp(proof);
    }

    // valid-timestamp region must be one contiguous interval -> no valid/invalid/valid holes
    function testFuzz_hasInvalidTimestamp_validRegionHasNoHoles(uint256 prev, uint256 a, uint256 b, uint256 c) public {
        prev = bound(prev, 1e6, 1e30);
        a = bound(a, prev - 1e6, prev + 1e6);
        b = bound(b, prev - 1e6, prev + 1e6);
        c = bound(c, prev - 1e6, prev + 1e6);
        (uint256 lo, uint256 mid, uint256 hi) = _sort3(a, b, c);

        if (!_isFraud(lo, prev) && !_isFraud(hi, prev)) {
            assertFalse(_isFraud(mid, prev), "hole in valid region");
        }
    }

    // hasInvalidTimestamp is insensitive to channelId/forkId -> same timestamps, same verdict
    function testFuzz_hasInvalidTimestamp_ignoresChannelAndFork(
        uint256 fraudTimestamp,
        uint256 prev,
        bytes32 channelId1,
        bytes32 forkId1,
        bytes32 channelId2,
        bytes32 forkId2
    ) public {
        prev = bound(prev, 1e6, 1e30);
        fraudTimestamp = bound(fraudTimestamp, prev - 1e6, prev + 1e6);

        bool v1 = diamond.hasInvalidTimestamp(_genesisProof(fraudTimestamp, prev, channelId1, forkId1));
        bool v2 = diamond.hasInvalidTimestamp(_genesisProof(fraudTimestamp, prev, channelId2, forkId2));
        assertEq(v1, v2, "verdict leaked onto channelId/forkId");
    }

    // honest on-time block (0..p2pTime skew) can never be slashed
    function testFuzz_hasInvalidTimestamp_honestBlockNeverFraud(uint256 prev, uint256 skew) public {
        prev = bound(prev, 1e6, 1e30);
        skew = bound(skew, 0, P2P_TIME);
        assertFalse(_isFraud(prev + skew, prev), "honest on-time block flagged as fraud");
    }

    // forged signature must be inert regardless of timestamps
    function testFuzz_hasInvalidTimestamp_forgedSignatureInert(uint256 fraudTimestamp, uint256 prev) public {
        prev = bound(prev, 0, 1e30);
        fraudTimestamp = bound(fraudTimestamp, 0, 2e30);
        InvalidTimestampProof memory proof = _genesisProof(fraudTimestamp, prev, CHANNEL_ID, FORK_ID);
        proof.invalidBlock.signature = abi.encodePacked(keccak256("bad-r"), keccak256("bad-s"), uint8(27));
        assertFalse(diamond.hasInvalidTimestamp(proof), "forged-signature block treated as authentic");
    }

    function _sort3(uint256 x, uint256 y, uint256 z) internal pure returns (uint256, uint256, uint256) {
        if (x > y) (x, y) = (y, x);
        if (y > z) (y, z) = (z, y);
        if (x > y) (x, y) = (y, x);
        return (x, y, z);
    }
}
