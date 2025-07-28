pragma solidity ^0.8.8;

import "./StateChannelManagerProxy.sol";
import "../types/DataTypes.sol";

/**
 * @title LocalDiamond
 * @dev Local implementation of the diamond proxy.
 * This contract provides storage sync methods and no-op asset management for local testing.
 *
 */
contract LocalDiamond is StateChannelManagerProxy {
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
        StateChannelManagerProxy(
            _stateMachineImplementation,
            _disputeManagerFacet,
            _fraudProofFacet,
            _disputeFraudProofFacet,
            _stateSnapshotFacet,
            _joinChannelFacet,
            address(0) // Use 0x00 for consumer facet in local environment
        )
    {
        p2pTime = 5;
        agreementTime = 5;
        chainFallbackTime = 5;
        evidenceTime = 5;
        killTime = 10;
    }

    function setStorageSlot(bytes32 slot, bytes32 value) external {
        assembly {
            sstore(slot, value)
        }
        emit StorageSet(slot, value);
    }

    function getStorageSlot(bytes32 slot) external view returns (bytes32) {
        bytes32 value;
        assembly {
            value := sload(slot)
        }
        return value;
    }

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

    function getStorageSlots(bytes32[] calldata slots) external view returns (bytes32[] memory) {
        bytes32[] memory values = new bytes32[](slots.length);

        for (uint256 i = 0; i < slots.length; i++) {
            bytes32 slot = slots[i];
            bytes32 value;
            assembly {
                value := sload(slot)
            }
            values[i] = value;
        }

        return values;
    }
}
