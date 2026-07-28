# Peer3 - State Channels Plus

This is an SDK for creating scalable and resilient client side peer-to-peer (p2p) state channels for arbitrary state machines with shared security inherited from a distributed ledger (blockchain).

The repository currently holds a Minimal Feature Set (MFS) as part of our [grant agreement](https://github.com/w3f/Grants-Program/pull/2350) with the Web3 Foundation.

We recommend waiting for the Full Feature Set before using it in production.

## Table of Contents
- [Peer3 - State Channels Plus](#peer3---state-channels-plus)
  - [Table of Contents](#table-of-contents)
  - [Videos](#videos)
  - [Installation](#installation)
  - [Getting Started](#getting-started)
  - [Examples](#examples)
  - [Configuration](#configuration)
  - [Run Tests](#run-tests)
  - [Code Formatting](#code-formatting)
    - [Available Commands](#available-commands)
    - [Automatic Formatting](#automatic-formatting)
  - [Contact](#contact)
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
yarn && yarn build
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

## Configuration

### Persistence

`p2pSetup` enables persistence by default. Browser runtimes store channel
partitions in IndexedDB; Node runtimes use embedded LevelDB in the operating
system's application-data directory unless `persistence.location` is set.
Pass the channel ID during setup to restore the channel signer and cached state
before connecting:

```ts
await EvmStateMachine.p2pSetup(scm, stateMachine, deployStateMachine, {
    channelId,
    persistence: { location: "/path/to/app-data" }
});
```

Each channel partition permits one live writer. Local demos or tests running
multiple peers for the same channel must use separate locations or
`persistence: false`.

Storage writes update the in-memory cache immediately and are buffered to the
platform database in short atomic batches. Protocol actions that expose signed
state or submit transactions flush the required state internally first, and a
graceful SDK shutdown flushes the remaining buffered writes. A forced process
or worker termination can lose the unflushed, non-externalized tail.

Persistence recovery fails closed when stored data is corrupt or incomplete
and reports the resolved database location. Passing
`persistence: { location, reset: true }` explicitly deletes that channel
partition and starts fresh; it does not attempt to repair or preserve its data.

Signer secrets are currently stored as plaintext local metadata. Node limits
the default root to the current OS user; browsers rely on the origin boundary.
Caller-supplied encryption and automatic partition destruction after a channel
settles are not implemented yet. Proof-aware pruning is also pending, so
partitions grow until the application removes them.

Create a `peer3.config.json` file in the root of your project (next to `package.json`) with the following structure and set the values per your configuration:

```json
{
  "PROVIDER_URL": "http://localhost:8545",
  "DEBUG_STATE_MANAGER": false,
  "DEBUG_DISPUTE_HANDLER": false,
  "DEBUG_P2P_MANAGER": false,
  "DEBUG_RPC": false,
  "DEBUG_CHANNEL_CONTRACT": false,
  "DEBUG_LOCAL_TRANSPORT": false
}
```

```shell
yarn && yarn build
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
