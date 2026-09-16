# DeploymentBridgeSigner.ts — Source Report

> **Source:** [src/evm/signer/DeploymentBridgeSigner.ts](../../../../../../../src/evm/signer/DeploymentBridgeSigner.ts) > **Status:** Authored — engineer verification pending.
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

Deployment-time bridge signer (mirror deployment paths).

call unwraps encodedReturnData from the internal response and preserves the public ethers Promise<string> return contract.

## Key design decisions

Deployment operations select deploySigner endpoints on the bound SDK connection. Raw message/typed-data signing uses p2pSigner endpoints. Public signer behavior, deployment response reconstruction and 30-second request defaults remain unchanged. See [DeploySignerRpcMethods.ts](../../rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts.md).

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

Message signing uses the shared tagged message serializer. ABI call results remain unwrapped to the public Promise<string> contract.

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

| Source file                                                                                | Specification IDs                                                                            |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| [DeploymentBridgeSigner.ts](../../../../../../../src/evm/signer/DeploymentBridgeSigner.ts) | [`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) |

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

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [identity.md](../../../../../specification/protocol-model/identity.md), [P2pRuntimeHost](../../rpc/internal/roots/P2pRuntimeHostRoot.ts.md).
