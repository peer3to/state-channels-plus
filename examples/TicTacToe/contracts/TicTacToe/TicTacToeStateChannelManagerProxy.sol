// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

import "@peer3/state-channels-plus/contracts/V1/StateChannelDiamondProxy/AStateChannelManagerProxy.sol";
import "./TicTacToeStateMachine.sol";
// import "../StateChannelDiamondProxy/StateChannelUtilLibrary.sol";

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract TicTacToeStateChannelManagerProxy is AStateChannelManagerProxy {
    uint public totalChannelsOpened;

    constructor(
        address aStateMaachineAddress,
        address disputeManagerFacet
    ) AStateChannelManagerProxy(aStateMaachineAddress, disputeManagerFacet) {
        p2pTime = 5;
        agreementTime = 5;
        chainFallbackTime = 5;
        challengeTime = 5;
    }

    function openChannel(
        bytes32 channelId,
        bytes[] calldata openChannelData,
        bytes[] calldata signatures
    ) public virtual override {
        require(
            openChannelData.length > 0 &&
                openChannelData.length == signatures.length,
            "TicTacToeStateChannelManager: openChannel (openChannel <> signatures) incorect length"
        );

        JoinChannel[] memory joinChannels = new JoinChannel[](
            openChannelData.length
        );
        for (uint i = 0; i < openChannelData.length; i++) {
            joinChannels[i] = abi.decode(openChannelData[i], (JoinChannel));
        }

        bool isValid = true;
        for (uint i = 0; i < openChannelData.length; i++) {
            address[] memory addressesInThreshold = new address[](1);
            addressesInThreshold[0] = joinChannels[i].participant;
            bytes[] memory signature = new bytes[](1);
            signature[0] = signatures[i];
            (bool succeeds, ) = StateChannelUtilLibrary.verifyThresholdSigned(
                addressesInThreshold,
                openChannelData[i],
                signatures
            );
            if (!succeeds) {
                isValid = false;
                break;
            }
        }

        require(
            isValid,
            "TicTacToeStateChannelManager: openChannel (openChannel <> signatures) singatures don't match"
        );

        require(
            channelId != bytes32(0),
            "TicTacToeStateChannelManager: openChannel channelId cannot be 0x0"
        );

        require(
            !isChannelOpen(channelId),
            "TicTacToeStateChannelManager: openChannel - channel already open"
        );
        for (uint i = 0; i < joinChannels.length; i++) {
            require(
                channelId == joinChannels[i].channelId,
                "TicTacToeStateChannelManager: openChannel channelId doesn't match"
            );

            require(
                joinChannels[i].amount > 0,
                "TicTacToeStateChannelManager: openChannel amount must be greater than 0"
            );
            //TODO process deposits (this is composable with the global state (other contracts))

            require(
                joinChannels[i].deadlineTimestamp > block.timestamp,
                "TicTacToeStateChannelManager: openChannel timestampDeadline must be in the future"
            );
        }
        //AStateMachine genesis state
        TicTacToeState memory genesisState;
        genesisState.gameActive = true;
        genesisState.participants = new address[](joinChannels.length);
        genesisState.balances = new uint256[](joinChannels.length);
        for (uint i = 0; i < joinChannels.length; i++) {
            genesisState.participants[i] = joinChannels[i].participant;
            genesisState.balances[i] = joinChannels[i].amount;
        }
        genesisState.currentPlayer = genesisState.participants[0];
        genesisState.betAmount = 50;
        bytes memory genesisStateEcoded = abi.encode(genesisState);
        encodedStates[channelId][0] = genesisStateEcoded;
        genesisTimestamps[channelId][0] = block.timestamp;
        totalChannelsOpened++;
        emit SetState(channelId, genesisStateEcoded, 0, block.timestamp);
    }

    function closeChannel(
        bytes32 channelId,
        bytes[] calldata closeChannelData,
        bytes[] calldata signatures
    ) public virtual override {}

    function removeParticipant(
        bytes32 channelId,
        bytes[] calldata removeParticipantData,
        bytes[] calldata signatures
    ) public virtual override {}

    function addParticipant(
        bytes32 channelId,
        bytes[] calldata removeParticipantData,
        bytes[] calldata signatures
    ) public virtual override {}

    function _addParticipantComposable(
        JoinChannel memory joinChannel
    ) internal virtual override returns (bool) {}

    function _removeParticipantComposable(
        bytes32 channelId,
        ProcessExit memory processExit
    ) internal virtual override returns (bool) {}
}