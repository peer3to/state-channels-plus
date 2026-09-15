# rootWorkerGlobals.ts — Source Report

> **Source:** [rootWorkerGlobals.ts](../../../../../../../src/rpc/internal/rootWorkerGlobals.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Initializes worker compatibility globals before root dependencies load.

## Key design decisions

The first import in createRoot initializes compatibility globals inside a worker, including scripted workers without production entry metadata. Every root worker gets the same process, Buffer and global compatibility defaults; no concrete-root branch remains. It never invents window, because network platform detection uses its presence. Inline imports do not install worker globals. The initializer is private; root classes neither import nor call it. Explicit worker entry modules own bootstrap; no entry-name matching remains.

## Inputs, outputs, state, and side effects

The public entry signatures define the startup values and platform handles. Domain roots own services; the common router owns pending requests. Startup and cleanup may allocate or release ports and workers. No separate readiness registry is introduced here.

## Linked requirements

| Source file                                                                        | Specification IDs                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [rootWorkerGlobals.ts](../../../../../../../src/rpc/internal/rootWorkerGlobals.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

Startup data must be cloneable. Local dependencies stay in the receiving realm. Browser launch URLs are literal and visible to the bundler; arbitrary runtime class names do not identify worker bundles.

## Specification adherence

Creation preserves the existing domain readiness points and explicit parent ownership. Platform bootstrap shares the transferred-port boundary.

## Specification contradictions

None identified for this construction change.

## Missing behavior

This file contributes only the behavior described above; domain execution and lifecycle policy remain with their owners.

## Conformance traceability

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                  | Gap / divergence                                         |
| ------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** [rootWorkerGlobals.ts](../../../../../../../src/rpc/internal/rootWorkerGlobals.ts) supplies the construction/platform boundary. **Other files:** [RuntimeLifecycleService](../../../../../../../src/rpc/internal/services/lifecycle/RuntimeLifecycleService.ts) owns readiness and quiescence; [createRoot](../../../../../../../src/rpc/internal/createRoot.ts) connects the parent and child. | None identified; the cited owners compose this boundary. |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |
