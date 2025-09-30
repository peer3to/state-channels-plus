pragma solidity ^0.8.8;

import "../../types/DisputeTypes.sol";
import "../StateChannelUtilLibrary.sol";
import "../Errors.sol";

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

function _areBlocksSameFork(Block memory _block1, Block memory _block2) pure returns (bool) {
    return _getBlockFork(_block1) == _getBlockFork(_block2);
}

function _areBlocksSameChannel(Block memory _block1, Block memory _block2) pure returns (bool) {
    return _getBlockChannel(_block1) == _getBlockChannel(_block2);
}

function _doesBlockCommitToSnapshot(Block memory _block, StateSnapshot memory snapshot) pure returns (bool) {
    return _block.stateSnapshotHash == keccak256(abi.encode(snapshot));
}

function _areSignedBlocksLinkedAndVerified(SignedBlock[] memory signedBlocks, bytes32 optionalPreviousHash)
    pure
    returns (bool isLinked)
{
    bytes32 previousBlockHash = optionalPreviousHash;
    for (uint256 i = 0; i < signedBlocks.length; i++) {
        bytes memory currentBlockEncoded = signedBlocks[i].encodedBlock;
        Block memory currentBlock = abi.decode(currentBlockEncoded, (Block));
        //check is linked
        if (previousBlockHash != bytes32(0) && previousBlockHash != currentBlock.previousBlockHash) {
            return false;
        }
        previousBlockHash = keccak256(currentBlockEncoded);
        //verify original signature
        address signer = StateChannelUtilLibrary.retrieveSignerAddress(currentBlockEncoded, signedBlocks[i].signature);
        if (signer != currentBlock.transaction.header.participant) {
            return false;
        }
    }
    return true;
}

function _formExitChannelBlock(bytes32 previousBlockHash, ExitChannel[] memory exitChannels)
    pure
    returns (ExitChannelBlock memory _block)
{
    return ExitChannelBlock({exitChannels: exitChannels, previousBlockHash: previousBlockHash});
}
