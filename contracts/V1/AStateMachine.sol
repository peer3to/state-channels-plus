pragma solidity ^0.8.8;

import "./types/DataTypes.sol";
import "./types/MessageTypeHashes.sol";

abstract contract AStateMachine {
    Transaction _tx; // This should be used instead of msg.sender at least for now
    address _stateChannelManager;
    bool _nonreentrant;
    uint256 gasLimit;
    Message[] private _outboundMessages;

    constructor(uint256 _gasLimit) {
        gasLimit = _gasLimit;
    }
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

    // return the current exit channels
    function getOutboundMessages() public view returns (Message[] memory) {
        return _outboundMessages;
    }

    // return the balance1 + balance2
    function addBalance(Balance memory balance1, Balance memory balance2)
        public
        pure
        virtual
        returns (Balance memory sum);

    // return the balance1 - balance2 OR throw an error if balance1 < balance2
    function subtractBalance(Balance memory balance1, Balance memory balance2)
        public
        pure
        virtual
        returns (Balance memory diff);

    // return true if balance1 == balance2, false otherwise
    function areBalancesEqual(Balance memory balance1, Balance memory balance2) public pure virtual returns (bool);

    // return true if balance1 < balance2, false otherwise
    function isBalanceLesserThan(Balance memory balance1, Balance memory balance2) public pure virtual returns (bool);

    // return the total balance of the current state (e.g. sum up all participants balances)
    function getTotalStateBalance() public view virtual returns (Balance memory totalBalance);

    function getZeroBalance() public pure virtual returns (Balance memory zeroBalance);

    function processInboundMessage(Message calldata message) external _nonReentrant returns (bool) {
        return _processInboundMessage(message);
    }

    function _processInboundMessage(Message calldata message) internal virtual returns (bool) {
        if (message.messageType == MESSAGE_TYPE_JOIN) {
            JoinChannel memory joinChannel = abi.decode(message.data, (JoinChannel));
            return _joinChannel(joinChannel);
        }
        return _processCustomInboundMessage(message);
    }

    function _processCustomInboundMessage(Message calldata message) internal virtual returns (bool) {
        message;
        return false;
    }

    // modifies the state to add a new participant to the channel
    function _joinChannel(JoinChannel memory joinChannel) internal virtual returns (bool);

    // define the logic that punishes a participant for misbehaving (can also remove the participant from the state channel)
    function _slashParticipant(address adr) internal virtual returns (bool, ExitChannel memory exitChannel);

    // similar to _slashParticipant, but doesn't have to punish the player - just removes them from the state channel
    function _removeParticipant(address adr) internal virtual returns (bool, ExitChannel memory exitChannel);

    function _addOutboundMessage(Message memory message) internal {
        _outboundMessages.push(message);
    }

    function _addExitChannel(ExitChannel memory exitChannel) internal {
        Message memory outboundMessage;
        outboundMessage.messageType = MESSAGE_TYPE_EXIT;
        outboundMessage.participant = exitChannel.participant;
        outboundMessage.balance = exitChannel.balance;
        outboundMessage.data = abi.encode(exitChannel);
        _addOutboundMessage(outboundMessage);
    }

    function _clearOutboundMessages() internal {
        delete _outboundMessages;
    }

    function setState(bytes memory encodedState) external _nonReentrant {
        _setState(encodedState);
        // emit SetStateA(encodedState);
    }

    function joinChannel(JoinChannel memory jc) external _nonReentrant returns (bool) {
        return _joinChannel(jc);
    }

    function slashParticipant(address adr) external _nonReentrant returns (bool, ExitChannel memory) {
        (bool success, ExitChannel memory exitChannel) = _slashParticipant(adr);
        if (success) {
            _addExitChannel(exitChannel);
        }
        return (success, exitChannel);
    }

    function removeParticipant(address adr)
        external
        virtual
        _nonReentrant
        returns (bool, ExitChannel memory exitChannel)
    {
        return _removeParticipant(adr);
    }

    function stateTransition(Transaction calldata transaction)
        external
        _nonReentrant
        returns (bool, Message[] memory)
    {
        _clearOutboundMessages();
        _tx = transaction;
        (bool success, bytes memory result) = address(this).call{gas: gasLimit}(transaction.body.data);
        // emit TxExecutedA(success, getState());
        if (!success) {
            if (result.length == 0) {
                revert("AStateMachine - Call failed - result length 0");
            }
            assembly ("memory-safe") {
                let returndata_size := mload(result)
                revert(add(32, result), returndata_size)
            }
        }
        Message[] memory recordedMessages = new Message[](_outboundMessages.length);
        for (uint256 i = 0; i < _outboundMessages.length; i++) {
            recordedMessages[i] = _outboundMessages[i];
        }
        return (success, recordedMessages);
    }

    modifier _nonReentrant() {
        require(!_nonreentrant, "ReentrancyGuard: reentrant call");
        _nonreentrant = true;
        _;
        _nonreentrant = false;
    }
}
