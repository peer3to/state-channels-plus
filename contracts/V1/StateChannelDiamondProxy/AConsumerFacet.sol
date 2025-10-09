pragma solidity ^0.8.8;

import "../types/DataTypes.sol";
import "../StateChannelManagerInterface.sol";

abstract contract AConsumerFacet {
    function openChannelGenesis(JoinChannel[] memory successfulJoinChannels, bytes memory optionalOpeningData)
        external
        pure
        virtual
        returns (bytes memory encodedGenesisState, address[] memory participants);

    function deposit(JoinChannel memory joinChannel) external virtual returns (bool);

    function withdraw(ExitChannel memory exitChannel) external virtual returns (bool);
}
