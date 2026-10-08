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

The temporary client-local mirror deployment: extends the proxy with event-driven storage-sync
handlers and a zero consumer facet — the local half of dual execution. Never production-deployed.
It mirrors only events indexed by its selected channel. It does not synchronize or answer global
manager state such as the enumerable open-channel registry. Its mirrored dispute-window
bookkeeping resolves commitments through the shared
[`_disputeCommitmentHash`](./utils/DisputeUtils.sol.md) owner, so a locally mirrored window keys
on exactly the preimage the manager committed.

Because it derives from [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), its
generated ABI carries only its own declarations plus the proxy's; every selector the proxy routes to
a facet is answered by the fallback and absent from that ABI. Clients therefore bind it through the
merged ABI in [localDiamond.ts](../../../src/utils/localDiamond.ts.md).

## Key design decisions

verifyMilestonesFromTrustedStart is a local-only entry into the common walk. It accepts the SDK's verified final snapshot without changing the mirrored chain anchor. It is not a production proxy selector. Replay positions come from ProofWalkResult. See [LocalDiamond.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L447).

1. **Event-replication entry points** (`on*` handlers) are how the client advances the mirror — replication, never local hypothesis ([`REQ-MIRROR-2-E9F3TM` (Unconditional replication)](../../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)).
2. **No block-authentication or decoding entry point of its own.** The public `isBlockAuthentic`
   entry point is gone; the client checks author signatures itself under the signature carve-out of
   [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) and decodes blocks with `Codec`. The
   `_isBlockAuthentic` debug override ([#L457](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L457)) stays: mirrored fraud-proof and
   state-proof checks reach it (it decodes through [UtilityFacet](./UtilityFacet.sol.md)
   `tryDecodeBlock`, like the production path) and log why a block failed.
3. **Channel-open event order preserves genesis deposits.** `InboundMessagesProcessed` is mirrored
   before `ChannelOpened`, so `onChannelOpened` retains the finalized snapshot deposit total instead
   of resetting the local balance mirror to zero.
4. **Channel-local by design.** Stateful and stateless channel computation stays on participant
   hardware without repeated RPC reads, but the event feed is not a complete or verified chain
   view. Consequential decisions retain their chain/RPC fallback. A future verified light-client
   RPC can replace this temporary mirror instead of extending it into global-state replication.
5. **Gas-capped dispute computations name an exhausted budget.** `computeDisputeOutputSnapshotData`,
   `computeDisputeOutputState` and `isDisputeOutputCorrect` all run the dispute verification facet
   through one helper, `_delegateDisputeExecution` ([#L390](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L390)), which delegates with the
   dispute execution gas limit (`_getGasLimit()`) and returns the facet's return data. `forwarded`
   is the gas the frame received: the limit, or all but 1/64 of the remaining gas when that is less
   ([#L413](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L413)).
   A failure is out of gas when it has empty return data and
   `gasUsed + forwarded / 64 + 5_000 >= forwarded`
   ([#L414](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L414)); it
   reverts with `ErrorDisputeExecutionOutOfGas(gasLimit, gasUsed)`
   ([#L415](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L415)).
   The `forwarded / 64` term covers an out-of-gas inside a nested state-machine call
   (`setState`, `processInboundMessage`, `slashParticipant`, `getState`): the facet keeps the 1/64
   it did not pass on and bubbles an empty revert, so that case is also
   `ErrorDisputeExecutionOutOfGas`. The 5,000 gas covers the call's own cost before the frame
   starts. Every other failure is re-thrown with its own revert data unchanged
   ([#L418](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L418)): a
   facet revert within the budget keeps its revert bytes, and an empty revert within the budget
   stays empty. Limit: the rule is a gas heuristic, so an empty revert that by chance uses up all
   but the margin is also reported as out of gas. Before this helper an exhausted budget surfaced
   as an empty revert. The helper changes no result: a computation that fits the budget
   returns the same data as before, and a failure is still an error, never an answer
   ([`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)).

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

| Source file                                                                                     | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LocalDiamond.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol) | [`INV-MIRROR-1-VAF778`](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778), [`REQ-MIRROR-1-XCY9CB`](../../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb), [`REQ-MIRROR-2-E9F3TM`](../../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm), [`REQ-MIRROR-4-H9C4YS`](../../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys) |

## Assumptions, dependencies, trust boundaries, and limits

- Executes only in the manager's delegatecall context (except UtilityFacet's plain calls).
- Deployment-size budget applies per deployable ([architecture view](../../../../views/architecture/contracts/architecture.md) §3 measurements).

## Specification adherence

- Operation semantics per the owning protocol documents; composition rules per [contracts.md](../../../../../specification/enforcement/contracts.md).
- The local balance mirror starts from the finalized genesis deposit total, so replay evaluates the
  balance invariant against the same deposits as the production channel.
- A local dispute computation never turns a failure into an answer
  ([`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)):
  an exhausted budget, also one inside a nested state-machine call, is
  `ErrorDisputeExecutionOutOfGas`, and any other failure keeps its own revert data.

## Specification contradictions

None demonstrated.

## Missing behavior

- [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30): `onChannelOpened` builds the genesis inbound block in memory and never persists it, so the mirror diverges from the production open path ([`INV-MIRROR-1-VAF778` (Single implementation)](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778), [`REQ-MIRROR-2-E9F3TM` (Unconditional replication)](../../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                               | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Gap / divergence                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`INV-MIRROR-1-VAF778`](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) | Covered               | **Here:** same logic by inheritance; local-only additions are sync plumbing and the debug override of `_isBlockAuthentic`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30): `onChannelOpened` builds the genesis inbound block in memory and never persists it — mirror divergence from the production open path (open finding). |
| [`REQ-MIRROR-1-XCY9CB`](../../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb) | Partial               | **Here:** `onChannelOpened` preserves the finalized genesis deposit total used by local replay and balance-invariant checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Other mirrored predicates and their state inputs are owned by their respective facets and event handlers.                                                                                                                  |
| [`REQ-MIRROR-2-E9F3TM`](../../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm) | Partial               | **Here:** the event handlers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30) persistence gap.                                                                                                                                      |
| [`REQ-MIRROR-4-H9C4YS`](../../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys) | Covered               | **Here:** the gas-capped dispute computations propagate an exhausted budget, including an out-of-gas inside a nested state-machine call, as `ErrorDisputeExecutionOutOfGas` ([#L414](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L414)) and every other failure as its own revert ([#L418](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L418)); none becomes a result. **Other files:** the SDK callers that own the local-first answer policy and its chain confirmation ([DisputeValidationService.ts.md](../../../src/stateManager/dispute/DisputeValidationService.ts.md), [EventHandler.ts.md](../../../src/eventHandlers/EventHandler.ts.md), [DisputeManager.ts.md](../../../src/disputeManager/DisputeManager.ts.md)). | None.                                                                                                                                                                                                                      |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation                     | Public entry and setup                                                                                                        | Oracle and forbidden effects                                                                                                                                                                                  | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-local-diamond-1-pje47m"></a>`UNIT-TEST-LOCAL-DIAMOND-1-PJE47M` | Mirror replication             | Replay event sequences incl. duplicates and the open event                                                                    | Idempotent convergence with on-chain state; [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30) documented                                                                                   | <a id="unit-test-local-diamond-1-pje47m.p1"></a>`UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P1` — event replay convergence; <a id="unit-test-local-diamond-1-pje47m.p2"></a>`UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P2` — duplicate idempotence; <a id="unit-test-local-diamond-1-pje47m.p3"></a>`UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P3` — onChannelOpened (documents [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| <a id="unit-test-local-diamond-2-g8m3vq"></a>`UNIT-TEST-LOCAL-DIAMOND-2-G8M3VQ` | Genesis deposit mirror         | Audit honest and altered disputes after a channel opens with nonzero deposits                                                 | Honest replay passes the balance invariant; changing the deposit total produces the matching fraud proof                                                                                                      | <a id="unit-test-local-diamond-2-g8m3vq.p1"></a>`UNIT-TEST-LOCAL-DIAMOND-2-G8M3VQ.P1` — honest nonzero genesis deposits pass; <a id="unit-test-local-diamond-2-g8m3vq.p2"></a>`UNIT-TEST-LOCAL-DIAMOND-2-G8M3VQ.P2` — altered nonzero genesis deposits fail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| <a id="unit-test-local-diamond-3-h2mqe5"></a>`UNIT-TEST-LOCAL-DIAMOND-3-H2MQE5` | Gas-capped dispute computation | Deploy a local diamond with a chosen dispute execution gas limit over a seeded state and call the dispute output computations | An exhausted budget reverts `ErrorDisputeExecutionOutOfGas`, never an empty revert or a result; within the budget the result is the facet's own and the output snapshot lists the output state's participants | <a id="unit-test-local-diamond-3-h2mqe5.p1"></a>`UNIT-TEST-LOCAL-DIAMOND-3-H2MQE5.P1` — a budget too small for the computation reverts `ErrorDisputeExecutionOutOfGas`; <a id="unit-test-local-diamond-3-h2mqe5.p2"></a>`UNIT-TEST-LOCAL-DIAMOND-3-H2MQE5.P2` — within the default budget `computeDisputeOutputSnapshotData` hashes the state `computeDisputeOutputState` returns and lists the participants of that output state (a removed participant is gone, order kept); <a id="unit-test-local-diamond-3-h2mqe5.p3"></a>`UNIT-TEST-LOCAL-DIAMOND-3-H2MQE5.P3` — a facet failure with revert data inside the budget is re-thrown with that data unchanged; <a id="unit-test-local-diamond-3-h2mqe5.p4"></a>`UNIT-TEST-LOCAL-DIAMOND-3-H2MQE5.P4` — an out-of-gas inside a nested state-machine call, where the facet keeps the 1/64 of the forwarded gas it did not pass on, reverts `ErrorDisputeExecutionOutOfGas`; <a id="unit-test-local-diamond-3-h2mqe5.p5"></a>`UNIT-TEST-LOCAL-DIAMOND-3-H2MQE5.P5` — an empty revert inside the budget stays an empty revert and is not relabeled `ErrorDisputeExecutionOutOfGas` |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
- [localDiamond.ts](../../../src/utils/localDiamond.ts.md) — the client binding that merges this contract's ABI with the routed one.
- [UtilityFacet](./UtilityFacet.sol.md) — the block decoder `_isBlockAuthentic` calls.
