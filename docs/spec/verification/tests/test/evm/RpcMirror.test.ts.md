# RpcMirror.test.ts

Test file: [test/evm/RpcMirror.test.ts](../../../../../../test/evm/RpcMirror.test.ts)
Exercises: [MirrorRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/MirrorRpcProvider.ts.md)

## Overview

Each case builds a `MirrorRpcProvider` over an isolated anvil test chain with a real storage diff service following it. Recording proxies sit between the provider and the node and between the provider and the service, so the oracles are the answers the provider returns, the exact requests each of them received, the service pushes the case holds back or withholds, the counters of the mirror and the warnings it logs. Cases that need an account lazy or a snapshot absent run the service with a block source or a held snapshot that produces that status; time-bound cases hold the service's pushes and observe that a read stays pending.

## Tests

- `answers an eth_call at latest without sending an eth_call to the node`: REQ-RPCMIRROR-1-XQNZ4J.T1.P1
- `reads a slot written on chain after the block's record arrives without an eth_getStorageAt`: REQ-RPCMIRROR-1-XQNZ4J.T1.P2
- `reads the first read of a slot the service has ready from the snapshot it pushed, with no scp_getState and no node read`: REQ-RPCMIRROR-3-7MQH88.T1.P1
- `applies a snapshot that reaches the mirror before the reply of the subscription that asked for it`: REQ-RPCMIRROR-3-7MQH88.T1.P2
- `waits for the snapshot of an account the service has ready instead of reading lazily`: REQ-RPCMIRROR-3-7MQH88.T1.P3
- `reads an account the service says is syncing at once, and answers locally once its snapshot has come`: REQ-RPCMIRROR-3-7MQH88.T1.P4
- `reads an account the service says is lazy at once, without waiting for a snapshot`: REQ-RPCMIRROR-3-7MQH88.T1.P5
- `keeps an account lazy when the backfill of a syncing account ends without a snapshot`: REQ-RPCMIRROR-3-7MQH88.T1.P6
- `keeps an account lazy when the backfill of a syncing account fails`: REQ-RPCMIRROR-3-7MQH88.T1.P7
- `asks the node, after the learned backstop, for a snapshot the service has ready and never delivers`: REQ-RPCMIRROR-3-7MQH88.T1.P8
- `stops waiting for a snapshot at once when the service connection drops`: REQ-RPCMIRROR-3-7MQH88.T1.P9
- `re-asks the node about a sampled read after replying, and counts the match`: REQ-RPCMIRROR-7-4A6NJN.T1.P1
- `samples balance, nonce and code reads against the node too`: REQ-RPCMIRROR-7-4A6NJN.T1.P2
- `sends nothing to the node at a sample rate of 0`: REQ-RPCMIRROR-7-4A6NJN.T1.P3
- `samples a small fraction of local answers when the provider is built without a sample rate`: REQ-RPCMIRROR-7-4A6NJN.T1.P6
- `counts a mismatch between a cached value and the node, and reads the account from the node from then on`: REQ-RPCMIRROR-7-4A6NJN.T1.P4
- `checks a sampled eth_call against the node and drops the called account on a mismatch`: REQ-RPCMIRROR-7-4A6NJN.T1.P5
- `drops a complete account to lazy reads when the service finds its cached entries short after a block, and reads the omitted slot`: REQ-RPCMIRROR-3-7MQH88.T1.P11
- `answers a call that carries a gas limit from the node, which charges the transaction gas the local EVM does not`: REQ-RPCMIRROR-2-1P38E2.T1.P3
- `asks the service for exactly the missing fields, at the head block, for an account that is syncing`: REQ-RPCMIRROR-3-7MQH88.T1.P10
- `answers a read from the node when the service fails the state fill`: REQ-RPCMIRROR-8-1PA83T.T1.P2
- `sends no scp_getState and no node read for a second read of the same slot`: REQ-RPCMIRROR-1-XQNZ4J.T1.P3
- `reads a slot cleared on chain as zero without an eth_getStorageAt`: REQ-RPCMIRROR-1-XQNZ4J.T1.P4
- `reads the replacement branch's value after a reorg`: REQ-RPCMIRROR-5-KDRWDZ.T1.P1
- `restores a slot the orphaned block wrote when the replacement block does not write it`: REQ-RPCMIRROR-5-KDRWDZ.T1.P2
- `asks the service for the blocks from the next missing one when a record's parent is not the head`: REQ-RPCMIRROR-5-KDRWDZ.T1.P3
- `empties the cache when the service no longer retains the missing blocks, and the next read goes to the service again`: REQ-RPCMIRROR-5-KDRWDZ.T1.P4
- `reads from the node at the head block number only while the service answers that the block is not retained`: REQ-RPCMIRROR-5-KDRWDZ.T1.P5
- `takes the block environment from the service without reading blocks from the node`: REQ-RPCMIRROR-5-KDRWDZ.T1.P6
- `runs a custom precompile locally without an upstream request`: REQ-RPCMIRROR-1-XQNZ4J.T1.P8
- `holds a call issued after the peer's own transaction is mined until the mirror has that block`: REQ-RPCMIRROR-4-H35NFC.T1.P1
- `answers with the node's value, not the older head's, when a block never reaches the copy within the learned backstop`: REQ-RPCMIRROR-4-H35NFC.T1.P8
- `has the SDK's RPC deadline as its backstop until a block has reached the copy, and a shorter one after fast blocks`: REQ-RPCMIRROR-4-H35NFC.T1.P13
- `asks the node at once when the service says its tracing of the awaited block failed`: REQ-RPCMIRROR-4-H35NFC.T1.P9
- `asks the node at once when the service says its upstream has not seen the awaited block`: REQ-RPCMIRROR-4-H35NFC.T1.P10
- `asks the node at once when the service says a snapshot it promised as ready is delayed`: REQ-RPCMIRROR-3-7MQH88.T1.P12
- `asks the node at once when the service connection drops while a call waits for a block`: REQ-RPCMIRROR-4-H35NFC.T1.P12
- `asks the node at once when a node announces a later block while the copy still lacks the one before`: REQ-RPCMIRROR-4-H35NFC.T1.P11
- `holds a call until the mirror reaches a block the node announced`: REQ-RPCMIRROR-4-H35NFC.T1.P2
- `returns what the node returns at the same head for a call, a revert and a read of account state`: REQ-RPCMIRROR-1-XQNZ4J.T1.P5
- `discards what a call wrote when it ends`: REQ-RPCMIRROR-1-XQNZ4J.T1.P6
- `keeps a returned sub-call's write out of the frame that reverted it`: REQ-RPCMIRROR-1-XQNZ4J.T1.P7
- `sends estimateGas and reads at an older block to the node`: REQ-RPCMIRROR-2-1P38E2.T1.P1
- `sends every read to the node without a storage diff service`: REQ-RPCMIRROR-2-1P38E2.T1.P2
- `sends a pending nonce read to the node and answers the latest one itself`: REQ-RPCMIRROR-1-XQNZ4J.T1.P9
- `records the included head from the catch-up and from a push`: REQ-RPCMIRROR-6-MHV1QD.T1.P4
- `answers the chain id from its first answer without asking a node again`: REQ-RPCMIRROR-6-MHV1QD.T1.P1
- `answers the block number, blocks, transactions and receipts as the node does, without asking a node`: REQ-RPCMIRROR-6-MHV1QD.T1.P2
- `asks the node for a transaction, receipt or block the service does not hold`: REQ-RPCMIRROR-6-MHV1QD.T1.P3
- `asks the node for the latest block while the service is behind a block the node announced`: REQ-RPCMIRROR-4-H35NFC.T1.P4
- `holds a read until the mirror reaches the block of a log notification the node pushed first`: REQ-RPCMIRROR-4-H35NFC.T1.P3
