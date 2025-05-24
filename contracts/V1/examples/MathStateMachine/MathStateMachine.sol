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

    // Game-specific function: player voluntarily leaves the game
    function leaveGame() public returns (bool) {
        require(
            _tx.header.participant == getNextToWrite(),
            "MathStateMachine: leaveGame only next player can leave"
        );
        
        address leavingPlayer = _tx.header.participant;
        (bool success, ExitChannel memory exitChannel) = _removeParticipant(leavingPlayer);
        
        if (success) {
            _addExitChannel(exitChannel);
        }
        
        return success;
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

                exitChannel.participant = adr;
                exitChannel.amount = 0;
                exitChannel.isPartialExit = false;
                return (true, exitChannel);
            }
        }
        return (false, exitChannel);
    }

    function _joinChannel(
        JoinChannel memory joinChannel
    ) internal virtual override returns (bool) {}
}
