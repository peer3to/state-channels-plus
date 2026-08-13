# SpectateService.ts — Source Report

> **Source:** [src/rpc/services/spectate/SpectateService.ts](../../../../../../../../../src/rpc/services/spectate/SpectateService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/spectate.md](../../../../../views/architecture/sdk/rpc/spectate.md)

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

Both halves of verifiable sync. Responder: `generateSyncPayload` proves exactly the requested
target (dispute-window walk to the target fork, state proof, stream ranges, encoded states) or
returns nothing. Requester: `sync` (one in-flight per peer) then `applySyncResponse` — the full
verification chain (decode-in-try, RTT bound, on-chain anchor, window walk with local
re-reduction, genesis validity, stale short-circuit, range checks, dispute status, milestone
proof, balance invariant, simulated advance) before mutex-guarded persistence and suffix replay.

## Key design decisions

1. **Nothing trusted on receipt.** Every payload element is re-established against the requester's own chain reads and the mirrored canonical predicates — the file is the reference implementation of [`INV-SYNC-1`](../../../../../../specification/peer-communication/synchronization.md#inv-sync-1).
2. **Validated against the requester's own request.** The request lives in the `sync` closure; the responder's echo is never consulted ([`INV-SYNC-2`](../../../../../../specification/peer-communication/synchronization.md#inv-sync-2)).
3. **Read-only trust establishment.** All contract checks are local-mirror or simulated calls; no step transacts ([`INV-SYNC-4`](../../../../../../specification/peer-communication/synchronization.md#inv-sync-4), [`REQ-MIRROR-1`](../../../../../../specification/enforcement/local-mirror.md#req-mirror-1)).
4. **Fail-closed split by role.** Fresh spectator aborts entirely; recovering participant cuts only the offending peer ([`INV-SYNC-3`](../../../../../../specification/peer-communication/synchronization.md#inv-sync-3)).
5. **Malformed heights rejected before any chain walk** so a hostile target cannot buy expensive traversal.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| Inputs       | Sync requests (responder); encoded payloads (requester).                 |
| Outputs      | Encoded payloads or refusal; persisted verified state + replayed suffix. |
| Owned state  | One-in-flight-per-peer set (cleaned in finally).                         |
| Side effects | Persistence under the state boundary; abort/cut consequences.            |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                   | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [SpectateService.ts](../../../../../../../../../src/rpc/services/spectate/SpectateService.ts) | [`INV-SYNC-1`](../../../../../../specification/peer-communication/synchronization.md#inv-sync-1), [`INV-SYNC-2`](../../../../../../specification/peer-communication/synchronization.md#inv-sync-2), [`INV-SYNC-3`](../../../../../../specification/peer-communication/synchronization.md#inv-sync-3), [`INV-SYNC-4`](../../../../../../specification/peer-communication/synchronization.md#inv-sync-4), [`REQ-SYNC-1`](../../../../../../specification/peer-communication/synchronization.md#req-sync-1), [`REQ-SYNC-2`](../../../../../../specification/peer-communication/synchronization.md#req-sync-2), [`REQ-SYNC-3`](../../../../../../specification/peer-communication/synchronization.md#req-sync-3) |

## Assumptions, dependencies, trust boundaries, and limits

- Requester-side chain view honesty anchors every check (../../../../../../specification/security/trust-model.md); proof generation cost is the [OQ-6](../../../../../../specification/open-questions.md) surface.

## Specification adherence

- Exact-target proving with above-latest refusal and height-0 pinning ([`REQ-SYNC-1`](../../../../../../specification/peer-communication/synchronization.md#req-sync-1)).
- Client-side balance-invariant check defeating colluding undercollateralized snapshots ([`REQ-SYNC-2`](../../../../../../specification/peer-communication/synchronization.md#req-sync-2)).
- Suffix replay through the standard pipeline in the spectating context ([`REQ-SYNC-3`](../../../../../../specification/peer-communication/synchronization.md#req-sync-3)).

## Specification contradictions

None demonstrated in the verification chain itself.

## Missing behavior

**DEF-5 / DEF-10 fault taxonomy (both directions):** the requester blacklists on _any_ request-path failure (timeout/transport/refusal — availability conflated with malice), and the responder blacklists a requester whose pinned target it honestly cannot prove yet. Both tracked in [open-findings](../../../../../../audit/open-findings.md); the fix lands here. Rate limiting of proof serving: [OQ-6](../../../../../../specification/open-questions.md).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                                                                                             | Implementation status | Evidence                                                                                                                                                                                   | Gap / divergence                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [`INV-SYNC-1`](../../../../../../specification/peer-communication/synchronization.md#inv-sync-1) / [`INV-SYNC-2`](../../../../../../specification/peer-communication/synchronization.md#inv-sync-2) | Covered               | **Here:** the ordered verification chain against own anchor and own request. **Other files:** predicates via [EvmDiamondStateMachine](../../../evm/EvmDiamondStateMachine.ts.md) (mirror). | None.                                                                                   |
| [`INV-SYNC-3`](../../../../../../specification/peer-communication/synchronization.md#inv-sync-3)                                                                                                    | Covered               | **Here:** role-split abort with no partial persistence (skip-if-ahead; conflict aborts).                                                                                                   | None.                                                                                   |
| [`REQ-SYNC-1`](../../../../../../specification/peer-communication/synchronization.md#req-sync-1)                                                                                                    | Partial               | **Here:** exact-target proving and refusal.                                                                                                                                                | DEF-10: honest can't-prove-yet refusal punishes the requester (fault taxonomy pending). |
| [`REQ-SYNC-2`](../../../../../../specification/peer-communication/synchronization.md#req-sync-2)                                                                                                    | Covered               | **Here:** client-side invariant check before adoption. **Other files:** on-chain enforcement absence tracked as [OQ-19](../../../../../../specification/open-questions.md).                | None here.                                                                              |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                            | Obligation                   | Public entry and setup                                                                                          | Oracle and forbidden effects                                                                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-spectate-service-1"></a>`UNIT-TEST-SPECTATE-SERVICE-1` | Requester verification chain | Serve payloads with each element individually forged; alter echoes; force each abort step; both requester roles | Every forgery aborts at its step with role-correct consequences; echoes ignored; no transaction ever sent; valid payload adopts and replays | <a id="unit-test-spectate-service-1.p1"></a>`UNIT-TEST-SPECTATE-SERVICE-1.P1` — each forged element; <a id="unit-test-spectate-service-1.p2"></a>`UNIT-TEST-SPECTATE-SERVICE-1.P2` — altered echo ignored; <a id="unit-test-spectate-service-1.p3"></a>`UNIT-TEST-SPECTATE-SERVICE-1.P3` — role-split abort per step; <a id="unit-test-spectate-service-1.p4"></a>`UNIT-TEST-SPECTATE-SERVICE-1.P4` — no-transaction property; <a id="unit-test-spectate-service-1.p5"></a>`UNIT-TEST-SPECTATE-SERVICE-1.P5` — valid adoption + suffix replay; <a id="unit-test-spectate-service-1.p6"></a>`UNIT-TEST-SPECTATE-SERVICE-1.P6` — one-in-flight per peer              |
| <a id="unit-test-spectate-service-2"></a>`UNIT-TEST-SPECTATE-SERVICE-2` | Responder proving            | Request latest/pinned/height-0/above-latest/unknown-fork targets from varied local states                       | Exact targets proven; everything else refused (never substituted); malformed height rejected pre-walk; refusal consequence documents DEF-10 | <a id="unit-test-spectate-service-2.p1"></a>`UNIT-TEST-SPECTATE-SERVICE-2.P1` — latest and pinned success; <a id="unit-test-spectate-service-2.p2"></a>`UNIT-TEST-SPECTATE-SERVICE-2.P2` — height-0 pin; <a id="unit-test-spectate-service-2.p3"></a>`UNIT-TEST-SPECTATE-SERVICE-2.P3` — above-latest refused; <a id="unit-test-spectate-service-2.p4"></a>`UNIT-TEST-SPECTATE-SERVICE-2.P4` — unknown fork refused; <a id="unit-test-spectate-service-2.p5"></a>`UNIT-TEST-SPECTATE-SERVICE-2.P5` — malformed height cheap-rejected; <a id="unit-test-spectate-service-2.p6"></a>`UNIT-TEST-SPECTATE-SERVICE-2.P6` — lagging-responder refusal (documents DEF-10) |

## Related source reports

- [SpectateRpcMethods](./SpectateRpcMethods.ts.md), [EventSyncService](../../../stateManager/EventSyncService.ts.md), [SpectatingValidationStrategy](../../../stateManager/validationStrategy/SpectatingValidationStrategy.ts.md), [EvmDiamondStateMachine](../../../evm/EvmDiamondStateMachine.ts.md).
