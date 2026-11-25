pragma solidity ^0.8.8;

import "../types/DataTypes.sol";
import "../StateChannelManagerInterface.sol";
import "./StateChannelManagerStorage.sol";

abstract contract AConsumerFacet is StateChannelManagerStorage {
    /// @dev The genesis state for the opening joins; every signer and observer calls it off-chain, `open` never does.
    ///     The SDK runs it on a local copy of this facet's code, so it must call no other contract (no external library).
    function openChannelGenesis(JoinChannel[] memory joinChannels, bytes memory optionalOpeningData)
        external
        pure
        virtual
        returns (bytes memory encodedGenesisState);

    function deposit(JoinChannel memory joinChannel) external virtual returns (bool);

    function withdraw(ExitChannel memory exitChannel) external virtual returns (bool);
}
