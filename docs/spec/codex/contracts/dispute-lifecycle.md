# Dispute lifecycle and timing

## Status and authority

This chapter defines evidence intake, dispute windows, kill processing, and the fast path. Reduction and successor adoption are in [reduction and snapshots](reduction-and-snapshots.md). Timing uses chain timestamps.

## 1. Purpose

A dispute window gathers the valid views and recovery requests that were available when peers could not agree off chain. It gives other participants time to add a view and remove invalid commitments before one deterministic reduction creates a successor fork.

## 2. Design decisions and rationale

### 2.1 A dispute is a committed view plus a recovery reason

A dispute says which fork is being recovered, what latest state the disputer can prove, which inbound head must be carried forward, and which recovery action is requested. A valid reason is at least one of:

1. apply selected on-chain slashes;
2. time out the deterministic next author;
3. remove the disputer voluntarily;
4. force inclusion of newer on-chain inbound messages.

An evidence item with no recovery reason is invalid even if its state proof is otherwise well formed.

### 2.2 Every eligible participant gets at most one view per window

One commitment per participant bounds evidence count by channel size and avoids one address weighting reduction through duplicates. A participant chooses its best complete view. A later correction requires killing or replacing the prior commitment under an explicit rule; current code has no replacement operation.

### 2.3 Evidence and kill phases are separate

The evidence phase lets eligible participants add commitments. The kill phase freezes additions and lets proofs remove invalid commitments. Separating them gives reducers a fixed set at the kill deadline.

The current timestamp implementation lets the kill deadline extend from the last evidence submission. This is reasonable, but the phase formulas must be explicit and not described as one generic challenge window.

### 2.4 Full auditing data is optional at upload

A dispute always commits to `DisputeAuditingData`. It may publish the data in the upload transaction or leave only the hash and serve data over RPC. This is an optimistic data-cost choice. A hash-only dispute needs stronger final-anchor rules or a later publication path so challengers can audit it.

### 2.5 Unanimous evidence can finalize quickly

If the complete current threshold set signs the same dispute, there is no competing honest view under the unanimity assumption. The contract may close evidence and commit the signed output immediately. This path still needs all structural, signature, output, and balance checks. Signatures must not turn invalid bytes into a valid successor.

## 3. Boundary and responsibilities

`DisputeManagerFacet` accepts commitments and maintains timers. `DisputeFraudProofFacet` removes invalid commitments. `DisputeVerificationFacet` validates auditing data, reduction, and successor output. SDK `DisputeManager` builds and broadcasts evidence, collects signatures, publishes it, and mirrors window events.

## 4. Data model and owned state

### 4.1 Dispute input

| Field                                      | Meaning and required rule                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `channelId`                                | nonzero channel being recovered                                                |
| `forkId`                                   | disputed fork and hash of its genesis snapshot data                            |
| `latestStateSnapshotHash`                  | exact latest state supported by the proof                                      |
| `latestInboundMessageBlockHash` and height | on-chain inbound prefix requested for successor processing                     |
| `stateProof`                               | genesis or final-anchor path plus optional non-final suffix                    |
| `onChainSlashes`                           | selected slash entries under the final slash-selection policy                  |
| `disputeAuditingDataHash`                  | commitment to all state, snapshots, and stream data needed to audit and reduce |
| `disputer`                                 | signer and on-chain sender responsible for this evidence                       |
| `timeout`                                  | optional next-author timeout claim                                             |
| `selfRemoval`                              | optional request to remove the disputer without Byzantine penalty              |

`postedAuditingData` states whether upload calldata includes auditing data. `outputSnapshotDataHash` commits to the disputer’s computed successor output and is used by the unanimous fast path.

### 4.2 Auditing data

Auditing data contains fork genesis snapshot data, latest state snapshot, milestone snapshots, latest finalized application state, inbound blocks needed to reach the requested head, and outbound blocks since genesis or the required lower anchor. Every item must link to a dispute or snapshot commitment.

### 4.3 Window evidence

A window is keyed by disputed fork and stores:

- `forkId`;
- `creationTimestamp`;
- `lastEvidenceSubmissionTimestamp`;
- ordered dispute commitment hashes;
- addresses that have posted;
- optional reduced result with successor fork, reduction timestamp, and reducer.

The commitment array order is chain inclusion order. Required convergence should not depend on it, except deterministic tie resolution must use intrinsic values, not arrival position.

### 4.4 Phase formulas

Let `E` be the evidence duration captured when the window opens.

```text
evidenceDeadline = creationTimestamp + E
killDeadline     = lastEvidenceSubmissionTimestamp + E
challengeDeadline = reductionTimestamp + E
```

The evidence phase is live while `now < evidenceDeadline`. The kill phase is live while `now < killDeadline`. Reduction may commit at `now >= killDeadline`. A reduction challenge is live while `now < challengeDeadline`. Equality belongs to the later phase.

The implementation may use separate configured durations later, but a window must snapshot them so config updates do not alter existing deadlines.

## 5. Inputs and preconditions

Dispute upload requires:

1. exact decoding within resource bounds;
2. `msg.sender == dispute.input.disputer`;
3. valid disputer signature over exact encoded dispute;
4. disputer belongs to adopted plus pending participants and is not on-chain slashed;
5. dispute channel and fork match the target window;
6. state-proof headers all name that channel and fork;
7. requested inbound hash and height name an ancestor of the current on-chain inbound head;
8. at least one valid dispute reason;
9. timeout race checks when timeout is present;
10. auditing data presence flag matches the called entry point and supplied data hash;
11. sender has not already posted in this window;
12. sender throttle has expired;
13. evidence phase is live for an existing window.

Full state-proof and output validity may be optimistic at upload if the kill phase provides executable proofs. Cheap structural checks that prevent unkillable garbage must still run before commitment.

## 6. Processing algorithm

### 6.1 Derive the target window

The disputed fork is `dispute.input.forkId`. A dispute cannot choose a different map key through a derived output field. The contract checks all evidence against this same fork.

### 6.2 Validate timeout race conditions

For a non-forced timeout:

1. require no calldata commitment exists for the timed-out participant at the claimed height;
2. if previous author availability is part of the claim, require observed presence matches the dispute field;
3. require chain time has reached `minTimeStamp`;
4. if the window already existed before `minTimeStamp`, reject the timeout because its recovery clock began too early.

A forced timeout skips only the publication race checks named by the protocol. It does not skip expected-author, height, state-link, or minimum-time validity.

### 6.3 Open or append to a window

1. If no window exists, set fork ID, creation timestamp, and last evidence timestamp to current chain time; snapshot phase durations; append fork to the channel’s allocated-window index.
2. Otherwise, require evidence phase live, no prior post by this disputer, and no finalized reduction.
3. Set last evidence timestamp to current chain time.
4. Append `hash(dispute)` and the disputer address at corresponding positions.
5. Set the disputer throttle to current time plus its configured interval.
6. Emit the commitment event, including full auditing data only when the called path provided it.

The author list and commitment list should be parallel so a killed item can be removed without leaving a permanent one-post marker for a commitment that no longer exists. Current code stores `hasPosted` as an append-only set, so a killed disputer cannot correct its evidence.

### 6.4 Threshold-final fast path

1. Derive the current on-chain threshold set from adopted plus pending participants minus slashes.
2. Combine the disputer signature and added signatures.
3. Require one valid distinct signature from every threshold address over exact dispute bytes.
4. Fully verify the state proof, auditing data, output snapshot data, balance invariant, inbound prefix, and requested recovery action.
5. Commit the signed output successor and mark evidence, kill, and challenge periods completed according to a dedicated fast-path representation.
6. Emit both commitment and reduction events.

Backdating timestamps to simulate expiry, as current code does, is not a suitable production representation. It obscures event time and can underflow when deployment duration exceeds current chain timestamp.

### 6.5 Kill an invalid commitment

During the live kill phase, apply [dispute fraud proof](fraud-proofs-and-slashing.md) rules. Remove the commitment and its author while preserving survivor order. Do not reopen evidence or extend the kill deadline unless the accepted replacement policy says so.

### 6.6 Close the window for reduction

At `now >= killDeadline`, evidence and kill processing are closed. The exact ordered surviving commitment list becomes immutable input to reduction. If at least one survives, any eligible reducer can supply their full data and expected result.

If none survive, the protocol still requires a successor, but its exact construction is unresolved. The contract must not leave the disputed fork permanently without a recovery path.

## 7. Outputs and postconditions

A normal upload adds one commitment and emits `DisputeCommitted` or `DisputeCommittedWithAuditingData`. A valid kill removes one commitment and records one slash. Window closure itself does not mutate storage; it changes which calls pass timestamp checks. A fast path writes a reduced successor only after full validity checks.

## 8. Invariants

- **DSP-INV-1:** one participant has at most one live commitment in a window.
- **DSP-INV-2:** every commitment binds complete dispute bytes and one auditing-data hash.
- **DSP-INV-3:** all commitments in a window target the same channel and disputed fork.
- **DSP-INV-4:** no new evidence is accepted at or after the evidence deadline.
- **DSP-INV-5:** no kill is accepted at or after the kill deadline.
- **DSP-INV-6:** reduction is not committed before the kill deadline unless the fully verified unanimous fast path applies.
- **DSP-INV-7:** killing evidence preserves the order of survivors.
- **DSP-INV-8:** a slashed address cannot add or challenge evidence.
- **DSP-INV-9:** every surviving dispute has at least one valid recovery reason.
- **DSP-INV-10:** timer config changes do not alter an existing window.
- **DSP-INV-11:** a window has a defined path to one successor even when no commitment survives.

## 9. Ordering, concurrency, and atomicity

Chain order chooses the evidence commitment order but must not choose the semantic winner. Two uploads at the exact evidence boundary are accepted or rejected by inclusion timestamp. A proof and reduction at the kill boundary cannot both succeed: before the boundary only the proof is valid; at equality only reduction is valid.

One sender throttle applies per channel, not globally. It limits repeated window openings but is not a complete anti-spam system. A new participant set can still create costly valid evidence.

## 10. Trust and security assumptions

The window assumes at least one honest participant in every relevant network partition can observe the chain and submit or challenge before deadlines. If every participant with access to a partition is Byzantine, the protocol does not promise safety for evidence unavailable to honest observers.

Hash-only auditing assumes the data can be obtained before the kill deadline. Without guaranteed publication, a malicious disputer may commit uncheckable data. The specification needs a forced auditing-data publication or automatic invalidation rule.

## 11. Failure behavior and recovery

A stale upload reverts without changing the window. A duplicate author cannot replace its commitment. A peer that loses the P2P race publishes through the chain if the evidence phase remains live.

If auditing data is unavailable, honest peers must fail closed and use the on-chain publication path. If no such path completes in time, the hash-only commitment must not survive reduction.

After restart, a peer reconstructs windows from commitment, kill, slash, and reduction events, then confirms current view getters. It schedules actions from chain timestamps, not local receipt time.

## 12. Current implementation

`DisputeManagerFacet.sol` binds sender to disputer, checks eligibility and timeout races, creates windows, stores hashes, records `hasPosted`, throttles each disputer for `evidenceTime`, and detects threshold-final signatures. `DisputeUtils.sol` derives deadlines. Events optionally carry full auditing data.

Current evidence upload checks expiry only when the window has commitments; a window whose commitments were all killed can accept later evidence even after the original evidence deadline. Threshold finality backdates timestamps and clears prior commitments before adding the final commitment.

## 13. Difference from the intended design

| Classification   | Difference                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| bug              | a window with zero commitments can accept evidence after the evidence deadline                            |
| bug              | threshold fast path trusts `outputSnapshotDataHash` without the full verification sequence specified here |
| bug              | threshold fast path simulates finality by backdating timestamps                                           |
| missing          | window snapshots of configured durations                                                                  |
| missing          | forced publication or invalidation rule for unavailable auditing data                                     |
| decision pending | correction or replacement path after a participant’s commitment is killed                                 |
| decision pending | exact successor when no commitments survive                                                               |
| decision pending | whether timeout can coexist with selected slashes, beyond current slash precedence                        |
| missing          | full input size bounds and exact gas budget                                                               |

## 14. Dependencies and cross-layer effects

SDK clock, RPC evidence sync, storage durability, fraud-proof submission, chain event replay, reduction, and snapshot update depend on these phases. Changing one deadline changes operations and E2E tests. Changing valid dispute reasons changes both SDK construction and contract kill predicates.

## 15. Verification

Tests must cover first and later uploads, one-post rule, throttling across windows, every exact deadline, killed-to-zero windows, optional auditing data commitment, unavailable audit data, every timeout race, forced timeout limits, threshold signatures with duplicates and outsiders, invalid unanimous output, competing transaction order, restart reconstruction, and chain reorganization.

Permutation tests must show that arrival order does not change reduction result, even though commitment arrays preserve arrival order for evidence identity.

## 16. Future work

An optimistic reduction may commit only a result hash and wait for challenge, reducing gas at the cost of latency. A peer-agreed fast path may also avoid full data publication, but it must retain a challenge path for an unavailable participant.
