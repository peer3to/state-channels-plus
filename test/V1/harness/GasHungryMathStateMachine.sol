// @spec-test-coverage-ignore: test harness state machine; it contains no executable evidence
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import {MathStateMachine} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {ExitChannel, Message} from "../../../contracts/V1/types/DataTypes.sol";

/// A Math machine with transitions that stage each stipend boundary: `burn` never finishes, so it
/// is invalid under any budget; `guardedAdd` catches an inner out-of-gas, so only its fully funded
/// run is `add(1)`; `bareRevert` and `failWithReason` fail with empty and nonempty returndata.
contract GasHungryMathStateMachine is MathStateMachine {
    // Sized for this fixture's 16M guarded-work budget: `work` costs a little under what the guarded
    // sub-call is offered, so it fails as soon as the transition is granted about 1M less than the
    // budget, while the outer frames still keep enough gas to finish a fraud verdict.
    uint256 internal constant GUARDED_WORK_GAS = 15_000_000;
    uint256 internal constant WORK_ROUNDS = 160_000;

    constructor(uint256 _gasLimit, uint256 _maxChannelParticipants)
        MathStateMachine(_gasLimit, _maxChannelParticipants)
    {}

    function burn() public {
        require(_tx.header.participant == getNextToWrite(), "GasHungryMathStateMachine: only next player");
        uint256 x = 1;
        while (x != 0) {
            x = uint256(keccak256(abi.encode(x)));
        }
    }

    /// `add(1)` after finite work in a guarded sub-call; if the sub-call fails the turn only
    /// advances. Under the full budget the sub-call always succeeds, so an under-funded replay
    /// would succeed with a different state.
    function guardedAdd() public {
        require(_tx.header.participant == getNextToWrite(), "GasHungryMathStateMachine: only next player");
        try this.work{gas: GUARDED_WORK_GAS}() {
            add(1);
        } catch {
            state.currentTurnIndex++;
        }
    }

    /// `guardedAdd` with an unused input of any size: the input is copied into memory for the
    /// transition's call, so its size must not change how much gas the transition is granted.
    function guardedAddWithInput(bytes calldata) public {
        guardedAdd();
    }

    /// The gas `recordEntryGas` had when the transition started, for tests that check the
    /// transition was granted its full budget.
    uint256 public lastEntryGas;

    function recordEntryGas(bytes calldata) public {
        lastEntryGas = gasleft();
    }

    /// Leaves `count` exit messages for the next transition to clear.
    function recordExits(uint256 count) public {
        for (uint256 i = 0; i < count; i++) {
            ExitChannel memory exitChannel;
            exitChannel.participant = address(uint160(i + 1));
            exitChannel.balance.amount = i + 1;
            _addExitChannel(exitChannel);
        }
    }

    /// Leaves `count` messages whose data is `dataLength` nonzero bytes.
    function recordMessages(uint256 count, uint256 dataLength) public {
        bytes memory data = new bytes(dataLength);
        for (uint256 i = 0; i < dataLength; i++) {
            data[i] = 0x01;
        }
        for (uint256 i = 0; i < count; i++) {
            Message memory message;
            message.participant = address(uint160(i + 1));
            message.balance.amount = i + 1;
            message.data = data;
            _addOutboundMessage(message);
        }
    }

    /// The gas `recordMessagesMeasured` spent inside the transition, for tests that compare a
    /// transition's own cost after different histories.
    uint256 public lastTransitionGas;

    function recordMessagesMeasured(uint256 count, uint256 dataLength) public {
        uint256 start = gasleft();
        recordMessages(count, dataLength);
        lastTransitionGas = start - gasleft();
    }

    function work() external pure returns (uint256 x) {
        uint256 rounds = WORK_ROUNDS;
        assembly ("memory-safe") {
            x := 1
            for { let i := 0 } lt(i, rounds) { i := add(i, 1) } {
                mstore(0, x)
                x := keccak256(0, 32)
            }
        }
    }

    function bareRevert() public pure {
        revert();
    }

    function failWithReason() public pure {
        revert("GasHungryMathStateMachine: rejected");
    }
}
