# LightClientFollowedChannel.test.ts

Test file: [test/lightClient/LightClientFollowedChannel.test.ts](../../../../../../test/lightClient/LightClientFollowedChannel.test.ts)
Exercises: [LightClientRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts.md), [LightClient.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/LightClient.ts.md), [LightClientSubscriptions.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/LightClientSubscriptions.ts.md)

## Overview

Every declaration starts a peer3 dev node of its own from the binary `PEER3_NODE_BIN` names, with the
test-owned light client sidecar in front of it and a test-owned proxy in front of the sidecar. The
runner discovers the file only with `--lc-tests`. The provider under test is the one the SDK builds
with `createRpcNodesProvider` and `LIGHT_CLIENT` on, given the proxy's address. The contract is
hand-assembled: a transaction stores a word at a slot and logs the slot as its only topic, and a call
returns the word at a slot. A slot so stands for a channel id, and a test follows one slot through
`followChannel`. Transactions go to the node directly. The proxy records each block the sidecar
pushes to the provider, so a test knows which blocks reached the provider's socket. It answers the
best block request with the node's own header of an earlier block, so a read is made at a block
whose pushed block was sent before the answer, on the same socket. Without that a read would race
the push of a block the node sealed in between. The proxy also drops or changes pushed blocks. The
oracles are the node's own answers at the read's block, the slots each read proof was asked to
prove, the subscription requests the proxy saw, the provider's counters and what it logged as
warnings and errors. The suite does not cover more than one endpoint, a pushed block that arrives
while a read runs, the limit of pushed blocks kept while no read uses them, or a runtime that follows
its channel.

## Tests

- `reads a followed contract's storage at a later block from the pushed blocks without a proof`: REQ-LC-5-MM0BM9.T1.P1
- `runs a call over a followed contract's pushed storage without proving a slot`: REQ-LC-5-MM0BM9.T1.P2
- `proves a slot the pushed blocks wrote but no read held before`: REQ-LC-5-MM0BM9.T1.P3
- `proves a followed contract's balance at the read's block, because only its storage is kept`: REQ-LC-5-MM0BM9.T1.P4
- `proves all held storage of a followed contract in one request when the pushed blocks do not reach the read's block`: REQ-LC-5-MM0BM9.T1.P5
- `keeps a slot a block pushed without its write changed until the interval's proof finds it`: REQ-LC-6-NEFA2N.T1.P1
- `refuses a pushed block whose write is not the proven one and proves the storage itself`: REQ-LC-7-W8WDN3.T1.P1
- `refuses a pushed block that comes without the proof of its writes`: REQ-LC-7-W8WDN3.T1.P2
- `proves a contract's storage at each block again once its channel is unfollowed`: REQ-LC-5-MM0BM9.T1.P6
- `gets the writes of a second channel of the contract once that channel is followed too`: REQ-LC-5-MM0BM9.T1.P7
- `subscribes again on a socket that reopened and proves the held storage again`: REQ-LC-5-MM0BM9.T1.P8
- `follows nothing on a node without the light client endpoints`: REQ-LC-5-MM0BM9.T1.P9
