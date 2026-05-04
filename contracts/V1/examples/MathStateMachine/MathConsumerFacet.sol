// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import "../../StateChannelDiamondProxy/AConsumerFacet.sol";
import "../../StateChannelDiamondProxy/StateChannelManagerProxy.sol";
import "./MathStateMachine.sol";
import "../../types/DataTypes.sol";
import "../../types/MessageTypeHashes.sol";

/**
 * @title MathConsumerFacet
 * @dev Concrete implementation of ConsumerFacet for the Math state machine example
 */
contract MathConsumerFacet is AConsumerFacet {
    function openChannelGenesis(JoinChannel[] memory successfulJoinChannels, bytes memory)
        external
        pure
        override
        returns (bytes memory encodedGenesisState, address[] memory participants)
    {
        // AStateMachine genesis state
        MathState memory genesisState;
        genesisState.participants = new address[](successfulJoinChannels.length);
        genesisState.balances = new uint256[](successfulJoinChannels.length);

        // Initialize state.number to sum of all balances to satisfy balance invariant:
        // totalDeposits == totalWithdrawals + getTotalStateBalance()
        uint256 totalBalance = 0;
        for (uint256 i = 0; i < successfulJoinChannels.length; i++) {
            genesisState.participants[i] = successfulJoinChannels[i].participant;
            genesisState.balances[i] = successfulJoinChannels[i].balance.amount;
            totalBalance += successfulJoinChannels[i].balance.amount;
        }
        genesisState.number = totalBalance;

        bytes memory genesisStateEncoded = abi.encode(genesisState);
        return (genesisStateEncoded, genesisState.participants);
    }

    function deposit(JoinChannel memory) external pure override returns (bool) {
        // Implementation for depositing assets when a participant joins

        return true; // Placeholder implementation
    }

    function withdraw(ExitChannel memory) external pure override returns (bool) {
        // Implementation for withdrawing assets when a participant exits
        return true; // Placeholder implementation
    }

    function forceInboundJoin(bytes32 channelId, address participant, uint256 amount)
        external
        returns (MessageBlock memory messageBlock, Balance memory newTotalDeposits)
    {
        require(channelId != bytes32(0), "MathConsumerFacet: channelId required");
        require(participant != address(0), "MathConsumerFacet: participant required");
        require(amount > 0, "MathConsumerFacet: amount required");

        JoinChannel[] memory joinChannels = new JoinChannel[](1);
        joinChannels[0] = JoinChannel({
            channelId: channelId,
            participant: participant,
            deadlineTimestamp: block.timestamp + 1 hours,
            balance: Balance({amount: amount, data: ""}),
            latestStateSnapshotHash: bytes32(0)
        });

        Message[] memory messages = new Message[](1);
        messages[0] = Message({
            messageType: MESSAGE_TYPE_JOIN,
            participant: participant,
            balance: joinChannels[0].balance,
            data: abi.encode(joinChannels[0])
        });

        (messageBlock, newTotalDeposits) =
            StateChannelManagerProxy(address(this)).appendInboundMessages(channelId, messages);
    }
}
