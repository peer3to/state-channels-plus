# EthersResultProxy.ts — Source Report

> **Source:** [src/utils/EthersResultProxy.ts](../../../../../../src/utils/EthersResultProxy.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../views/architecture/sdk/runtime-and-concurrency.md)

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

Normalization boundary around ethers contracts and Result objects (array/object duality). It
recursively normalizes method inputs and outputs, listener arguments, event-log arguments, and
query results, including values produced by a compatible ethers copy in another module graph.

## Key design decisions

1. **Result identity is structural.** Conversion delegates to the shared public-API predicate and re-exports it for callers, avoiding constructor identity while leaving ordinary arrays unchanged ([#L2](../../../../../../src/utils/EthersResultProxy.ts#L2), [#L29](../../../../../../src/utils/EthersResultProxy.ts#L29)).
2. **One proxy owns every ethers boundary.** Typed methods, `staticCall`, listeners, and
   `queryFilter` all pass through the same recursive conversion path, so nested Results cannot
   escape through a less common contract API ([#L97](../../../../../../src/utils/EthersResultProxy.ts#L97), [#L116](../../../../../../src/utils/EthersResultProxy.ts#L116), [#L190](../../../../../../src/utils/EthersResultProxy.ts#L190)).
3. **Listener identity is stable for its full lifetime.** Every registration of one original
   callback uses the same wrapped callback. Removal keeps that mapping so repeated registrations
   can be removed one at a time through the original callback ([#L119](../../../../../../src/utils/EthersResultProxy.ts#L119), [#L171](../../../../../../src/utils/EthersResultProxy.ts#L171)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Arbitrary values for `convertEthersValue`; a contract-like object for `createEthersResultProxy`; method arguments, listener arguments, and query filters used through that proxy. |
| Outputs      | Values with ethers Results recursively converted to named plain objects; a contract proxy that preserves the original public surface.                                             |
| Owned state  | One weak original-listener-to-wrapped-listener map per contract proxy.                                                                                                            |
| Side effects | Delegated contract calls and listener registration/removal on the original contract object.                                                                                       |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                              | Specification IDs                                                                                                                                                                            |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EthersResultProxy.ts](../../../../../../src/utils/EthersResultProxy.ts) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Ethers values normalize without depending on one package copy's constructor identity.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                       | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** `convertEthersValue` uses the shared structural Result predicate. **Other files:** [ObjectChecks](./ObjectChecks.ts.md) owns that predicate; [Codec](./Codec.ts.md) owns recursive conversion.       | None.            |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** method, listener, event-log, and query results are normalized before crossing consumer boundaries. **Other files:** [Codec](./Codec.ts.md) owns the canonical recursive Result-to-object conversion. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                | Obligation                     | Public entry and setup                                                                                                                                            | Oracle and forbidden effects                                                                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-ethers-result-proxy-1-1brj8d"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D` | Value normalization            | Pass native, compatible cross-module, proxy-wrapped, normalized, nested, and ordinary array values through `convertEthersValue`                                   | Results become the same named plain object; clean branches and already-normalized values retain identity; ordinary arrays remain ordinary arrays        | <a id="unit-test-ethers-result-proxy-1-1brj8d.p1"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P1` — native and cross-module Result conversion; <a id="unit-test-ethers-result-proxy-1-1brj8d.p2"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P2` — ordinary array rejection and identity preservation; <a id="unit-test-ethers-result-proxy-1-1brj8d.p3"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P3` — proxy-wrapped Result converts once and normalized output is stable; <a id="unit-test-ethers-result-proxy-1-1brj8d.p4"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P4` — recursive array/plain-object conversion with clean-branch identity                                                                                                                                                                                                                                                               |
| <a id="unit-test-ethers-result-proxy-2-ra8yec"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC` | Contract method boundary       | Invoke direct and `staticCall` methods with synchronous, asynchronous, nested Result, and rejected values                                                         | Inputs and successful outputs normalize once; receiver and method properties survive; rejection identity is unchanged                                   | <a id="unit-test-ethers-result-proxy-2-ra8yec.p1"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P1` — synchronous direct result; <a id="unit-test-ethers-result-proxy-2-ra8yec.p2"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P2` — asynchronous direct result; <a id="unit-test-ethers-result-proxy-2-ra8yec.p3"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P3` — `staticCall` result; <a id="unit-test-ethers-result-proxy-2-ra8yec.p4"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P4` — direct and static argument conversion; <a id="unit-test-ethers-result-proxy-2-ra8yec.p5"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P5` — method properties and receiver; <a id="unit-test-ethers-result-proxy-2-ra8yec.p6"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P6` — rejection identity                                                                                                                       |
| <a id="unit-test-ethers-result-proxy-3-b08xre"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE` | Listener lifecycle             | Register through every supported add verb, emit Result and event-log arguments, then remove through both supported remove verbs, including duplicate registration | Arguments normalize; once/prepend semantics hold; event-log prototype survives; the original callback removes every matching registration one at a time | <a id="unit-test-ethers-result-proxy-3-b08xre.p1"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P1` — `on` argument and event-log conversion; <a id="unit-test-ethers-result-proxy-3-b08xre.p2"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P2` — `once`; <a id="unit-test-ethers-result-proxy-3-b08xre.p3"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P3` — `addListener`; <a id="unit-test-ethers-result-proxy-3-b08xre.p4"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P4` — `prependListener`; <a id="unit-test-ethers-result-proxy-3-b08xre.p5"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P5` — `prependOnceListener`; <a id="unit-test-ethers-result-proxy-3-b08xre.p6"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P6` — `off` with original callback; <a id="unit-test-ethers-result-proxy-3-b08xre.p7"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P7` — repeated `removeListener` with original callback |
| <a id="unit-test-ethers-result-proxy-4-4ykw7t"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T` | Query and passthrough boundary | Invoke `queryFilter`, ordinary methods, and ordinary properties through the proxy                                                                                 | Every returned event log normalizes with its prototype intact; non-array query results and unrelated surface members pass through unchanged             | <a id="unit-test-ethers-result-proxy-4-4ykw7t.p1"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T.P1` — event-log array conversion; <a id="unit-test-ethers-result-proxy-4-4ykw7t.p2"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T.P2` — non-array query result passthrough; <a id="unit-test-ethers-result-proxy-4-4ykw7t.p3"></a>`UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T.P3` — ordinary method/property passthrough                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Related source reports

- Consumers per the views.
