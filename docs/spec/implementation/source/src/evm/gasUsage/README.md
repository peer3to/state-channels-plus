# src/evm/gasUsage — Subsystem

> **Status:** Authored — engineer verification pending.

The subsystem answers what the peer's own chain transactions cost. It is split so that the
arithmetic can be tested without a chain: `GasUsageTable` aggregates finished receipts and owns no
I/O, and `GasUsageRecorder` is the thin observer that waits for a receipt and hands it over. The
single producer is [HostNonceManager.ts](../signer/HostNonceManager.ts.md), the one signer every
real-chain transaction of a peer passes through; the readers are the chain-signer runtime service
and the runtime host root's disposal report, and both go through the recorder's own
settle-then-snapshot read so they answer with one freshness rule.

## Contents

- [GasUsageRecorder.ts](./GasUsageRecorder.ts.md)
- [GasUsageTable.ts](./GasUsageTable.ts.md)

## Source inventory

| Source | Report |
| --- | --- |
| [GasUsageRecorder.ts](../../../../../../../src/evm/gasUsage/GasUsageRecorder.ts) | [GasUsageRecorder.ts.md](./GasUsageRecorder.ts.md) |
| [GasUsageTable.ts](../../../../../../../src/evm/gasUsage/GasUsageTable.ts) | [GasUsageTable.ts.md](./GasUsageTable.ts.md) |

## Integration obligations

None: the two files have no interaction of their own to test. The recorder's only real public
entry is the signer that owns it, which lives in [signer/](../signer/HostNonceManager.ts.md) and
therefore outside this directory, so that evidence stays with
[`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8`](GasUsageRecorder.ts.md#unit-test-gas-usage-recorder-1-f2h4x8).
