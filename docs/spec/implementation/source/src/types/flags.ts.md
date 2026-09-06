# flags.ts — Source Report

> **Source:** [src/types/flags.ts](../../../../../../src/types/flags.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

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

Canonical enum declarations for block outcomes and SDK lifecycle status. Each `Status` member owns its
short lifecycle meaning here, so state holders and consumers do not repeat a second taxonomy.

## Key design decisions

The shared predicate means only PENDING_PARTICIPANT or PARTICIPATING. It does not define synced, engaged, finalized or source-specific status policies. See [flags.ts](../../../../../../src/types/flags.ts#L26).

`Status` is listed in lifecycle order. `DISCOVERING` is the only active caller-topic state and has no
selected channel ID; later members describe targeted or open-channel progress.

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

| Source file                                      | Specification IDs |
| ------------------------------------------------ | ----------------- |
| [flags.ts](../../../../../../src/types/flags.ts) |                   |

## Assumptions, dependencies, trust boundaries, and limits

- Network transports are untrusted byte pipes; identity comes only from the handshake.

## Specification adherence

- Declarative; consumers own behavior.

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

| Unit test ID                                                      | Obligation                           | Public entry and setup                                                                                                            | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-flags-32-1zfqy7"></a>`UNIT-TEST-FLAGS-32-1ZFQY7` | Committed participant classification | Call the predicate for every current status and an unknown numeric value; only pending participant and participating return true. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-flags-32-1zfqy7.p1"></a>`UNIT-TEST-FLAGS-32-1ZFQY7.P1` — classifies PENDING_PARTICIPANT; <a id="unit-test-flags-32-1zfqy7.p2"></a>`UNIT-TEST-FLAGS-32-1ZFQY7.P2` — classifies PARTICIPATING; <a id="unit-test-flags-32-1zfqy7.p3"></a>`UNIT-TEST-FLAGS-32-1ZFQY7.P3` — classifies DISCOVERING; <a id="unit-test-flags-32-1zfqy7.p4"></a>`UNIT-TEST-FLAGS-32-1ZFQY7.P4` — classifies NOT_OPENED; <a id="unit-test-flags-32-1zfqy7.p5"></a>`UNIT-TEST-FLAGS-32-1ZFQY7.P5` — classifies OPENED; <a id="unit-test-flags-32-1zfqy7.p6"></a>`UNIT-TEST-FLAGS-32-1ZFQY7.P6` — classifies SYNCED; <a id="unit-test-flags-32-1zfqy7.p7"></a>`UNIT-TEST-FLAGS-32-1ZFQY7.P7` — rejects an unknown numeric status |

## Related source reports

- [protocol-model/data-types](../../../../specification/protocol-model/data-types.md) (the neutral vocabulary).
