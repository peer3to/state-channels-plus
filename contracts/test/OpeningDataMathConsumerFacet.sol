// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import "../V1/examples/MathStateMachine/MathConsumerFacet.sol";

/// Test-only Math consumer whose genesis depends on the opening data: the
/// Math genesis with the opening data's hash folded into `number`, so a
/// genesis built from any other data has another hash.
contract OpeningDataMathConsumerFacet is MathConsumerFacet {
    function openChannelGenesis(JoinChannel[] memory joinChannels, bytes memory openingData)
        public
        pure
        override
        returns (bytes memory encodedGenesisState)
    {
        MathState memory genesisState = abi.decode(super.openChannelGenesis(joinChannels, openingData), (MathState));
        genesisState.number += uint256(keccak256(openingData)) >> 128;
        return abi.encode(genesisState);
    }
}
