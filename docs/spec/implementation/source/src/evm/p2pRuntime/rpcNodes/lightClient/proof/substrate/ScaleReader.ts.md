# ScaleReader.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/ScaleReader.ts](../../../../../../../../../../../src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/ScaleReader.ts)

## Requirements

- [`REQ-STPROOF-1-J20P5Y` (A slot value is accepted only when the proof decides it)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-1-j20p5y)
- [`REQ-STPROOF-3-NVJGR0` (A pushed block is accepted only under its own header)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0)

## UNIT-TEST-STPROOF-5-4PSJRN

SCALE compact encoding of a number

- Setup: Numbers on both sides of every size boundary of the compact encoding.
- Oracle: `encodeCompact` returns the bytes the SCALE specification gives for each.

- [x] `UNIT-TEST-STPROOF-5-4PSJRN.P1` — 0, 63 and 64, 16383 and 16384, 2^30 - 1 and 2^30, and 2^32 - 1
