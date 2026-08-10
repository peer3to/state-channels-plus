# Dispute reduction, successor generation, and snapshot adoption

## Status and authority

This chapter defines the deterministic merge of valid dispute inputs and the two paths that advance the authoritative on-chain snapshot. It marks the unresolved slash-selection conflict explicitly.

## 1. Purpose

After the kill deadline, peers may still have submitted different valid latest states and different recovery requests. Reduction converts that set into one result that every correct implementation can reproduce. Successor generation applies the result to application state. Snapshot adoption then processes the cross-layer effects committed by that state.

## 2. Design decisions and rationale

### 2.1 Prefer the longest valid proved history

Valid non-final transitions are not discarded merely because all participants had not yet signed them. Reduction chooses the view with the greatest proved transaction count. This carries maximum valid progress into canonical reality.

If two valid views have the same count, the smaller block hash wins. The tie-break is arbitrary but deterministic and independent of transaction arrival order. Equivocation proof handling should normally slash the conflicting signer before reduction.

### 2.2 Reduction is a set merge with explicit precedence

Slashes and self-removals are unioned and deduplicated. Inbound progress uses one chain-derived cutoff. Timeout chooses the earliest valid missing-author position. Slash consequence takes precedence over a simple timeout removal because application punishment may differ from voluntary removal.

### 2.3 Successor output is computed, not supplied as authority

The reducer supplies source state and streams, but the contract replays inbound messages, slashes, and removals through the state machine. The resulting encoded state, participants, balances, and outbound exits define successor snapshot data. A caller-supplied expected fork only detects races and local computation errors.

### 2.4 Snapshot advancement is the only withdrawal gate

An outbound exit message does not move L1 assets when the off-chain transition creates it. Assets move only when a finalized same-fork or finalized successor snapshot proves the outbound stream range. Normal exit and forced exit use the same mechanism.

### 2.5 The successor is mandatory

Every completed dispute must produce one new fork. Off-chain execution resumes from its genesis snapshot. The manager does not continue authoring on the disputed fork after recovery.

## 3. Boundary and responsibilities

Reduction selects values from surviving disputes and objective chain state. Successor generation uses the state machine to apply them. The snapshot facet checks finality or reduced-fork ancestry, verifies message streams, calls the consumer, and stores the adopted snapshot. The SDK prepares source data and independently computes `expectedReducedForkId`.

## 4. Data model and owned state

### 4.1 Reduced output

`ReduceOutput` contains:

- `latestBlock`, or an empty block for genesis-only evidence;
- distinct `slashedParticipants`;
- selected inbound message head and height;
- one timeout claim or an unset timeout;
- distinct self-removal addresses.

It is an intermediate value. The stored result is the successor `forkId`, reduction timestamp, and reducer address.

### 4.2 Dispute output state

`DisputeOutputState` contains encoded modified application state, at most one newly built outbound message block for slash and removal exits, and resulting cumulative deposits and withdrawals.

### 4.3 Successor snapshot data

The successor has:

- `originForkId` equal to the disputed fork;
- state-machine state hash and participants from replayed output;
- inbound head and height from reduction;
- outbound head and height extended by any generated exit block;
- cumulative deposits and withdrawals after replay.

The successor fork ID is `keccak256(abi.encode(successorSnapshotData))`. Its genesis `StateSnapshot` has block height zero and timestamp equal to the finalized recovery timestamp.

## 5. Inputs and preconditions

Reduction requires:

1. at least one surviving dispute, unless the no-survivor rule is invoked;
2. supplied disputes exactly match the complete committed sequence after kills;
3. every supplied dispute targets the same channel and fork;
4. kill period expired;
5. no reduced result already exists, or existing result equals the caller expectation;
6. source latest snapshot links to the selected latest block or fork genesis;
7. encoded source state hashes to that snapshot;
8. supplied inbound blocks form the exact range from source snapshot head to selected reduced head;
9. caller is eligible to reduce;
10. expected reduced fork equals the independently computed output.

A challenge requires a committed result, live challenge period, exact evidence set, complete source data, and eligible challenger.

## 6. Processing algorithm

### 6.1 Fix the evidence cutoff

The cutoff is the kill deadline, not the reducer transaction time. Objective chain changes after the cutoff must not change this reduction.

Starting from the current on-chain inbound head, walk backward while an inbound block timestamp is after the cutoff. The first remaining block is the selected inbound head. Its stored height is selected with it. Zero head implies zero height and application zero deposits.

### 6.2 Select the latest proved block

For every surviving dispute:

1. extract its latest proved block under the state-proof rules;
2. ignore the empty genesis representation for block comparison;
3. choose greater `transactionCnt`;
4. on equal count, choose numerically smaller block hash;
5. require every candidate has the same channel and fork before comparison.

The selected block’s full snapshot commitment, not transaction count alone, determines source state.

### 6.3 Merge slash selection

The review’s intended model says each dispute may consume a subset of accumulated on-chain slashes. Current code also automatically adds every eligible on-chain slash recorded by the cutoff. These are different protocols.

Until resolved, the production rule is not final. Either accepted rule must satisfy:

- only participants in adopted plus pending membership at the cutoff can appear;
- every selected address has an on-chain slash at or before the cutoff;
- duplicates are removed;
- later slashes do not affect this reduction;
- the outcome is independent of dispute order.

If subset selection is accepted, the merge is the union of valid dispute-selected subsets. If mandatory consumption is accepted, reduction starts with all eligible cutoff slashes and dispute fields only prove awareness.

### 6.4 Merge timeout and self-removal

Insert every true self-removal’s disputer into a distinct set. For timeout, ignore unset claims. Among valid timeout claims, choose the smallest `blockHeight`. If equal heights name different participants, use the expected leader derived from the selected source state; any other claim is invalid. A second intrinsic tie-break must be specified if leader derivation cannot distinguish them.

If the final slash set is nonempty, do not also apply the selected timeout removal under current precedence. Self-removal still applies unless the same address is already slashed, in which case the slash consequence wins and duplicate removal is skipped.

### 6.5 Generate successor application state

1. Load the encoded application state linked to the selected latest snapshot.
2. Verify the inbound range from that snapshot head to the reduced head.
3. Process inbound messages in block and message order. Add each balance to cumulative deposits.
4. Apply each distinct slash through `slashParticipant` in canonical address order. Collect successful exit values.
5. Apply each distinct non-slashed removal through `removeParticipant` in canonical address order. Collect successful exits.
6. Require the state machine reports success for every required join, slash, and removal. A request for a participant not present after prior operations must have an explicit idempotent rule.
7. Combine exit messages in the same canonical operation order.
8. If exits exist, build one outbound block extending the latest snapshot outbound head and height, using the successor genesis timestamp rule.
9. Add exit balances to cumulative withdrawals and enforce the balance invariant.
10. serialize state, read participants, and construct successor snapshot data.

Canonical address order is required because input commitment order must not change serialized application state or outbound hash. Current code applies array order and therefore needs either proof of commutativity or sorting.

### 6.6 Enforce the balance invariant

For a valid snapshot:

```text
totalDeposits == totalWithdrawals + totalStateBalance
```

using application balance operations. Also require new totals are not below already processed on-chain totals, the requested inbound head resolves to the claimed deposits, and outbound stream totals resolve to claimed withdrawals. This check runs before committing a reduction and before adopting a supplied snapshot.

### 6.7 Commit reduction

1. Require kill deadline expired and result unset.
2. Compute successor data and fork ID.
3. Require equality with `expectedReducedForkId`.
4. store fork ID, current chain timestamp as reduction time, and eligible reducer;
5. emit `DisputeReducedResultCommitted`.

The challenge period begins at the actual reduction transaction timestamp.

### 6.8 Challenge reduction

1. Revalidate exact evidence and source data.
2. Recompute reduced output and successor fork.
3. If it matches the stored result, the challenge is false; apply the accepted false-challenge penalty to the challenger.
4. If it differs, record a slash against the prior reducer, replace the stored result, set reduction timestamp to current chain time, and set reducer identity according to the accepted policy.
5. Start a fresh challenge period for the replacement.

A challenged replacement must not become final immediately. Other participants need time to challenge the new result.

### 6.9 Same-fork snapshot update

1. Require at least one supplied milestone snapshot.
2. Require its last snapshot uses the currently adopted fork and is newer by block height.
3. Verify all milestone proofs from the adopted threshold snapshot.
4. Require the new snapshot has consumed the complete current on-chain inbound head. This avoids adopting a supposedly current final state that omits pending deposits.
5. Verify and apply only the new outbound stream difference.
6. verify balance invariant;
7. store the snapshot and emit update events;
8. clear safe obsolete evidence and inbound blocks only after all consumers no longer need them.

### 6.10 Successor-fork snapshot update

1. If target fork is already adopted, return idempotently.
2. Require target snapshot is a fork genesis: height zero and fork ID equal to snapshot-data hash.
3. Resolve its timestamp from a finalized reduced-result path beginning at the current adopted fork.
4. Walk successor links only through results whose challenge periods expired.
5. Require the target is on that path and timestamp equals its authoritative genesis time.
6. verify and apply outbound difference;
7. verify balance invariant and store target;
8. emit update events and perform safe cleanup.

## 7. Outputs and postconditions

Reduction commits one successor fork but does not adopt it. A successful challenge either leaves that fork and penalizes the challenger or replaces it and penalizes the reducer. Snapshot update adopts one state and processes exactly the unprocessed outbound difference.

If the new state has zero participants, the channel closes after outbound effects. Remaining funds need a specified treasury or recovery destination; current code contains only a TODO.

## 8. Invariants

- **RED-INV-1:** identical cutoff evidence and source data produce identical successor bytes.
- **RED-INV-2:** latest-state selection is greatest proved height, then smallest block hash.
- **RED-INV-3:** no post-cutoff inbound block or slash enters the result.
- **RED-INV-4:** merge sets contain no duplicates and use canonical application order.
- **RED-INV-5:** slash consequence has precedence over simple removal for the same address.
- **RED-INV-6:** successor origin is the disputed fork and successor fork is its snapshot-data hash.
- **RED-INV-7:** challenge replacement receives a full new challenge period.
- **RED-INV-8:** snapshot adoption never processes the same outbound block twice.
- **RED-INV-9:** snapshot adoption never skips an outbound ancestor.
- **RED-INV-10:** deposits equal withdrawals plus application balance at every adopted state.
- **RED-INV-11:** cleanup never deletes evidence needed to prove a live or challengeable successor.
- **RED-INV-12:** every completed window has exactly one finalized successor path.

## 9. Ordering, concurrency, and atomicity

Evidence arrival order cannot choose the latest state, slash union, timeout, self-removal set, or successor hash. Application operations need canonical order or a proved commutative state-machine contract. Chain order only determines the evidence cutoff and which competing valid reduction or challenge transaction executes first.

An expected fork ID makes duplicate reductions idempotent if they agree and stale if they disagree. Snapshot adoption is atomic with outbound asset calls. Cleanup happens after state and effects validate, within the same transaction.

## 10. Trust and security assumptions

Reducers and challengers are untrusted. Source state and streams are untrusted until hash and ancestry verification. The state machine must be deterministic and its balance operations must be total for supported values.

The longest-history rule assumes round-robin non-equivocation. The balance invariant assumes `Balance` addition, comparison, and state total correctly represent every controlled asset. Mixed assets require a component-wise model, not one scalar comparison unless `data` commits to the complete vector.

## 11. Failure behavior and recovery

A wrong expected result, missing evidence item, invalid source state, broken inbound range, failed application operation, or balance mismatch reverts without a stored result. A peer rebuilds exact calldata from window events and RPC auditing data.

A false challenge may penalize its eligible sender only under an accepted economic policy. An out-of-gas or verifier failure reverts without economic judgment.

If outbound asset transfer fails during adoption, the successor remains finalized but unadopted. Any participant may retry the same snapshot and stream range when the external failure is resolved.

## 12. Current implementation

`DisputeVerificationFacet.reduce` implements greatest transaction count and smaller-hash tie-break. It derives inbound cutoff from the kill deadline, includes eligible on-chain slashes up to that deadline, unions dispute slash arrays, chooses the smallest timeout height, and appends self-removals. `generateDisputeOutputState` applies inbound messages, slashes, then removals.

`reduceAndFinalize` verifies exact commitment order, computes output, checks expected fork, and commits. `challengeDisputeReduction` recomputes and slashes either reducer or challenger. On successful challenge it commits the replacement with a backdated timestamp, which makes its challenge period immediately expired.

`StateSnapshotFacet` implements same-fork and successor-fork adoption, outbound effects, closure, and cleanup. Current cleanup deletes slash records and all dispute windows, with a code comment questioning safety.

## 13. Difference from the intended design

| Classification     | Difference                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| decision pending   | dispute-selected slash subset versus automatic inclusion of all eligible cutoff slashes                      |
| bug                | successful challenge backdates replacement and gives no new challenge period                                 |
| missing            | canonical ordering or explicit commutativity requirement for slash and removal application                   |
| missing            | reducer eligibility check is commented out in `reduceAndFinalize`                                            |
| missing            | exact equal-height timeout tie rule                                                                          |
| decision pending   | successor construction when all commitments are killed                                                       |
| bug                | cleanup can delete slash and dispute evidence still needed by parallel or descendant recovery                |
| missing            | remaining-funds destination when zero participants close a channel                                           |
| documentation debt | height of an empty selected inbound head and genesis-only latest block need explicit encoded representations |

## 14. Dependencies and cross-layer effects

SDK reduction must produce byte-identical output, including set order. State-machine slash and remove operations define exits. Contract event replay tracks reduced paths. Message stream verification and consumer calls gate withdrawal. Storage retention must keep source snapshots, states, streams, and commitments through challenge and adoption.

## 15. Verification

Required tests include every permutation of the same dispute set; longest height and equal-height hash tie; post-cutoff slash and inbound exclusion; subset and mandatory slash modes once decided; duplicate and overlapping slash/removal; timeout height ties; application-order permutations; source linkage failure; balance inflation; honest late join; successful and false challenge; replacement challenge period; multi-hop successor adoption; repeated update; outbound prefix pruning; partial and failed consumer calls; safe cleanup; zero-participant close; and all-commitments-killed recovery.

Tests should compare Solidity output byte-for-byte with SDK output, not only compare selected participants.

## 16. Future work

An optimistic result-hash path can reduce gas when immediate adoption is not needed. It must use the same reduction function and challenge evidence, with no second semantic path.
