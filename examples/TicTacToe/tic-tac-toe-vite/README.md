# Tic-Tac-Toe - setup

This is the user interface for the Tic-Tac-Toe game utilizing the SDK. 


## Prerequisite

Complete everything in the [README](../README.md) of the parent directory. 

## Local SDK config (`peer3.config.ts`)

This UI expects a local config file at [src/peer3.config.ts](src/peer3.config.ts) (same folder as `main.tsx`).

- Create it by copying the template:
	- `cp src/example.peer3.config.ts src/peer3.config.ts`
- The only required change is `HOLEPUNCH_RELAYER_URLS` (set it to your relay URL(s)).


## Typechain types, ABI and Bytecode
<b style="color: yellow;">

In the parent directory, after completeing all steps there will be a `typechain-types` and `artifacts` directory and a `contracts.json` file. These are needed for the user interface to interact with the contracts. </b>

Hardhat is configured to emit TypeChain output directly into [src/stateChannel/typechain-types](./src/stateChannel/typechain-types) when you run `hardhat compile` in the parent directory.

`TicTacToeStateMachine.json` (or the appropriate artifact) needs to be copied from `artifacts` to the [src](./src) directory. <b style="color: yellow;"> This is done automatically during the build process. </b>

`contracts.json` needs to be copied from the parent directory to the [src](./src) directory.<b style="color: yellow;"> Also done automatically during the build process. </b>



## Installation
```shell
# From the repo root, first build (or watch-build) the SDK so `dist/` exists:
#   yarn && yarn build
#   # or (watch mode)
#   yarn dev:tsc

# Then, in this folder:
yarn

# Optional (Pear build): install hyperswarm deps as well
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
yarn add -D http-server
```
```shell
npx http-server dist
```