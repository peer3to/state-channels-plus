# Fraud enforcement and dispute recovery protocol

## Status and authority

This chapter defines the cross-layer recovery protocol. Contract phase and reduction algorithms are in [dispute lifecycle](../contracts/dispute-lifecycle.md) and [reduction and snapshots](../contracts/reduction-and-snapshots.md). SDK validation and orchestration are under the SDK dispute chapter.

## 1. Purpose

Recovery must handle two different problems:

- a participant made an objectively provable invalid commitment;
- peers cannot continue or agree, even though no Byzantine fault is proved.

Fraud proofs solve the first. The dispute game solves the second and consumes any fraud results already recorded. Combining them would make every recovery replay all faults and would mislabel normal unavailability as fraud.

## 2. Design decisions and rationale

### 2.1 Immediate binary fraud enforcement

When the block pipeline finds objective evidence, it attempts the matching on-chain proof. The result is binary: the target is added to the slash set, or it is not. Later reduction consumes the slash set and does not need the original proof again.

### 2.2 Disputes gather proved views, not opinions

Each eligible participant submits its latest state proof and recovery inputs. Different latest states may all be valid non-final descendants. Reduction compares their proved histories rather than choosing the first or the most popular submission.

### 2.3 Four valid dispute input classes

One dispute may request:

1. selected objective slashes;
2. deterministic author timeout;
3. voluntary self-removal;
4. forced inbound progress.

At least one must be present and valid. Application transaction disagreement without one of these recovery reasons does not open a window by itself.

### 2.4 Evidence is optimistic but challengeable

The chain may store only a hash of full auditing data. Peers exchange it through RPC and run the same validation locally. When data or validity fails, challengers publish the proof required to kill the commitment.

Optimistic storage is valid only if a missing-data commitment cannot survive. The current design needs a complete forced-publication or invalidation rule.

### 2.5 Reduction converges by intrinsic rules

The result is a function of valid evidence and an objective cutoff, not of transaction arrival order. Latest state uses greatest proved block height, then smallest block hash. Set inputs use deduplicated union or the accepted slash-selection rule. Timeout uses earliest valid missing height with a deterministic tie. Application effects use canonical order.

### 2.6 Recovery always creates a successor

The disputed fork does not resume after reduction. The result is new genesis snapshot data whose hash is the new fork ID. This remains required if the result only removes one unavailable participant, only forces an inbound join, or has no surviving dispute commitment.

## 3. Boundary and responsibilities

Validation discovers objective faults and builds proof candidates. Fraud proof contracts record slashes. Dispute manager constructs local evidence and gathers signatures. RPC serves auditing data. Contract windows order and time commitments. Reducers compute successor state. Event sync returns every peer to the same fork.

## 4. Data and states

### 4.1 Objective slash set

This is an append-only, timestamped per-channel set for the active recovery horizon. Membership immediately removes an address from eligible dispute and threshold actions. Application punishment waits for successor generation.

### 4.2 Dispute view

A view commits to channel, fork, latest snapshot, state proof, inbound progress, slash choice, optional timeout, optional self-removal, auditing data, and computed output. The disputer signs exact bytes and is accountable for false claims.

### 4.3 Recovery state machine

| State           | Entry                                           | Valid work                                                                  | Exit                  |
| --------------- | ----------------------------------------------- | --------------------------------------------------------------------------- | --------------------- |
| normal          | active fork, no window                          | fraud proof or first dispute                                                | first commitment      |
| evidence        | window opened                                   | one view per eligible participant, audit data exchange, fraud proof results | evidence deadline     |
| kill            | evidence additions closed                       | dispute fraud proofs and data-availability challenges                       | kill deadline         |
| reduction       | surviving set fixed                             | compute and commit successor                                                | reduction transaction |
| challenge       | proposed successor stored                       | recompute and challenge                                                     | challenge deadline    |
| successor final | result unchallenged or final challenge resolved | snapshot adoption                                                           | successor adopted     |
| resumed         | peers rebuild from successor                    | normal execution                                                            | later fault or close  |

## 5. Inputs and preconditions

An objective fraud proof must be deterministic, fully linked to signed or on-chain commitments, and executable within bounds. A dispute requires eligible signer, exact active fork, recoverable state proof, valid inbound ancestor, committed auditing data, one valid reason, and chain-live deadline.

A participant already slashed on chain cannot submit, confirm threshold-final evidence, reduce, or challenge. A pending joiner is eligible for recovery because its deposit may need forced inclusion.

## 6. Processing algorithm

### 6.1 Objective fault path

1. Full block or dispute validation returns a typed objective failure.
2. Map failure to one proof type. If no proof exists, record the security coverage gap and use safe dispute recovery without claiming a slash.
3. Gather the minimal commitment-linked evidence.
4. Preflight through the same contract verifier at current chain state.
5. Deduplicate against local pending and canonical slash state.
6. Submit before any proof deadline.
7. Wait for canonical result event and update eligibility.
8. If submission fails because evidence is stale or a chain race changed context, rebuild. Do not infer target innocence or sender fault from transaction failure alone.

### 6.2 Decide whether to dispute

Start dispute when at least one holds:

- a selected on-chain slash needs application consequence;
- deterministic next author missed its objective deadline;
- local participant requests self-removal;
- current on-chain inbound head is newer than the latest valid application state and normal inclusion failed.

Conflicting valid latest views are attached after a window exists. A peer should not wait for explicit finality before using its latest valid view.

### 6.3 Build local dispute

1. Lock one consistent local channel view.
2. Read latest valid block and snapshot, latest final anchor, encoded application states, streams, confirmations, pending membership, timeouts, and canonical slash set.
3. Build the shortest valid state proof from fork genesis or retained milestones to latest block, including non-final suffix.
4. Select the inbound head allowed by current chain evidence.
5. Apply the accepted slash-selection policy.
6. Add at most one valid timeout, self-removal, and forced-inbound reason.
7. Build complete auditing data and compute its hash.
8. Replay successor generation locally and commit output snapshot data hash.
9. Run every contract audit predicate through the local EVM.
10. Sign and persist exact dispute bytes before broadcast.

### 6.4 Exchange and validate off chain

Peers gossip dispute bytes and signatures. They request auditing data by dispute hash. Validation checks signer, eligibility, state proof, latest state, stream ranges, recovery reason, slash selection, timeout, output state, and balance invariant. Work that needs independent data can run in parallel, but final acceptance uses one immutable chain and storage view.

Invalid objective claims produce dispute fraud-proof candidates. Missing auditing data starts the publication or invalidation path. A valid view is stored and may receive a local confirmation signature.

### 6.5 Publish evidence

The disputer submits one commitment, optionally with auditing data. The contract binds sender, signer, channel, fork, deadline, and one-post rule. Peers reconcile from the event and fetch any missing audit data.

If every eligible threshold participant signs the same fully verified dispute, the fast path may finalize it. Unanimous signatures do not remove proof and accounting verification.

### 6.6 Kill invalid evidence

Before kill deadline, a challenger submits one deterministic dispute fraud proof. A valid proof slashes the disputer and removes only its commitment. Invalid sender punishment follows the accepted economic policy. Removal preserves survivor order, although semantic reduction cannot depend on that order.

### 6.7 Reduce surviving views

1. Freeze cutoff at kill deadline.
2. Verify the supplied list equals all surviving commitments.
3. Validate any data not already proved by a kill path.
4. choose greatest proved block count, then smallest block hash;
5. select inbound prefix up to cutoff;
6. merge eligible cutoff slashes under the final policy;
7. union self-removals;
8. choose earliest valid timeout and apply slash precedence;
9. replay inbound messages, slash consequences, and removals through the state machine;
10. build outbound exits and enforce balance conservation;
11. hash successor snapshot data and commit result.

### 6.8 Challenge result

Any eligible participant recomputes from exact evidence. A mismatch challenge replaces the result, slashes prior reducer under the accepted policy, and starts a fresh challenge period. A matching challenge may slash challenger only if false-challenge economics are approved and verifier failures are excluded.

### 6.9 Adopt and resume

After challenge expiry, any caller supplies successor genesis snapshot and outbound difference. The manager follows the finalized reduced-result path, applies outbound messages, and adopts the successor. SDK event sync stops old-fork authoring, cancels timers, stores successor genesis state, updates membership, reconnects the mesh, and resumes from transaction zero.

## 7. Outputs and postconditions

Fraud enforcement produces a logical slash. Dispute completion produces one final successor fork. Adoption makes that fork canonical and may release outbound assets. No recovery path directly edits an old block or old snapshot.

## 8. Invariants

- **REC-INV-1:** objective slash requires deterministic commitment-linked evidence.
- **REC-INV-2:** unavailability does not imply Byzantine fault.
- **REC-INV-3:** every committed dispute binds complete auditing data even if bytes stay off chain initially.
- **REC-INV-4:** every surviving dispute has one valid recovery reason.
- **REC-INV-5:** semantic reduction is independent of evidence arrival order.
- **REC-INV-6:** valid non-final progress can win latest-state selection.
- **REC-INV-7:** post-cutoff chain changes do not alter a reduction.
- **REC-INV-8:** one completed window has one finalized successor.
- **REC-INV-9:** a replacement reduction has a new challenge period.
- **REC-INV-10:** successor adoption is required before dispute-generated exits settle.

## 9. Ordering, concurrency, and atomicity

Peer validation and proof construction can be parallel. Chain phase transitions and commitment mutations are serialized. SDK must cancel stale work when a slash, kill, reduction, challenge, or successor event changes the input version.

Permutation convergence requires set operations and application changes to use canonical order or proved commutativity. Arrival order may decide which transaction pays gas first but not output bytes.

## 10. Trust and security assumptions

At least one honest participant in each relevant partition must observe chain events and act before deadlines. Every participant may otherwise be Byzantine. Chain censorship lasting past deadlines can violate liveness. Full audit data must remain available through challenge and adoption.

Invalid-proof and false-challenge penalties are high-risk economic rules. Ambiguous errors, out-of-gas, reorganization, or adapter failure must never be interpreted as an objective lie.

## 11. Failure behavior and recovery

If a proof type is missing, reject the block locally and enter dispute without automatic slash. If audit data is unavailable, force publication or kill the commitment. If no participant can submit before deadline, recovery can fail under the stated chain-access assumption.

If every commitment is killed, the protocol still needs a default successor based on authoritative adopted state and cutoff inputs. This algorithm is unresolved and blocks a complete production design.

If snapshot adoption fails because an external transfer fails, the final successor remains retryable. Peers should not author on it until the application’s adoption policy says local execution can safely proceed.

## 12. Current implementation

The repository implements separate block and dispute fraud facets, SDK fraud-proof services, dispute validation strategies, event synchronization, reduction manager and executor, and snapshot update service. E2E suites cover many invalid dispute fields, state-proof cases, balance invariant, timeouts, force join, reductions, final dispute, and fuzzed recovery.

Known current behavior automatically includes all eligible cutoff slashes in reduction, rejects milestone-plus-suffix state proofs on chain, backdates a successful challenge replacement, and has no no-survivor successor rule.

## 13. Difference from the intended design

| Classification   | Difference                                                      |
| ---------------- | --------------------------------------------------------------- |
| decision pending | slash subset selection versus mandatory cutoff set              |
| missing          | forced audit-data publication or unavailable-data kill rule     |
| missing          | complete objective fault coverage matrix                        |
| bug              | contract state proof rejects final anchor plus non-final suffix |
| bug              | successful challenge replacement has no fresh challenge period  |
| decision pending | exact no-survivor successor                                     |
| missing          | approved invalid-proof and false-challenge economic model       |
| missing          | durable restart and reorganization recovery for every phase     |

## 14. Dependencies and cross-layer effects

Execution produces proof material. Time determines phase and timeout validity. Membership determines eligibility. Streams determine forced inbound and exits. State machine defines slash and removal output. Contracts enforce final order. SDK storage must retain all evidence through the full recovery horizon.

## 15. Verification

Required coverage includes every fraud and dispute proof predicate, unavailability without fraud, four dispute reasons alone and combined, optional audit data, missing data, exact deadlines, all evidence permutations, non-final longest state, equal-height tie, slash cutoff, timeout precedence, all killed, successful and false challenge, replacement challenge, successor adoption, transfer retry, restart, partition, provider delay, censorship window, and reorganization.

Fuzzing must assert convergence and conservation, not only absence of revert.

## 16. Future work

Optimistic result commitments and threshold-agreed fast paths can reduce gas. They must use the same successor function and retain a complete challenge route for offline participants.
