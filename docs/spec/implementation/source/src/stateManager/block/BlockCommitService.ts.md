# BlockCommitService.ts — Source Report

> **Source:** [src/stateManager/block/BlockCommitService.ts](../../../../../../../src/stateManager/block/BlockCommitService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [dispute pipeline](../../../../views/architecture/sdk/dispute-pipeline.md)

## Responsibility and observable boundary

Commits a successfully executed block: participation status, snapshot and state storage, a permitted
counter-signature, block and outbound storage, participant changes, leave progress and follow-up work.
The caller holds the StateManager mutex across execution and this commit.

## Key design decisions

Verified live commits replace MembershipService's off-chain member set with the participant union. Publication passes only the addresses; the mirror stores no fork metadata.

After canonical block storage, a live or spectate commit publishes the normalized previous/resulting union. Dispute replay and a cancelled commit do not replace current membership knowledge. A committed callback marks the point after which later side-effect failure must not roll the VM behind stored state. Spectators persist and notify without signing or relaying; insertion promotes a listed signer before the normal signing/gossip path. Fresh gossip requires PARTICIPATING. See [publishOffChainEligibility](../../../../../../../src/stateManager/block/BlockCommitService.ts#L87).

1. Snapshot and state storage precede the signing decision, so the previous/resulting participant union
   is available when deciding whether this peer may sign.
2. The asynchronous signer call and signed block storage finish under the state mutex. Dispute admission
   waits for that work before setting its marker. New live arrivals under the marker are rejected by
   ValidationService before this owner. `shouldSignBlock` also refuses work reaching it under the marker.
3. Receipt-confirmed pending participation becomes participating when the committed state includes the
   signer. This later promotion does not change the earlier successful targeted-connect receipt.
4. A committed block advances the fixed leave block bound and notifies the leave owner about its turn.
5. Signing and relaying share one membership test, `MembershipService.isSignerInBlockUnion`: the
   block's previous/resulting participant union must contain this signer. Status alone is not
   enough for relaying. A leaver stays `PARTICIPATING` until its exit snapshot lands, yet it is
   outside the union of every later block; relaying those blocks put its copy in front of peers that
   had already applied its exit, which admit no unknown source and blacklist it, so its later forced
   re-join could never reconnect. The leaver still relays its own leave block, whose union contains it.
6. **The authored block's calldata timer re-checks the fork when it fires** ([#L171](../../../../../../../src/stateManager/block/BlockCommitService.ts#L171)). Step 11 arms a
   posting one agreement window ahead, and timers stay armed through most of a channel release —
   the task drain is the second-to-last step, after the peers are gone — so this closure could
   still run for the channel the runtime just left and send a transaction for it. It calls
   `sm.isActiveFork(block.forkId)` first and returns, the same guard the participant timeout
   check already uses, which covers both a disposed runtime and a retired fork with one read; the
   reset retires the fork before its first await, so the guard is already false by the time any
   of the release has run ([`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Inputs       | Executed block, resulting state/snapshot, participant changes, optional outbound block and validation strategy. |
| Outputs      | Promise completing commit and follow-up scheduling.                                                             |
| Storage      | Snapshot, encoded state, block and signature, outbound messages, participant change points.                     |
| Side effects | Participation status, finalization notification, broadcast and timeout/leave follow-up work.                    |

## Linked requirements

| Source file                                                                                | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [BlockCommitService.ts](../../../../../../../src/stateManager/block/BlockCommitService.ts) | [`REQ-TJOIN-3-DCZKS6`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6), [`REQ-TJOIN-5-Q795M7`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7), [`REQ-GOSSIP-4-J5Z4DF`](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df), [`REQ-LIF-10-QR8NQ9`](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) |

## Assumptions, dependencies, trust boundaries, and limits

The execution owner holds the state mutex and has validated the block. The signer remains asynchronous;
dispute admission must share that mutex rather than checking after signature production. Dispute replay
uses its own validation strategy and does not produce a counter-signature here.

## Specification adherence

Admitted signing/storage is ordered before dispute capture. Pending promotion and leave progress keep
their existing owners and chain-backed status rules.

The authored block's calldata timer produces no chain submission for a fork the runtime has retired:
the scheduled closure reads `isActiveFork` before posting ([#L176](../../../../../../../src/stateManager/block/BlockCommitService.ts#L176)), so a leave that lands between
arming and firing cancels the effect rather than the timer alone ([`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                              | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Gap / divergence                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [`REQ-DISPUTE-PIPE-8-BVR8XV`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv) | Covered               | **Here:** [source](../../../../../../../src/stateManager/block/BlockCommitService.ts#L31) finishes admitted counter-signing and storage under the state mutex before dispute admission can set its marker. New live arrivals under the marker are rejected by ValidationService before commit. **Other files:** [DisputeManager.ts](../../disputeManager/DisputeManager.ts.md) (dispute admission, rollback and construction), [StateManager.ts](../StateManager.ts.md) (shared state ordering), [BlockProductionService.ts](BlockProductionService.ts.md) (authoring and signed storage), [ValidationService.ts](../ingest/ValidationService.ts.md) (live-arrival rejection). | —                                                                                                    |
| [`REQ-GOSSIP-4-J5Z4DF`](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)         | Covered               | **Here:** [publishOffChainEligibility](../../../../../../../src/stateManager/block/BlockCommitService.ts#L87) implements the contribution described above. **Other files:** [Storage.ts](../../storage/Storage.ts.md), [MembershipService.ts](../membership/MembershipService.ts.md)                                                                                                                                                                                                                                                                                                                                                                                           | Limited to this file's contribution; cache freshness and aggregate queue limits remain as specified. |
| [`REQ-LIF-10-QR8NQ9`](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)                        | Covered               | **Here:** the step-11 calldata timer checks `isActiveFork(block.forkId)` when it fires ([#L176](../../../../../../../src/stateManager/block/BlockCommitService.ts#L176)), so a posting armed while the channel was held sends nothing once the return has retired that fork. **Other files:** [StateManager](../StateManager.ts.md) retires the fork before the release's first await and owns `isActiveFork`, [TimeoutManager](../../utils/TimeoutManager.ts.md) owns the timer registry the release drains, [CalldataPostingService](../chainFallback/CalldataPostingService.ts.md) owns the submission this guard declines to start.                                        | None; this row covers the scheduled-posting contribution only.                                       |

## Component test obligations

| Unit test ID                                                                                  | Obligation                    | Public entry and setup                                                                                                                             | Oracle and forbidden effects                                                                                                                                                                                                                                                                                                                                                                                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-block-commit-service-1-v6tp9s"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S` | Later cooperative inclusion   | Commit the first block that includes a receipt-confirmed pending joiner                                                                            | Status advances to participating and force-join bookkeeping clears without changing the earlier connect result                                                                                                                                                                                                                                                                                                                                      | <a id="unit-test-block-commit-service-1-v6tp9s.p1"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P1` — pending joiner included by first committed block; <a id="unit-test-block-commit-service-1-v6tp9s.p2"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P2` — the full ingest pipeline stores a block without signing when dispute admission precedes commit; <a id="unit-test-block-commit-service-1-v6tp9s.p3"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P3` — a spectator commit persists state and calls success without signing or gossip; <a id="unit-test-block-commit-service-1-v6tp9s.p4"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P4` — a commit inserting the spectator promotes it and signs and gossips once; <a id="unit-test-block-commit-service-1-v6tp9s.p5"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P5` — dispute replay with a historical union preserves current off-chain eligibility; <a id="unit-test-block-commit-service-1-v6tp9s.p6"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P6` — a leaver with a parked exit post stays participating, ingests the blocks committed after its leave block, and broadcasts none of them |
| <a id="unit-test-block-commit-service-2-apafnv"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-2-APAFNV` | Authored-block calldata timer | Capture the step-11 closure as the commit path schedules it for a block this runtime authored, release the channel, then fire the captured closure | The closure makes no posting attempt once the fork is retired, counted at `maybePostBlockOnChain` rather than at the chain so a submission that is attempted and reverts still fails the case; the live side of the boundary is the ordinary posting path, exercised by every run that reaches a calldata post ([CalldataPostingService](../chainFallback/CalldataPostingService.ts.md)), so it is not restated here as a permutation of this timer | <a id="unit-test-block-commit-service-2-apafnv.p1"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-2-APAFNV.P1` — channel released: the captured timer fired after `resetChannel()` makes no posting attempt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Related source reports

- [DisputeManager](../../disputeManager/DisputeManager.ts.md) sets and rolls back the single marker.
- [StateManager](../StateManager.ts.md) owns the mutex.
- [ValidationService](../ingest/ValidationService.ts.md) rejects new live arrivals under the marker.
- [LeaveChannelService](../membership/LeaveChannelService.ts.md) owns channel leave settlement.
- [CalldataPostingService](../chainFallback/CalldataPostingService.ts.md) owns the posting the step-11 timer starts.
