# OpenChannelNegotiationHelpers.ts — Source Report

> **Source:** [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts](../../../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/open-channel-negotiation.md](../../../../../views/architecture/sdk/rpc/open-channel-negotiation.md)

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

The proposal-mismatch predicate and canonical-struct helpers: participants sorted by numeric
address, balances aligned, and field-by-field comparison (channel, participants, every balance
amount/data, atomicity, data, deadline bounded into the permitted window).

## Key design decisions

1. **One mismatch predicate for the whole struct** so the verifier cannot forget a field — additions to the struct force a change here.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                              |
| ------------ | ------------------------------------- |
| Inputs       | Proposed and locally rebuilt structs. |
| Outputs      | Mismatch verdict/canonical struct.    |
| Owned state  | None.                                 |
| Side effects | None.                                 |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                             | Specification IDs                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [OpenChannelNegotiationHelpers.ts](../../../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts) | [`INV-NEG-1-6FW90P`](../../../../../../specification/peer-communication/channel-negotiation.md#inv-neg-1-6fw90p) |

## Assumptions, dependencies, trust boundaries, and limits

- Canonical participant ordering is the same the contract verifies.

## Specification adherence

- Field-exact comparison backbone of [`INV-NEG-1-6FW90P`](../../../../../../specification/peer-communication/channel-negotiation.md#inv-neg-1-6fw90p).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                          | Implementation status | Evidence                                               | Gap / divergence |
| ---------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------ | ---------------- |
| [`INV-NEG-1-6FW90P`](../../../../../../specification/peer-communication/channel-negotiation.md#inv-neg-1-6fw90p) | Covered               | **Here:** the exhaustive comparison + deadline window. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                          | Obligation              | Public entry and setup                            | Oracle and forbidden effects                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-open-negotiation-helpers-1-rwqazf"></a>`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF` | Mismatch exhaustiveness | Vary each field independently; boundary deadlines | Each variation detected; identical structs pass; deadline window edges correct | <a id="unit-test-open-negotiation-helpers-1-rwqazf.p1"></a>`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P1` — channelId variation; <a id="unit-test-open-negotiation-helpers-1-rwqazf.p2"></a>`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P2` — deadline at expired edge; <a id="unit-test-open-negotiation-helpers-1-rwqazf.p3"></a>`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P3` — sort/alignment canonicalization; <a id="unit-test-open-negotiation-helpers-1-rwqazf.p4"></a>`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P4` — participants length variation; <a id="unit-test-open-negotiation-helpers-1-rwqazf.p5"></a>`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P5` — participant address variation; <a id="unit-test-open-negotiation-helpers-1-rwqazf.p6"></a>`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P6` — balances length variation; <a id="unit-test-open-negotiation-helpers-1-rwqazf.p7"></a>`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P7` — balance amount variation; <a id="unit-test-open-negotiation-helpers-1-rwqazf.p8"></a>`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P8` — balance data variation; <a id="unit-test-open-negotiation-helpers-1-rwqazf.p9"></a>`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P9` — isAtomic variation; <a id="unit-test-open-negotiation-helpers-1-rwqazf.p10"></a>`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P10` — non-empty data variation; <a id="unit-test-open-negotiation-helpers-1-rwqazf.p11"></a>`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P11` — deadline beyond max edge |

## Related source reports

- [OpenChannelNegotiationService](./OpenChannelNegotiationService.ts.md).
