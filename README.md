# Peer3 - State Channels Plus

This is an SDK for creating scalable and resilient client side peer-to-peer (p2p) state channels for arbitrary state machines with shared security inherited from a distributed ledger (blockchain).

The repository currently holds a Minimal Feature Set (MFS) as part of our [grant agreement](https://github.com/w3f/Grants-Program/pull/2350) with the Web3 Foundation.

We recommend waiting for the Full Feature Set before using it in production.

## Table of Contents
- [Videos](#videos)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Examples](#examples)
- [Run Tests](#run-tests)
- [Get In Touch](#contact)
- [Docs (MFS)](./docs/mfsDocs.md)
- [License](#license)

## Videos
- Demo - https://www.youtube.com/watch?v=W_CWPOezjU8
- Tech Explanation - https://www.youtube.com/watch?v=RtjiyDDhvWA
- Peer3 Intro - https://www.youtube.com/watch?v=GnRPe6ziKpI

## Installation

```shell
yarn add @peer3/state-channels-plus
```

## Getting Started
The SDK currently supports running EVM smart contracts (state machines).
We recommend watching our [tech explanation video](https://www.youtube.com/watch?v=RtjiyDDhvWA) to have a rough estimate how things work.

While you can do general (arbitrary) execution, the SDK requires the state machines to implement a base contract [AStateMachine](./contracts/V1/AStateMachine.sol).
The implemented contract executes p2p with shared security enforced by a blockchain, concretely by a StateChannelManager contract that extends [AStateChannelManager](./contracts/V1/StateChannelDiamondProxy/AStateChannelManagerProxy.sol).

The TypeScript part of the SDK currently builds on top of [ethers](https://github.com/ethers-io/ethers.js).

The SDK abstracts away most of the complexities of the system and is designed to have the same development experience as if the contracts were executing on-chain. It takes an ethers contract instance and enshrines it during [setup](./src/evm/EvmStateMachine.ts#205). The enshrined contract has the same type and functionality as the original contract, but it executes p2p. The setup also wraps the ethers signer by giving it more functionality that's used within the system.

## Examples

[Tic-Tac-Toe](./examples/TicTacToe) - the code used in the [demo video](https://www.youtube.com/watch?v=W_CWPOezjU8)

## Run Tests
Install local dependencies
```shell
yarn
```
Compile the contracts and run tests
```shell
yarn testc
```

## Contact
- contact@peer3.to
- [Peer3 X](https://x.com/peer3_to)

# License
MIT