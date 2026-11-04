# LocalExecutionPolicy.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/mirror/LocalExecutionPolicy.ts](../../../../../../../../../src/evm/p2pRuntime/rpcNodes/mirror/LocalExecutionPolicy.ts)

## Requirements

- [`REQ-RPCMIRROR-2-1P38E2` (Reads the copy cannot answer correctly go to the node whole)](../../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-2-1p38e2)

## UNIT-TEST-RPCMIRROR-LOCAL-POLICY-1-B53976

`isPolkaVmCode` and `isNodeOnlyAddress` decide exactly which code and addresses the local EVM must not run.

- Setup: Call them with PolkaVM magic bytes and near misses, empty and ordinary EVM code, the standard precompile addresses, the builtin and external precompile ranges of the chain, address zero and an ordinary contract address.
- Oracle: Only the exact magic is PolkaVM code; only addresses above the standard precompiles in the builtin range and the external ranges are node-only.

- [x] `UNIT-TEST-RPCMIRROR-LOCAL-POLICY-1-B53976.P1` — PolkaVM program blobs are recognised by their magic and nothing else
- [x] `UNIT-TEST-RPCMIRROR-LOCAL-POLICY-1-B53976.P2` — the chain's builtin and external precompile ranges go to the node and the standard ones run locally
