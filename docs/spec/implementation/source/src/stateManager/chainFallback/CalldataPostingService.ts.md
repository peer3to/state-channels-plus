# CalldataPostingService.ts — Source Report

> **Source:** [src/stateManager/chainFallback/CalldataPostingService.ts](../../../../../../../src/stateManager/chainFallback/CalldataPostingService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Block confirmation pipeline](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Responsibility and observable boundary

Publishes a stored block when its participant set has not supplied every signature. The public entry returns immediately; the collected operation includes the transaction receipt and its recovery handler.

## Key design decisions

1. Read the stored block and current signatures at [entry](../../../../../../../src/stateManager/chainFallback/CalldataPostingService.ts#L29), so an absent or fully signed block causes no post.
2. Derive the deadline from the previous relevant timestamp and the protocol timeout at [the post](../../../../../../../src/stateManager/chainFallback/CalldataPostingService.ts#L50).
3. Collect the complete operation after [receipt recovery](../../../../../../../src/stateManager/chainFallback/CalldataPostingService.ts#L67). The raw receipt is awaited within that operation; collecting it separately would report a handled deadline refusal as an unhandled failure.

## Inputs, outputs, state, and side effects

Input: stored block hash. Dependencies: StateManager storage, contract, signer, clock, event hooks and logger. Side effects: posting hook, contract submission, receipt recovery, diagnostic logging and detached-operation collection. This service has no mutable protocol state; its logger is created by the constructor.

## Linked requirements

| Source file                                                                                                | Specification IDs                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [CalldataPostingService.ts](../../../../../../../src/stateManager/chainFallback/CalldataPostingService.ts) | [`REQ-DA-1-NVV85Z`](../../../../../specification/security/data-availability.md#req-da-1-nvv85z) |

The service publishes the signed block needed for chain-only data recovery.

## Assumptions, dependencies, trust boundaries, and limits

The contract enforces the deadline and publication validity. This service uses the stored participant union and previous relevant timestamp. A deadline refusal cannot make calldata available; the normal timeout/dispute workflow remains responsible for progress. Unknown post errors retain the existing error log; this change does not redefine that policy.

## Specification adherence

Publishes the signed block through the contract calldata path when agreement is incomplete.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                         | Implementation status | Evidence                                                                                                                                                                                                                                                                                                              | Gap / divergence |
| ----------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DA-1-NVV85Z`](../../../../../specification/security/data-availability.md#req-da-1-nvv85z) | Covered               | **Here:** [postBlockCalldata](../../../../../../../src/stateManager/chainFallback/CalldataPostingService.ts#L71) publishes the signed block. **Other files:** the [block confirmation pipeline](../../../../views/architecture/sdk/block-confirmation-pipeline.md) describes contract commitment and recovery owners. | None.            |

## Component test obligations

| Unit test ID                                                                                          | Obligation                                   | Public entry and setup                                                 | Oracle and forbidden effects                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-calldata-posting-service-1-p42419"></a>`UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419` | Conditional publication and receipt recovery | Real session; invoke maybePostBlockOnChain with stored or absent block | Post only when signatures are incomplete; handled receipt failures do not escape through diagnostic collection | <a id="unit-test-calldata-posting-service-1-p42419.p1"></a>`UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P1` — fully signed block posts nothing; <a id="unit-test-calldata-posting-service-1-p42419.p2"></a>`UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P2` — missing block is a no-op; <a id="unit-test-calldata-posting-service-1-p42419.p3"></a>`UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P3` — incomplete agreement publishes calldata; <a id="unit-test-calldata-posting-service-1-p42419.p4"></a>`UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P4` — expired deadline at the mined receipt is handled before detached collection |

## Related source reports

- [StateManager](../StateManager.ts.md)
