# RpcMirrorRouting.test.ts

Test file: [test/evm/RpcMirrorRouting.test.ts](../../../../../../test/evm/RpcMirrorRouting.test.ts)
Exercises: [MirrorRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/MirrorRpcProvider.ts.md)

## Overview

Each case builds a `MirrorRpcProvider` over an isolated anvil test chain with a real storage diff service following it. Recording proxies sit between the provider and the node and between the provider and the service, so the oracles are the answers the provider returns, the exact requests each of them received, the service pushes the case holds back or withholds and the warnings it logs. Cases that need an account lazy or a snapshot absent run the service with a block source or a held snapshot that produces that status; time-bound cases hold the service's pushes and observe that a read stays pending.

This file covers which reads are answered locally and which go to the node whole, and that the local answer equals the node's.

## Tests

- `answers an eth_call at latest without sending an eth_call to the node`: REQ-RPCMIRROR-1-XQNZ4J.T1.P1
- `answers a call that carries a gas limit from the node, which charges the transaction gas the local EVM does not`: REQ-RPCMIRROR-2-1P38E2.T1.P3
- `returns what the node returns at the same head for a call, a revert and a read of account state`: REQ-RPCMIRROR-1-XQNZ4J.T1.P5
- `discards what a call wrote when it ends`: REQ-RPCMIRROR-1-XQNZ4J.T1.P6
- `keeps a returned sub-call's write out of the frame that reverted it`: REQ-RPCMIRROR-1-XQNZ4J.T1.P7
- `sends estimateGas and reads at an older block to the node`: REQ-RPCMIRROR-2-1P38E2.T1.P1
- `sends every read to the node without a storage diff service`: REQ-RPCMIRROR-2-1P38E2.T1.P2
- `sends a pending nonce read to the node and answers the latest one itself`: REQ-RPCMIRROR-1-XQNZ4J.T1.P9
- `answers the chain id from its first answer without asking a node again`: REQ-RPCMIRROR-6-MHV1QD.T1.P1
- `answers the block number, blocks, transactions and receipts as the node does, without asking a node`: REQ-RPCMIRROR-6-MHV1QD.T1.P2
- `asks the node for a transaction, receipt or block the service does not hold`: REQ-RPCMIRROR-6-MHV1QD.T1.P3
