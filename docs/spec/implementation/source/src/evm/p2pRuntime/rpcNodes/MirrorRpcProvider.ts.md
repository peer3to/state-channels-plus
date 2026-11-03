# MirrorRpcProvider.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/MirrorRpcProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MirrorRpcProvider.ts)

## Requirements

- [`REQ-RPCMIRROR-1-XQNZ4J` (Latest-block reads are answered from a local copy of the chain)](../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-1-xqnz4j)
- [`REQ-RPCMIRROR-2-1P38E2` (Reads the copy cannot answer correctly go to the node whole)](../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-2-1p38e2)
- [`REQ-RPCMIRROR-4-H35NFC` (A read is never older than a block the peer already saw)](../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-4-h35nfc)
- [`REQ-RPCMIRROR-6-MHV1QD` (Chain data comes from the service when it holds it)](../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-6-mhv1qd)
- [`REQ-RPCMIRROR-7-4A6NJN` (A fraction of local answers is checked against the node)](../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-7-4a6njn)
- [`REQ-RPCMIRROR-9-5VD1GG` (The storage diff service is required)](../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-9-5vd1gg)
- [`REQ-CHAINOBS-3-N137ZP` (Manager events from the storage diff service, through connection loss)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp)
