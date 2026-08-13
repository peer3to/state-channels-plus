# registry.ts — Source Report

> **Source:** [src/rpc/registry.ts](../../../../../../src/rpc/registry.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

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

Type definitions for custom RPC roots: the constructor signature and the serializable manifest
(module specifier, optional export name, forwarded options).

## Key design decisions

1. **Manifests are serializable by design** so a custom root can be declared across worker/process boundaries and loaded platform-appropriately.

## Inputs, outputs, state, and side effects

| Aspect       | Contents    |
| ------------ | ----------- |
| Inputs       | —           |
| Outputs      | Types only. |
| Owned state  | None.       |
| Side effects | None.       |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                          | Specification IDs |
| ---------------------------------------------------- | ----------------- |
| [registry.ts](../../../../../../src/rpc/registry.ts) |                   |

## Assumptions, dependencies, trust boundaries, and limits

- Module loading is platform-delegated ([moduleLoader](../utils/moduleLoader/) per [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)).

## Specification adherence

- Declarative only.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [resolveCustomRpcManifest](./resolveCustomRpcManifest.ts.md) (the loader).
