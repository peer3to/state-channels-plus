# RpcMirrorSnapshots.test.ts

Test file: [test/evm/RpcMirrorSnapshots.test.ts](../../../../../../test/evm/RpcMirrorSnapshots.test.ts)
Exercises: [MirrorRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/MirrorRpcProvider.ts.md)

## Overview

Each case builds a `MirrorRpcProvider` over an isolated anvil test chain with a real storage diff service following it. Recording proxies sit between the provider and the node and between the provider and the service, so the oracles are the answers the provider returns, the exact requests each of them received, the service pushes the case holds back or withholds and the warnings it logs. Cases that need an account lazy or a snapshot absent run the service with a block source or a held snapshot that produces that status; time-bound cases hold the service's pushes and observe that a read stays pending.

This file covers the snapshots of accounts the service has ready, syncing or lazy: when a read waits for one, when it reads lazily, and how the wait ends.

## Tests

- `applies a snapshot that reaches the mirror before the reply of the subscription that asked for it`: REQ-RPCMIRROR-3-7MQH88.T1.P2
- `waits for the snapshot of an account the service has ready instead of reading lazily`: REQ-RPCMIRROR-3-7MQH88.T1.P1, REQ-RPCMIRROR-3-7MQH88.T1.P3
- `reads an account the service says is syncing at once, and answers locally once its snapshot has come`: REQ-RPCMIRROR-3-7MQH88.T1.P4
- `reads an account the service says is lazy at once, without waiting for a snapshot`: REQ-RPCMIRROR-3-7MQH88.T1.P5
- `keeps an account lazy when the backfill of a syncing account ends without a snapshot`: REQ-RPCMIRROR-3-7MQH88.T1.P6
- `keeps an account lazy when the backfill of a syncing account fails`: REQ-RPCMIRROR-3-7MQH88.T1.P7
- `asks the node, after a backstop learned from snapshot arrivals, for a snapshot the service has ready and never delivers`: REQ-RPCMIRROR-3-7MQH88.T1.P8
- `takes the snapshot of a ready account after a reconnect when the read that followed it failed its catch-up`: REQ-RPCMIRROR-3-7MQH88.T1.P14
- `holds the mirror past the snapshot backstop until a snapshot being placed for the read is placed`: REQ-RPCMIRROR-3-7MQH88.T1.P15
- `does not shorten the wait for a snapshot because blocks arrived fast`: REQ-RPCMIRROR-3-7MQH88.T1.P13
- `stops waiting for a snapshot at once when the service connection drops`: REQ-RPCMIRROR-3-7MQH88.T1.P9
- `drops a complete account to lazy reads when the service finds its cached entries short after a block, and reads the omitted slot`: REQ-RPCMIRROR-3-7MQH88.T1.P11
- `asks the service for exactly the missing fields, at the head block, for an account that is syncing`: REQ-RPCMIRROR-3-7MQH88.T1.P10
- `places no snapshot on a chain its catch-up cleared, and answers the read`: REQ-RPCMIRROR-3-7MQH88.T1.P16
