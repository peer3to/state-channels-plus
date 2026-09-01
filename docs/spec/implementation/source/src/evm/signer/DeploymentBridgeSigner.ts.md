# DeploymentBridgeSigner.ts — Source Report

> **Source:** [src/evm/signer/DeploymentBridgeSigner.ts](../../../../../../../src/evm/signer/DeploymentBridgeSigner.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

## Responsibility and observable boundary

Deployment-time bridge signer (mirror deployment paths): calls the host's `deploySigner` service; a deploy reply is the mined transaction.

## Linked requirements

| Source file                                                                                | Specification IDs                                                                            |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| [DeploymentBridgeSigner.ts](../../../../../../../src/evm/signer/DeploymentBridgeSigner.ts) | [`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) |

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
