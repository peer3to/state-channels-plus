# bytes32.ts — Source Report

> **Source:** [bytes32.ts](../../../../../../src/utils/bytes32.ts#L1)  
> **Status:** Authored — engineer verification pending.  
> **Design views:** [components.md](../../../views/architecture/sdk/components.md)

## Responsibility and observable boundary

Reject values that are not exactly 32 hex bytes using the caller's error message.

## Key design decisions

The assertion signature narrows a successful input to string. Runtime validation still returns no value and never normalizes the input. Callers that previously hexlified still do so themselves. See [bytes32.ts](../../../../../../src/utils/bytes32.ts#L1).

## Inputs, outputs, state, and side effects

Reject values that are not exactly 32 hex bytes using the caller's error message. The input may be undefined. ethers.isHexString owns byte-length and hex validation; this helper has no state or platform dependencies.

## Linked requirements

| Source file                                             | Specification IDs                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [bytes32.ts](../../../../../../src/utils/bytes32.ts#L1) | [`REQ-UPG-6-BC60XD`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd) |

This file contributes only its operation above; [discoveryKey.ts.md](discoveryKey.ts.md) owns the surrounding policy.

## Assumptions, dependencies, trust boundaries, and limits

The input may be undefined. ethers.isHexString owns byte-length and hex validation; this helper has no state or platform dependencies.

## Specification adherence

The operation supports [`REQ-UPG-6-BC60XD`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd) within the caller-owned policy described above.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                  | Implementation status | Evidence                                                                                                                                                                                                                                                 | Gap / divergence            |
| -------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`REQ-UPG-6-BC60XD`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd) | Covered               | **Here:** Reject values that are not exactly 32 hex bytes using the caller's error message. [bytes32.ts](../../../../../../src/utils/bytes32.ts#L1). **Other files:** [discoveryKey.ts.md](discoveryKey.ts.md) supplies the surrounding protocol policy. | None for this contribution. |

## Component test obligations

| Unit test ID                                                          | Obligation              | Public entry and setup                                                                                        | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-bytes32-32-e6kc18"></a>`UNIT-TEST-BYTES32-32-E6KC18` | Bytes32 validation only | Call requireBytes32 with undefined and valid zero hash; compare exact supplied error message and void return. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-bytes32-32-e6kc18.p1"></a>`UNIT-TEST-BYTES32-32-E6KC18.P1` — uses the caller message for undefined bytes32 input; <a id="unit-test-bytes32-32-e6kc18.p2"></a>`UNIT-TEST-BYTES32-32-E6KC18.P2` — validates bytes32 without returning a normalized value |

## Related source reports

- [discoveryKey.ts.md](discoveryKey.ts.md)
