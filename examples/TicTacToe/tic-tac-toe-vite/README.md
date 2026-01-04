# Tic-Tac-Toe - setup

This is the user interface for the Tic-Tac-Toe game utilizing the SDK. 


## Prerequisite

Complete everything in the [README](../README.md) of the parent directory. 

## Typechain types, ABI and Bytecode
<b style="color: yellow;">

In the parent directory, after completeing all steps there will be a `typechain-types` and `artifacts` directory and a `contracts.json` file. These are needed for the user interface to interact with the contracts. </b>

Hardhat is configured to emit TypeChain output directly into [src/stateChannel/typechain-types](./src/stateChannel/typechain-types) when you run `hardhat compile` in the parent directory.

`TicTacToeStateMachine.json` (or the appropriate artifact) needs to be copied from `artifacts` to the [src](./src) directory. <b style="color: yellow;"> This is done automatically during the build process. </b>

`contracts.json` needs to be copied from the parent directory to the [src](./src) directory.<b style="color: yellow;"> Also done automatically during the build process. </b>



## Installation
```shell
# Recommended (fast iteration): use pnpm + local link
# From this repo root, first build (or watch-build) the SDK so dist/ exists:
#   pnpm -w run dev:tsc
# Then, in this folder:
pnpm install

# Optional: install hyperswarm deps used by the Pear build
cd hyperswarm && pnpm install && cd ..

# Legacy
# pnpm -w run install-all
```

## Build

```shell
pnpm run build:browser
```
This will generate the dist directory.

## Serve the UI
Use a static server to serve the UI. For example, you can use `http-server`.
```shell
pnpm add -g http-server
```
```shell
cd dist && http-server
```