// @spec-test-coverage-ignore: shared Foundry storage-seeding mixin exercised by owning mapped test declarations
pragma solidity ^0.8.8;

import {StateChannelCommon} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol";
import {MESSAGE_TYPE_JOIN} from "../../../contracts/V1/types/MessageTypeHashes.sol";
import "../../../contracts/V1/types/DataTypes.sol";

/// Stores an inbound block through the production writer, so seeded records
/// have the layout a deposit writes.
abstract contract InboundSeeding is StateChannelCommon {
    /// persists a block at `height` after `previous` holding one zero-deposit JOIN per participant under `hash`;
    /// it becomes the channel's inbound head
    function seedInboundJoins(
        bytes32 channelId,
        bytes32 hash,
        bytes32 previous,
        uint256 height,
        uint256 timestamp,
        address[] memory participants
    ) public {
        MessageBlock memory inbound;
        inbound.previousBlockHash = previous;
        inbound.blockHeight = height;
        inbound.timestamp = timestamp;
        inbound.messages = new Message[](participants.length);
        for (uint256 i = 0; i < participants.length; i++) {
            JoinChannel memory join;
            join.channelId = channelId;
            join.participant = participants[i];
            inbound.messages[i] = Message({
                messageType: MESSAGE_TYPE_JOIN,
                participant: participants[i],
                balance: join.balance,
                data: abi.encode(join)
            });
        }
        _seedInboundBlock(channelId, hash, inbound);
    }

    /// persists `inbound` under `hash` and makes it the channel's inbound head
    function _seedInboundBlock(bytes32 channelId, bytes32 hash, MessageBlock memory inbound) internal {
        _persistInboundMessageBlock(channelId, hash, inbound);
        channelBalances[channelId].latestInboundMessageBlockHash = hash;
        channelBalances[channelId].latestInboundMessageBlockHeight = inbound.blockHeight;
    }
}
