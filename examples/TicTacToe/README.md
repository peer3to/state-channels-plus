# Tic-Tac-Toe

This is an implementation of Tic-Tac-Toe. It showcases how to build a typical consumer application with the SDK.

The [contracts](./contracts/) hold the state machine logic that is ultimately enforced by a blockchain.
The [user interface](./tic-tac-toe-vite/) is built with React and utilizes the typescript portion of the SDK. 

## Installation
```shell
yarn
```
## Compile contracts
```shell
yarn hardhat compile
```

## Deploy contracts
To deploy to a custom network, add a .env file and define PROVIDER_URL (look at .env.example). Default network: http://localhost:8545
```shell
yarn hardhat run scripts/deployTicTacToeContractsProxy.ts
```
Contracts should be deployed and a contracts.json file generated.
This file contains the ABIs and contract addresses that are used by the user interface.

## UI setup
Change the directory to the UI directory.
```shell
cd tic-tac-toe-vite
```
Follow instructions in the [UI README](./tic-tac-toe-vite/README.md)
