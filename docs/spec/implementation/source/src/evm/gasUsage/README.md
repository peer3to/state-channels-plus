# src/evm/gasUsage — Subsystem

> **Status:** Authored — engineer verification pending.

The subsystem answers what the peer's own chain transactions cost. It is split so that the
arithmetic can be tested without a chain: `GasUsageTable` aggregates finished receipts and owns no
I/O, and `GasUsageRecorder` is the thin observer that waits for a receipt and hands it over. The
single producer is [HostNonceManager.ts](../signer/HostNonceManager.ts.md), the one signer every
real-chain transaction of a peer passes through; the readers are the chain-signer runtime service
and the runtime host root's disposal report.

## Contents

- [GasUsageRecorder.ts](./GasUsageRecorder.ts.md)
- [GasUsageTable.ts](./GasUsageTable.ts.md)

## Source inventory

| Source | Report |
| --- | --- |
| [GasUsageRecorder.ts](../../../../../../../src/evm/gasUsage/GasUsageRecorder.ts) | [GasUsageRecorder.ts.md](./GasUsageRecorder.ts.md) |
| [GasUsageTable.ts](../../../../../../../src/evm/gasUsage/GasUsageTable.ts) | [GasUsageTable.ts.md](./GasUsageTable.ts.md) |

## Integration obligations

| Integration test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------------- | ---------- | ---------------------- | ---------------------------- | --------------------- |
