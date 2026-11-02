# RpcMirrorState.test.ts

Test file: [test/evm/RpcMirrorState.test.ts](../../../../../../test/evm/RpcMirrorState.test.ts)
Exercises: [MirrorRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/MirrorRpcProvider.ts.md)

## Overview

Each case builds a `MirrorRpcProvider` over an isolated anvil test chain with a real storage diff service following it. Recording proxies sit between the provider and the node and between the provider and the service, so the oracles are the answers the provider returns, the exact requests each of them received, the service pushes the case holds back or withholds, the counters of the mirror and the warnings it logs. Cases that need an account lazy or a snapshot absent run the service with a block source or a held snapshot that produces that status; time-bound cases hold the service's pushes and observe that a read stays pending. The silent-service cases have the service proxy swallow the replies to one kind of request, or go silent altogether, and time the read against the SDK deadline.

This file covers the cached state of storage slots: first reads, cache hits, reorgs, gaps in the records, pruned history and a node that fails a read.

## Tests

- `reads a slot written on chain after the block's record arrives without an eth_getStorageAt`: REQ-RPCMIRROR-1-XQNZ4J.T1.P2
- `answers a read from the node when the service fails the state fill`: REQ-RPCMIRROR-8-1PA83T.T1.P2
- `answers a read from the node within the SDK deadline when the service never answers its state read`: REQ-RPCMIRROR-8-1PA83T.T1.P4
- `answers a read of a newly followed account from the node within the SDK deadline when the service never answers the subscribe`: REQ-RPCMIRROR-8-1PA83T.T1.P5
- `answers a first read from the node within the SDK deadline when the service never answers the catch-up that starts following`: REQ-RPCMIRROR-8-1PA83T.T1.P6
- `answers eth_blockNumber from the node within the SDK deadline when the service never answers its head`: REQ-RPCMIRROR-8-1PA83T.T1.P7
- `answers two concurrent reads from the node within the SDK deadline when the service goes silent`: REQ-RPCMIRROR-8-1PA83T.T1.P8
- `answers a read from the node within its deadline while a pushed record's catch-up holds the mirror on a silent service`: REQ-RPCMIRROR-8-1PA83T.T1.P9
- `keeps the service connection and the cache when the service fails to drop a superseded subscription`: REQ-RPCMIRROR-8-1PA83T.T1.P1
- `sends no scp_getState and no node read for a second read of the same slot`: REQ-RPCMIRROR-1-XQNZ4J.T1.P3
- `reads a slot cleared on chain as zero without an eth_getStorageAt`: REQ-RPCMIRROR-1-XQNZ4J.T1.P4
- `reads the replacement branch's value after a reorg`: REQ-RPCMIRROR-5-KDRWDZ.T1.P1
- `restores a slot the orphaned block wrote when the replacement block does not write it`: REQ-RPCMIRROR-5-KDRWDZ.T1.P2
- `asks the service for the blocks from the next missing one when a record's parent is not the head`: REQ-RPCMIRROR-5-KDRWDZ.T1.P3
- `empties the cache when the service no longer retains the missing blocks, and the next read goes to the service again`: REQ-RPCMIRROR-5-KDRWDZ.T1.P4
- `reads from the node at the head block number only while the service answers that the block is not retained`: REQ-RPCMIRROR-5-KDRWDZ.T1.P5
- `keeps the service connection and the cache when the node fails a state read`: REQ-RPCMIRROR-8-1PA83T.T1.P3
- `takes the block environment from the service without reading blocks from the node`: REQ-RPCMIRROR-5-KDRWDZ.T1.P6
