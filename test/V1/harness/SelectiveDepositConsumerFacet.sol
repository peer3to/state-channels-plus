// @spec-test-coverage-ignore: shared Foundry consumer-facet staging exercised by owning mapped test declarations
pragma solidity ^0.8.8;

import {AConsumerFacet} from "../../../contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol";
import "../../../contracts/V1/types/DataTypes.sol";

/// A consumer facet that rejects a zero-amount deposit and counts the ones it
/// accepts, so the proxy's real deposit loop can be driven to a partial
/// outcome. Etched over the deployed consumer facet by the open and deposit
/// suites.
contract SelectiveDepositConsumerFacet is AConsumerFacet {
    bytes32 private constant DEPOSIT_COUNT_SLOT = keccak256("state-channels-plus.test.deposit-count");

    function openChannelGenesis(JoinChannel[] memory, bytes memory)
        external
        pure
        override
        returns (bytes memory encodedGenesisState, address[] memory participants)
    {
        participants = new address[](0);
        return (encodedGenesisState, participants);
    }

    function deposit(JoinChannel memory joinChannel) external override returns (bool) {
        if (joinChannel.balance.amount == 0) return false;

        bytes32 slot = DEPOSIT_COUNT_SLOT;
        assembly {
            sstore(slot, add(sload(slot), 1))
        }
        return true;
    }

    function withdraw(ExitChannel memory) external pure override returns (bool) {
        return true;
    }

    function depositCount() external view returns (uint256 count) {
        bytes32 slot = DEPOSIT_COUNT_SLOT;
        assembly {
            count := sload(slot)
        }
    }
}
