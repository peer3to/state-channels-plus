# NodeHeadSubscription.test.ts

Test file: [test/evm/NodeHeadSubscription.test.ts](../../../../../../test/evm/NodeHeadSubscription.test.ts)
Exercises: [RpcNodeProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts.md), [MultiRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts.md)

## Overview

Each case runs a `MultiRpcProvider` over one WebSocket node that replays frames recorded from Asset Hub's eth-rpc ([fixture](../../../../../../test/fixtures/node/NewBlockHeadersNode.ts)): it refuses `eth_subscribe ["newHeads"]`, naming `newBlockHeaders` in the error's `data`, accepts `["newBlockHeaders"]`, ends that subscription on `eth_unsubscribe` and pushes the recorded header on demand. One case has the node refuse `newHeads` without naming another kind. The oracles are the subscription kinds the node was asked for, in order, the ids it was asked to unsubscribe, the block events the provider emits and the blocks the node's announcement watchers hear.

## Tests

- `emits block events from newBlockHeaders on a node that refuses newHeads and offers newBlockHeaders`: REQ-CHAINOBS-3-N137ZP.T1.P34
- `announces the blocks of newBlockHeaders pushes to the node's announcement watchers`: REQ-RPCMIRROR-4-H35NFC.T1.P29
- `subscribes to newBlockHeaders again on the socket a node reopens, and emits its block events`: REQ-CHAINOBS-3-N137ZP.T1.P35
- `unsubscribes the newBlockHeaders subscription when the last block listener is removed`: REQ-CHAINOBS-3-N137ZP.T1.P38
- `asks for no other kind when a node refuses newHeads without offering newBlockHeaders`: REQ-CHAINOBS-3-N137ZP.T1.P36
