# LocalDiamond.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

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

The client-local mirror deployment: extends the proxy with event-driven storage-sync handlers
and a zero consumer facet — the local half of dual execution. Never production-deployed.

## Key design decisions

1. **Event-replication entry points** (`on*` handlers) are how the client advances the mirror — replication, never local hypothesis ([`REQ-MIRROR-2-E9F3TM`](../../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)).
2. **Channel-open event order preserves genesis deposits.** `InboundMessagesProcessed` is mirrored
   before `ChannelOpened`, so `onChannelOpened` retains the finalized snapshot deposit total instead
   of resetting the local balance mirror to zero.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                             |
| ------------ | ---------------------------------------------------- |
| Inputs       | Per file role.                                       |
| Outputs      | State mutations/verdicts/events per operation group. |
| Owned state  | Mirror sync additions.                               |
| Side effects | Events; escrow via consumer where applicable.        |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                     | Specification IDs                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LocalDiamond.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol) | [`INV-MIRROR-1-VAF778`](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778), [`REQ-MIRROR-1-XCY9CB`](../../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb), [`REQ-MIRROR-2-E9F3TM`](../../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm) |

## Assumptions, dependencies, trust boundaries, and limits

- Executes only in the manager's delegatecall context (except UtilityFacet's plain calls).
- Deployment-size budget applies per deployable ([architecture view](../../../../views/architecture/contracts/architecture.md) §3 measurements).

## Specification adherence

- Operation semantics per the owning protocol documents; composition rules per [contracts.md](../../../../../specification/enforcement/contracts.md).
- The local balance mirror starts from the finalized genesis deposit total, so replay evaluates the
  balance invariant against the same deposits as the production channel.

## Specification contradictions

None demonstrated.

## Missing behavior

See conformance rows.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                               | Implementation status | Evidence                                                                                                                     | Gap / divergence                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`INV-MIRROR-1-VAF778`](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) | Covered               | **Here:** same logic by inheritance; local-only additions are sync plumbing.                                                 | [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30): `onChannelOpened` builds the genesis inbound block in memory and never persists it — mirror divergence from the production open path (open finding). |
| [`REQ-MIRROR-1-XCY9CB`](../../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb) | Partial               | **Here:** `onChannelOpened` preserves the finalized genesis deposit total used by local replay and balance-invariant checks. | Other mirrored predicates and their state inputs are owned by their respective facets and event handlers.                                                                                                                  |
| [`REQ-MIRROR-2-E9F3TM`](../../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm) | Partial               | **Here:** the event handlers.                                                                                                | [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30) persistence gap.                                                                                                                                      |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation             | Public entry and setup                                                        | Oracle and forbidden effects                                                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-local-diamond-1-pje47m"></a>`UNIT-TEST-LOCAL-DIAMOND-1-PJE47M` | Mirror replication     | Replay event sequences incl. duplicates and the open event                    | Idempotent convergence with on-chain state; [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30) documented | <a id="unit-test-local-diamond-1-pje47m.p1"></a>`UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P1` — event replay convergence; <a id="unit-test-local-diamond-1-pje47m.p2"></a>`UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P2` — duplicate idempotence; <a id="unit-test-local-diamond-1-pje47m.p3"></a>`UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P3` — onChannelOpened (documents [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30)) |
| <a id="unit-test-local-diamond-2-g8m3vq"></a>`UNIT-TEST-LOCAL-DIAMOND-2-G8M3VQ` | Genesis deposit mirror | Audit honest and altered disputes after a channel opens with nonzero deposits | Honest replay passes the balance invariant; changing the deposit total produces the matching fraud proof                    | <a id="unit-test-local-diamond-2-g8m3vq.p1"></a>`UNIT-TEST-LOCAL-DIAMOND-2-G8M3VQ.P1` — honest nonzero genesis deposits pass; <a id="unit-test-local-diamond-2-g8m3vq.p2"></a>`UNIT-TEST-LOCAL-DIAMOND-2-G8M3VQ.P2` — altered nonzero genesis deposits fail                                                                                                                                                               |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
