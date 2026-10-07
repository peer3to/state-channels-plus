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

The client-side binding of the deployed local mirror, and the policy for reading it before the
chain. It publishes four things:
`LocalDiamondContract` — the mirror as callers see it, `LocalDiamond & StateChannelManagerInterface`
([#L17](../../../../../../src/utils/localDiamond.ts#L17)); `localDiamondAbi` — the de-duplicated
union of both generated ABIs ([#L20](../../../../../../src/utils/localDiamond.ts#L20));
`connectLocalDiamond(address, runner)` — an `ethers.Contract` bound to that merged ABI
([#L25](../../../../../../src/utils/localDiamond.ts#L25)); and `preferLocal(local, onChain, acceptLocal)` — run a read on the
mirror, keep the answer when `acceptLocal` accepts it, and otherwise return the chain's answer; a thrown local error propagates ([#L44](../../../../../../src/utils/localDiamond.ts#L44)).

It performs no protocol logic and reads no protocol state itself; `preferLocal` only sequences two
reads its caller supplies, and the caller decides which answer is safe to accept unconfirmed. Its whole job is that every predicate
the SDK evaluates locally is reachable **on the deployed mirror**, so no caller is forced to
re-implement one in TypeScript. Every `localDiamondContract.*` call in the SDK
([ADiamondStateMachine](../ADiamondStateMachine.ts.md) owns the field) resolves through this ABI.

## Key design decisions

1. **Both ABIs are required, because the mirror's own ABI is incomplete by design.**
   `StateChannelManagerProxy` routes most selectors to facets through its fallback, so those
   functions never appear in `LocalDiamond`'s generated ABI even though the deployed contract
   answers them. `LocalDiamond__factory.abi` alone reaches only the local-only surface; the routed
   surface and full manager error vocabulary come from `stateChannelManagerAbi`.
2. **The shared ABI helper owns merge semantics.** Fragments are keyed by `type:sighash`, and the
   first definition wins. The two ABIs overlap because
   [LocalDiamond](../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md) inherits
   `StateChannelManagerProxy`: every `StateChannelManagerEvents` event and the functions the proxy
   declares itself (`open`, `multicall`, `postBlockCalldata`, `executeStateTransition`,
   `depositAssetsComposable`, `withdrawAssetsComposable`, `facetAddressForSelector`) appear in both
   `LocalDiamond`'s ABI and
   [StateChannelManagerInterface](../../contracts/V1/StateChannelManagerInterface.sol.md). The
   local-only surface — the `on*` event handlers and the mirror helpers — has no counterpart in the
   interface ABI and is carried once. `contractAbi.mergeAbis` de-duplicates on that key;
   without it `ethers.Interface` would reject the ambiguous ABI. Overlapping fragments are
   signature-identical, so which of the two objects survives is not externally observable — the
   guarantee is that exactly one survives.
3. **The intersection type is the caller-facing contract, not a re-declaration.** `LocalDiamond &
StateChannelManagerInterface` reuses both generated typechain types instead of restating any
   signature, so a Solidity change propagates into every call site through `tsc`
   ([#L17](../../../../../../src/utils/localDiamond.ts#L17)).
4. **Local first, the chain confirms the adverse answer.** The mirror follows the chain through the
   event pipeline and can lag it, so its answer is kept only when `acceptLocal` says acting on it
   unconfirmed is safe ([#L51](../../../../../../src/utils/localDiamond.ts#L51)); every other answer is re-read on the chain, and the
   chain's answer is returned as is. The acceptance rule is the caller's, because only the caller
   knows which answer stakes the node ([`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)).
5. **Thrown failures propagate.** `preferLocal` awaits the local read directly. A thrown
   contract revert, executor failure or acceptance-callback error escapes without calling the
   chain. Only a completed local answer rejected by `acceptLocal` invokes the chain; its errors
   also propagate.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | The two generated typechain ABIs; a deployed mirror address and an ethers `ContractRunner` (or `null`); for `preferLocal`, a local read, a chain read, and the caller's acceptance rule. |
| Outputs      | `LocalDiamondContract` (the bound contract), `localDiamondAbi` (merged fragments), the `LocalDiamondContract` type, and `preferLocal`'s chosen answer.                                   |
| Owned state  | One module-level constant, `localDiamondAbi`, computed once at import.                                                                                                                   |
| Side effects | None of its own. `connectLocalDiamond` only constructs the binding; `preferLocal` invokes the caller's local read and, when needed, the caller's chain read.                             |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                    | Specification IDs                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [localDiamond.ts](../../../../../../src/utils/localDiamond.ts) | [`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778), [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390), [`REQ-MIRROR-4-H9C4YS`](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys) |

Contribution per ID: [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) — makes every mirrored predicate callable on the deployed
mirror, which is the precondition for evaluating predicates through the mirror instead of
re-implementing them client-side; [`REQ-CONTRACT-ARCH-1-9W5390` (Stable external boundary)](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) — presents the manager's whole external
surface at one address to the client, regardless of how the deployment decomposes it;
[`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys) — the shared mechanism: mirror first, chain for every answer the
caller does not accept, propagation of all local failures including reverts. Which answer
is safe is decided by each calling report.

## Assumptions, dependencies, trust boundaries, and limits

- **Depends on generated artifacts.** Both ABIs come from typechain output; a stale `typechain-types`
  produces a binding that silently lacks a selector. The build regenerates them.
- **`StateChannelManagerInterface` must stay a superset of the routed surface.** Nothing implements
  that abstract contract, so only review and the routing test keep it in step with
  `_facetForSelector`; a declaration missing there is unreachable from here.
- **No trust boundary.** The mirror is a local, client-owned deployment; its answers are a cache and
  never authority — `preferLocal` returns an unconfirmed mirror answer only when the caller's rule accepts it ([`REQ-MIRROR-3-THD7K8` (Cache, never authority)](../../../../specification/enforcement/local-mirror.md#req-mirror-3-thd7k8), owned by its callers).
- **Limit:** the merge is by signature only. Two different fragments with the same `type:sighash`
  are indistinguishable here, and the first (the `LocalDiamond` one) wins by construction.
- **Local failures propagate unchanged.** No message-based classification converts a local error into a chain fallback.
- **Platform-neutral.** It imports only `ethers`, generated types, and the shared error helpers,
  so it compiles for both the node and browser builds.

## Specification adherence

- Keeps predicate evaluation on the deployed mirror rather than in TypeScript, which is the
  mechanism [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) requires.
- Adds no protocol behavior, no state, and no validation, so it cannot relax any check.
- `preferLocal` returns the chain's answer for every answer its caller does not accept, and
  propagates every local failure, including a revert, without a chain read
  ([`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)).

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

| Requirement / invariant                                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Gap / divergence                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)            | Covered               | **Here:** the merged ABI makes every routed predicate reachable on the mirror ([#L20](../../../../../../src/utils/localDiamond.ts#L20)), and the binding is typed by the generated contracts ([#L17](../../../../../../src/utils/localDiamond.ts#L17)). **Other files:** [LocalDiamond](../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md) is the mirror; [EvmDiamondStateMachine](../evm/EvmDiamondStateMachine.ts.md) constructs it; the predicate callers are the dispute and validation services. The signature carve-out owner is [SignerRecoveryCache](../cache/SignerRecoveryCache.ts.md) (contract signature acceptance rule); block decoding is client-side `Codec` and is the open deviation [`FIND-DECODE-1-FD1V6V`](../../../../audit/open-findings.md#find-decode-1-fd1v6v), owned by [Block](../models/Block.ts.md). | None; each caller's report judges its own use of the mirror.                                                                               |
| [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) | Partial               | **Here:** one address exposes the union of the proxy-implemented and routed surfaces ([#L20](../../../../../../src/utils/localDiamond.ts#L20)). **Other files:** [StateChannelManagerProxy](../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md) owns the routing that makes the boundary stable; [StateChannelManagerInterface](../../contracts/V1/StateChannelManagerInterface.sol.md) declares it.                                                                                                                                                                                                                                                                                                                                                                                                                    | Local mirror only; production manager addresses use `connectStateChannelManager` from [stateChannelManager.ts](stateChannelManager.ts.md). |
| [`REQ-MIRROR-4-H9C4YS`](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)            | Covered               | **Here:** `preferLocal` keeps an accepted local answer with no chain read ([#L51](../../../../../../src/utils/localDiamond.ts#L51)), re-reads the chain for every other returned answer ([#L53](../../../../../../src/utils/localDiamond.ts#L53), [#L55](../../../../../../src/utils/localDiamond.ts#L55)), and rethrows every local failure, including a revert, without a chain read ([#L53](../../../../../../src/utils/localDiamond.ts#L53)). **Other files:** the acceptance rule per decision — [DisputeValidationService](../stateManager/dispute/DisputeValidationService.ts.md) (audit predicates, timeout-calldata proof, state-proof check) and [DisputeManager](../disputeManager/DisputeManager.ts.md) (auditing-data omission). Reduction and reduced-result validation read the chain only.                                       | None.                                                                                                                                      |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                    | Obligation                           | Public entry and setup                                                                                                                                                                                                                                                                                                                                                                                | Oracle and forbidden effects                                                                                                                                                                                                                                                                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-local-diamond-binding-1-w8atc1"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1` | Merged mirror ABI and binding        | `localDiamondAbi` and `connectLocalDiamond(address, runner)`, both against the generated ABIs alone and against a `LocalDiamond` deployed by the real deployment helper; no hand-written ABI, no stubbed runner                                                                                                                                                                                       | Every fragment of both generated ABIs is present exactly once; a routed selector and a `LocalDiamond`-only selector each encode identically to their own generated interface and each answer on the deployed mirror; a `null` runner yields a read-only binding at the given address; no duplicate-fragment construction error                                            | <a id="unit-test-local-diamond-binding-1-w8atc1.p1"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P1` — merged ABI carries every fragment of both generated ABIs; <a id="unit-test-local-diamond-binding-1-w8atc1.p2"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P2` — a signature declared by both ABIs yields exactly one fragment; <a id="unit-test-local-diamond-binding-1-w8atc1.p3"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P3` — a routed facet selector encodes through the binding exactly as the interface ABI encodes it; <a id="unit-test-local-diamond-binding-1-w8atc1.p4"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P4` — a `LocalDiamond`-only selector encodes through the binding exactly as `LocalDiamond`'s own ABI encodes it; <a id="unit-test-local-diamond-binding-1-w8atc1.p5"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P5` — `connectLocalDiamond` with a `null` runner builds a read-only binding at the given address; <a id="unit-test-local-diamond-binding-1-w8atc1.p6"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P6` — a routed facet view answers on the deployed mirror through the binding; <a id="unit-test-local-diamond-binding-1-w8atc1.p7"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P7` — a `LocalDiamond`-only handler executes on the deployed mirror through the binding; <a id="unit-test-local-diamond-binding-1-w8atc1.p8"></a>`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P8` — every manager error appears once in the local ABI |
| <a id="unit-test-prefer-local-1-xc95t6"></a>`UNIT-TEST-PREFER-LOCAL-1-XC95T6`                   | Local-first read with chain fallback | `preferLocal(local, onChain, acceptLocal)` with counting local and chain reads and a boolean acceptance rule; the local failure is a revert as the local signer surfaces it (synthetic, or a real `ContractExecutor` call through `LocalContractExecutorSigner`), a plain non-revert error, a real signer failure, or a non-`Error` thrown value; the chain read or the acceptance rule may also fail | The returned answer or rejection and the number of chain reads: an accepted local answer returns with zero chain reads; a rejected answer returns the chain's answer after exactly one chain read; every local failure including a revert and an acceptance-rule failure reject with that same error and zero chain reads; a chain-read failure rejects with that failure | <a id="unit-test-prefer-local-1-xc95t6.p1"></a>`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P1` — accepted local answer kept without a chain read; <a id="unit-test-prefer-local-1-xc95t6.p2"></a>`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P2` — rejected local answer replaced by the chain's answer; <a id="unit-test-prefer-local-1-xc95t6.p4"></a>`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P4` — non-revert local failure propagates without a chain read; <a id="unit-test-prefer-local-1-xc95t6.p5"></a>`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P5` — the chain read that confirms a rejected local answer fails: that failure propagates; <a id="unit-test-prefer-local-1-xc95t6.p8"></a>`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P8` — a real local signer call that never reaches the EVM fails without the revert marker and propagates with no chain read; <a id="unit-test-prefer-local-1-xc95t6.p10"></a>`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P10` — the acceptance rule throws: that failure propagates with no chain read; <a id="unit-test-prefer-local-1-xc95t6.p11"></a>`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P11` — a local EVM revert propagates as the same error with zero chain reads; <a id="unit-test-prefer-local-1-xc95t6.p12"></a>`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P12` — a real contract call reverting in the local executor propagates as the same error with zero chain reads.                                                                                                                                                |

## Related source reports

- [evmErrorHandler.ts](./evmErrorHandler.ts.md) — local executor error classification used by callers; `preferLocal` propagates errors without classification.
- [ADiamondStateMachine.ts](../ADiamondStateMachine.ts.md) — owns the `localDiamondContract` field this type describes.
- [EvmDiamondStateMachine.ts](../evm/EvmDiamondStateMachine.ts.md) — the only caller of `connectLocalDiamond`.
- [LocalDiamond.sol](../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md) — the deployed mirror.
- [StateChannelManagerInterface.sol](../../contracts/V1/StateChannelManagerInterface.sol.md) — the routed half of the merged ABI.
- [index.ts](./index.ts.md) — re-exports this module.
