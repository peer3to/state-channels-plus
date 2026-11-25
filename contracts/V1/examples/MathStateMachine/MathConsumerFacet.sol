// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import "../../StateChannelDiamondProxy/AConsumerFacet.sol";
import "./MathStateMachine.sol";
import "../../types/DataTypes.sol";

/**
 * @title MathConsumerFacet
 * @dev Concrete implementation of ConsumerFacet for the Math state machine example
 */
contract MathConsumerFacet is AConsumerFacet {
    function openChannelGenesis(JoinChannel[] memory joinChannels, bytes memory)
        public
        pure
        virtual
        override
        returns (bytes memory encodedGenesisState)
    {
        // AStateMachine genesis state
        MathState memory genesisState;
        genesisState.participants = new address[](joinChannels.length);
        genesisState.balances = new uint256[](joinChannels.length);

        // Initialize state.number to sum of all balances to satisfy balance invariant:
        // totalDeposits == totalWithdrawals + getTotalStateBalance()
        uint256 totalBalance = 0;
        for (uint256 i = 0; i < joinChannels.length; i++) {
            genesisState.participants[i] = joinChannels[i].participant;
            genesisState.balances[i] = joinChannels[i].balance.amount;
            totalBalance += joinChannels[i].balance.amount;
        }
        genesisState.number = totalBalance;

        return abi.encode(genesisState);
    }

    function deposit(JoinChannel memory) external pure override returns (bool) {
        // Implementation for depositing assets when a participant joins

        return true; // Placeholder implementation
    }

    function withdraw(ExitChannel memory) external pure override returns (bool) {
        // Implementation for withdrawing assets when a participant exits
        return true; // Placeholder implementation
    }
}
