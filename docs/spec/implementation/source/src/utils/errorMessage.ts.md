# errorMessage.ts — Source Report

> **Source:** [errorMessage.ts](../../../../../../src/utils/errorMessage.ts#L1)  
> **Status:** Authored — engineer verification pending.  
> **Design views:** [components.md](../../../views/architecture/sdk/components.md)

## Responsibility and observable boundary

Turn an unknown error into the existing message string.

## Key design decisions

Error objects use message, including an empty message; other values use String. This leaf avoids the model/storage dependency cycle that importing LoggerUtils into runtime and logging foundations would create. See [errorMessage.ts](../../../../../../src/utils/errorMessage.ts#L1).

## Inputs, outputs, state, and side effects

Turn an unknown error into the existing message string. Custom String conversion can throw as before. The helper does not wrap errors, copy stack fields or rebuild receipts.

## Linked requirements

| Source file                                                       | Specification IDs                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [errorMessage.ts](../../../../../../src/utils/errorMessage.ts#L1) | [`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) |

Supplies identical Error.message or String coercion to both platform logging and runtime error paths. This is a limited contribution; the callers own the complete policy.

## Assumptions, dependencies, trust boundaries, and limits

Custom String conversion can throw as before. The helper does not wrap errors, copy stack fields or rebuild receipts.

## Specification adherence

Supplies identical Error.message or String coercion to both platform logging and runtime error paths.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                             | Gap / divergence            |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** Supplies identical Error.message or String coercion to both platform logging and runtime error paths. [source](../../../../../../src/utils/errorMessage.ts#L1). **Other files:** [caller report](../evm/p2pRuntime/P2pRuntimeClient.ts.md) owns the surrounding operation. | None for this contribution. |

## Component test obligations

| Unit test ID                                                                      | Obligation          | Public entry and setup                                                                                                                           | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-error-message-32-x678kx"></a>`UNIT-TEST-ERROR-MESSAGE-32-X678KX` | Error text coercion | Call the leaf helper with Error and non-Error inputs; compare exact message or String conversion, including empty strings and custom conversion. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-error-message-32-x678kx.p1"></a>`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P1` — formats Error; <a id="unit-test-error-message-32-x678kx.p2"></a>`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P2` — formats empty Error; <a id="unit-test-error-message-32-x678kx.p3"></a>`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P3` — formats string; <a id="unit-test-error-message-32-x678kx.p4"></a>`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P4` — formats null; <a id="unit-test-error-message-32-x678kx.p5"></a>`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P5` — formats undefined; <a id="unit-test-error-message-32-x678kx.p6"></a>`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P6` — formats number; <a id="unit-test-error-message-32-x678kx.p7"></a>`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P7` — formats symbol; <a id="unit-test-error-message-32-x678kx.p8"></a>`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P8` — formats custom conversion |

## Related source reports

- [LoggerUtils.ts.md](LoggerUtils.ts.md)
