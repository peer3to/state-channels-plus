# RpcMirrorFreshness.test.ts

Test file: [test/evm/RpcMirrorFreshness.test.ts](../../../../../../test/evm/RpcMirrorFreshness.test.ts)
Exercises: [MirrorRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/MirrorRpcProvider.ts.md)

## Overview

Each case builds a `MirrorRpcProvider` over an isolated anvil test chain with a real storage diff service following it. Recording proxies sit between the provider and the node and between the provider and the service, so the oracles are the answers the provider returns, the exact requests each of them received, the service pushes the case holds back or withholds and the warnings it logs. Cases that need an account lazy or a snapshot absent run the service with a block source or a held snapshot that produces that status; time-bound cases hold the service's pushes and observe that a read stays pending.

This file covers the waits for a block the peer saw or a node announced, their learned backstop, and what ends them, including which block a node's heads and logs announce across a reorganization and across two nodes (one case gives the provider a second node through its own proxy).

## Tests

- `holds a call issued after the peer's own transaction is mined until the mirror has that block`: REQ-RPCMIRROR-4-H35NFC.T1.P1
- `holds a call until the mirror reaches a block the node announced`: REQ-RPCMIRROR-4-H35NFC.T1.P2
- `waits the whole cap, then asks the node, for an announced block before any record has reached the copy`: REQ-RPCMIRROR-4-H35NFC.T1.P18, REQ-RPCMIRROR-4-H35NFC.T1.P20
- `keeps the longest wait when the node answers a log query slowly`: REQ-RPCMIRROR-4-H35NFC.T1.P19
- `answers with the node's value, not the older head's, when a block never reaches the copy within the learned backstop`: REQ-RPCMIRROR-4-H35NFC.T1.P8, REQ-RPCMIRROR-4-H35NFC.T1.P13
- `asks the node at once when the service says its tracing of the awaited block failed`: REQ-RPCMIRROR-4-H35NFC.T1.P9
- `asks the service once when a wait for a block starts, so a service whose upstream is behind sends the reads to the node at once`: REQ-RPCMIRROR-4-H35NFC.T1.P10, REQ-RPCMIRROR-4-H35NFC.T1.P14
- `asks the service again when a later wait is for the same block number, as after the node rolled back below the block the copy had reached`: REQ-RPCMIRROR-4-H35NFC.T1.P16
- `shortens the longest wait as the node's round trips grow, and a read that waits the whole cap still gets the node's answer inside the deadline`: REQ-RPCMIRROR-4-H35NFC.T1.P15
- `asks the node at once when the service says a snapshot it promised as ready is delayed`: REQ-RPCMIRROR-3-7MQH88.T1.P12
- `asks the node at once when the service connection drops while a call waits for a block`: REQ-RPCMIRROR-4-H35NFC.T1.P12
- `asks the node at once when a node announces a later block while the copy still lacks the one before`: REQ-RPCMIRROR-4-H35NFC.T1.P11
- `asks the node for the latest block while the service is behind a block the node announced`: REQ-RPCMIRROR-4-H35NFC.T1.P4
- `holds a read until the mirror reaches the block of a log notification the node pushed first`: REQ-RPCMIRROR-4-H35NFC.T1.P3
- `answers from the copy again once the node's new head falls below the block it announced before, as after a reorganization to a shorter branch`: REQ-RPCMIRROR-4-H35NFC.T1.P21
- `keeps a read waiting for one node's newer head when another node announces an older head after it`: REQ-RPCMIRROR-4-H35NFC.T1.P22
- `answers from the copy at once after a reorganization when the node reports an orphaned block's log as removed`: REQ-RPCMIRROR-4-H35NFC.T1.P23
- `keeps a read waiting for the node's newer head when the node's log of the block before arrives after it`: REQ-RPCMIRROR-4-H35NFC.T1.P24
