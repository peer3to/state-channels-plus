// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import "../../AStateMachine.sol";

// Uncomment this line to use console.log
// import "hardhat/console.sol";
struct MathState {
    uint number;
    address[] participants;
}

contract MathStateMachine is AStateMachine {
    MathState state;

    event Addition(uint a, uint b, uint result);
    event NextToPlay(address player);

    function add(uint _number) public returns (uint) {
        require(
            _tx.header.participant == getNextToWrite(),
            "MathStateMachine: add only next player can write"
        );
        emit Addition(state.number, _number, state.number + _number);
        state.number += _number;
        emit NextToPlay(getNextToWrite());
        return state.number;
    }

    function getSum() public view returns (uint) {
        return state.number;
    }

    function _setState(bytes memory encodedState) internal virtual override {
        state = abi.decode(encodedState, (MathState));
    }

    function getState() public view virtual override returns (bytes memory) {
        return abi.encode(state);
    }

    function getParticipants()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        return state.participants;
    }

    function getNextToWrite() public view virtual override returns (address) {
        if (state.participants.length == 0) {
            return _tx.header.participant;
        }
        return state.participants[state.number % state.participants.length];
    }

     function _slashParticipant(
        address adr
    ) internal virtual override returns (bool, ExitChannel memory) {
        return _removeParticipant(adr);
    }

    function _removeParticipant(
        address adr
    ) internal virtual override returns (bool, ExitChannel memory) {
        uint256 length = state.participants.length;
        ExitChannel memory exitChannel;
        for (uint256 i = 0; i < length; i++) {
            if (state.participants[i] == adr) {
                state.participants[i] = state.participants[length - 1];
                state.participants.pop();

                ExitChannel memory exitChannel;
                exitChannel.participant = adr;
                exitChannel.balance.amount = 0;
                return (true, exitChannel);
            }
        }
        return (false, exitChannel);
    }

    function _joinChannel(
        JoinChannel memory joinChannel
    ) internal virtual override returns (bool) {}

    function addBalance(Balance memory balance1, Balance memory balance2) public pure override returns (Balance memory sum) {
        sum.amount = balance1.amount + balance2.amount;
        return sum;
    }
    function subtractBalance(Balance memory balance1, Balance memory balance2) public pure override returns (Balance memory diff) {
        require(balance1.amount >= balance2.amount, "MathStateMachine: balance1 < balance2");
        diff.amount = balance1.amount - balance2.amount;
        return diff;
    }
    function areBalancesEqual(Balance memory balance1, Balance memory balance2) public pure override returns (bool) {
        return balance1.amount == balance2.amount;
    }
    function isBalanceLesserThan(Balance memory balance1, Balance memory balance2) public pure override returns (bool) {
        return balance1.amount < balance2.amount;
    }
    function getTotalStateBalance() public view override returns (Balance memory totalBalance) {
        totalBalance.amount = state.number;
        return totalBalance;
    }
}
