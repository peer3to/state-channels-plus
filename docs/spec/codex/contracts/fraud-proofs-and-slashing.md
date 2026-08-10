# Fraud proofs and slashing

## Status and authority

This chapter defines the separation between objective block fraud proofs and proofs that invalidate a committed dispute. The proof list is current V1 coverage, not a claim that every objective protocol violation is covered.

## 1. Purpose

Fraud proofs turn a compact, deterministic violation into an on-chain slash record. They let the later dispute process consume an objective result without replaying every observed fault. Dispute fraud proofs remove invalid evidence before reduction, so a bad dispute commitment cannot select the successor.

## 2. Design decisions and rationale

### 2.1 Objective evidence only

A slash requires evidence that every correct verifier evaluates the same way. Disconnection, slow delivery, low reputation, and disagreement without contradictory signatures are not fraud. They may justify timeout recovery but not a Byzantine-fault penalty.

### 2.2 Block fraud and dispute fraud are separate pipelines

Block fraud can be discovered during ordinary confirmation and submitted immediately. A dispute need not carry every proof. Once the contract records a participant in the slash set, later reduction needs only the slash selection and cutoff rule.

A dispute fraud proof instead says that one committed dispute is invalid. A valid proof kills that commitment and penalizes its disputer. It does not undo unrelated slash records or other commitments.

### 2.3 Proof submitters accept accountability

Submitting an invalid proof can slash an eligible sender. This deters proof spam, but it is safe only if validation is deterministic, failure causes are not transient, and the SDK preflight uses the same contract logic. Decode errors and race failures must not be misclassified as a false objective claim.

This economic rule needs explicit approval. The current code implements it; the design must not inherit it silently.

### 2.4 One logical slash per participant

The manager stores at most one slash record for a channel participant. Later valid proofs against an already-slashed participant are no-ops for membership and punishment. Evidence may still matter to audit logs, but it must not apply the application penalty twice.

## 3. Boundary and responsibilities

Proof handlers verify objective conditions and return the accountable address. The wrapper binds that result to the declared target, checks eligibility, and writes the slash. The dispute verifier removes killed commitments. The state machine later converts a slash into application-specific state and exit messages.

The SDK discovers, deduplicates, preflights, submits, and watches proofs. The SDK must not locally decide that a proof succeeded until the canonical chain event confirms it.

## 4. Data model and owned state

### 4.1 Block fraud envelope

`FraudProof` contains a proof type, declared participant, and encoded type-specific proof. `FraudProofVerificationContext` currently contains channel ID. The returned accountable address must equal the declared participant.

### 4.2 Dispute fraud envelope

`DisputeFraudProof` contains a proof type, declared participant, complete committed dispute, and encoded proof. Its dispute hash must still exist in the relevant window. The declared participant is expected to be the dispute submitter for a valid kill proof.

### 4.3 Slash record

`OnChainSlash` stores participant and chain timestamp. Entries are unique by participant and append in chain order. The timestamp controls eligibility in a reduction cutoff.

### 4.4 Current block proof categories

| Type                          | Objective claim                                                                    | Required core evidence                                                                                     | Accountable party    |
| ----------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------- |
| `BlockDoubleSign`             | same signer signed different blocks at the same channel fork and transaction count | two authentic signed blocks                                                                                | common signer        |
| `BlockInvalidStateTransition` | replay from committed prior state does not produce claimed snapshot                | invalid block, prior block when any, prior snapshot, prior encoded state                                   | invalid block author |
| `WrongGenesis`                | transaction zero does not link to authoritative fork genesis                       | first signed block and resolved genesis snapshot                                                           | block author         |
| `InvalidTimestamp`            | block time is before its parent or after the permitted author window               | invalid block, parent or genesis snapshot, relevant calldata timestamps and optional prior-block signature | block author         |
| `ForgedInboundMessageBlock`   | block consumes an inbound block not committed by the manager or adopted snapshot   | authentic block and forged inbound block                                                                   | block author         |

### 4.5 Current dispute proof categories

The current enum covers these claim families:

- a newer block signed by the disputer proves the submitted state was not latest;
- output state recomputation differs from the dispute commitment;
- state proof or a block inside it is invalid;
- snapshot accounting violates the balance invariant;
- claimed slash selection is not a subset of on-chain slashes;
- dispute has no valid reason;
- state-proof headers use the wrong channel or fork;
- claimed inbound head is not in the on-chain stream;
- block structure or block author membership is invalid;
- a no-auditing-data dispute lacks the required final milestone;
- timeout target already reached threshold, is at the wrong height, is not next, was challenged by posted calldata, or was submitted too early.

Each proof type must have a separate evidence schema and exact predicate. Enum membership alone is not a specification.

## 5. Inputs and preconditions

### 5.1 Block proof submission

A proof submission requires a nonzero known channel, bounded proof batch, and an eligible sender if invalid-proof self-slashing remains part of the accepted design. The declared target must be a current or pending channel participant and not already slashed. The handler must verify all referenced signatures and link every state or message value to a commitment before it interprets the alleged fault.

### 5.2 Dispute proof submission

The exact dispute commitment must still exist. The kill period must be live. The proof sender must be eligible and not the disputer if the protocol wants independent challenge; current code does not state the latter rule. The proof must name the disputer as its accountable target.

### 5.3 Race-sensitive proof inputs

Any predicate that depends on calldata publication, genesis availability, a slash set, or window time must bind to authoritative on-chain state at execution. A stale proof that became false because valid evidence arrived first is a race loss, not necessarily a malicious false proof. Whether the sender is penalized for that race must be explicit per proof type.

## 6. Processing algorithm

### 6.1 Apply block fraud proofs

For each proof in submitted order:

1. skip a target already slashed in the channel;
2. check envelope structure, channel context, type-specific byte bound, and declared target eligibility;
3. decode with a non-reverting typed failure path;
4. verify every authenticity and commitment prerequisite;
5. evaluate the type-specific objective predicate;
6. if valid, require returned accountable address equals the declared target and add one slash record;
7. if invalid, apply the accepted invalid-proof policy to the sender;
8. continue only if batch semantics permit independent results.

Production should prefer one proof per transaction or explicit per-item events. A batch in which malformed decode reverts all earlier valid proofs creates unclear economic and retry behavior.

### 6.2 Apply dispute fraud proof

1. Compute the dispute commitment and find it in the window.
2. If absent because it was already killed, return an idempotent no-op. If it was never in the window, reject rather than silently accepting unrelated data.
3. Require the kill deadline has not passed.
4. Verify the type-specific predicate against the committed dispute and authoritative chain state.
5. Require the accountable result equals the declared target and the dispute’s disputer.
6. On valid proof, append one slash for the disputer, remove only that commitment, preserve the relative order of all surviving commitments, and emit `DisputeKilled`.
7. On invalid proof, apply the accepted sender-penalty rule.

Preserving survivor order matters because current reduction verifies and reads commitments in order. The current swap-with-last removal changes that order and can change any order-sensitive reduction input.

### 6.3 Double-sign predicate

A valid double-sign proof requires:

- both blocks decode and name the requested channel;
- fork and transaction count are equal;
- encoded block hashes differ;
- both signatures are valid;
- both recovered signers are the same address;
- that signer is the named header participant in both blocks;
- the position is one for which that participant could sign under the leader policy.

Missing header-author checks can slash someone whose signature is attached to a block that names another author.

### 6.4 Invalid transition predicate

1. Authenticate the alleged invalid block.
2. Prove prior snapshot and encoded state linkage.
3. Prove parent linkage, or genesis linkage for transaction zero.
4. Execute the transaction through the configured state machine with the same gas and message rules as ordinary execution.
5. Apply outbound message commitments and inbound message consumption in protocol order.
6. construct the expected snapshot with correct fork and height;
7. proof is valid if execution fails or expected snapshot hash differs from the block claim.

### 6.5 Timeout proof precedence

Timeout defenses must be evaluated before reduction uses a timeout removal. Evidence that the timed-out participant produced the required block or that a complete threshold confirmed it defeats the timeout. A wrong-height or wrong-next-author timeout defeats the dispute. A “too early” proof compares the dispute window creation time with the deadline derived from the prior authoritative timestamp.

When any slash is selected, timeout removal is ignored in current successor generation. This precedence must remain explicit because slash consequences and simple removal may pay different exits.

## 7. Outputs and postconditions

A valid block proof adds a unique slash record and emits `ChainSlashed`. A valid dispute proof adds that slash, removes one dispute commitment, and emits `DisputeKilled`. Proof handling does not directly mutate application state, pay a penalty, adopt a snapshot, or close the window.

An invalid proof either leaves state unchanged or slashes the eligible sender according to the final economic policy. It must never slash the declared target.

## 8. Invariants

- **FRAUD-INV-1:** every slash has an objective proof or an explicitly accepted invalid-submission rule.
- **FRAUD-INV-2:** a participant appears at most once in the channel slash log.
- **FRAUD-INV-3:** signatures are authenticated before signed content is used as evidence.
- **FRAUD-INV-4:** all referenced state, blocks, streams, and timestamps link to authoritative commitments.
- **FRAUD-INV-5:** a valid dispute proof kills exactly one committed dispute.
- **FRAUD-INV-6:** killing one commitment does not change the relative order of survivors.
- **FRAUD-INV-7:** proof failure cannot slash the alleged target.
- **FRAUD-INV-8:** a logical slash does not apply the application penalty more than once.
- **FRAUD-INV-9:** non-Byzantine unavailability is not represented as objective fraud.
- **FRAUD-INV-10:** proof result is independent of the caller except for explicit eligibility and invalid-sender consequences.

## 9. Ordering, concurrency, and atomicity

Two proofs against the same target race. The first valid inclusion records the slash; the second becomes an idempotent no-op. A dispute kill and reduction race at the kill boundary. Kill is allowed only before expiry; reduction is allowed only at or after expiry, with equality behavior defined by `block.timestamp >= deadline` as expired.

Proof batches are atomic in current Solidity. One revert can roll back earlier valid items. Production must either retain this and make it part of the caller contract or isolate each proof.

## 10. Trust and security assumptions

The configured state machine is trusted to replay deterministically. Chain time and stored calldata commitments are authoritative. A proof submitter is untrusted. Proof bytes can target worst-case decode, memory, state-machine gas, and nested arrays.

Invalid-proof slashing creates a strong denial risk if valid proofs can fail because of reorganization, configuration changes, gas differences, or ambiguous boundary behavior. The policy needs a separate economic and security review before production.

## 11. Failure behavior and recovery

Malformed data should return a typed invalid result before economic action. An internal verifier error, out-of-gas condition, unavailable chain evidence, or state-machine adapter failure is not proof that the sender lied. These conditions revert without slashing.

A peer preflights exact calldata against the target block state, sends one proof, waits for canonical inclusion, and reconciles from `ChainSlashed` or `DisputeKilled`. After a reorganization, the peer removes orphaned results and may resubmit if still live.

## 12. Current implementation

`FraudProofFacet.sol` implements five block proof types. `DisputeFraudProofFacet.sol` dispatches seventeen dispute proof types. `DisputeVerificationFacet._killDispute` slashes the disputer, removes the commitment by swapping the last entry into its position, and emits `DisputeKilled`. `StateChannelCommon.addOnChainSlashedParticipant` deduplicates slash records.

If a block handler returns zero or an address different from the envelope target, current `applyFraudProofs` chooses `msg.sender` and slashes it if eligible. Dispute proofs use a similar rule. Current decoders can revert the full batch before that result path.

## 13. Difference from the intended design

| Classification     | Difference                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| bug                | dispute kill uses swap-with-last and changes survivor commitment order                                                  |
| missing            | per-proof distinction between false claim, stale race, malformed input, verifier failure, and unsupported proof         |
| decision pending   | whether every invalid eligible proof sender is slashed                                                                  |
| missing            | complete proof coverage and attack analysis across virtual voting, stream omission, reduction, and cross-layer behavior |
| missing            | target header-author checks are not uniform across proof handlers                                                       |
| missing            | proof batch and byte/gas bounds                                                                                         |
| decision pending   | batch atomicity versus independent per-proof processing                                                                 |
| documentation debt | some proof names combine block fraud application and dispute killing, which obscures the two-stage consequence          |

## 14. Dependencies and cross-layer effects

Block validation strategies create proof data. Contract event sync updates SDK slash sets. Dispute validation uses the same handlers to preflight kills. Reduction consumes selected slash records. The application state machine defines the eventual economic effect. Operations need proof failure and self-slash alerts.

## 15. Verification

For every proof type, tests must cover valid evidence, each failed prerequisite, wrong declared target, wrong channel and fork, forged signature, malformed encoding, already-slashed target, ineligible sender, duplicate submission, batch neighbor failure, exact time boundary, competing chain transaction, and reorganization replay.

Cross-language vectors must show SDK-built bytes produce the same Solidity predicate. A fault-coverage matrix must map every objective validation rule to a proof or state why no proof is possible.

## 16. Future work

After the security review, add missing proof types and consider proof-specific bonds instead of immediate sender slashing. Any bond design must define refund and adjudication without adding a subjective arbiter.
