# resolveCustomRpcManifest.ts — Source Report

> **Source:** [src/rpc/resolveCustomRpcManifest.ts](../../../../../../src/rpc/resolveCustomRpcManifest.ts) > **Status:** Authored — engineer verification pending.
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

Loads a custom RPC root constructor from its manifest via the platform module loader, selecting
the named or default export and forwarding serializable options.

## Key design decisions

1. **Fail loudly on a non-constructor export** — a misconfigured manifest surfaces at startup, not at first dispatch ([#L25](../../../../../../src/rpc/resolveCustomRpcManifest.ts#L25)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                             |
| ------------ | ------------------------------------ |
| Inputs       | Manifest or undefined.               |
| Outputs      | Constructor + options, or undefined. |
| Owned state  | None.                                |
| Side effects | Dynamic module import.               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                          | Specification IDs                                                                             |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [resolveCustomRpcManifest.ts](../../../../../../src/rpc/resolveCustomRpcManifest.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

- The platform loader abstracts Node/browser import differences ([`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)).

## Specification adherence

- Platform-neutral loading through the delegated loader ([`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** loader delegation + export validation. **Other files:** [moduleLoader](../utils/moduleLoader/) platform pair. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                              | Obligation          | Public entry and setup                                             | Oracle and forbidden effects                                                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-resolve-custom-rpc-1-tq6bp6"></a>`UNIT-TEST-RESOLVE-CUSTOM-RPC-1-TQ6BP6` | Manifest resolution | Resolve default/named/missing/non-function exports and no manifest | Constructors returned with options; non-function throws; no manifest → undefined | <a id="unit-test-resolve-custom-rpc-1-tq6bp6.p1"></a>`UNIT-TEST-RESOLVE-CUSTOM-RPC-1-TQ6BP6.P1` — default export; <a id="unit-test-resolve-custom-rpc-1-tq6bp6.p2"></a>`UNIT-TEST-RESOLVE-CUSTOM-RPC-1-TQ6BP6.P2` — named export; <a id="unit-test-resolve-custom-rpc-1-tq6bp6.p3"></a>`UNIT-TEST-RESOLVE-CUSTOM-RPC-1-TQ6BP6.P3` — non-function throws; <a id="unit-test-resolve-custom-rpc-1-tq6bp6.p4"></a>`UNIT-TEST-RESOLVE-CUSTOM-RPC-1-TQ6BP6.P4` — absent manifest |

## Related source reports

- [registry](./registry.ts.md), [moduleLoader](../utils/moduleLoader/).
