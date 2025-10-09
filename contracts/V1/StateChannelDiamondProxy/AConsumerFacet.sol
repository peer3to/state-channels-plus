pragma solidity ^0.8.8;

import "../types/DataTypes.sol";
import "../StateChannelManagerInterface.sol";

abstract contract AConsumerFacet {
    function openChannel(bytes32 channelId, bytes[] calldata openChannelData, bytes[] calldata signatures)
        external
        virtual;

    function removeParticipant(bytes32 channelId, bytes[] calldata removeParticipantData, bytes[] calldata signatures)
        external
        virtual;

    function addParticipant(bytes32 channelId, bytes[] calldata addParticipantData, bytes[] calldata signatures)
        external
        virtual;

    function depositAssetsComposable(JoinChannel memory joinChannel) external virtual returns (bool);

    function withdrawAssetsComposable(ExitChannel memory exitChannel) external virtual returns (bool);
}
