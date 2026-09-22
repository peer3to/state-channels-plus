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
once, `settle()` waits for the observations already started, and `snapshot()` answers the current
table.

## Key design decisions

1. **The observation runs on its own receipt wait**, so the caller's own `wait()` result, its
   ordering, and the nonce owner's bookkeeping are untouched.
2. **A reverted transaction is recovered from the error.** `wait()` throws `CALL_EXCEPTION`
   carrying the receipt when the status is 0, so the reverted receipt is still counted.
3. **Anything else that ends the wait counts as "never mined"** — replaced, dropped, or a provider
   closed under the wait. It is logged at debug and left out of the table.
4. **An observation never rejects.** The stored promise is already caught, so a failed observation
   cannot become an unhandled rejection or a participant failure.
5. **A deployment is not recorded**, because the table keys on the called contract and a
   deployment has no callee.
6. **Function names come from `LoggerUtils.getContractCallMetadata`**, the one owner of
   selector decoding, so no second selector-to-name map exists.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| Inputs       | An ethers `TransactionResponse` already broadcast by the owning signer.                        |
| Outputs      | `GasUsageRow[]`; a settled promise for the observations in flight.                             |
| Owned state  | One [GasUsageTable](./GasUsageTable.ts.md) and the set of receipt waits still running.         |
| Side effects | Receipt waits against the peer's provider; debug log lines for transactions left out.          |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                            | Specification IDs                                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [GasUsageRecorder.ts](../../../../../../../src/evm/gasUsage/GasUsageRecorder.ts) | [`REQ-SDK-ARCH-5-NSJYQT`](../../../../../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt) — decides what mined and keeps observation free of caller-visible effects. |

## Assumptions, dependencies, trust boundaries, and limits

- The provider stays reachable for as long as an observation waits; when it does not, the
  transaction is simply not counted.
- `settle()` waits for real receipts, so a caller that uses it must know its transactions can mine.
- The peer's own chain data is trusted here: a receipt's `gasUsed` and `status` are taken as given.

## Specification adherence

- Mined-only counting and effect-free observation per [`REQ-SDK-ARCH-5-NSJYQT` (Chain spending is observable)](../../../../../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |
| [`REQ-SDK-ARCH-5-NSJYQT`](../../../../../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt) | Partial | **Here:** receipt resolution and reverted recovery in [resolveReceipt](../../../../../../../src/evm/gasUsage/GasUsageRecorder.ts#L67), non-rejecting observation in [observe](../../../../../../../src/evm/gasUsage/GasUsageRecorder.ts#L27). **Other files:** [GasUsageTable.ts](./GasUsageTable.ts.md) aggregates, [HostNonceManager.ts](../signer/HostNonceManager.ts.md) is the single producer, and [LoggerUtils.ts](../../utils/LoggerUtils.ts.md) names the selector. | Exposure and the disposal report belong to the runtime host and the client surface. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |
| <a id="unit-test-gas-usage-recorder-1-f2h4x8"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8` | Record only what mined, through the owning signer, without changing the caller's result. | A funded wallet on a private chain wrapped in `HostNonceManager`; transactions sent through it; `settle()` then `snapshot()`. | The snapshot rows and their gas against the real receipts; the caller's own `wait()` and nonce sequence must be unchanged and no unhandled rejection may escape. | <a id="unit-test-gas-usage-recorder-1-f2h4x8.p1"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P1` — mined transaction recorded with its real gas; <a id="unit-test-gas-usage-recorder-1-f2h4x8.p2"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P2` — repeated identical calls aggregate; <a id="unit-test-gas-usage-recorder-1-f2h4x8.p3"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P3` — selector the contract surface does not name; <a id="unit-test-gas-usage-recorder-1-f2h4x8.p4"></a>`UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P4` — a broadcast that never reaches the chain is absent. |

## Related source reports

- [GasUsageTable.ts](./GasUsageTable.ts.md), [HostNonceManager.ts](../signer/HostNonceManager.ts.md), [LoggerUtils.ts](../../utils/LoggerUtils.ts.md).
