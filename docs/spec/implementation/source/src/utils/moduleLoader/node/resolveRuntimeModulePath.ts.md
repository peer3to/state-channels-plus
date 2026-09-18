# resolveRuntimeModulePath.ts — Source Report

> **Source:** [src/utils/moduleLoader/node/resolveRuntimeModulePath.ts](../../../../../../../../src/utils/moduleLoader/node/resolveRuntimeModulePath.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

Maps a module path written for one tree to the twin that exists in the other: a `.ts` path whose file is absent resolves to its `.js` twin when that exists, and the reverse. Existing files and bare package specifiers pass through unchanged. The manifest loader and the root worker factory use it so fixtures and worker entries can be named once and run both under ts-node and from the compiled `dist` tree.

## Key design decisions

1. **Existence decides, never the mode.** No environment flag selects a tree; the file that is present is loaded. A tree with both twins keeps the one named.
2. **Only the extension changes.** Directory and base name are preserved, so a compiled tree must mirror the source layout, which the build does.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                             |
| ------------ | ------------------------------------ |
| Inputs       | A module path or specifier.          |
| Outputs      | The same path, or its existing twin. |
| Owned state  | None.                                |
| Side effects | File existence checks only.          |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                    | Specification IDs |
| -------------------------------------------------------------------------------------------------------------- | ----------------- |
| [resolveRuntimeModulePath.ts](../../../../../../../../src/utils/moduleLoader/node/resolveRuntimeModulePath.ts) |                   |

## Assumptions, dependencies, trust boundaries, and limits

- Node only; the browser module loader never names files on disk.

## Specification adherence

- Platform adapter for the node module loader; no protocol behavior.

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

| Unit test ID                                                                                                | Obligation      | Public entry and setup                                        | Oracle and forbidden effects                                                                          | Required permutations                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-resolve-runtime-module-path-1-k3m8qd"></a>`UNIT-TEST-RESOLVE-RUNTIME-MODULE-PATH-1-K3M8QD` | Twin resolution | Call with paths in a temporary directory holding chosen twins | The named file wins when present; the twin only when the named file is absent; other inputs unchanged | <a id="unit-test-resolve-runtime-module-path-1-k3m8qd.p1"></a>`UNIT-TEST-RESOLVE-RUNTIME-MODULE-PATH-1-K3M8QD.P1` — existing file, compiled-only twin, source-only twin, missing both, bare specifier and non-module extension |

## Related source reports

- [importModuleFromManifest.ts](./importModuleFromManifest.ts.md) and [RootWorkerRuntime.ts](../../../rpc/internal/node/RootWorkerRuntime.ts.md) — the consumers.
