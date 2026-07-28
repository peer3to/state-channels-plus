pragma solidity ^0.8.8;

import "../../types/DisputeTypes.sol";
import "../Errors.sol";
import "./GeneralUtils.sol";

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
