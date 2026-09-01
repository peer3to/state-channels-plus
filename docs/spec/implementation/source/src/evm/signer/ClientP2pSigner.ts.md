# ClientP2pSigner.ts — Source Report

> **Source:** [src/evm/signer/ClientP2pSigner.ts](../../../../../../../src/evm/signer/ClientP2pSigner.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

## Responsibility and observable boundary

The client-side signer facade in isolated deployments: forwards signing/collection to the host's `p2pSigner` service over the runtime endpoint — the key never leaves the host.

## Key design decisions

1. **Signing requests cross the boundary; keys do not** ([`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

| Source file                                                                  | Specification IDs                                                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [ClientP2pSigner.ts](../../../../../../../src/evm/signer/ClientP2pSigner.ts) | [`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Signing confinement per the identity rules.

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [identity.md](../../../../../specification/protocol-model/identity.md), [P2pRuntimeHost](../p2pRuntime/P2pRuntimeHost.ts.md).
