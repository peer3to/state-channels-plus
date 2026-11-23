pragma solidity ^0.8.8;

import "../../types/DisputeTypes.sol";
import "../Errors.sol";
import "./GeneralUtils.sol";
import "../UtilityFacetInterface.sol";

// measured for solc 0.8.34 via-IR, 100 runs; recalibrate with `test_decodeGasBudget_coversEveryCanonicalWorstCaseShape`
// on any compiler or optimizer change
// `_decodeGasBudget` terms, the measured worst canonical shape plus 25%: fixed cost of the frame and header
uint256 constant DECODE_GAS_BASE = 15_000;
// decode, re-encode and copy work per word
uint256 constant DECODE_GAS_PER_WORD = 400;
// memory expansion of the fresh callee frame, which holds about four copies of the block
uint256 constant DECODE_GAS_QUAD_DIVISOR = 25;

/// `encodedBlock` decoded by `decoder.decodeBlock` within `_decodeGasBudget(encodedBlock.length)`, or false when it
/// is not a canonical block that decodes within that budget. A decode the frame could not fund is not a verdict:
/// EIP-150 then leaves the caller at most 1/64 of the gas it had, and that case reverts with
/// `ErrorBlockDecodeOutOfGas`, so the gas a caller attaches decides only whether there is a verdict, never which.
function _tryDecodeBlock(UtilityFacetInterface decoder, bytes memory encodedBlock)
    view
    returns (bool decoded, Block memory blockData)
{
    uint256 gasBefore = gasleft();
    try decoder.decodeBlock{gas: _decodeGasBudget(encodedBlock.length)}(encodedBlock) returns (
        Block memory decodedBlock
    ) {
        return (true, decodedBlock);
    } catch {
        if (gasleft() <= gasBefore / 64) revert ErrorBlockDecodeOutOfGas();
    }
}

/// The gas a canonical block of `length` bytes needs to decode, with margin: a function of its bytes alone.
function _decodeGasBudget(uint256 length) pure returns (uint256) {
    uint256 words = (length + 31) / 32;
    return DECODE_GAS_BASE + words * DECODE_GAS_PER_WORD + words * words / DECODE_GAS_QUAD_DIVISOR;
}

function _getBlockHeight(Block memory _block) pure returns (uint256) {
    return _block.transaction.header.transactionCnt;
}

function _getBlockChannel(Block memory _block) pure returns (bytes32) {
    return _block.transaction.header.channelId;
}

function _getBlockFork(Block memory _block) pure returns (bytes32) {
    return _block.transaction.header.forkId;
}

function _getBlockAuthor(Block memory _block) pure returns (address) {
    return _block.transaction.header.participant;
}

function _getBlockHash(Block memory blockData) pure returns (bytes32) {
    return keccak256(abi.encode(blockData));
}

function _areBlocksSameFork(Block memory _block1, Block memory _block2) pure returns (bool) {
    return _getBlockFork(_block1) == _getBlockFork(_block2);
}

function _areBlocksSameChannel(Block memory _block1, Block memory _block2) pure returns (bool) {
    return _getBlockChannel(_block1) == _getBlockChannel(_block2);
}

function _doesBlockCommitToSnapshot(Block memory _block, StateSnapshot memory snapshot) pure returns (bool) {
    return _block.stateSnapshotHash == keccak256(abi.encode(snapshot));
}

function _isBlockAuthorParticipant(
    Block memory _block,
    StateSnapshot memory previousSnapshot,
    StateSnapshot memory resultingSnapshot
) pure returns (bool) {
    address author = _getBlockAuthor(_block);
    if (_isAddressInArray(previousSnapshot.snapshotData.participants, author)) {
        return true;
    }

    if (
        resultingSnapshot.blockHeight == _getBlockHeight(_block) && resultingSnapshot.forkId == _getBlockFork(_block)
            && _isAddressInArray(resultingSnapshot.snapshotData.participants, author)
    ) {
        return true;
    }
    return false;
}

function _isGenesisSnapshotWithoutTimeCheck(StateSnapshot memory snapshot) pure returns (bool) {
    return snapshot.forkId == keccak256(abi.encode(snapshot.snapshotData)) && snapshot.blockHeight == 0;
}

function _isSnapshotNewer(StateSnapshot memory newSnapshot, StateSnapshot memory currentSnapshot) pure returns (bool) {
    if (newSnapshot.blockHeight > currentSnapshot.blockHeight) return true;
    // block 0's snapshot may replace the genesis, but never one that still looks like a genesis -> the chain
    // would keep judging the fork as at genesis and slash block 0's honest author
    if (
        newSnapshot.blockHeight == 0 && currentSnapshot.blockHeight == 0
            && _isGenesisSnapshotWithoutTimeCheck(currentSnapshot) && !_isGenesisSnapshotWithoutTimeCheck(newSnapshot)
            && keccak256(abi.encode(newSnapshot)) != keccak256(abi.encode(currentSnapshot))
    ) return true;
    return false;
}
