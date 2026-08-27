# localDiamond.ts — Source Report

> **Source:** [src/utils/localDiamond.ts](../../../../../../src/utils/localDiamond.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../views/architecture/contracts/manager-and-facets.md), [architecture/sdk/components.md](../../../views/architecture/sdk/components.md)

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

The client-side binding of the deployed local mirror. It publishes three things:
`LocalDiamondContract` — the mirror as callers see it, `LocalDiamond & StateChannelManagerInterface`
([#L23](../../../../../../src/utils/localDiamond.ts#L23)); `localDiamondAbi` — the de-duplicated
union of both generated ABIs ([#L52](../../../../../../src/utils/localDiamond.ts#L52)); and
`connectLocalDiamond(address, runner)` — an `ethers.Contract` bound to that merged ABI
([#L57](../../../../../../src/utils/localDiamond.ts#L57)).

It performs no protocol logic and reads no protocol state. Its whole job is that every predicate
the SDK evaluates locally is reachable **on the deployed mirror**, so no caller is forced to
re-implement one in TypeScript. Every `localDiamondContract.*` call in the SDK
([ADiamondStateMachine](../ADiamondStateMachine.ts.md) owns the field) resolves through this ABI.

## Key design decisions

1. **Both ABIs are required, because the mirror's own ABI is incomplete by design.**
   `StateChannelManagerProxy` routes most selectors to facets through its fallback, so those
   functions never appear in `LocalDiamond`'s generated ABI even though the deployed contract
   answers them. `LocalDiamond__factory.abi` alone reaches only the local-only surface; the routed
   surface comes from `StateChannelManagerInterface__factory.abi`
   ([#L52](../../../../../../src/utils/localDiamond.ts#L52)).
2. **Fragments are keyed by `type:sighash`, and the first definition wins.** The two ABIs overlap —
   every inherited `StateChannelManagerEvents` event, and `isBlockAuthentic`, which
   [LocalDiamond](../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md) declares itself
   so the debug override dispatches before the fallback while
   [StateChannelManagerInterface](../../contracts/V1/StateChannelManagerInterface.sol.md) declares
   it as routed. `mergeAbis` de-duplicates on that key
   ([#L40](../../../../../../src/utils/localDiamond.ts#L40)–[#L45](../../../../../../src/utils/localDiamond.ts#L45));
   without it `ethers.Interface` would reject the ambiguous ABI. Overlapping fragments are
   signature-identical, so which of the two objects survives is not externally observable — the
   guarantee is that exactly one survives.
3. **The intersection type is the caller-facing contract, not a re-declaration.** `LocalDiamond &
   StateChannelManagerInterface` reuses both generated typechain types instead of restating any
   signature, so a Solidity change propagates into every call site through `tsc`
   ([#L23](../../../../../../src/utils/localDiamond.ts#L23)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | The two generated typechain ABIs; a deployed mirror address and an ethers `ContractRunner` (or `null`).                                                          |
| Outputs      | `LocalDiamondContract` (the bound contract), `localDiamondAbi` (merged fragments), and the `LocalDiamondContract` type.                                          |
| Owned state  | One module-level constant, `localDiamondAbi`, computed once at import.                                                                                          |
| Side effects | None. No chain call is issued here — `connectLocalDiamond` only constructs the binding; the calls are made by its consumers.                                     |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                       | Specification IDs                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [localDiamond.ts](../../../../../../src/utils/localDiamond.ts)     | [`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778), [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) |

Contribution per ID: [`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) — makes every mirrored predicate callable on the deployed
mirror, which is the precondition for evaluating predicates through the mirror instead of
re-implementing them client-side; [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) — presents the manager's whole external
surface at one address to the client, regardless of how the deployment decomposes it.

## Assumptions, dependencies, trust boundaries, and limits

- **Depends on generated artifacts.** Both ABIs come from typechain output; a stale `typechain-types`
  produces a binding that silently lacks a selector. The build regenerates them.
- **`StateChannelManagerInterface` must stay a superset of the routed surface.** Nothing implements
  that abstract contract, so only review and the routing test keep it in step with
  `_facetForSelector`; a declaration missing there is unreachable from here.
- **No trust boundary.** The mirror is a local, client-owned deployment; its answers are a cache and
  never authority ([`REQ-MIRROR-3-THD7K8`](../../../../specification/enforcement/local-mirror.md#req-mirror-3-thd7k8), owned by its callers).
- **Limit:** the merge is by signature only. Two different fragments with the same `type:sighash`
  are indistinguishable here, and the first (the `LocalDiamond` one) wins by construction.
- **Platform-neutral.** It imports only `ethers` and generated types, so it compiles for both the
  node and browser builds.

## Specification adherence

- Keeps predicate evaluation on the deployed mirror rather than in TypeScript, which is the
  mechanism [`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) requires.
- Adds no protocol behavior, no state, and no validation, so it cannot relax any check.

## Specification contradictions

None demonstrated.

## Missing behavior

- **No startup reconciliation of the merged ABI against the deployed code.** If a routed selector is
  declared on `StateChannelManagerInterface` but absent from the proxy's routing table, a call made
  through this binding falls through to the consumer facet instead of failing loudly. The
  drift is caught in the contracts by the routing test
  ([`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P21`](../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p21)), not here.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                     | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                | Gap / divergence                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)           | Partial               | **Here:** the merged ABI makes every routed predicate reachable on the mirror ([#L52](../../../../../../src/utils/localDiamond.ts#L52)), and the binding is typed by the generated contracts ([#L23](../../../../../../src/utils/localDiamond.ts#L23)). **Other files:** [LocalDiamond](../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md) is the mirror; [EvmDiamondStateMachine](../evm/EvmDiamondStateMachine.ts.md) constructs it; the predicate callers are the dispute and validation services. | Reachability only — this file cannot show that callers actually use the mirror instead of a local re-implementation; that judgment stays with each calling report.        |
| [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) | Partial               | **Here:** one address exposes the union of the proxy-implemented and routed surfaces ([#L52](../../../../../../src/utils/localDiamond.ts#L52)). **Other files:** [StateChannelManagerProxy](../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md) owns the routing that makes the boundary stable; [StateChannelManagerInterface](../../contracts/V1/StateChannelManagerInterface.sol.md) declares it. | Local mirror only; the production binding is `StateChannelManagerInterface__factory.connect` in [EvmDiamondStateMachine](../evm/EvmDiamondStateMachine.ts.md).             |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                        | Obligation                                        | Public entry and setup                                                                                                                                              | Oracle and forbidden effects                                                                                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-local-diamond-binding-1-w8atc1"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1`     | Merged mirror ABI and binding                     | `localDiamondAbi` and `connectLocalDiamond(address, runner)`, both against the generated ABIs alone and against a `LocalDiamond` deployed by the real deployment helper; no hand-written ABI, no stubbed runner | Every fragment of both generated ABIs is present exactly once; a routed selector and a `LocalDiamond`-only selector each encode identically to their own generated interface and each answer on the deployed mirror; a `null` runner yields a read-only binding at the given address; no duplicate-fragment construction error | <a id="unit-test-local-diamond-binding-1-w8atc1.p1"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P1` — merged ABI carries every fragment of both generated ABIs; <a id="unit-test-local-diamond-binding-1-w8atc1.p2"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P2` — a signature declared by both ABIs yields exactly one fragment; <a id="unit-test-local-diamond-binding-1-w8atc1.p3"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P3` — a routed facet selector encodes through the binding exactly as the interface ABI encodes it; <a id="unit-test-local-diamond-binding-1-w8atc1.p4"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P4` — a `LocalDiamond`-only selector encodes through the binding exactly as `LocalDiamond`'s own ABI encodes it; <a id="unit-test-local-diamond-binding-1-w8atc1.p5"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P5` — `connectLocalDiamond` with a `null` runner builds a read-only binding at the given address; <a id="unit-test-local-diamond-binding-1-w8atc1.p6"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P6` — a routed facet view answers on the deployed mirror through the binding; <a id="unit-test-local-diamond-binding-1-w8atc1.p7"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P7` — a `LocalDiamond`-only handler executes on the deployed mirror through the binding |

## Related source reports

- [ADiamondStateMachine.ts](../ADiamondStateMachine.ts.md) — owns the `localDiamondContract` field this type describes.
- [EvmDiamondStateMachine.ts](../evm/EvmDiamondStateMachine.ts.md) — the only caller of `connectLocalDiamond`.
- [LocalDiamond.sol](../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md) — the deployed mirror.
- [StateChannelManagerInterface.sol](../../contracts/V1/StateChannelManagerInterface.sol.md) — the routed half of the merged ABI.
- [index.ts](./index.ts.md) — re-exports this module.
