# LoggerUtils.ts — Source Report

> **Source:** [src/utils/LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../views/architecture/sdk/components.md)

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

Structured-log formatting helpers (dispute/auditing metadata projections, hash formatting).

## Key design decisions

Proof metadata projects milestones and latest height, with no separate signed-block count. Block metadata uses acceptedSignerAddresses so malformed evidence does not crash logging. Dispute fraud names resolve only in the dispute enum and ordinary fraud names only in its enum; unknown values display UNKNOWN(n). See [LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts#L791) and [LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts#L924).

Peer-profile metadata has one owner: identity, blacklist state and live transport metadata. Lifecycle callers reuse this projection. See [LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts#L500).

Time-failure metadata uses the caller's captured clock value and the existing enum formatter. Dependency-free error text coercion lives in errorMessage.ts so low-level loggers and runtime clients need not import this domain graph. See [LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts#L122).

Dispute-deadline metadata has one owner. `getDisputeDeadlineMetadata({ killPeriodEnd, evidencePeriodEnd? })`
([LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts#L711)) projects a dispute window's
deadlines into `killPeriodEnd`, `killPeriodRemainingSeconds`, `evidencePeriodEnd` and
`evidencePeriodRemainingSeconds`. The remaining seconds are the deadline minus `Clock.getTimeInSeconds()`,
the chain-estimated clock (wall time plus the synced chain adjustment), not a chain read. A negative
remainder means the period is already over. The evidence deadline is optional: without it, both
evidence fields are `undefined` (a caller that knows only the kill period end, such as
`DisputeManager.killDispute`). It only formats; no caller decides anything on it. Callers:
[DisputeManager](../disputeManager/DisputeManager.ts.md) (kill send) and
[EventHandler](../eventHandlers/EventHandler.ts.md) (dispute-window logs).

Contract-call metadata is the single owner of selector decoding: it slices the selector and names it
from one lazily built selector-to-name map over the merged SDK contract surface, so no second map
exists. The lookup is a `Map.get`, total for any string, because the calldata reaching it on every
block validation is peer-authored and must not be able to steer an ABI parse; a selector the
surface does not declare is reported as its own hex. See
[LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts#L216).

Block-confirmation struct metadata never throws on the bytes it logs. Its callers log refused
confirmations (dispute replay abort, ingest decode refusal, queue intake), whose encoded block may
not decode; `getBlockConfirmationStructMetadata` then leaves the block fields out and sets
`undecodableBlock: true`, keeping the confirmation hash and signatures, instead of raising a decode
error from inside the log call and replacing the caller's verdict with a throw. See
[LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts#L579).

Dispute metadata includes the signed `requireExistingDisputeWindow` value. Logs distinguish a conditional state contribution from an independently justified dispute without changing either classification.

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                  | Specification IDs |
| ------------------------------------------------------------ | ----------------- |
| [LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts) |                   |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Role-consistent with the owning views.

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

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation                                       | Public entry and setup                                                                                                                                                | Oracle and forbidden effects                                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-logger-utils-32-wmbbza"></a>`UNIT-TEST-LOGGER-UTILS-32-WMBBZA` | Enum and failed time metadata                    | Use a real logger store and captured time; inspect exact enum output, severity, message and metadata including optional prior timestamps.                             | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.                               | <a id="unit-test-logger-utils-32-wmbbza.p1"></a>`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P1` — formats known and unknown numeric enum members without changing strings; <a id="unit-test-logger-utils-32-wmbbza.p2"></a>`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P2` — logs objective time failure using captured time and previous timestamps; <a id="unit-test-logger-utils-32-wmbbza.p3"></a>`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P3` — omits previous timestamp fields for subjective time failures<br><a id="unit-test-logger-utils-32-wmbbza.p4"></a>`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P4` — Dispute proof metadata translates chain enum values 0, 1, 19 and 20 into the exact dispute-family names, including the two new counters, without using the overlapping block-fraud names.<br><a id="unit-test-logger-utils-32-wmbbza.p5"></a>`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P5` — Block-fraud metadata translates chain enum values 0, 1 and 4 into BlockDoubleSign, BlockInvalidStateTransition and ForgedInboundMessageBlock.<br><a id="unit-test-logger-utils-32-wmbbza.p6"></a>`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P6` — Unknown dispute proof value 99 and unknown block-fraud proof value 5 format as UNKNOWN(99) and UNKNOWN(5) in their separate metadata lookups. |
| <a id="unit-test-logger-utils-33-a11ybz"></a>`UNIT-TEST-LOGGER-UTILS-33-A11YBZ` | Contract-call metadata names its selector        | Call `getContractCallMetadata` with calldata for a function the SDK contract surface declares, for one it does not, and for data too short to hold a selector at all. | The returned selector, function name and calldata length; no other metadata field changes, and no input throws.                            | <a id="unit-test-logger-utils-33-a11ybz.p1"></a>`UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P1` — undeclared selector is reported as its own hex; <a id="unit-test-logger-utils-33-a11ybz.p2"></a>`UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P2` — declared selector is reported by name; <a id="unit-test-logger-utils-33-a11ybz.p3"></a>`UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P3` — calldata shorter than a selector is returned unchanged and does not throw                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| <a id="unit-test-logger-utils-34-hnbmfq"></a>`UNIT-TEST-LOGGER-UTILS-34-HNBMFQ` | Refused block confirmations log without decoding | Call `getBlockConfirmationStructMetadata` with a confirmation whose block bytes do not decode.                                                                        | The metadata marks `undecodableBlock: true`, keeps the confirmation hash and signatures, and has no block fields; the call does not throw. | <a id="unit-test-logger-utils-34-hnbmfq.p1"></a>`UNIT-TEST-LOGGER-UTILS-34-HNBMFQ.P1` — undecodable block bytes are marked instead of throwing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Related source reports

- Consumers per the views.
