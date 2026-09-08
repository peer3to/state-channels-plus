# channelKey.ts — Source Report

> **Source:** [channelKey.ts](../../../../../../src/utils/channelKey.ts#L1)  
> **Status:** Authored — engineer verification pending.  
> **Design views:** [components.md](../../../views/architecture/sdk/components.md)

## Responsibility and observable boundary

Give channel-key maps the existing shared string identity.

## Key design decisions

The conversion remains String(channelId).toLowerCase(); extraction does not add validation or enforce bytes32. See [channelKey.ts](../../../../../../src/utils/channelKey.ts#L1).

## Inputs, outputs, state, and side effects

Give channel-key maps the existing shared string identity. This is a permissive identity conversion. Validation belongs at the public channel-selection boundaries.

## Linked requirements

| Source file                                                   | Specification IDs                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [channelKey.ts](../../../../../../src/utils/channelKey.ts#L1) | [`REQ-ID-2-F3Y8J4`](../../../../specification/protocol-model/identity.md#req-id-2-f3y8j4) |

Supplies case-insensitive channel identity to channel-scoped maps without changing public bytes32 validation. This is a limited contribution; the callers own the complete policy.

## Assumptions, dependencies, trust boundaries, and limits

This is a permissive identity conversion. Validation belongs at the public channel-selection boundaries.

## Specification adherence

Supplies case-insensitive channel identity to channel-scoped maps without changing public bytes32 validation.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                   | Implementation status | Evidence                                                                                                                                                                                                                                                                            | Gap / divergence            |
| ----------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`REQ-ID-2-F3Y8J4`](../../../../specification/protocol-model/identity.md#req-id-2-f3y8j4) | Covered               | **Here:** Supplies case-insensitive channel identity to channel-scoped maps without changing public bytes32 validation. [source](../../../../../../src/utils/channelKey.ts#L1). **Other files:** [caller report](../storage/EventSyncStorage.ts.md) owns the surrounding operation. | None for this contribution. |

## Component test obligations

| Unit test ID                                                                  | Obligation             | Public entry and setup                                                                                  | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-channel-key-32-yj2a0a"></a>`UNIT-TEST-CHANNEL-KEY-32-YJ2A0A` | Channel key conversion | Case variants share a key and non-string inputs retain permissive String conversion without validation. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-channel-key-32-yj2a0a.p1"></a>`UNIT-TEST-CHANNEL-KEY-32-YJ2A0A.P1` — shares an identity across hex case variants; <a id="unit-test-channel-key-32-yj2a0a.p2"></a>`UNIT-TEST-CHANNEL-KEY-32-YJ2A0A.P2` — preserves permissive string conversion without validation |

## Related source reports

- [EventSyncStorage.ts.md](../storage/EventSyncStorage.ts.md)
