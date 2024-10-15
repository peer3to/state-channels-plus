pragma solidity ^0.8.8;

import "./DisputeTypes.sol";
import "./DataTypes.sol";

interface StateChannelManagerEvents {
    event BlockCalldataPosted(
        bytes32 indexed channelId,
        SignedBlock signedBlock,
        uint timestamp
    );
    event SetState(
        bytes32 indexed channelId,
        bytes encodedState,
        uint forkCnt,
        uint timestamp
    );
    event DisputeUpdated(bytes32 indexed channelId, Dispute dispute);
}
