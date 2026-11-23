# LightClientProvider.test.ts

Test file: [test/lightClient/LightClientProvider.test.ts](../../../../../../test/lightClient/LightClientProvider.test.ts)
Exercises: [LightClientRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts.md)

## Overview

Every declaration starts a peer3 dev node of its own, with the light client endpoints, from the binary
`PEER3_NODE_BIN` names, and a test-owned proxy in front of it. The runner discovers the file only with
`--lc-tests`. The provider under test is the one the SDK builds with `createRpcNodesProvider`, given the
proxy's address; it is on because the node lists the endpoints. The contracts are the repository's
`SimpleNumberStorage` and hand-assembled ones that return the block values a call reads, forward a
static call, return the previous block's hash, return CALLER and ORIGIN, return the blob base fee, run
out of gas, and hit an invalid opcode. Transactions go to the node directly, so the provider only reads.
The oracles are the node's own answers to the same reads, the provider's counters, the requests the
proxy saw, and the entries the provider logged. For the failures the proxy answers one request in the
node's place. Two endpoints and pushed partitions are the subject of
[LightClientFollowedChannel.test.ts](LightClientFollowedChannel.test.ts.md). The suite does not cover a node that lies about its
best block, or a distributed worker.

## Tests

- `answers a contract call from proven state with the node's own answer`: REQ-LC-1-JT5PKT.T1.P1
- `answers a reverting call with the node's revert reason`: REQ-LC-1-JT5PKT.T1.P2
- `answers a call that reaches a second contract`: REQ-LC-1-JT5PKT.T1.P3
- `runs a call into one of Ethereum's precompiles without proving the precompile's account`: REQ-LC-1-JT5PKT.T1.P9
- `answers the block values a call reads as the node's block has them`: REQ-LC-1-JT5PKT.T1.P4, REQ-STPROOF-6-CASBQP.T2.P1
- `answers storage, code, balance and nonce reads with the node's own answers`: REQ-LC-1-JT5PKT.T1.P5
- `answers from the block a mined transaction is in`: REQ-LC-1-JT5PKT.T1.P6
- `keeps nothing a call wrote`: REQ-LC-1-JT5PKT.T1.P7
- `keeps the answers of reads made at once apart`: REQ-LC-1-JT5PKT.T1.P8
- `proves the block values and the state two calls made at once at one block both need in one request each`: REQ-LC-9-KWXV43.T2.P1
- `asks the endpoint once for its best block for two reads made while its answer is awaited`: REQ-LC-1-JT5PKT.T1.P27
- `asks the endpoint for its best block again for a read made after the block floor rose above a lookup still awaited`: REQ-LC-1-JT5PKT.T1.P28
- `sends the node a read at an earlier block, a pending nonce and a call with a gas limit`: REQ-LC-2-PMY1VG.T1.P1
- `leaves to the node a call that reaches the chain's own precompile or reads an earlier block's hash`: REQ-LC-2-PMY1VG.T1.P2
- `asks the node, logs an error and counts the failure when a proof is refused`: REQ-LC-3-W7RRHM.T1.P1
- `asks the node, logs an error and counts the failure when the node gives no block header`: REQ-LC-3-W7RRHM.T1.P2
- `asks the node for every read and says once that the node lists no light client endpoints`: REQ-LC-4-E29Y46.T1.P1
- `asks the node once which methods it serves, at the first read the light client may answer`: REQ-LC-4-E29Y46.T1.P6
- `leaves to the node a call that runs out of gas or hits an invalid opcode locally`: REQ-LC-2-PMY1VG.T1.P3
- `leaves to the node a call that reads the blob base fee, and answers with the node's answer`: REQ-LC-2-PMY1VG.T1.P7
- `asks the node for every read when the node answers that it does not know rpc_methods`: REQ-LC-4-E29Y46.T1.P3
- `asks the node for every read when the node answers, as Hardhat does, that it does not support rpc_methods`: REQ-LC-4-E29Y46.T1.P4
- `asks the node again which methods it serves when the question failed`: REQ-LC-4-E29Y46.T1.P5
- `fails reads still running at destroy as a plain provider would, without counting or logging them`: REQ-LC-3-W7RRHM.T1.P3
- `sends the node a pending read and a call with a gas price`: REQ-LC-2-PMY1VG.T1.P4
- `answers a call with the caller and origin the node gives it`: REQ-LC-1-JT5PKT.T1.P10
- `says a contract's reads are proven while the serving endpoint lists the light client endpoints, not while that question fails, and reads replicated state from it then`: REQ-LC-11-MTCBF9.T1.P4, REQ-MIRROR-5-N5SZC9.T2.P1
- `says a contract's reads are not proven over an endpoint without the light client endpoints, or over a plain provider, and reads replicated state from the local diamond then`: REQ-LC-11-MTCBF9.T1.P5, REQ-MIRROR-5-N5SZC9.T2.P2
- `says a contract's reads are proven while the serving endpoint lists the light client endpoints, and not once it fails over to one that does not`: REQ-LC-11-MTCBF9.T1.P6
- `says a contract's reads are not proven, without throwing, while no endpoint is connected`: REQ-LC-11-MTCBF9.T1.P7
