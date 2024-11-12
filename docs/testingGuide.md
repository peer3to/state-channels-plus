# Testing Guide

All the tests can be found in the [tests](../test/V1/) directory.

## Setup

To run the tests, first install all the dependencies locally or use Docker.

### Local dependency installation

```shell
yarn
```

(It's also possible to use another package manager like npm).

### Docker

Use the Dockerfile to build the image and use that image to run tests in a container.

```shell
docker build -t peer3-tests .
```

Run the container in interactive mode with the terminal:

```shell
docker run -it peer3-tests /bin/bash
```

---

## Running tests

The testing process is same for Docker and running locally (directly on the host machine).

There's a single command that compiles all contracts, generates all the TypeScript types and runs all tests:

```shell
yarn testc
```

The above command can be broken up into steps:

First, contracts have to be compiled:

```shell
yarn hardhat compile
```

Use TypeChain to generate the TypeScript types that are used throughout the SDK:

```shell
yarn hardhat typechain
```

Run all tests:

```shell
yarn hardhat test
```

## Run individual tests:

Cryptography tests:

```shell
yarn hardhat test test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts
```

Channel Opening tests:

```shell
yarn hardhat test test/V1/DiamondProxy/StateChannelManager/OpenChannel.test.ts
```

Timeout and liveness tests:

```shell
yarn hardhat test test/V1/DiamondProxy/DisputeManager/Timeout.test.ts
```

Networking, discovery, p2p state machine replication, agreement tracking, dispute handling, virtual clock, hooks - all of these components are tested under a single integration test that combines them all together. Failure of any component (byzantine) needs to be handled by a more advanced dispute logic on-chain which is not implemented as part of the minimal feature set (MFS), but is explained in the tech video:
To run these tests:

```shell
yarn hardhat test test/V1/EvmStateMachine.test.ts
```
