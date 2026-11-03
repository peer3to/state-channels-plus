# MirrorRequiresService.test.ts

Test file: [test/evm/MirrorRequiresService.test.ts](../../../../../../test/evm/MirrorRequiresService.test.ts)
Exercises: [MirrorRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/MirrorRpcProvider.ts.md), [RuntimeChainContext.ts](../../../../implementation/source/src/evm/p2pRuntime/RuntimeChainContext.ts.md)

## Overview

The first case builds the mirror provider with an empty service URL and expects the missing-setting error. The second calls the exported `createRpcNodesProvider` with an empty service URL and a reachable node behind a proxy; it expects the same error and no socket open at the proxy after an absence window. The third starts the runtime chain context with an empty service URL and an unreachable node and expects the same error rather than the node's refusal, which shows that no node was opened first.

## Tests

- `refuses to build the mirror provider without a storage diff URL`: REQ-RPCMIRROR-9-5VD1GG.T1.P1
- `refuses to build the exported chain access without a storage diff URL before any node is asked`: REQ-RPCMIRROR-9-5VD1GG.T1.P3
- `refuses to start the runtime chain context without a storage diff URL before any node is asked`: REQ-RPCMIRROR-9-5VD1GG.T1.P2
