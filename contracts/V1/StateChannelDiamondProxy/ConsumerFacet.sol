pragma solidity ^0.8.8;

import "../types/DataTypes.sol";
import "../StateChannelManagerInterface.sol";

/**
 * @title ConsumerFacet
 * @dev This facet contains the consumer-specific logic that was previously abstract in AStateChannelManagerProxy.
 * Each implementation (Math, TicTacToe, etc.) will implement this facet with their specific logic.
 */
abstract contract ConsumerFacet {
    /**
     * @dev Opens a new channel with the specified participants and initial state
     * @param channelId The unique identifier for the channel
     * @param openChannelData Array of encoded JoinChannel data
     * @param signatures Array of signatures for the open channel data
     */
    function openChannel(bytes32 channelId, bytes[] calldata openChannelData, bytes[] calldata signatures)
        external
        virtual;

    /**
     * @dev Closes an existing channel and processes withdrawals
     * @param channelId The unique identifier for the channel
     * @param closeChannelData Array of encoded ExitChannel data
     * @param signatures Array of signatures for the close channel data
     */
    function closeChannel(bytes32 channelId, bytes[] calldata closeChannelData, bytes[] calldata signatures)
        external
        virtual;

    /**
     * @dev Removes a participant from the channel
     * @param channelId The unique identifier for the channel
     * @param removeParticipantData Array of encoded participant removal data
     * @param signatures Array of signatures for the removal data
     */
    function removeParticipant(bytes32 channelId, bytes[] calldata removeParticipantData, bytes[] calldata signatures)
        external
        virtual;

    /**
     * @dev Adds a new participant to the channel
     * @param channelId The unique identifier for the channel
     * @param addParticipantData Array of encoded participant addition data
     * @param signatures Array of signatures for the addition data
     */
    function addParticipant(bytes32 channelId, bytes[] calldata addParticipantData, bytes[] calldata signatures)
        external
        virtual;

    /**
     * @dev Deposits assets for a participant joining the channel
     * @param joinChannel The join channel data containing participant and balance information
     * @return bool Success status of the deposit operation
     */
    function depositAssetsComposable(JoinChannel memory joinChannel) external virtual returns (bool);

    /**
     * @dev Withdraws assets for a participant exiting the channel
     * @param exitChannel The exit channel data containing participant and balance information
     * @return bool Success status of the withdrawal operation
     */
    function withdrawAssetsComposable(ExitChannel memory exitChannel) external virtual returns (bool);
}
