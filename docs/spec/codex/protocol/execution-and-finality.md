# Execution, authoring, confirmation, and finality

## Status and authority

This chapter defines peer-visible execution rules. [SDK block pipeline](../sdk/block-confirmation-pipeline.md) defines the current component algorithm. [Contract state proofs](../contracts/state-proofs-and-finality.md) define the on-chain verifier.

## 1. Purpose

Peers need to agree which transaction can follow a state, verify its result independently, and accumulate finality without pausing after every block. The protocol must also retain enough proof material to carry valid non-final progress into a dispute.

## 2. Design decisions and rationale

### 2.1 The state machine chooses the next author

Round-robin is the recommended V1 policy, but the actual address is returned from the current application state. This keeps turn order deterministic and able to react to joins and removals. A block by another author is invalid even if its application call would otherwise succeed.

### 2.2 One block contains one transaction and a resulting state commitment

Peers replay one application transaction from one predecessor snapshot. The block also carries the ordered inbound message blocks consumed before or during that transition and commits to the resulting snapshot. This makes invalid state, forged inbound data, wrong author, and wrong ancestry separately provable.

### 2.3 Validation is staged

Cheap identity, size, decode, and signature checks run before storage and state-machine work. Ordering and predecessor checks run before replay. Replay runs before the receiver signs. This limits resource abuse and ensures no confirmation is issued for bytes the receiver did not fully validate.

### 2.4 Later signatures create virtual votes

Signing a descendant votes for its ancestry. Finality can therefore arrive after execution moved forward. A linked sequence whose distinct signers cover the full relevant participant set finalizes its earliest anchor.

### 2.5 The receiver signs only after durable acceptance

A crash between sending a confirmation and saving the validated block can leave the peer unable to prove what it signed. Durable block, snapshot, state, and non-equivocation records must commit before confirmation leaves the node.

## 3. Boundary and responsibilities

The author constructs and signs a block. Receivers authenticate, deduplicate, order, replay, and confirm. Agreement management collects distinct signatures and builds milestones. Storage retains predecessor state and signed commitments. Network code only transports messages; it does not decide validity.

## 4. Data model and state

### 4.1 Transaction header

The header contains channel ID, participant address, fork ID, transaction count, and protocol timestamp. The body contains encoded application call data and optional application metadata. Header fields are signed as part of the block.

### 4.2 Block linkage

For transaction zero, the parent commits to the authoritative fork genesis snapshot representation. For later blocks, `previousBlockHash` equals the hash of the exact encoded parent block. Counts begin at zero and increase by one.

### 4.3 Snapshot transition

The resulting snapshot stays on the same fork during normal execution, increases block height consistently, sets timestamp to block protocol time, hashes the serialized application state, records current participants, and advances stream heads only by included linked messages.

### 4.4 Local block status

A peer tracks at least:

| Status        | Meaning                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| received      | bytes passed transport frame checks but are not trusted                   |
| authenticated | envelope, channel, sender, decode, and author signature passed            |
| waiting       | valid shape but predecessor or required message data is missing           |
| validated     | replay produced the exact claimed result                                  |
| confirmed     | local signature durably recorded and sent                                 |
| final anchor  | direct or virtual signer coverage finalized the snapshot                  |
| rejected      | objective predicate failed; proof or dispute work may exist               |
| obsolete      | valid bytes belong to a fork no longer canonical after successor adoption |

## 5. Inputs and preconditions

An authored transaction requires local channel active, canonical fork known, local participant equals `getNextToWrite`, no conflicting local signature for the same position, and all required predecessor and inbound data present.

An incoming block requires a completed peer handshake, authenticated peer identity, supported protocol version, bounded encoded length and nesting, channel membership or allowed spectating context, and a recoverable predecessor relation.

## 6. Processing algorithm

### 6.1 Authoring

1. Read the current canonical local snapshot, encoded application state, latest block, and pending inbound head in one consistent storage view.
2. Ask the state machine for the next author. Abort if it is not the local signer.
3. Select the next ordered inbound message range permitted by the application and protocol. Do not skip an earlier unconsumed block.
4. Build a transaction header with the same channel and fork, next count, and protocol clock value.
5. Execute the transaction through the same state-machine interface receivers use.
6. Apply selected inbound blocks in the defined order and collect outbound messages in deterministic order.
7. Construct the resulting snapshot and outbound block commitments.
8. Build block bytes with correct parent hash and included inbound blocks.
9. Re-run local validation against an immutable predecessor view.
10. Atomically persist block, resulting snapshot, encoded state, stream material, and local signed-position record.
11. Sign exact encoded block bytes and persist the signature.
12. Gossip the signed block to all active participants.

If the implementation executes inbound messages before the application call instead of after it, that order must be fixed for the protocol version and shared by contract fraud replay. Current code paths need an audit to confirm one order.

### 6.2 Intake and cheap validation

1. Enforce transport and RPC frame limits before ABI decode.
2. Bind network peer identity to the claimed signer where the message source makes that claim.
3. Decode without mutating protocol state.
4. Require channel and fork context is known or explicitly being synchronized.
5. Require header author is nonzero and author signature recovers that address.
6. Compute block identity and deduplicate exact repeats.
7. Detect a conflicting block at the same fork and count by the same signer. Preserve both for a double-sign proof.
8. Enqueue by channel, fork, and transaction count.

### 6.3 Ordering and data recovery

The queue processes only the next count after the current accepted head. A future block waits within a bounded queue. The peer requests its predecessor and referenced inbound blocks from the sender and other peers. If the author has posted chain calldata, it also consumes that event path.

A waiting item has a deadline and bounded retries. Queue overflow drops or rejects lowest-priority future data while preserving the next executable block and active recovery evidence. Failure to obtain required data escalates to calldata fallback or dispute, not silent skip.

### 6.4 Full validation and replay

For the next block:

1. Re-read canonical predecessor inside the serialized state-manager operation.
2. Require parent hash and count continuity.
3. Require channel and fork equality.
4. Load predecessor encoded state and require its hash equals predecessor snapshot.
5. set state machine to predecessor state;
6. require header participant equals deterministic next author;
7. verify timestamp rules against predecessor and authoritative calldata time when present;
8. verify included inbound blocks are real, linked, consecutive, unconsumed, and end at the claimed head;
9. execute the transaction under the configured gas limit;
10. build outbound message block from emitted messages;
11. compute all resulting snapshot fields and require exact hash equality with block claim;
12. enforce balance conservation;
13. atomically persist accepted block, state, snapshot, message data, validation result, and non-equivocation record;
14. only after persistence, sign and send confirmation.

### 6.5 Confirmation collection

For each exact block hash, accept at most one signature per expected participant. Verify signature before storage. A confirmation from an outsider may be retained for audit but has no threshold weight. Senders gossip new valid confirmations so the mesh converges.

### 6.6 Finality calculation

1. Choose a candidate anchor block.
2. Walk its accepted descendant chain.
3. Collect distinct valid signers from author and explicit confirmation signatures on every walked block.
4. Use the membership threshold context valid for the anchor-to-result hop.
5. When the signer set covers every required address, mark the anchor snapshot final.
6. Store a milestone containing the minimal linked confirmation segment and paired snapshot context.
7. Continue execution from the latest valid state; finality marking does not change the head.

### 6.7 Dispute escalation

Escalate when an objective validation predicate fails, required data remains unavailable through its fallback deadline, deterministic author timeout becomes valid, conflicting valid views persist, or a participant asks to self-remove or force inbound progress. Objective faults attempt fraud proof first. Unavailability enters dispute without being called fraud.

## 7. Outputs and postconditions

Successful validation produces durable block, snapshot, state, streams, local confirmation, and possible final-anchor advancement. Rejection produces a typed reason and, where possible, a proof candidate. It never advances canonical local state.

## 8. Invariants

- **EXE-INV-1:** one accepted block position has one locally signed history per participant.
- **EXE-INV-2:** every accepted child links to the exact accepted parent.
- **EXE-INV-3:** every accepted snapshot is reproduced by deterministic replay.
- **EXE-INV-4:** no peer confirmation is sent before durable acceptance.
- **EXE-INV-5:** duplicate delivery does not repeat replay, signature, or gossip work beyond bounded acknowledgment.
- **EXE-INV-6:** future blocks never skip the next required count.
- **EXE-INV-7:** virtual votes count only across one linked accepted history.
- **EXE-INV-8:** finality signer coverage uses the membership context of the proved hop.
- **EXE-INV-9:** non-final valid descendants remain available for dispute carry-forward.
- **EXE-INV-10:** objective invalidity cannot mutate canonical state.

## 9. Ordering, concurrency, and atomicity

Different channels may validate in parallel. One channel and fork requires serialized state mutation. Signature verification, byte hashing, and data fetch can run in parallel before the final compare-and-commit step. That step revalidates the predecessor version to reject stale work.

Gossip arrival order is irrelevant. Queue order is transaction count plus parent ancestry. Equal-position conflicts remain separate evidence; no first-arrival rule chooses a winner.

## 10. Trust and security assumptions

All peers, including the current author, may be Byzantine. State-machine determinism, signature security, hash collision resistance, and at least one honest participant with chain access in each relevant partition are assumptions. Resource bounds are necessary because many valid-looking signatures and future blocks can consume CPU and memory.

The claim that non-final progress can be carried safely depends on round-robin authoring and complete double-sign enforcement. Other leader policies remain unresolved.

## 11. Failure behavior and recovery

Missing predecessor or message data moves a block to waiting state. Invalid bytes reject it. State-machine execution error creates an invalid-transition candidate. Local worker crash aborts the operation and restarts from durable head. Confirmation send failure retries idempotently because signature and block are already stored.

If a peer receives a chain calldata block after P2P acceptance, it deduplicates by block hash but records the on-chain timestamp for timeout and fraud-proof logic.

## 12. Current implementation

`StateManager`, `BlockQueueManager`, `ValidationService`, validation strategies, `AgreementManager`, model and storage classes implement this flow in parts. E2E tests cover state transitions, queueing, fraud proof creation, timeouts, and snapshots.

The current storage backend is memory-based, and queue retention is capped at 128 records. The precise durable-before-confirm order, retry state, and restart recovery are not production complete. Contract proof verification also rejects milestone-plus-suffix composition.

## 13. Difference from the intended design

| Classification     | Difference                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| missing            | durable atomic commit of block, state, snapshot, streams, signature, and queue result                 |
| missing            | full waiting-data retry and escalation state machine                                                  |
| documentation debt | exact inbound-versus-transaction execution order must be confirmed across all replay paths            |
| missing            | expected-author validation is not uniformly stated in every current validator and contract proof path |
| bug                | contract cannot verify milestone plus non-final suffix                                                |
| missing            | complete equivocation preservation and automatic double-sign submission path                          |
| decision pending   | bounded long-history milestone retention and proof compaction                                         |
| decision pending   | leader election beyond round robin                                                                    |

## 14. Dependencies and cross-layer effects

Time rules come from [time and data availability](time-and-data-availability.md). Membership threshold comes from [messages and membership](messages-membership-and-settlement.md). Fraud and dispute escalation comes from [disputes](disputes-and-fraud-proofs.md). Storage, networking, worker runtime, and validation details are specified under SDK.

## 15. Verification

Tests must cover every intake source, duplicate and conflict, future block and missing parent, invalid signature and author, wrong channel or fork, expected leader, replay failure, forged inbound block, outbound mismatch, late timestamp, delayed confirmation, virtual finality, membership hop, crash before and after persistence, send retry, queue pressure, network partition, calldata recovery, and non-final suffix reduction.

Adversarial schedules must permute delivery and confirmation order and produce identical accepted history and final anchors.

## 16. Future work

Signature aggregation and recursive state proofs may reduce proof size. They must preserve individual equivocation evidence and membership-hop accountability.
