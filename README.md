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

### Distributed parallel tests

The worker and orchestrator can run on different devices. They do not need a
direct IP address for each other when the default Hyperswarm DHT is reachable.
The orchestrator sends source files, not `node_modules` or local build output.

Put the same secret in the ignored `.env` file on every device:

```dotenv
SCP_TEST_POOL_SECRET=<the-same-random-secret-on-every-device>
```

Both runner entry points load `.env` automatically. On the worker device,
check out this SDK version, install its dependencies, and start the persistent
server:

```shell
pnpm install
pnpm test:parallel:server --name worker-one
```

Each server controls its own capacity. It uses the same defaults as the local
parallel runner: one infrastructure slot, up to 40 test processes, and one
admission attempt every 1000 ms. Use `--slots <count>`, `-w <count>`, and
`-i <ms>` on the server command to override them for that device. The
orchestrator does not set worker capacity or timing.

On the orchestrator device, start with a small smoke run from the project being
tested:

```shell
yarn test:parallel:distributed \
  --test-pattern 'scripts/e2eParallelDistributedE2E.test.ts' \
  --discovery-timeout 60000
```

The source archive contains tracked and non-ignored files from the test
repository and every recursive `link:` or `file:` dependency. Their relative
filesystem layout is preserved, so links such as
`poker -> ../state-channels-plus` resolve after extraction. The
worker installs each repository with pnpm, using a persistent pnpm store, then
builds linked repositories before the test repository.

#### Distributed storage and cleanup

`distributed-worker` is the default directory for worker-managed data, not a
separate process. When the server starts from this repository without an
explicit work root, its layout is:

```text
temp/distributed-worker/
├── pnpm-store/
├── workspaces/
│   └── <project-id>/
│       ├── source-manifest.json
│       ├── prepared.json
│       └── workspace/
└── leases/
    └── lease-*/
        ├── runtime.tgz
        ├── infra/
        └── spool/
```

- `/tmp/peer3-test-pool-server-v7.lock` is the one host-scoped file outside the
  worker root. Its OS-held lock prevents servers using different clones or
  `--work-root` values from oversubscribing the same machine. The file may
  remain after shutdown, but its lock is released.
- `pnpm-store/` is the persistent dependency cache shared by later runs.
- `workspaces/<project-id>/` is the persistent reconstructed source tree. It
  keeps `node_modules`, generated files, and successful build output.
- `source-manifest.json` records source hashes and cached file metadata. Before
  each run, the worker checks the cached files on disk, re-hashes anything
  whose size or modification time drifted, and asks the orchestrator only for
  changed files and deletion paths.
- `prepared.json` records the last source version that installed and built
  successfully. An unchanged prepared workspace skips upload, installation,
  and build. Source-only changes reuse `node_modules`; package or lockfile
  changes rerun pnpm installation.
- `leases/lease-*` is one temporary orchestrator lease.
- `runtime.tgz` contains only source files missing or changed in the persistent
  workspace. A first run contains every source file; an unchanged run contains
  no source files.
- A poker-contracts workspace has sibling `poker-contracts/` and
  `state-channels-plus/` directories inside its persistent `workspace/`.
- `infra/` contains temporary Hardhat and discovery infrastructure data.
- `spool/` temporarily holds test stdout and stderr before it is committed to
  the orchestrator.

The orchestrator creates the sending copy here:

```text
logs/run-N/distributed-transfer/source.tgz
```

This archive and its `distributed-transfer/` directory are deleted when the
distributed command finishes or fails. Canonical summaries and test logs stay
under `logs/run-N/`.

The worker deletes the complete `leases/lease-*` tree when the run completes,
fails, is cancelled, or loses its orchestrator. This removes the received
delta archive, infrastructure data, and spooled output. The worker root remains
with empty `leases/`, `pnpm-store/`, and prepared `workspaces/` so later runs can
reuse them.

Use `--work-root <path>` to replace the default root completely:

```shell
pnpm test:parallel:server \
  --name worker-one \
  --work-root /your/chosen/directory
```

All worker-managed files then live under `/your/chosen/directory`; nothing is
written to `temp/distributed-worker/`. Use an empty, writable directory on fast
local storage, and do not share one work root between worker servers. Real
distributed runs do not store package data in random OS temporary directories.
Unit tests may use OS temporary directories and remove them during teardown.

After the smoke run, remove `--test-pattern` to run the whole suite. The worker
reports ready, busy, and queued states and remains announced for later runs.

Discovery always uses the public Hyperswarm network. There is no bootstrap
server or port to configure. While a run is active, both commands print their
current stage: discovery, connection, lease, source upload, pnpm progress,
build output, test execution, and cleanup. Use repeatable `--forward-env
<NAME>` flags for required test settings. The pool secret and the rest of the
orchestrator environment are never forwarded. Stop a server with SIGINT or
SIGTERM. Canonical task and failure logs remain on the orchestrator under
`logs/run-N/`, including `error_*.ansi` files and worker infrastructure
diagnostics.

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
