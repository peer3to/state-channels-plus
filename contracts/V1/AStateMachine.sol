pragma solidity ^0.8.8;

import "./DataTypes.sol";

abstract contract AStateMachine {
    Transaction _tx; // This should be used instead of msg.sender at least for now
    address _stateChannelManager;
    bool _nonreentrant;

    // ***** DEBUG *****
    // event SetStateA(bytes encodedState);
    // event TxExecutedA(bool success, bytes encodedState);

    // ***** DEBUG *****

    // Restore the state (variables) of the contract by deserializing/decoding the given the encoded state
    function _setState(bytes memory encodedState) internal virtual;

    // Serialize/encode the current state (variables) of the contract
    function getState() public view virtual returns (bytes memory);

    // return the current participants of the state channel
    function getParticipants() public view virtual returns (address[] memory);

    // return the next participant which should produce a transaction based on the current state (eg. in the game of poker, the next player to play a move)
    function getNextToWrite() public view virtual returns (address);

    // return the balance1 + balance2
    function addBalance(Balance memory balance1, Balance memory balance2) public pure virtual returns (Balance memory sum);
    
    // return the balance1 - balance2 OR throw an error if balance1 < balance2
    function subtractBalance(Balance memory balance1, Balance memory balance2) public pure virtual returns (Balance memory diff);
    
    // return true if balance1 == balance2, false otherwise
    function areBalancesEqual(Balance memory balance1, Balance memory balance2) public pure virtual returns (bool);

    // return true if balance1 < balance2, false otherwise
    function isBalanceLesserThan(Balance memory balance1, Balance memory balance2) public pure virtual returns (bool);

    // return the total balance of the current state (e.g. sum up all participants balances)
    function getTotalStateBalance() public view virtual returns (Balance memory totalBalance);

    // modifies the state to add a new participant to the channel
    function _joinChannel(
        JoinChannel memory joinChannel
    ) internal virtual returns (bool);

    // define the logic that punishes a participant for misbehaving (can also remove the participant from the state channel)
    function _slashParticipant(
        address adr
    ) internal virtual returns (bool,ExitChannel memory exitChannel);

    // similart to _slashParticipant, but doesn't have to punish the player - just removes them from the state channel
    function _removeParticipant(
        address adr
    ) internal virtual returns (bool,ExitChannel memory exitChannel);

    modifier _nonReentrant() {
        require(!_nonreentrant, "ReentrancyGuard: reentrant call");
        _nonreentrant = true;
        _;
        _nonreentrant = false;
    }

    function setState(bytes memory encodedState) external _nonReentrant {
        _setState(encodedState);
        // emit SetStateA(encodedState);
    }

    function joinChannel(
        JoinChannel memory joinChannel
    ) external _nonReentrant returns (bool) {
        return _joinChannel(joinChannel);
    }

    function slashParticipant(
        address adr
    ) external _nonReentrant returns (bool, ExitChannel memory exitChannel) {
        return _slashParticipant(adr);
    }

    function removeParticipant(
        address adr
    ) external virtual _nonReentrant returns (bool, ExitChannel memory exitChannel) {
        return _removeParticipant(adr);
    }

    function stateTransition(
        Transaction calldata transaction
    ) external _nonReentrant returns (bool) {
        _tx = transaction;
        (bool success, bytes memory result) = address(this).call(
            transaction.body.data
        );
        // emit TxExecutedA(success, getState());
        if (!success) {
            if (result.length == 0)
                revert("AStateMachine - Call failed - result lenght 0");
            assembly ("memory-safe") {
                let returndata_size := mload(result)
                revert(add(32, result), returndata_size)
            }
        }
        return success;
    }

    // function stateTransition(bytes memory encodedState, Move memory move) public pure virtual returns (bool,bytes memory);
    // function joinChannelDelegateCall(bytes memory encodedState, Move memory move) public virtual returns (bool,bytes memory); //Not pure - can move assets -> modify state
    // function exitChannelDelegateCall(bytes memory encodedState, Move memory move) public virtual returns (bool,bytes memory); //Not pure - can move assets -> modify state
    // function slashParticipant(bytes memory encodedState, address adr) public pure virtual returns (bool,bytes memory);
    // function removeParticipant(bytes memory encodedState, address adr) public pure virtual returns (bool,bytes memory);
    // function getParticipants(bytes memory encodedState) public pure virtual returns (address[] memory);
    // function getNextToWrite(bytes memory encodedState) public pure virtual returns (address);

    // function setTimestamp(bytes memory encodedState, uint timestamp) public pure virtual returns (bytes memory);
    // function getTimestamp(bytes memory encodedState) public pure virtual returns (uint);
    // function setForkCnt(bytes memory encodedState, uint forkCnt) public pure virtual returns (bytes memory);
    // function getForkCnt(bytes memory encodedState) public pure virtual returns (uint);
    // function getMoveCnt(bytes memory encodedState) public pure virtual returns (uint);
}
