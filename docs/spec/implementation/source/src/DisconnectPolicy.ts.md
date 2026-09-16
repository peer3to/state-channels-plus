# DisconnectPolicy.ts — Source Report

> **Source:** [src/DisconnectPolicy.ts](../../../../../src/DisconnectPolicy.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../views/architecture/sdk/rpc/README.md), [architecture/sdk/components.md](../../views/architecture/sdk/components.md)

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

The two-value vocabulary every transport close is stated in: `ALLOW` closes the connection only and
leaves the peer's standing untouched, `BLACKLIST` closes it and excludes the profile. The file holds
the enum and nothing else; the switch that acts on it lives in [P2PManager](./P2PManager.ts.md).

## Key design decisions

The enum has exactly two members and no suspended middle tier. A session-scoped bar already expresses
everything a third tier would, and it belongs to the service that owns the session rather than to the
connection layer ([`REQ-LOBBY-10-V8MA22` (Session-scoped do-not-rematch set)](../../../specification/peer-communication/lobby-matching.md#req-lobby-10-v8ma22)).

The policy is a required argument of the close entry point rather than a default, so no close can
inherit the decision of an unrelated caller.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                               |
| ------------ | ------------------------------------------------------ |
| Inputs       | None — a declarative enum.                             |
| Outputs      | The policy value passed to the disconnect entry point. |
| Owned state  | None.                                                  |
| Side effects | None; consumers own every effect.                      |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                   | Specification IDs                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [DisconnectPolicy.ts](../../../../../src/DisconnectPolicy.ts) | [`REQ-RPC-6-E60S4J`](../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) |

## Assumptions, dependencies, trust boundaries, and limits

- Declarative only: every behavioral guarantee is owned by the caller that supplies the value and by
  the switch in [P2PManager](./P2PManager.ts.md).
- The values are in-memory session policy. Durability of an exclusion across a restart is undecided
  ([`OQ-34-FY08V2` (RPC boundary decisions)](../../../specification/open-questions.md#oq-34-fy08v2)).

## Specification adherence

- The two members are exactly the two outcomes the ingress requirement names, so a close cannot be
  expressed in any third way ([`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                 | Implementation status | Evidence                                                                                                                                                                                                      | Gap / divergence                                                                            |
| --------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`REQ-RPC-6-E60S4J`](../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) | Partial               | **Here:** the enum admits exactly the two named outcomes and no third. **Other files:** [P2PManager](./P2PManager.ts.md) owns the switch and the exclusion write; every calling service states its own value. | The file decides nothing on its own; the stage-by-stage consequences live with the callers. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [P2PManager](./P2PManager.ts.md), [ProfileManager](./ProfileManager.ts.md), [PeerProfile](./PeerProfile.ts.md), [transport/NetworkTransport](./transport/NetworkTransport.ts.md).
