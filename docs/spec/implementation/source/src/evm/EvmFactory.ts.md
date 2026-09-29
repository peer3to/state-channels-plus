# EvmFactory.ts — Source Report

> **Source:** [src/evm/EvmFactory.ts](../../../../../../src/evm/EvmFactory.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../views/architecture/sdk/architecture.md)

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

Constructs the local EVM instance (with custom precompiles) for the mirror deployment, and gives each manifest precompile factory its local context: the logger and, when the EVM is built by an SDK executor root, that exact owner root.

## Key design decisions

1. **Integrator precompiles are injected at construction** — deployment-time capability, not runtime mutation.
2. **Every local EVM gets the ecrecover memo.** `createEvm` calls `installEcrecoverCache` on the new EVM before returning it ([#L85](../../../../../../src/evm/EvmFactory.ts#L85)), so repeated mirror checks of the same signatures skip the secp256k1 work. The memo sits below the contract code and never changes a result ([EcrecoverCache](../cache/EcrecoverCache.ts.md)).

3. **The executor owner is passed, not looked up.** `EvmCustomPrecompileContext` is `{ logger; owner?: AInternalRpcRoot }` ([#L27-L35](../../../../../../src/evm/EvmFactory.ts#L27-L35)) and is the factory's second argument ([#L37-L40](../../../../../../src/evm/EvmFactory.ts#L37-L40)). `createEvm(options, logger, owner?)` ([#L56-L60](../../../../../../src/evm/EvmFactory.ts#L56-L60)) forwards the owner through `resolveCustomPrecompiles` and `resolveCustomPrecompileManifest` into the factory call ([#L129](../../../../../../src/evm/EvmFactory.ts#L129)). The SDK executor always supplies its exact root ([ContractExecutorService](../rpc/internal/services/contractExecutor/ContractExecutorService.ts.md)); a bare EVM built outside a root, such as a cache test, keeps the two-argument call and its factories see no owner. The factory runs during executor startup, before readiness, so it can create a child root under the owner; the reference stays in the realm that builds the EVM and is never part of the manifest options.

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

| Source file                                              | Specification IDs                                                                                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EvmFactory.ts](../../../../../../src/evm/EvmFactory.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y), [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): delivers the executor's exact owner to precompile factories during startup; child cascade is owned by the root lifecycle.

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Role-consistent with the runtime views.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** the owner-bearing factory context ([#L28](../../../../../../src/evm/EvmFactory.ts#L28)) forwarded from `createEvm` into the factory call ([#L129](../../../../../../src/evm/EvmFactory.ts#L129)). **Other files:** [ContractExecutorService](../rpc/internal/services/contractExecutor/ContractExecutorService.ts.md) supplies its root during `init`; [ContractExecutorRoot](../rpc/internal/roots/ContractExecutorRoot.ts.md) drains admitted work before its children close; [AInternalRpcRoot](../rpc/internal/AInternalRpcRoot.ts.md) cascades disposal to children. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                | Obligation                                            | Public entry and setup                                                                                                                                                                                                                                                          | Oracle and forbidden effects                                                                                                                                                                                                                                                                                                                             | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-evm-factory-1-002c8d"></a>`UNIT-TEST-EVM-FACTORY-1-002C8D` | Precompile composition and the executor owner context | `createEvm` directly with a caller-supplied precompile; and a real SDK-owned executor (inline and worker) whose manifest factory rejects unless its owner is the executor root and then creates a real probe child under it, returning bytes through the child's echo endpoint. | Bare EVM: the custom precompile runs once with its exact return and the console precompile still logs. Executor: the owner is the executor root, the child is registered as its child, precompile results carry the child's echoed bytes, and executor disposal closes the child. Forbidden: a missing or foreign owner, a child outliving its executor. | <a id="unit-test-evm-factory-1-002c8d.p1"></a>`UNIT-TEST-EVM-FACTORY-1-002C8D.P1` — inline executor: factory receives that executor root during startup, its child serves the precompile call, and executor disposal closes the child; <a id="unit-test-evm-factory-1-002c8d.p2"></a>`UNIT-TEST-EVM-FACTORY-1-002C8D.P2` — worker executor: factory receives the worker-side executor root and call and simulation both return the child's bytes; <a id="unit-test-evm-factory-1-002c8d.p3"></a>`UNIT-TEST-EVM-FACTORY-1-002C8D.P3` — bare two-argument EVM: a custom precompile executes once with its return value and the built-in console precompile still logs. |

## Related source reports

- [runtime-and-concurrency view](../../../views/architecture/sdk/runtime-and-concurrency.md).
- [EcrecoverCache.ts](../cache/EcrecoverCache.ts.md) — the precompile memo installed here.
- [ContractExecutorService.ts](../rpc/internal/services/contractExecutor/ContractExecutorService.ts.md) — supplies the owner.
- [index.ts](index.ts.md) — exports `EvmCustomPrecompileContext`.
