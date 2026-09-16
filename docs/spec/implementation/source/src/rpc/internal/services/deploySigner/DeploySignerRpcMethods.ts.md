# DeploySignerRpcMethods.ts — Source Report

> **Source:** [src/rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Declares only the public deploySigner endpoints: `getAddress`, `getNonce`, `resolveName`, `call`, `sendTransaction`. Each receiver uses its service for dependencies and retains its invocation sender.

call returns a named { encodedReturnData } object across the runtime port.

## Key design decisions

- Endpoint declarations are the concrete source of bound remote argument/result types ([`DeploySignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts#L6)).
- Domain work delegates through the service; helpers are not added to the routable receiver ([`DeploySignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts#L6)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Typed positional endpoint arguments and the service/sender receiver supplied by shared dispatch.                                                |
| Outputs      | Domain values or awaited void acknowledgements through the shared response path.                                                                |
| Owned state  | Invocation-local receiver only; domain state stays on the service or existing owner.                                                            |
| Side effects | Address, nonce, name resolution, call and deployment transaction operations retain their existing local signer behavior and receipt projection. |

## Linked requirements

| Source file                                                                                                                   | Specification IDs                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`DeploySignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The endpoint declarations and domain projections preserve argument and result meaning
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The invocation receiver delegates to the canonical domain owner

## Assumptions, dependencies, trust boundaries, and limits

Address, nonce, name resolution, call and deployment transaction operations retain their existing local signer behavior and receipt projection. Constructor, base members, getters and service helpers are excluded by common descriptor dispatch. The trailing delivery operation decides whether a response is required; void does not imply fire-and-forget.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The endpoint declarations and domain projections preserve argument and result meaning See [`DeploySignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts#L6).
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The invocation receiver delegates to the canonical domain owner See [`DeploySignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts#L6).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** The endpoint declarations and domain projections preserve argument and result meaning [`DeploySignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts#L6). **Other files:** [DeploySignerService.ts](DeploySignerService.ts.md) (deployment signer access before host readiness), [DeploymentBridgeSigner.ts](../../../../evm/signer/DeploymentBridgeSigner.ts.md) (public deployment signer reconstruction and bound calls), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The invocation receiver delegates to the canonical domain owner [`DeploySignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts#L6). **Other files:** [DeploySignerService.ts](DeploySignerService.ts.md) (deployment signer access before host readiness), [DeploymentBridgeSigner.ts](../../../../evm/signer/DeploymentBridgeSigner.ts.md) (public deployment signer reconstruction and bound calls), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).                       | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID                                                                              | Obligation                                                  | Public entry and setup                                                                                  | Oracle and forbidden effects                                                                              | Required permutations                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-deploy-signer-call-1-2b0r11"></a>`UNIT-TEST-DEPLOY-SIGNER-CALL-1-2B0R11` | Preserve deployment call bytes across the runtime boundary. | Deploy a real MathStateMachine during SDK setup and call getSum through the supplied deployment signer. | The public signer returns the exact ABI-encoded zero value; the internal response uses encodedReturnData. | <a id="unit-test-deploy-signer-call-1-2b0r11.p1"></a>`UNIT-TEST-DEPLOY-SIGNER-CALL-1-2B0R11.P1` — inline SDK placement; <a id="unit-test-deploy-signer-call-1-2b0r11.p2"></a>`UNIT-TEST-DEPLOY-SIGNER-CALL-1-2B0R11.P2` — SDK worker placement. |

## Related source reports

- [DeploySignerService.ts](DeploySignerService.ts.md)
- [DeploymentBridgeSigner.ts](../../../../evm/signer/DeploymentBridgeSigner.ts.md)
- [RpcDispatch.ts](../../../RpcDispatch.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
