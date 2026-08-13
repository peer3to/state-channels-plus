# SpectatingValidationStrategy.ts — Source Report

> **Source:** [src/stateManager/validationStrategy/SpectatingValidationStrategy.ts](../../../../../../../../src/stateManager/validationStrategy/SpectatingValidationStrategy.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

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

The spectator/pending-joiner context: same verdicts, but provable participant fraud aborts the whole spectate (fail-closed) while junk with nobody to slash only drops the sender — a DoS must never force an abort.

## Key design decisions

1. **The abort/drop split is the fail-closed rule:** provable fraud → stop following; unattributable junk → keep spectating (INV-SYNC-3 consumer side).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                    |
| ------------ | ----------------------------------------------------------- |
| Inputs       | Deviation hook calls with block context.                    |
| Outputs      | Verdicts + context consequences.                            |
| Owned state  | None.                                                       |
| Side effects | Evidence storage, escalation, penalties, restores per hook. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                    | Specification IDs                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [SpectatingValidationStrategy.ts](../../../../../../../../src/stateManager/validationStrategy/SpectatingValidationStrategy.ts) | `REQ-BLOCK-PIPE-3`, [`INV-SYNC-3`](../../../../../specification/peer-communication/synchronization.md#inv-sync-3) |

## Assumptions, dependencies, trust boundaries, and limits

- Hooks run under the caller's execution boundary; consequences must not assume otherwise.

## Specification adherence

- Context-complete consequence profile (`REQ-BLOCK-PIPE-3`) — the spectating consequence profile.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence                                                                                                                                                                                                     | Gap / divergence |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `REQ-BLOCK-PIPE-3`      | Covered               | **Here:** the spectating consequence profile. **Other files:** verdict production in [ValidationService](../ValidationService.ts.md); base vocabulary in [AValidationStrategy](./AValidationStrategy.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                      | Obligation          | Public entry and setup                                          | Oracle and forbidden effects                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-spectatingvalidation-strategy-1"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1` | Consequence profile | Drive every hook in this context incl. impossible-context hooks | Each deviation maps to exactly the documented consequence; impossible hooks throw; keep-connection interpretation correct | <a id="unit-test-spectatingvalidation-strategy-1.p1"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1.P1` — every hook; <a id="unit-test-spectatingvalidation-strategy-1.p2"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1.P2` — impossible-context hooks; <a id="unit-test-spectatingvalidation-strategy-1.p3"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1.P3` — keep-connection mapping |

## Related source reports

- [ValidationService](../ValidationService.ts.md), [StateManager](../StateManager.ts.md), [FraudProofService](../utils/FraudProofService.ts.md).
