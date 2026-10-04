# index.ts — Source Report

> **Source:** [src/index.ts](../../../../../src/index.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../views/architecture/sdk/components.md)

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

The package's public export surface, including the supported deployed-manager ABI helpers, the
structured contract-size error classes and limits thrown by exported deployment functions, and the
`GasUsageRow` row type a consumer reads a peer's chain spending as.

## Key design decisions

The network service base is exported only as `ANetworkRpcService`. The old `ARpcService` alias is removed by engineer decision; callers use the explicit network name.

The standalone createContractExecutorFactory and ContractExecutorFactoryOptions package exports are removed. Executor creation is internal to SDK setup and requires its owning endpoint. Unrelated exports retain their existing public contracts; the replacement internal factory and owner endpoint are not exported here. See [createContractExecutor.ts](evm/contractExecutor/createContractExecutor.ts.md).

1. Public deployment failures and their error constructors are exported from the same package root,
   so consumers can use `instanceof ContractSizeLimitError` without a private path import.
   The same export block ([#L107-L113](../../../../../src/index.ts#L107-L113)) also exports the
   runtime-size check `assertArtifactRuntimeSize` from [contractSize](utils/contractSize.ts.md), so a
   consumer's own build can refuse an oversized artifact with the SDK's EIP-170 rule instead of a
   copy of it.
2. **Host-only guard is public.** `LocalOnlyGuard` is exported beside `HandshakeCompletedGuard`
   ([#L14](../../../../../src/index.ts#L14), [#L68](../../../../../src/index.ts#L68)) so poker and other consumers install the SDK guard instead of a
   copy. Its behavior is owned by [LocalOnlyGuard](rpc/network/guards/LocalOnlyGuard.ts.md).
3. **Local construction contexts are public types.** `CustomRpcContext` ([#L26](../../../../../src/index.ts#L26)) and
   `EvmCustomPrecompileContext` ([#L41](../../../../../src/index.ts#L41)) type the local owner a custom RPC constructor and a
   custom precompile factory receive ([registry](rpc/network/registry.ts.md),
   [EvmFactory](evm/EvmFactory.ts.md)). Both are type-only exports; no owner value crosses this entry.
4. **Generic root bases and creation are public; concrete owners are not.** The entry exports the
   generic `AInternalRpcRoot` with the `RuntimeConnection` type, `AInternalRpcService`,
   `AInternalRpcMethods`, `createRoot`, `startRootWorker`, the `RootConstructor`/`RootStartContext`
   types, and the `RemoteRoot`, `InternalRpcRouter`, and `InternalTransport` types
   ([#L124-L140](../../../../../src/index.ts#L124-L140)), so a consumer can define its own roots and create them inline, as a
   worker under an explicit local owner, or as a parentless worker ([createRoot](rpc/internal/createRoot.ts.md)).
   The concrete SDK roots (`P2pRuntimeHostRoot`, `ContractExecutorRoot`, the client and bridge roots)
   and their internal creation helpers are still not exported: a consumer obtains a parent only as the
   exact owner passed through its construction context, never by constructing or looking up an SDK root.
   The one exception is test-only: the separate, published `./test-harness` entry
   ([test-harness.ts#L15-L17](../../../../../test-harness.ts#L15-L17)) re-exports `P2pRuntimeHostRoot` so test
   fixtures can type the concrete host, and `RootCreationControl`, whose observation hook sees every root
   created while it is active. A consumer importing it runs in the SDK's own process, so the residual
   risk is local only ([security assessment](../../../audit/security-assessment.md#host-only-guard-local-owners-parentless-workers-and-executor-drain--2026-09-29)).
   This public entry still keeps every concrete root private.
5. **Client-side helpers a consumer needs to drive a runtime are public.** The entry exports the
   status predicate `isCommittedParticipantStatus` and the wait helper `timeoutWaitTime` with its
   `TimeConfig` type ([#L73-L78](../../../../../src/index.ts#L73-L78)), the `P2pInstance` and
   `P2pSetupOptions` types ([#L79-L80](../../../../../src/index.ts#L79-L80)), the `OwnJoinState`
   type of the own-join reading ([#L92](../../../../../src/index.ts#L92)), and `errorMessage`
   ([#L102](../../../../../src/index.ts#L102)). A consumer such as the poker client uses the SDK's
   own status rule, wait bound, and error text instead of a copy. Their behavior is owned by
   [flags](types/flags.ts.md), [time](types/time.ts.md), [P2pInstance](evm/P2pInstance.ts.md),
   [MembershipService](stateManager/membership/MembershipService.ts.md), and
   [errorMessage](utils/errorMessage.ts.md); this entry only re-exports them.

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

| Source file                             | Specification IDs                                                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [index.ts](../../../../../src/index.ts) | [`REQ-RPC-7-9CBSHK`](../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk), [`REQ-RUNTIME-3-VQXW59`](../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk): exports the host-only guard to consumers.
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../specification/runtime/execution.md#req-runtime-3-vqxw59): exports the generic root creation surface and the local owner-context types; lifecycle behavior stays with their owners.

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.

## Specification adherence

- Role-consistent with the owning views; no divergence observed at this file's boundary.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Gap / divergence |
| ------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-7-9CBSHK`](../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)    | Covered               | **Here:** public `LocalOnlyGuard` export ([#L68](../../../../../src/index.ts#L68)). **Other files:** host-only admission, punishment, and suppression in [LocalOnlyGuard](rpc/network/guards/LocalOnlyGuard.ts.md); bypass and response dispatch in [ANetworkRpcService](rpc/network/ANetworkRpcService.ts.md).                                                                                                                                                                                                      | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** generic root and creation exports ([#L124-L140](../../../../../src/index.ts#L124-L140)) and the local context types ([#L26](../../../../../src/index.ts#L26), [#L41](../../../../../src/index.ts#L41)). **Other files:** creation, parentless workers, and cleanup in [createRoot](rpc/internal/createRoot.ts.md); owner passing in [P2pRuntimeHostRoot](rpc/internal/roots/P2pRuntimeHostRoot.ts.md) and [ContractExecutorService](rpc/internal/services/contractExecutor/ContractExecutorService.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- Exported modules' reports, including [LocalOnlyGuard](rpc/network/guards/LocalOnlyGuard.ts.md), [registry](rpc/network/registry.ts.md), [EvmFactory](evm/EvmFactory.ts.md), [AInternalRpcRoot](rpc/internal/AInternalRpcRoot.ts.md), [createRoot](rpc/internal/createRoot.ts.md), and [RemoteRoot](rpc/internal/RemoteRoot.ts.md).
