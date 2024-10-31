# Minimal Feature Set (MFS) - Docs

## Overview

This SDK is composed of 2 parts:

1. Smart contracts
2. TypeScript

The smart contracts provide base contracts that need to be extended for a specific use-case (state machine). The state machine executes p2p in real-time without any fees, with shared security inherited from a distributed ledger (blockchain).

The TypeScript part of the SDK implements all the functionality and makes it easily available through a simple [setup](../src/evm/EvmStateMachine.ts#205) that wraps/ensrhnies [ethers](https://github.com/ethers-io/ethers.js) contract instances. After the setup, the wrapped/enshrined contracts can be used as a direct substitute for the original contracts, and the system will handle everything. The contracts preserve the same TypeChain generated type.

## General Usage

1.  Implement a specific state machine (smart contract) by extending [AStateMachine](../contracts/V1/AStateMachine.sol). ([Example](../examples/TicTacToe/contracts/TicTacToe/TicTacToeStateMachine.sol));

2.  Implement a specific StateChannelManager contract by extending [AStateChannelManager](../contracts/V1/StateChannelDiamondProxy/AStateChannelManagerProxy.sol). ([Example](../examples/TicTacToe/contracts/TicTacToe/TicTacToeStateChannelManagerProxy.sol));

3.  Compile your contracts (we use Hardhat);

4.  Deploy contracts ([Example](../examples/TicTacToe/scripts/deployTicTacToeContractsProxy.ts)):

-   Deploy [StateChannelUtil](../contracts/V1/StateChannelDiamondProxy/StateChannelUtilLibrary.sol) or use an existing deployment ([Example](../examples/TicTacToe/scripts/deployTicTacToeContractsProxy.ts#L37));
-   Deploy [DisputeManagerFacet](../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol) or use an existing deployment ([Example](../examples/TicTacToe/scripts/deployTicTacToeContractsProxy.ts#L51));
-   Deploy the implemented StateMachine contract ([Example](../examples/TicTacToe/scripts/deployTicTacToeContractsProxy.ts#L64));
-   Deploy the implemented StateChannelManager contract ([Example](../examples/TicTacToe/scripts/deployTicTacToeContractsProxy.ts#L83));

5. Run [setup](../src/evm/EvmStateMachine.ts#L205) on ethers contract instances ([Example](../examples/TicTacToe/tic-tac-toe-vite/src/stateChannel/TicTacToeStateChannel.ts#L53));

6. Use the enshrined contract as a direct substitute for the original contract ([Example](../examples/TicTacToe/tic-tac-toe-vite/src/components/Game.tsx#L65)).

## AStateMachine interface

```solidity
function _setState(bytes memory encodedState) internal virtual;
```

Unconditionally sets the state of the state machine contract, by deserializing (decoding) bytes. ([Example](../examples/TicTacToe/contracts/TicTacToe/TicTacToeStateMachine.sol#L116))

```solidity
function getState() public view virtual returns (bytes memory);
```

Serializes (encodes) the state of the state machine contract and returns it. ([Example](../examples/TicTacToe/contracts/TicTacToe/TicTacToeStateMachine.sol#L120))

```solidity
function getParticipants() public view virtual returns (address[] memory);
```

Returns the current participants of the state channel. ([Example](../examples/TicTacToe/contracts/TicTacToe/TicTacToeStateMachine.sol#L124))

```solidity
function getNextToWrite() public view virtual returns (address);
```

Returns the next participant whose turn is to progress (mutate) the state machine. ([Example](../examples/TicTacToe/contracts/TicTacToe/TicTacToeStateMachine.sol#L134))

```solidity
function _joinChannel(JoinChannel memory joinChannel) internal virtual returns (bool);
```

Triggered when someone joins the state channel. Used to modify the state machine to incorporate the addition into the state. (type [JoinChannel](../contracts/V1/DataTypes.sol#L80)) ([Example](../examples/TicTacToe/contracts/TicTacToe/TicTacToeStateMachine.sol#L165))

```solidity
function _slashParticipant(address adr) internal virtual returns (bool, ProcessExit memory);
```

Triggered when someone is slashed - when provable fraud is detected. Allows the state machine to define custom behavior how to handle and apply the slash. ([Example](../examples/TicTacToe/contracts/TicTacToe/TicTacToeStateMachine.sol#L141))

```solidity
function _removeParticipant(address adr) internal virtual returns (bool, ProcessExit memory);
```

Triggered when someone is removed from the state channel, but not as aggressive as slash. Currently triggered on timeout. ([Example](../examples/TicTacToe/contracts/TicTacToe/TicTacToeStateMachine.sol#L147))

### Each state machine has to override the above-listed functions as they're expected by the system (SDK), but can add its own functions to extend the interface and thus build arbitrary state machines in its own way.

## AStateChannelManager interface

```solidity
function openChannel(
        bytes32 channelId,
        bytes[] calldata openChannelData,
        bytes[] calldata signatures
    ) public virtual;
```

Executed on-chain once for every unique channelId. Performs all the composable operations on the global (world) state (can interact with other contracts). Atomic success or failure.

-   channelId - unique identifier of the channel

-   openChannelData - array of bytes for every participant in the channel - bytes hold commitment data (eg. amount of tokens to deposit). - usually the bytes are interpreted as [JoinChannel](../contracts/V1/DataTypes.sol#L80), but you can use your own custom types and have a fully custom verification logic.

-   signatures - array of sigantures - signed openChannelData by each participant in the channel.

([Example](../examples/TicTacToe/contracts/TicTacToe/TicTacToeStateChannelManagerProxy.sol#L23))

## This is for the MFS (minimal feature set) - the full feature set will include more functionality.
