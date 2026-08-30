# LocalP2pSigner.ts — Source Report

> **Source:** [src/evm/signer/LocalP2pSigner.ts](../../../../../../../src/evm/signer/LocalP2pSigner.ts) > **Status:** Authored — engineer verification pending.
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

In addition to the existing host-side signing surface, `joinLobby(topic, options)` owns the complete
host workflow: match one authenticated peer, start guarded negotiation, retry unsigned failures, leave
the topic after chain-observed opening, and return the opened channel ID and peer address. Matching has
no default deadline; the caller may pass a finite `matchTimeoutMs`. `leaveLobby` delegates the phase
decision to matching: it returns `true` and settles the pending join only before commitment, or `false`
after handoff without cancelling negotiation or chain observation. The caller must supply an exact
32-byte topic; the signer supplies no default.
`connectToChannel` rejects while a lobby topic or discovery lifecycle is active, so targeted channel
selection cannot silently abandon or overlap the lobby session.

The inline signer facade: local key-backed signing plus the join-collection entry (`collectJoinChannelConfirmation` via the service).

## Key design decisions

1. **One facade for signing + protocol collection** so integrators never touch services directly.
2. **Host-owned composition** keeps live profiles, attempts, timers, and retry state out of the runtime port.

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

| Source file                                                                | Specification IDs                                                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [LocalP2pSigner.ts](../../../../../../../src/evm/signer/LocalP2pSigner.ts) | [`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) |

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

- [identity.md](../../../../../specification/protocol-model/identity.md), [P2pRuntimeHost](../p2pRuntime/P2pRuntimeHost.ts.md).
