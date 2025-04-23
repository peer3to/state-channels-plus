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
- [Code Formatting](#code-formatting)
- [Get In Touch](#contact)
- [Docs (MFS)](./docs/mfsDocs.md)
- [License](#license)

## Videos
- Demo - https://www.youtube.com/watch?v=W_CWPOezjU8
- Tech Explanation - https://www.youtube.com/watch?v=RtjiyDDhvWA
- Peer3 Intro - https://www.youtube.com/watch?v=GnRPe6ziKpI

## Installation

For usage in other projects, install from npm:
```shell
yarn add @peer3/state-channels-plus
```

For usage in this repository, install local dependencies and build the SDK:
```shell
yarn && yarn hardhat compile && yarn build
```


## Getting Started
The SDK currently supports running EVM smart contracts (state machines).
We recommend watching our [tech explanation video](https://www.youtube.com/watch?v=RtjiyDDhvWA) to have a rough estimate how things work.

While you can do general (arbitrary) execution, the SDK requires the state machines to implement a base contract [AStateMachine](./contracts/V1/AStateMachine.sol).
The implemented contract executes p2p with shared security enforced by a blockchain, concretely by a StateChannelManager contract that extends [AStateChannelManager](./contracts/V1/StateChannelDiamondProxy/AStateChannelManagerProxy.sol).

The TypeScript part of the SDK currently builds on top of [ethers](https://github.com/ethers-io/ethers.js).

The SDK abstracts away most of the complexities of the system and is designed to have the same development experience as if the contracts were executing on-chain. It takes an ethers contract instance and enshrines it during [setup](./src/evm/EvmStateMachine.ts#L205). The enshrined contract has the same type and functionality as the original contract, but it executes p2p. The setup also wraps the ethers signer by giving it more functionality that's used within the system.

## Examples

[Tic-Tac-Toe](./examples/TicTacToe) - the code used in the [demo video](https://www.youtube.com/watch?v=W_CWPOezjU8)

<b style="color: yellow;">Note: The examples within this repository use the current version of the SDK(this repository) and not the remote package available on npm. This requires to install dependencies and build the SDK locally, before proceeding. </b>

```shell
yarn && yarn hardhat compile && yarn build
```

## Run Tests
Install local dependencies
```shell
yarn
```
Compile the contracts and run tests
```shell
yarn testc
```

## Code Formatting

This repository uses [Prettier](https://prettier.io/) for code formatting with configuration in `.prettierrc`. Formatting is automatically enforced using [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/lint-staged/lint-staged) to ensure consistent code style across all contributions.

### Available Commands

- Format all files: `yarn format`
- Check formatting without modifying files: `yarn format:check`

### Automatic Formatting

Files are automatically formatted when you commit changes. The pre-commit hook will run Prettier on staged files before they are committed, ensuring that all code in the repository follows the same formatting standards.

## Contact
- contact@peer3.to
- [Peer3 X](https://x.com/peer3_to)

# License
MIT