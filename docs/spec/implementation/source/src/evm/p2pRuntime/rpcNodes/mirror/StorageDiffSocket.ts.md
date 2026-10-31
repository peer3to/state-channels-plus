# StorageDiffSocket.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/mirror/StorageDiffSocket.ts](../../../../../../../../../src/evm/p2pRuntime/rpcNodes/mirror/StorageDiffSocket.ts)

## Requirements

- [`REQ-RPCMIRROR-3-7MQH88` (A snapshot is waited for only when the service says it is ready)](../../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-3-7mqh88)
- [`REQ-RPCMIRROR-4-H35NFC` (A read is never older than a block the peer already saw)](../../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-4-h35nfc)
- [`REQ-RPCMIRROR-6-MHV1QD` (Chain data comes from the service when it holds it)](../../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-6-mhv1qd)
- [`REQ-RPCMIRROR-8-1PA83T` (Trouble with the service degrades reads to the node, never fails them)](../../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-8-1pa83t)
