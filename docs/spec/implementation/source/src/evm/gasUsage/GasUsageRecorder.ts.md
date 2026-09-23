# GasUsageRecorder.ts — Source Report

> **Source:** [src/evm/gasUsage/GasUsageRecorder.ts](../../../../../../../src/evm/gasUsage/GasUsageRecorder.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

Turns a broadcast transaction response into a recorded receipt. `observe(response)` returns at
once, `settle(timeoutMs?)` waits for the observations already started, `snapshot()` answers the
current table, and `settledSnapshot(timeoutMs?)` composes the two — it is the read every reporter
uses.

## Key design decisions

1. **The observation runs on its own receipt wait**, so the caller's own `wait()` result, its
   ordering, and the nonce owner's bookkeeping are untouched.
2. **A reverted transaction is recovered from the error.** `wait()` throws `CALL_EXCEPTION`
   carrying the receipt when the status is 0, so the reverted receipt is still counted.
3. **Anything else that ends the wait counts as "never mined"** — replaced, dropped, or the wait's
   own bound expiring. It is logged at debug and left out of the table.
4. **An observation never rejects.** The stored promise is already caught, so a failed observation
   cannot become an unhandled rejection or a participant failure.
5. **The receipt wait is bounded** by `GAS_USAGE_RECEIPT_WAIT_MS`. Destroying an ethers provider
   removes its listeners and clears its own timers but never rejects an outstanding `wait()`, so an
   unbounded wait would stay pending forever and take `settle()` with it.
6. **`settle()` means the observations started before the call**, taken as one snapshot of the
   in-flight set, so a caller under a steady stream of sends is not made to wait for observations
   that began after it asked. A `timeoutMs` gives up on the rest, for a caller that may not wait on
   the chain.
7. **Settle-then-snapshot has one owner here**, so the public read, the disposal report and the
   harness query all answer with the same freshness rule.
8. **A deployment is not recorded**, because the table keys on the called contract and a
   deployment has no callee.
9. **Function names come from `LoggerUtils.getContractCallMetadata`**, the one owner of
   selector decoding, so no second selector-to-name map exists.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------- |
| Inputs       | An ethers `TransactionResponse` already broadcast by the owning signer.                  |
| Outputs      | `GasUsageRow[]`, unsettled or settled; a settled promise for the observations in flight. |
| Owned state  | One [GasUsageTable](./GasUsageTable.ts.md) and the set of receipt waits still running.   |
| Side effects | Receipt waits against the peer's provider; debug log lines for transactions left out.    |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                      | Specification IDs                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GasUsageRecorder.ts](../../../../../../../src/evm/gasUsage/GasUsageRecorder.ts) | [`REQ-SDK-ARCH-6-8DE4ER`](../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er) — decides what mined and keeps observation free of caller-visible effects. |

## Assumptions, dependencies, trust boundaries, and limits

- The provider may close or the chain may stall under an observation; the bounded wait then ends it
  and the transaction is simply not counted.
- `settle()` waits for real receipts, so a caller that uses it must know its transactions can mine,
  or pass the timeout that gives up on them.
- The peer's own chain data is trusted here: a receipt's `gasUsed` and `status` are taken as given.

## Specification adherence

- Mined-only counting and effect-free observation per [`REQ-SDK-ARCH-6-8DE4ER` (Chain spending is observable)](../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                      | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Gap / divergence                                                                    |
| -------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`REQ-SDK-ARCH-6-8DE4ER`](../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er) | Partial               | **Here:** receipt resolution, reverted recovery and the bounded wait in [resolveReceipt](../../../../../../../src/evm/gasUsage/GasUsageRecorder.ts#L100), non-rejecting observation in [observe](../../../../../../../src/evm/gasUsage/GasUsageRecorder.ts#L29), and the settled read in [settledSnapshot](../../../../../../../src/evm/gasUsage/GasUsageRecorder.ts#L76). **Other files:** [GasUsageTable.ts](./GasUsageTable.ts.md) aggregates, [HostNonceManager.ts](../signer/HostNonceManager.ts.md) is the single producer, and [LoggerUtils.ts](../../utils/LoggerUtils.ts.md) names the selector. | Exposure and the disposal report belong to the runtime host and the client surface. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                              | Obligation                                                                               | Public entry and setup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Oracle and forbidden effects                                                                                                                                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-gas-usage-recorder-1-f2h4x8"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8` | Record only what mined, through the owning signer, without changing the caller's result. | A funded wallet on an exclusively owned hardhat node wrapped in `HostNonceManager` — the recorder has no chain of its own, and the signer that constructs it is its only real public entry, which is why this stays a `UNIT-TEST-*` family owned here rather than an interaction among this directory's files. Transactions are sent through the manager, then `settledSnapshot()` is read. Cases that need a shortened receipt bound drive the recorder's own constructor with the same real responses. | The snapshot rows and their gas against the real receipts; the caller's own `wait()` and nonce sequence must be unchanged and no unhandled rejection may escape. | <a id="unit-test-gas-usage-recorder-1-f2h4x8.p1"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P1` — mined transaction recorded with its real gas; <a id="unit-test-gas-usage-recorder-1-f2h4x8.p2"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P2` — repeated identical calls aggregate; <a id="unit-test-gas-usage-recorder-1-f2h4x8.p3"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P3` — selector the contract surface does not name; <a id="unit-test-gas-usage-recorder-1-f2h4x8.p4"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P4` — a broadcast replaced before it mined is absent; <a id="unit-test-gas-usage-recorder-1-f2h4x8.p5"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P5` — a real reverted receipt lands in the reverted fields and moves no bound; <a id="unit-test-gas-usage-recorder-1-f2h4x8.p6"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P6` — a provider destroyed under an outstanding wait still settles, and the row is absent; <a id="unit-test-gas-usage-recorder-1-f2h4x8.p7"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P7` — an observation started inside a settle window does not hold that settle. |

## Related source reports

- [GasUsageTable.ts](./GasUsageTable.ts.md), [HostNonceManager.ts](../signer/HostNonceManager.ts.md), [LoggerUtils.ts](../../utils/LoggerUtils.ts.md).
