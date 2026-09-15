# applyNodeGlobalsShim.ts — Source Report

> **Source:** [applyNodeGlobalsShim.ts](../../../../../../../../src/evm/p2pRuntime/worker/applyNodeGlobalsShim.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Applies the existing browser-to-Node global compatibility shim to the supplied host.

## Key design decisions

The helper does not run on import. The existing nodeGlobalsShim entry retains its explicit side effect; production root entries call through worker-only initialization.

## Inputs, outputs, state, and side effects

The public entry signatures define the startup values and platform handles. Domain roots own services; the common router owns pending requests. Startup and cleanup may allocate or release ports and workers. No separate readiness registry is introduced here.

## Linked requirements

| Source file                                                                                          | Specification IDs                                                                                   |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [applyNodeGlobalsShim.ts](../../../../../../../../src/evm/p2pRuntime/worker/applyNodeGlobalsShim.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

Startup data must be cloneable. Local dependencies stay in the receiving realm. Browser launch URLs are literal and visible to the bundler; arbitrary runtime class names do not identify worker bundles.

## Specification adherence

Creation preserves the existing domain readiness points and explicit parent ownership. Platform bootstrap shares the transferred-port boundary.

## Specification contradictions

None identified for this construction change.

## Missing behavior

This file contributes only the behavior described above; domain execution and lifecycle policy remain with their owners.

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                          | Gap / divergence                                         |
| --------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** [applyNodeGlobalsShim.ts](../../../../../../../../src/evm/p2pRuntime/worker/applyNodeGlobalsShim.ts) supplies the construction/platform boundary. **Other files:** [RuntimeLifecycleService](../../../../../../../../src/rpc/internal/services/lifecycle/RuntimeLifecycleService.ts) owns readiness and quiescence; [createRoot](../../../../../../../../src/rpc/internal/createRoot.ts) connects the parent and child. | None identified; the cited owners compose this boundary. |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Worker fixture entry migration

The side-effect-only `nodeGlobalsShim.ts` entry moved to `test/fixtures/NodeGlobalsShim.ts`. Production workers initialize globals through common root startup. The shared initializer remains the owner of worker-global behavior; the fixture adds no production API.
