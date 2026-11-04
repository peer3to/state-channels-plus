# LogFeed.test.ts

Test file: [test/evm/LogFeed.test.ts](../../../../../../test/evm/LogFeed.test.ts)
Exercises: [LogFeed.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/mirror/LogFeed.ts.md)

## Overview

Each case builds a `MirrorRpcProvider` over an isolated anvil test chain with a real storage diff service following it, behind recording proxies, deploys a contract that emits `ValueSet(word)`, and watches it through the provider's log feed. The oracles are the logs a watch hands on (value, block, hash and whether removed, in order), the node's own `eth_getLogs` answer for the same block, and the `eth_getLogs` requests the node received. Reorganizations use `anvil_reorg` on the case's own chain: one replaces the newest block at the same height, one replaces two blocks and the chain then grows, and one, with the service retaining two blocks, replaces the newest block with one carrying the same call so the fork is read from the node. One case holds the service's catch-up reply, moves the head and stops the watch before releasing it. One case holds the service's record pushes and the node's head pushes, starts a watch at the block the mirror lacks and reads the contract from the watch's listener. Absence checks wait a fixed window before asserting that nothing more arrived.

## Tests

- `hands on a log with the fields the node's eth_getLogs has, once its block is on the service's chain`: REQ-CHAINOBS-3-N137ZP.T1.P39
- `hands on the logs of several blocks in block order, once to each of two watches of the same filter`: REQ-CHAINOBS-3-N137ZP.T1.P40
- `hands on no log of a block before the block it was asked to start at`: REQ-CHAINOBS-3-N137ZP.T1.P41
- `hands on no log of another address or of another topic`: REQ-CHAINOBS-3-N137ZP.T1.P48
- `hands on a log again as removed when a reorg replaces its block at the same height, then the replacing block's log`: REQ-CHAINOBS-3-N137ZP.T1.P42
- `hands on, newest first and as removed, the logs of every block a deeper reorg replaced, none of a block below the fork, then the logs of the new chain`: REQ-CHAINOBS-3-N137ZP.T1.P43
- `reads the chain at the block of a log it handed on before the mirror applied that block`: REQ-RPCMIRROR-4-H35NFC.T1.P23
- `hands on a log mined while the service connection was cut, after it is back`: REQ-CHAINOBS-3-N137ZP.T1.P4
- `reads blocks the service no longer retains from the node, up to the node's head`: REQ-CHAINOBS-3-N137ZP.T1.P44
- `reads a reorg the service no longer retains the fork of from the node: logs already handed on are not handed on again, a replaced one comes again as removed`: REQ-CHAINOBS-3-N137ZP.T1.P45
- `hands on nothing that a read in flight when the watch is stopped answers`: UNIT-TEST-LOG-FEED-1-QE0G60.P4
- `hands on nothing more after the watch is stopped`: REQ-CHAINOBS-3-N137ZP.T1.P47
