pragma solidity ^0.8.8;

import "./types/DataTypes.sol";
import "./types/MessageTypeHashes.sol";

/// The caller cannot grant the transition its full `gasLimit` stipend. Raised before the
/// transition runs, so an under-funded replay never produces a verdict.
error ErrorInsufficientGasForStateTransition(uint256 required, uint256 granted);

abstract contract AStateMachine {
    Transaction _tx; // This should be used instead of msg.sender at least for now
    address _stateChannelManager;
    bool _nonreentrant;
    uint256 gasLimit;
    // This transition's messages. The previous transition's messages are deleted before the gas
    // check, so every transition writes into empty slots and its cost does not depend on what an
    // earlier call left behind; the deletion is paid by the caller outside the budget.
    Message[] private _outboundMessages;

    // Margin for the fixed opcodes between the gas reading and the stipend CALL (the call input is
    // already in memory, so nothing there grows with the transaction). It only makes the
    // granted-gas estimate conservative: a refusal that could have been a verdict costs the sender
    // a retry, never a wrong verdict.
    uint256 internal constant STATE_TRANSITION_CALL_RESERVE = 20_000;
    // Upper bound on what stateTransition spends before it reads the gas it can grant for a
    // typical call (storing the transaction header, copying the call input). Deleting the previous
    // transition's outbound messages and copying a larger input cost more; that work grows with
    // history and input and is not covered here: a sender's estimate pays for it.
    uint256 internal constant STATE_TRANSITION_SETUP_GAS = 200_000;

    constructor(uint256 _gasLimit) {
        gasLimit = _gasLimit;
    }

    /// Gas a caller must forward into the stateTransition frame for it to grant the transition
    /// its full `gasLimit` budget.
    function getStateTransitionGasRequirement() public view returns (uint256) {
        return (gasLimit + STATE_TRANSITION_CALL_RESERVE) * 64 / 63 + 1 + STATE_TRANSITION_SETUP_GAS;
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

    // Adds a new participant, or tops up an existing participant on a repeated join.
    function _joinChannel(JoinChannel memory joinChannel) internal virtual returns (bool);

    /// @dev Define the logic that punishes a participant for misbehaving (can also remove the participant from the
    /// state channel). Must return true for every current participant: dispute reduction adds the timeout target to
    /// the removals only when no slash took effect, so a false return for a present participant also removes the
    /// timeout target.
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

    /// @notice The next writer of `encodedState`.
    /// @dev Sets that state, so callers run it as a simulated call and the change is not kept.
    function getNextToWriteOf(bytes memory encodedState) external _nonReentrant returns (address) {
        _setState(encodedState);
        return getNextToWrite();
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
        (bool success, ExitChannel memory removedExit) = _removeParticipant(adr);
        if (success) {
            _addExitChannel(removedExit);
        }
        return (success, removedExit);
    }

    // Implementations must reject a transaction whose participant is not
    // getNextToWrite(); wrong-turn fraud-proof soundness depends on it.
    function stateTransition(Transaction calldata transaction)
        external
        _nonReentrant
        returns (bool, Message[] memory)
    {
        _clearOutboundMessages();
        _tx.header = transaction.header;
        // EIP-150 lets a CALL forward at most 63/64 of the remaining gas and never fails for
        // asking more, so an under-funded caller would silently hand the transition less than
        // `gasLimit`. A transition can catch an inner out-of-gas and still succeed or fail
        // with its own error, so no outcome of an under-funded run is a verdict. Refuse to run
        // unless the call can grant the full budget; the caller (a fraud-proof sender) must
        // fund it upfront (see getStateTransitionGasRequirement).
        // Copy the call input and read the budget first: that work grows with the input and must
        // be paid before the gas check, not between the check and the CALL.
        bytes memory data = transaction.body.data;
        uint256 budget = gasLimit;
        uint256 available = gasleft();
        uint256 granted =
            available > STATE_TRANSITION_CALL_RESERVE ? available - available / 64 - STATE_TRANSITION_CALL_RESERVE : 0;
        if (granted < budget) revert ErrorInsufficientGasForStateTransition(budget, granted);
        bool success;
        uint256 resultSize;
        assembly ("memory-safe") {
            success := call(budget, address(), 0, add(data, 32), mload(data), 0, 0)
            resultSize := returndatasize()
        }
        bytes memory result = new bytes(resultSize);
        assembly ("memory-safe") {
            returndatacopy(add(result, 32), 0, resultSize)
        }
        // emit TxExecutedA(success, getState());
        if (!success) {
            if (result.length == 0) {
                // Out of gas within the full budget, or a bare revert.
                revert("AStateMachine - Call failed - result length 0");
            }
            assembly ("memory-safe") {
                let returndata_size := mload(result)
                revert(add(32, result), returndata_size)
            }
        }
        return (success, getOutboundMessages());
    }

    modifier _nonReentrant() {
        require(!_nonreentrant, "ReentrancyGuard: reentrant call");
        _nonreentrant = true;
        _;
        _nonreentrant = false;
    }
}
