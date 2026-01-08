# Tic-Tac-Toe

This is an implementation of Tic-Tac-Toe. It showcases how to build a typical consumer application with the SDK.

The [contracts](./contracts/) hold the state machine logic that is ultimately enforced by a blockchain.
The [user interface](./tic-tac-toe-vite/) is built with React and utilizes the TypeScript portion of the SDK. 

## Installation
<b style="color: yellow;">Note: Examples within this repository use the current version of the SDK(this repository) and not the remote package available on npm. This requires to install dependencies and build the SDK locally. Please make sure you've run `yarn && yarn build` in the root directory of this repository, before proceeding. </b>

Continue with installation of local dependencies:
```shell
yarn
```
## Compile contracts
```shell
yarn hardhat compile
```
This will generate <b>typechain-types</b> and <b>artifacts</b> directories which contain typescript types, contract ABIs and bytecodes needed for deployment and interaction.
## EVM testnet
The SDK requires an underlying blockchain from which to inherit security. The SDK is designed to work with any EVM-compatible blockchain. For testing purposes, we recommend using a local blockchain such as [Ganache](https://www.npmjs.com/package/ganache), setting the gas price to 0 to and using a hardfork before [London](https://ethereum.org/en/history/#london) to avoid having to fund the generated accounts with tokens for gas fees. We also recommend using WebSockets for a more 'real-time' experience, when interacting with the chain.

Install ganache:
```shell
npm install -g ganache
```
Run a ganache node locally with gas price set to 0, the berlin hardfork, and block time set to 2 seconds:
```shell
ganache -g 0 -k 'berlin' -b 2 -h 0.0.0.0 --chain.allowUnlimitedContractSize true
```
This will run a node on http://localhost:8545

Alternatively, you can use [Anvil](https://book.getfoundry.sh/reference/anvil/) (Foundry) with a 2-second block time and gas settings that avoid needing funded accounts:
```shell
anvil -b 2 --block-base-fee-per-gas 0 --disable-code-size-limit --disable-min-priority-fee --gas-price 0
```
This will also run a node on http://localhost:8545

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

Note: Create `tic-tac-toe-vite/src/peer3.config.ts` by copying `tic-tac-toe-vite/src/example.peer3.config.ts` and update `HOLEPUNCH_RELAYER_URLS`.
