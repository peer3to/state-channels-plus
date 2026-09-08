# createLoggerFoundation.ts — Source Report

> **Source:** [createLoggerFoundation.ts](../../../../../../../src/utils/logging/createLoggerFoundation.ts#L1)  
> **Status:** Authored — engineer verification pending.  
> **Design views:** [components.md](../../../../views/architecture/sdk/components.md)

## Responsibility and observable boundary

Create the common logger store and option values for both platform factories.

## Key design decisions

Each call allocates a distinct LogStore. Explicit skipWriting false survives nullish defaulting; store capacity and uploader configuration retain their existing fallback expressions. See [createLoggerFoundation.ts](../../../../../../../src/utils/logging/createLoggerFoundation.ts#L1).

## Inputs, outputs, state, and side effects

Create the common logger store and option values for both platform factories. Configuration is read at factory-call time. Platform levels, excluded tags and logger classes stay in the Node/browser factories; this module imports no platform implementation.

## Linked requirements

| Source file                                                                                      | Specification IDs                                                                                |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [createLoggerFoundation.ts](../../../../../../../src/utils/logging/createLoggerFoundation.ts#L1) | [`INV-RUNTIME-1-AKRHAK`](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) |

Supplies the same effective store and uploader options to both platform factories. This is a limited contribution; the callers own the complete policy.

## Assumptions, dependencies, trust boundaries, and limits

Configuration is read at factory-call time. Platform levels, excluded tags and logger classes stay in the Node/browser factories; this module imports no platform implementation.

## Specification adherence

Supplies the same effective store and uploader options to both platform factories.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                              | Gap / divergence            |
| ------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** Supplies the same effective store and uploader options to both platform factories. [source](../../../../../../../src/utils/logging/createLoggerFoundation.ts#L1). **Other files:** [caller report](node/createLogger.ts.md) owns the surrounding operation. | None for this contribution. |

## Component test obligations

| Unit test ID                                                                                            | Obligation                | Public entry and setup                                                                                                                                       | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-create-logger-foundation-32-1nhgfc"></a>`UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC` | Logger foundation options | Build real stores under temporary config values; inspect defaults, explicit false, uploader options, disabled storage, fallback size and distinct instances. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-create-logger-foundation-32-1nhgfc.p1"></a>`UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P1` — uses config defaults and allocates a distinct store per call; <a id="unit-test-create-logger-foundation-32-1nhgfc.p2"></a>`UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P2` — preserves explicit false and uploader options; <a id="unit-test-create-logger-foundation-32-1nhgfc.p3"></a>`UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P3` — disables storage when upload is disabled; <a id="unit-test-create-logger-foundation-32-1nhgfc.p4"></a>`UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P4` — uses the default store size for zero configuration |

## Related source reports

- [createLogger.ts.md](node/createLogger.ts.md)
