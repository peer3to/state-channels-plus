# RuntimeChainContext.ts — Source Report

> **Source:** [src/evm/p2pRuntime/RuntimeChainContext.ts](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

Creates the host-owned WebSocket provider and signer. Creation waits for a reachable network; cleanup uses the standard ethers provider destruction. The returned provider and signer stay within the host.

## Key design decisions

HTTP provider URLs are converted to their WebSocket equivalent. Socket startup errors reject creation, with provider cleanup before the failure returns.

The host calls the standard ethers `destroy()` without first removing provider listeners. Ethers owns subscription cleanup. There is no extra subscription registry, drain promise or stored subscription-error history.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------- |
| Inputs       | Runtime provider URL and signer secret.                                                            |
| Outputs      | A verified provider and its connected wallet.                                                      |
| Owned state  | The ethers provider and connected signer.                                                          |
| Side effects | Opens a socket, subscribes through ethers, removes listeners and closes the socket on destruction. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                              | Specification IDs                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [RuntimeChainContext.ts](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) |

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

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                    | Obligation       | Public entry and setup                        | Oracle and forbidden effects                                            | Required permutations                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-runtime-chain-cleanup-1-3h7pt8"></a>`UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8` | Provider cleanup | Real runtime construction and public cleanup. | The provider closes, has no listeners and permits repeated destruction. | <a id="unit-test-runtime-chain-cleanup-1-3h7pt8.p3"></a>`UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8.P3` — Cleanup without subscriptions.; <a id="unit-test-runtime-chain-cleanup-1-3h7pt8.p4"></a>`UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8.P4` — Cleanup with a block subscription. |

## Related source reports

- [P2pRuntimeHostRoot](../../rpc/internal/roots/P2pRuntimeHostRoot.ts.md).
