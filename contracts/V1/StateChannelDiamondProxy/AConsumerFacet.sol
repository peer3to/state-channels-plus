pragma solidity ^0.8.8;

import "../types/DataTypes.sol";
import "../StateChannelManagerInterface.sol";

abstract contract AConsumerFacet {
    function openChannel(bytes32 channelId, bytes[] calldata openChannelData, bytes[] calldata signatures)
        external
        virtual;

    function deposit(JoinChannel memory joinChannel) external virtual returns (bool);

    function withdraw(ExitChannel memory exitChannel) external virtual returns (bool);
}
