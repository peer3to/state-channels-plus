# HostNonceManager.ts — Source Report

> **Source:** [src/evm/signer/HostNonceManager.ts](../../../../../../../src/evm/signer/HostNonceManager.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

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

Host-side nonce management for chain submissions (serializes nonce allocation), and the one point
where the peer's chain spending is observed.

## Key design decisions

1. **Nonce allocation is host-owned** so concurrent submitters cannot race nonces.
2. **Gas headroom on every estimate.** `estimateGas` returns the wrapped wallet's estimate plus
   [`withGasHeadroom`](../../utils/gas.ts.md), and a send without a caller gas limit uses it. Every
   peer's chain transaction passes here, including client-mode sends forwarded by
   [ClientChainSigner](./ClientChainSigner.ts.md), so no caller sets a fixed limit.
3. **Gas is observed here because every real-chain transaction of the peer passes here.** The
   worker-side signers reach the chain through the chain-signer runtime service, which sends
   through this manager, and the host-side manager contract and dispute retries are bound to it
   too. `sendTransaction` overrides `AbstractSigner.sendTransaction` as a thin wrapper: it
   broadcasts through `sendWithOwnedNonce`, hands the response to the recorder and returns it
   unchanged, so nonce handling stays in `sendWithOwnedNonce`. A response recovered from the node
   after a failed broadcast is observed like any other; a broadcast that fails with nothing on the
   node rejects before anything is observed.
4. **The recorder is created with the signer** — it lives exactly as long as the signer whose
   transactions it counts, and every reader reaches the same instance through it. The signer's
   owner disposes it through the same field when the chain connection goes away.

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

| Source file                                                                    | Specification IDs                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [HostNonceManager.ts](../../../../../../../src/evm/signer/HostNonceManager.ts) | [`REQ-SDK-ARCH-5-AAM7YK`](../../../../../specification/runtime/sdk.md#req-sdk-arch-5-aam7yk), [`REQ-SDK-ARCH-6-8DE4ER`](../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er) — the single producer of gas usage records. |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Signing confinement per the identity rules.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                      | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                  | Gap / divergence                                             |
| -------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`REQ-SDK-ARCH-6-8DE4ER`](../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er) | Partial               | **Here:** the observation point and the owned recorder in [sendTransaction](../../../../../../../src/evm/signer/HostNonceManager.ts#L78). **Other files:** [GasUsageRecorder.ts](../gasUsage/GasUsageRecorder.ts.md) waits for the receipt, [GasUsageTable.ts](../gasUsage/GasUsageTable.ts.md) aggregates, and [P2pRuntimeHostRoot.ts](../../rpc/internal/roots/P2pRuntimeHostRoot.ts.md) reports the table on disposal. | Exposure to callers is the client signer's, not this file's. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [identity.md](../../../../../specification/protocol-model/identity.md), [P2pRuntimeHost](../../rpc/internal/roots/P2pRuntimeHostRoot.ts.md), [GasUsageRecorder.ts](../gasUsage/GasUsageRecorder.ts.md).
