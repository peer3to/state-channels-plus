pragma solidity ^0.8.8;

import "./AStateChannelManagerProxy.sol";
import "./ConsumerFacet.sol";
import "../types/DataTypes.sol";

/**
 * @title LocalDiamond
 * @dev Local implementation of the diamond proxy for testing and local EVM environments.
 * This contract provides storage sync methods and no-op asset management for local testing.
 * Focuses on dispute game functionality, not asset management.
 */
contract LocalDiamond is AStateChannelManagerProxy {
    // Events for storage sync
    event StorageSet(bytes32 indexed slot, bytes32 value);
    event StorageGet(bytes32 indexed slot, bytes32 value);

    constructor(
        address _stateMachineImplementation,
        address _disputeManagerFacet,
        address _fraudProofFacet,
        address _disputeFraudProofFacet,
        address _stateSnapshotFacet,
        address _joinChannelFacet
    )
        AStateChannelManagerProxy(
            _stateMachineImplementation,
            _disputeManagerFacet,
            _fraudProofFacet,
            _disputeFraudProofFacet,
            _stateSnapshotFacet,
            _joinChannelFacet,
            address(0) // Use 0x00 for consumer facet in local environment
        )
    {
        // Set local-specific timing parameters
        p2pTime = 5;
        agreementTime = 5;
        chainFallbackTime = 5;
        evidenceTime = 5;
        killTime = 10;
    }

    /**
     * @dev Set a storage slot value - useful for syncing state between local and on-chain environments
     * @param slot The storage slot to set
     * @param value The value to store
     */
    function setStorageSlot(bytes32 slot, bytes32 value) external {
        assembly {
            sstore(slot, value)
        }
        emit StorageSet(slot, value);
    }

    /**
     * @dev Get a storage slot value - useful for reading state in local environment
     * @param slot The storage slot to read
     * @return The value stored at the slot
     */
    function getStorageSlot(bytes32 slot) external returns (bytes32) {
        bytes32 value;
        assembly {
            value := sload(slot)
        }
        emit StorageGet(slot, value);
        return value;
    }

    /**
     * @dev Set multiple storage slots at once for efficient state syncing
     * @param slots Array of storage slots to set
     * @param values Array of values to store
     */
    function setStorageSlots(bytes32[] calldata slots, bytes32[] calldata values) external {
        require(slots.length == values.length, "LocalDiamond: slots and values arrays must have same length");

        for (uint256 i = 0; i < slots.length; i++) {
            bytes32 slot = slots[i];
            bytes32 value = values[i];
            assembly {
                sstore(slot, value)
            }
            emit StorageSet(slot, value);
        }
    }

    /**
     * @dev Get multiple storage slots at once for efficient state reading
     * @param slots Array of storage slots to read
     * @return Array of values stored at the slots
     */
    function getStorageSlots(bytes32[] calldata slots) external returns (bytes32[] memory) {
        bytes32[] memory values = new bytes32[](slots.length);

        for (uint256 i = 0; i < slots.length; i++) {
            bytes32 slot = slots[i];
            bytes32 value;
            assembly {
                value := sload(slot)
            }
            values[i] = value;
            emit StorageGet(slot, value);
        }

        return values;
    }
}
