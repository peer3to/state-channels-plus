# SDK dispute construction, validation, proof handling, reduction, and adoption

## Status and authority

This chapter defines the SDK recovery pipeline from the first trigger through successor adoption. It distinguishes validation truth, proof construction, chain event state, and operation orchestration.

## 1. Purpose

Recovery combines data from local execution, peers, the local EVM mirror, and the production chain. The SDK must construct complete evidence, audit every remote commitment, submit objective proofs safely, reproduce Solidity reduction bytes, handle races, and move the state manager to the final successor without signing on stale forks.

## 2. Design decisions and rationale

### 2.1 Build disputes from one consistent local view

State proof, latest snapshot, encoded state, inbound range, slash set, timeout, and output hash must describe one instant. Reading them across concurrent block or event updates creates a commitment that no verifier can reproduce.

### 2.2 Validate cheap and objective structure first

Inbound-head ancestry, decodability, channel/fork headers, and block structure can invalidate a dispute before expensive replay. The pipeline runs them first and creates the narrowest executable kill proof.

### 2.3 Replay proof blocks through the block validator

Unfinalized state-proof blocks use the same authentication, leader, time, message, and transition predicates as normal blocks. A dispute strategy changes side effects: it creates a kill proof rather than broadcasting or disconnecting a historical source.

### 2.4 Local mirror is a cache, production views break ties

The local EVM provides fast shared predicates. If a stateful result such as slash subset fails locally, the SDK checks the production manager before creating proof. Mirror lag must not create a false accusation.

### 2.5 Reduction submission is simulate, send, classify, reconcile

The SDK first computes and simulates exact calldata. On-chain submission may still lose a race. Known race errors are classified against canonical result, while unknown errors remain failures and do not become peer fault.

## 3. Boundary and responsibilities

`DisputeManager` builds, signs, stores, broadcasts, uploads, and kills disputes. `DisputeValidationService` audits one dispute. `DisputeValidationStrategy` audits state-proof blocks. Fraud proof services store exact proof envelopes. `EventSyncService` supplies canonical windows and slashes. Reduction manager/computation/executor own reduction. `SnapshotUpdateService` prepares and submits adoption.

## 4. Data model and owned state

### 4.1 Local dispute record

Store exact signed dispute bytes, confirmation signatures, hash, auditing data or availability reference, source peer/event coordinate, validation status and version, generated proof hashes, upload transaction identity, and canonical commitment status.

### 4.2 Proof record

A proof record contains type, target, exact encoded evidence, source validation failure, preflight block tag and result, submission state, transaction hash, canonical result event, and duplicate key. Proof bytes are immutable after hash creation.

### 4.3 Reduction operation

Per disputed fork, store operation generation, evidence commitment list and event coordinate, kill deadline, source disputes, computed output, source state and streams, expected successor, simulation result, transaction state, canonical result, and completion promise.

### 4.4 Validation status

Dispute status is unseen, awaiting data, validating, valid, invalid-with-proof, invalid-without-proof, committed, killed, included-in-reduction, and obsolete. Only canonical events set committed or killed.

## 5. Inputs and preconditions

Construction requires active or disputed local fork, durable latest state, proof material, authoritative slash view, valid recovery reason, chain clock, and no conflicting local dispute signature for the window.

Validation requires exact dispute commitment, auditing data when posted or fetched, fork genesis, referenced snapshots and states, stream blocks, local contract version, and current canonical window phase.

Reduction requires kill expiry, exact surviving commitments, all audit data, source state for selected view, inbound range, and eligible transaction signer.

## 6. Processing algorithm

### 6.1 Trigger and coalescing

1. Receive trigger from objective fraud result, timeout scheduler, self-exit request, force-inbound timer, canonical dispute event, or mismatched-fork recovery.
2. Key operation by channel and fork.
3. If a current operation exists, merge trigger reasons and return its completion.
4. If fork changed or operation generation was canceled, discard trigger.
5. Stop normal old-fork authoring before constructing evidence.

### 6.2 Construct local dispute

Under the state-manager mutex:

1. snapshot fork, latest valid block, latest snapshot, latest final anchor, encoded state hashes, current inbound and outbound heads, participant contexts, local timeout, self-removal, forced join, and canonical slash set version;
2. select recovery reasons and reject an empty reason set;
3. record immutable construction version and release lock.

Outside the lock:

4. ask `AgreementManager` for proof through the latest block, including milestones and trailing non-final suffix;
5. gather paired milestone snapshots, final and latest application states, inbound range to requested chain head, and required outbound history;
6. select valid slash subset or mandatory set according to the resolved policy;
7. build timeout fields from authoritative predecessor time and calldata evidence;
8. compute successor output through local contract/state machine;
9. enforce balance invariant;
10. create auditing data and hash;
11. encode dispute, sign it, and compute commitment.

Reacquire lock and require construction version unchanged. Atomically store dispute, audit data, signature, and non-equivocation record. Then broadcast for validation and confirmation.

### 6.3 Validate intake structure

For a remote or event dispute:

1. verify envelope signature and disputer identity;
2. verify channel, fork, commitment, source event, and resource bounds;
3. query authoritative inbound ancestry. If the claimed hash/height is not in chain, build `DisputeInboundHashNotInChain`;
4. decode all state-proof blocks without partial persistence;
5. if undecodable and posted audit data exists, build invalid-state-proof evidence; if no executable proof exists, mark invalid-without-proof and keep it out of local agreement;
6. call contract header-mismatch predicate;
7. call first-invalid-structure predicate;
8. stop at first proof that is sufficient to kill.

### 6.4 Resolve and verify auditing data

If data was posted, require event payload and hash. If hash-only:

1. request from disputer and other peers by commitment;
2. enforce response deadline and byte limits;
3. verify hash before decode;
4. if unavailable, start forced publication or unavailable-data kill path;
5. if last final milestone or its state is already stored, use it as a trusted local anchor only after hash equality.

Call `verifyStateProof` through local or production-compatible contract. A revert becomes invalid only when it is a deterministic input verdict. Internal, gas, artifact, or mirror error stops validation without creating proof.

### 6.5 Replay the unfinalized proof section

1. Ask contract helper for the unfinalized `BlockConfirmation` sequence under the intended proof model.
2. For each block index, instantiate `DisputeValidationStrategy` with dispute and index.
3. Reposition state machine to that block’s predecessor state.
4. feed block through `StateManager.onBlockConfirmationStruct` with live fork/order gates disabled;
5. on an objective block fault, create normal block fraud proof and wrap it in the matching dispute kill proof where required;
6. on invalid structure or outsider author, require the canonical Solidity predicate before storing kill proof;
7. abort replay only when a stored executable dispute fraud proof exists. False without a proof is an internal invariant failure.

Historical replay must use an isolated state namespace or restore live canonical state after each block. It must not merge replayed blocks into the active fork unless exact hash already belongs there.

### 6.6 Run remaining dispute checks

After proof replay:

1. verify latest snapshot hash is correct for final proof block or genesis;
2. load encoded state by latest snapshot hash;
3. verify dispute slash selection against local mirror, then production chain on mismatch;
4. call balance invariant verifier;
5. find a newer block signed by the disputer; if present, build not-latest proof;
6. validate timeout height is exactly after latest proof block;
7. set state machine to latest state and verify timeout participant is next author;
8. compare window creation with objective timeout minimum, using exact equality rule;
9. defeat timeout if target block reached full threshold;
10. defeat timeout if valid matching calldata was posted in time;
11. verify self-removal belongs to disputer;
12. verify at least one valid dispute reason;
13. recompute dispute output state, snapshot data, and output hash;
14. verify inbound and outbound auditing ranges;
15. if all pass, atomically store validated data and allow confirmation.

These checks may prepare independent data in parallel, but proof selection follows this order so one deterministic minimal proof is submitted.

### 6.7 Proof submission

1. Deduplicate proof by encoded hash and target.
2. Confirm dispute commitment still exists and kill period is live.
3. Re-run production `staticCall` at latest block with exact sender.
4. Distinguish valid proof, invalid claim, race loss, verifier error, and out-of-gas.
5. Submit one proof transaction and persist transaction hash before waiting.
6. Reconcile only from canonical slash/kill event.
7. Cancel later redundant proofs against the killed commitment or slashed target.

Current code often creates proof records but automatic submission coverage needs audit.

### 6.8 Synchronize a window for reduction

1. Query canonical commitment order and phase times from event store plus manager view.
2. For each commitment, load local dispute or request exact bytes and audit data.
3. verify hash and validation status;
4. wait for any live kill transactions to resolve before cutoff;
5. at kill expiry, refresh canonical list because a final kill may have changed it;
6. require local list equals chain list byte for byte and freeze reduction generation.

### 6.9 Compute local reduction candidate

1. Pass exact disputes to local contract `reduce` or a byte-equivalent TypeScript service.
2. select source latest snapshot and encoded state from `latestBlock` or fork genesis;
3. retrieve exact inbound range to reduced head;
4. call `reduceOutputToSnapshotData` locally;
5. capture successor encoded state and generated outbound block;
6. create successor genesis snapshot with authoritative genesis timestamp rule;
7. hash snapshot data and require equality with expected successor;
8. atomically store candidate under reduction generation, but do not make it canonical.

### 6.10 Simulate and submit reduction

1. Build `reduceAndFinalize` calldata from exact candidate.
2. `staticCall` against production manager with sender.
3. On expected race, query current result and classify already-reduced or threshold-final superseded.
4. On success, send transaction and persist its identity.
5. Wait for receipt and then canonical reduced-result event.
6. If event result differs from local candidate, start challenge preparation, do not adopt it.
7. Complete operation only after canonical event and local successor material are available.

Reducer eligibility is a protocol requirement even though the current contract check is commented out.

### 6.11 Challenge and replacement

On mismatched result:

1. pin exact commitment set and source data used by the event result;
2. recompute locally and simulate `challengeDisputeReduction`;
3. submit within challenge deadline with safety margin;
4. reconcile slash and replacement events;
5. reset local challenge deadline from replacement timestamp;
6. do not adopt until replacement challenge period expires.

### 6.12 Adopt successor and same-fork progress

`SnapshotUpdateService` first prepares any finalized successor path from current on-chain snapshot. It walks reduced results and requires each challenge period expired. It loads target genesis and outbound range. It then prepares same-fork milestone update from the snapshot that will result after the fork update, not from the old chain snapshot.

Both calls may be sent in one `multicall`: successor adoption first, same-fork advancement second. Preparation always completes; `canPost` decides eligibility. Expected snapshot and ranges are persisted with the submitted operation. On canonical update event, state manager transitions fork, cancels old timers and queue work, sets successor genesis, replays later blocks, and resumes.

## 7. Outputs and postconditions

Construction produces one durable signed local dispute. Validation produces valid status or one executable kill proof. Reduction produces one local candidate and one canonical event result. Adoption produces canonical local fork and head equal to manager state.

## 8. Invariants

- **DIS-SDK-INV-1:** one local construction uses one immutable state and event version.
- **DIS-SDK-INV-2:** invalid verdict that triggers kill has a stored executable proof.
- **DIS-SDK-INV-3:** mirror mismatch is checked against production before accusation.
- **DIS-SDK-INV-4:** replay cannot mutate active canonical state.
- **DIS-SDK-INV-5:** reduction uses exact surviving canonical commitment order.
- **DIS-SDK-INV-6:** local successor bytes equal Solidity computation.
- **DIS-SDK-INV-7:** submitted operation identity is durable before asynchronous receipt wait.
- **DIS-SDK-INV-8:** race error is classified from canonical state, never guessed from text alone.
- **DIS-SDK-INV-9:** old-fork work cannot mutate after successor generation change.
- **DIS-SDK-INV-10:** snapshot update processes only proved outbound descendants.

## 9. Ordering, concurrency, and atomicity

One validation per dispute hash may run at a time. Independent signature recovery, state fetching, and proof predicates can run in parallel. State-machine replay and canonical storage commit are serialized. Reduction uses one single-flight operation per fork and coalesces triggers.

No chain receipt wait holds the state-manager mutex. Every completion reacquires it and checks operation generation, fork, window commitment version, and event coordinate.

## 10. Trust and security assumptions

Peer audit data, local mirror, provider results, reducer transaction, and challenger are untrusted. Contract bytecode and state-machine artifact version are trusted configuration. Local simulations can be stale one block later, so on-chain checks remain authoritative.

Full audit data and source state may be large. Without bounds and durable retention, a valid recovery can exhaust memory or become unavailable after restart.

## 11. Failure behavior and recovery

Missing peer data waits only until publication/kill deadline. A mirror error triggers resync, not proof. Worker or state-machine failure moves runtime to degraded. Submission failure retains durable candidate and transaction data for reconciliation.

After crash, event sync reconstructs canonical phase. Storage resumes pending validation, proof, reduction, challenge, or adoption based on canonical result, not by replaying the original trigger blindly.

## 12. Current implementation

The current classes implement most stages, including structural contract checks, proof replay through strategies, slash double-check against production, timeout checks, balance invariant, local reduction, static simulation, race classification, and combined snapshot multicall.

Important current comments admit gaps: hash-only undecodable dispute may be treated as continuing because no proof can fire; unavailable local final milestone can skip audit; cross-audit calldata races remain; proof creation does not always submit immediately; storage is in memory. The proof builder omits milestone-plus-suffix.

## 13. Difference from the intended design

| Classification     | Difference                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| bug                | a dispute with undecodable proof and no posted audit data can escape a kill because no executable proof path exists |
| bug                | hash-only dispute may remain accepted when its final anchor or audit data is unavailable locally                    |
| bug                | state proof builder omits suffix after milestones                                                                   |
| missing            | forced audit-data publication or missing-data invalidation                                                          |
| missing            | durable operation, proof, transaction, and event state                                                              |
| missing            | complete automated proof submission and deduplication policy                                                        |
| documentation debt | minimal proof selection order is implicit across early returns                                                      |
| missing            | isolated historical replay state with explicit rollback guarantee                                                   |
| missing            | full challenge orchestrator and fresh replacement period handling                                                   |
| decision pending   | all-killed successor and slash selection policy                                                                     |

## 14. Dependencies and cross-layer effects

This pipeline depends on block validator, state proof builder, chain time, event sync, local contract mirror, durable storage, P2P RPC, state machine, fraud contracts, reduction contract, and consumer effects. A change in any proof predicate requires coordinated SDK, Solidity, and E2E vectors.

## 15. Verification

Tests must cover every early-return check and show the exact proof stored; no-proof internal failure; posted and hash-only audit paths; missing data; replay state isolation; mirror lag and production double-check; every timeout defense; output and balance mismatch; proof deduplication and chain race; reduction single-flight; exact commitment refresh at cutoff; simulation success and each race class; wrong canonical result challenge; restart at every stage; replacement challenge; multicall order; and fork transition cancellation.

## 16. Future work

Optimistic audit and reduction can reduce gas and bandwidth, but only after missing-data and restart paths are complete.
