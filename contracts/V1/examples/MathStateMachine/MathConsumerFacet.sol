// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import "../../StateChannelDiamondProxy/AConsumerFacet.sol";
import "../../StateChannelDiamondProxy/StateChannelUtilLibrary.sol";
import "./MathStateMachine.sol";
import "../../types/DataTypes.sol";

/**
 * @title MathConsumerFacet
 * @dev Concrete implementation of ConsumerFacet for the Math state machine example
 */
contract MathConsumerFacet is AConsumerFacet {
    // Events
    event SetState(bytes32 indexed channelId, bytes encodedState, uint256 timestamp, uint256 blockTimestamp);

    function openChannel(bytes32 channelId, bytes[] calldata openChannelData, bytes[] calldata signatures)
        external
        override
    {
        require(
            openChannelData.length > 0 && openChannelData.length == signatures.length,
            "MathConsumerFacet: openChannel (openChannel <> signatures) incorrect length"
        );

        JoinChannel[] memory joinChannels = new JoinChannel[](openChannelData.length);
        for (uint256 i = 0; i < openChannelData.length; i++) {
            joinChannels[i] = abi.decode(openChannelData[i], (JoinChannel));
        }

        bool isValid = true;
        for (uint256 i = 0; i < openChannelData.length; i++) {
            address[] memory addressesInThreshold = new address[](1);
            addressesInThreshold[0] = joinChannels[i].participant;
            bytes[] memory signature = new bytes[](1);
            signature[0] = signatures[i];
            (bool succeeds,) =
                StateChannelUtilLibrary.verifyThresholdSigned(addressesInThreshold, openChannelData[i], signatures);
            if (!succeeds) {
                isValid = false;
                break;
            }
        }

        require(isValid, "MathConsumerFacet: openChannel (openChannel <> signatures) signatures don't match");

        require(channelId != bytes32(0), "MathConsumerFacet: openChannel channelId cannot be 0x0");

        // Note: Channel open check is handled by the diamond before delegating to this facet

        for (uint256 i = 0; i < joinChannels.length; i++) {
            require(channelId == joinChannels[i].channelId, "MathConsumerFacet: openChannel channelId doesn't match");

            require(joinChannels[i].balance.amount > 0, "MathConsumerFacet: openChannel amount must be greater than 0");

            require(
                joinChannels[i].deadlineTimestamp > block.timestamp,
                "MathConsumerFacet: openChannel timestampDeadline must be in the future"
            );
        }
        //AStateMachine genesis state
        MathState memory genesisState;
        genesisState.number = 0;
        genesisState.participants = new address[](joinChannels.length);
        for (uint256 i = 0; i < joinChannels.length; i++) {
            genesisState.participants[i] = joinChannels[i].participant;
        }
        bytes memory genesisStateEncoded = abi.encode(genesisState);
        // encodedStates[channelId][0] = genesisStateEncoded;
        //TODO! Snapshot instead of encodedState -> think about this
        emit SetState(channelId, genesisStateEncoded, 0, block.timestamp);
    }

    function depositAssetsComposable(JoinChannel memory joinChannel) external override returns (bool) {
        // Implementation for depositing assets when a participant joins

        return true; // Placeholder implementation
    }

    function withdrawAssetsComposable(ExitChannel memory exitChannel) external override returns (bool) {
        // Implementation for withdrawing assets when a participant exits
        return true; // Placeholder implementation
    }
}
