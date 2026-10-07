# RuntimeChainContext.ts — Source Report

> **Source:** [src/evm/p2pRuntime/RuntimeChainContext.ts](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md), [runtime/chain-observation.md](../../../../views/runtime/chain-observation.md)

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

Creates the host-owned chain provider and signer. It resolves the ordered RPC endpoint list ([resolveProviderUrls](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L49)): PROVIDER_URLS, or the single PROVIDER_URL when that list is unset or empty. It opens one [RpcNodeProvider](rpcNodes/RpcNodeProvider.ts.md) per endpoint, sharing one expected chain id. Creation returns as soon as one endpoint connected, leaving the others connecting in the background, and fails, naming every endpoint by scheme and host only and destroying every node, when no first attempt connected ([createRuntimeChainContext](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L79)). The returned [MultiRpcProvider](rpcNodes/MultiRpcProvider.ts.md) and its signer stay within the host.

## Key design decisions

HTTP provider URLs are converted to their WebSocket equivalent, for every listed endpoint, and each URL must parse without a fragment; a rejected URL is named by scheme and host only. `LOG_QUERY_MAX_BLOCKS` is [checked](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L86) to be a positive integer first, so a window size that could never cover a range fails startup instead of the first catch-up. The wallet is derived before any node opens, so an invalid signing key leaves no connection behind. Socket startup errors of every endpoint reject creation, with node cleanup before the failure returns; one reachable endpoint is enough to start.

The host calls the standard ethers `destroy()` without first removing provider listeners. Ethers owns subscription cleanup. There is no extra subscription registry, drain promise or stored subscription-error history.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------- |
| Inputs       | Runtime provider URL list (or single URL), log window size and signer secret.                      |
| Outputs      | A verified provider and its connected wallet.                                                      |
| Owned state  | The ethers provider and connected signer.                                                          |
| Side effects | Opens a socket, subscribes through ethers, removes listeners and closes the socket on destruction. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                              | Specification IDs                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [RuntimeChainContext.ts](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-CHAINOBS-1-5JTHY8`](../../../../../specification/runtime/chain-observation.md#req-chainobs-1-5jthy8) |

## Assumptions, dependencies, trust boundaries, and limits

- Uses the ethers provider API. Caller-supplied contexts remain owned by their caller; this constructor creates an owned context.

## Specification adherence

- Host creation does not finish before its provider is usable. Host cleanup calls the provider’s standard destruction.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                    | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Gap / divergence |
| ---------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-CHAINOBS-1-5JTHY8`](../../../../../specification/runtime/chain-observation.md#req-chainobs-1-5jthy8) | Covered               | **Here:** [resolveProviderUrls](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L49) keeps list order and validates each entry; [createRuntimeChainContext](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L79) starts once one endpoint connected and fails, naming each endpoint without its path or query, when none did. **Other files:** [RpcNodeProvider](rpcNodes/RpcNodeProvider.ts.md) keeps reconnecting the unreachable ones; [config](../../utils/config.ts.md) declares PROVIDER_URLS. | —                |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                    | Obligation                           | Public entry and setup                                                                        | Oracle and forbidden effects                                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-runtime-chain-cleanup-1-3h7pt8"></a>`UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8` | Provider cleanup                     | Real runtime construction and public cleanup.                                                 | The provider closes, has no listeners and permits repeated destruction.                                                              | <a id="unit-test-runtime-chain-cleanup-1-3h7pt8.p3"></a>`UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8.P3` — Cleanup without subscriptions.; <a id="unit-test-runtime-chain-cleanup-1-3h7pt8.p4"></a>`UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8.P4` — Cleanup with a block subscription.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| <a id="unit-test-runtime-chain-urls-1-vrhevw"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW`       | Endpoint list resolution and startup | Pure resolution of config values; real startup against private nodes behind cuttable proxies. | Resolved URLs equal the hand-written list in order; startup succeeds with one reachable endpoint and fails naming each when none is. | <a id="unit-test-runtime-chain-urls-1-vrhevw.p1"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P1` — list unset; <a id="unit-test-runtime-chain-urls-1-vrhevw.p2"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P2` — list empty; <a id="unit-test-runtime-chain-urls-1-vrhevw.p3"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P3` — ordered list; <a id="unit-test-runtime-chain-urls-1-vrhevw.p4"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P4` — invalid entry; <a id="unit-test-runtime-chain-urls-1-vrhevw.p5"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P5` — one of two unreachable; <a id="unit-test-runtime-chain-urls-1-vrhevw.p6"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P6` — none reachable, endpoints named without path or query; <a id="unit-test-runtime-chain-urls-1-vrhevw.p7"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P7` — a silent endpoint does not delay startup; <a id="unit-test-runtime-chain-urls-1-vrhevw.p8"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P8` — endpoint with a fragment rejected, named by scheme and host; <a id="unit-test-runtime-chain-urls-1-vrhevw.p9"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P9` — endpoint with an out-of-range port rejected without its secret; <a id="unit-test-runtime-chain-urls-1-vrhevw.p10"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P10` — startup over a malformed endpoint opens no node; <a id="unit-test-runtime-chain-urls-1-vrhevw.p11"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P11` — invalid signing key opens no node; <a id="unit-test-runtime-chain-urls-1-vrhevw.p12"></a>`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P12` — a `LOG_QUERY_MAX_BLOCKS` of zero or a fraction rejects startup and opens no node. |

## Related source reports

- [P2pRuntimeHostRoot](../../rpc/internal/roots/P2pRuntimeHostRoot.ts.md), [MultiRpcProvider](rpcNodes/MultiRpcProvider.ts.md), [RpcNodeProvider](rpcNodes/RpcNodeProvider.ts.md).
