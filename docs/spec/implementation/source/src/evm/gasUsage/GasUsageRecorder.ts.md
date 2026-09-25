# GasUsageRecorder.ts

> **Source:** [src/evm/gasUsage/GasUsageRecorder.ts](../../../../../../../src/evm/gasUsage/GasUsageRecorder.ts)
>
> **Design views:** [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

## Requirements

- [`REQ-SDK-ARCH-6-8DE4ER` (Chain spending is observable)](../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er)
  Partial: a transient RPC error at the start of an observation's wait in `resolveReceipt` leaves a mined transaction uncounted ([`FIND-GAS-1-M26TMB`](../../../../../audit/open-findings.md#find-gas-1-m26tmb)).

## UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8

Record only what mined, through the owning signer, without changing the caller's result.

- Setup: A funded wallet on an exclusively owned hardhat node wrapped in `HostNonceManager` — the recorder has no chain of its own, and the signer that constructs it is its only real public entry, which is why this stays a `UNIT-TEST-*` family owned here rather than an interaction among this directory's files. Transactions are sent through the manager, then `settledSnapshot()` is read, bounded or not; the disposal cases call `dispose()` on the manager's recorder. The settle-window case needs two senders, so it drives the recorder's own constructor with the same real responses.
- Oracle: The snapshot rows and their gas against the real receipts; a bounded read resolves no earlier than its bound, and a disposed recorder's settle resolves before the event loop's next turn. The caller's own `wait()` and nonce sequence must be unchanged and no unhandled rejection may escape.

- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P1` — mined transaction recorded with its real gas
- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P2` — repeated identical calls aggregate
- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P3` — selector the contract surface does not name
- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P4` — a broadcast replaced before it mined is absent
- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P5` — a real reverted receipt lands in the reverted fields and moves no bound
- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P6` — a provider destroyed under an outstanding wait settles at once when the recorder is disposed, and the row is absent
- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P7` — an observation started inside a settle window does not hold that settle
- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P8` — a bounded read returns at its bound without a pending receipt, and a later read counts that receipt with its real gas once it mines
- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P9` — a transaction the node already held when its broadcast failed is recovered and recorded once it mines
- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P10` — a broadcast the node rejected fails the send and records nothing
- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P11` — a mined deployment is not recorded
- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P12` — a transaction observed after disposal is not recorded, and the send itself is unchanged
- [x] `UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P13` — a transaction recovered after its broadcast failed, then replaced at its nonce before it mined, is absent, and an unbounded read settles once the replacement mines
