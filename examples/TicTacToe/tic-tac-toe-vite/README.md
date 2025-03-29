# Tic-Tac-Toe - setup

This is the user interface for the Tic-Tac-Toe game utilizing the SDK. 


## Prerequisite

Complete everything in the [README](../README.md) of the parent directory. 

## Typechain types, ABI and Bytecode
<b style="color: yellow;">

In the parent directory, after completeing all steps there will be a `typechain-types` and `artifacts` directory and a `contracts.json` file. These are needed for the user interface to interact with the contracts. </b>

Copy the `typechain-types` directory to a place where it's accesable by the user interface, the example requires them in the [stateChannel](./src/stateChannel) directory.

`TicTacToeStateMachine.json` (or the appropriate artifact) needs to be copied from `artifacts` to the [src](./src) directory. <b style="color: yellow;"> This is done automatically during the build process. </b>

`contracts.json` needs to be copied from the parent directory to the [src](./src) directory.<b style="color: yellow;"> Also done automatically during the build process. </b>



## Installation
```shell
yarn install-all
```

## Build

```shell
yarn build:browser
```
This will generate the dist directory.

## Serve the UI
Use a static server to serve the UI. For example, you can use `http-server`.
```shell
npm install -g http-server
```
```shell
cd dist && https-server
```