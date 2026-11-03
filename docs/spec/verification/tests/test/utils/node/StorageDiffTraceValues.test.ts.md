# StorageDiffTraceValues.test.ts

Test file: [test/utils/node/StorageDiffTraceValues.test.ts](../../../../../../../test/utils/node/StorageDiffTraceValues.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases run the service against an isolated anvil test chain through a relay, with contracts whose reverted sub-calls, re-entrant calls and trusted traces decide whether values are read from the node or taken from the trace; the oracles compare the diffs with `anvil_dumpState` and with the request counts.

## Tests

- `leaves out the slot and the value transfer of a reverted sub-call that the trace reports`: REQ-SDS-4-ZZDEVF.T1.P1
- `lists no slot a transaction wrote with the value it already had`: REQ-SDS-4-ZZDEVF.T1.P2
- `misses no slot anvil holds after calls that nest and re-enter, and the diffs add up to its state`: REQ-SDS-4-ZZDEVF.T1.P3
- `takes the values of a block in which nothing reverted from the trace, with no read of them`: REQ-SDS-4-ZZDEVF.T1.P5
- `serves the history of an account first watched after N retained blocks from memory, with no value read`: REQ-SDS-4-ZZDEVF.T1.P6
- `reads the history of an account first watched after retained blocks whose values were not kept`: REQ-SDS-4-ZZDEVF.T1.P4, REQ-SDS-4-ZZDEVF.T1.P7
- `reads the values of a block when the call frames cannot be had`: REQ-SDS-4-ZZDEVF.T1.P8
- `reads the old value of a slot from its cache for every block of a multi-block step`: REQ-SDS-4-ZZDEVF.T1.P9
- `reads the balance, nonce and code of a touched account only when the trace shows them change`: REQ-SDS-4-ZZDEVF.T1.P10
