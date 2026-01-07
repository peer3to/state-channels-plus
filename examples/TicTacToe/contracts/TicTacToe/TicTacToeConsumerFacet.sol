// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

import "@peer3/state-channels-plus/contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol";
import "@peer3/state-channels-plus/contracts/V1/types/DataTypes.sol";

import "./TicTacToeStateMachine.sol";

/**
 * @dev Consumer facet for TicTacToe.
 *      This is where application-specific on-chain logic lives (genesis, deposits, withdrawals).
 */
contract TicTacToeConsumerFacet is AConsumerFacet {
    uint256 private constant DEFAULT_BET_AMOUNT = 50;

    function openChannelGenesis(JoinChannel[] memory successfulJoinChannels, bytes memory optionalOpeningData)
        external
        pure
        override
        returns (bytes memory encodedGenesisState, address[] memory participants)
    {
        uint256 betAmount = DEFAULT_BET_AMOUNT;
        if (optionalOpeningData.length > 0) {
            betAmount = abi.decode(optionalOpeningData, (uint256));
        }

        TicTacToeState memory genesisState;
        genesisState.gameActive = true;
        genesisState.participants = new address[](successfulJoinChannels.length);
        genesisState.balances = new uint256[](successfulJoinChannels.length);

        for (uint256 i = 0; i < successfulJoinChannels.length; i++) {
            genesisState.participants[i] = successfulJoinChannels[i].participant;
            genesisState.balances[i] = successfulJoinChannels[i].balance.amount;
        }

        genesisState.currentPlayer = genesisState.participants[0];
        genesisState.movesCount = 0;
        genesisState.betAmount = betAmount;

        bytes memory genesisStateEncoded = abi.encode(genesisState);
        return (genesisStateEncoded, genesisState.participants);
    }

    function deposit(JoinChannel memory) external pure override returns (bool) {
        // Example is ETH-free (no composable deposits).
        return true;
    }

    function withdraw(ExitChannel memory) external pure override returns (bool) {
        // Example is ETH-free (no composable withdrawals).
        return true;
    }
}
