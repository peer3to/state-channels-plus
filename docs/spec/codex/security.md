# Security model and attack analysis

## Status and approval

This is the V1 security specification reconstructed from the contracts, SDK, tests, and specification review. It is not a production approval. Open proof, storage, timing, resource, deployment-size, and watchtower issues are listed as release blockers below.

Security claims apply only when the stated assumptions hold. An implementation test is evidence for its asserted case, not proof that a whole attack class is closed.

## 1. Assets and security objectives

The system protects:

- assets deposited into a channel consumer;
- the canonical application state;
- participant membership and ordering;
- block authorship and confirmation history;
- inbound deposit and outbound withdrawal ordering;
- uniqueness and value of withdrawals;
- the data needed to audit, dispute, reduce, and settle;
- an honest participant's ability to leave and recover value;
- availability of protocol execution within defined failure assumptions.

### 1.1 Safety

Safety means that an invalid state transition, membership change, balance movement, message range, timeout, dispute, reduction, or withdrawal cannot become final when an honest observer has the required data and acts within every applicable chain window.

Safety is challenge-based for paths that the chain does not verify eagerly. It therefore depends on observation, data possession, and transaction inclusion before deadlines.

### 1.2 Liveness

Liveness means that participants can continue off chain during ordinary operation and can use chain fallback to recover from an unavailable author, missing data, a disputed fork, or a normal exit. Liveness does not promise low cost, immediate progress, or progress while the base chain is unavailable.

### 1.3 No-theft and conservation

At every accepted snapshot:

`totalDeposits = inStateBalance + totalWithdrawals`

under application-defined balance algebra. Each inbound value is counted once, each outbound value is settled at most once, and a slash/removal exit cannot exceed value released by the resulting state.

## 2. Trust boundaries

### 2.1 Base chain

The protocol trusts finalized chain consensus, EVM execution, log ordering, contract bytecode, and transaction inclusion under the target chain's stated availability assumptions. It treats block timestamps as chain-governed time, not exact wall time.

A reorganization deeper than the node's supported rollback window, chain censorship lasting beyond a response window, or failure of chain consensus is outside the current guarantee.

### 2.2 Manager, facets, and consumer

The manager proxy and facets are enforcement code. The consumer holds or transfers application assets. A defect, unauthorized upgrade, storage collision, reentrant consumer, or mismatched facet set can break every channel using that deployment.

Participants must agree on one deployment manifest before depositing. The manifest must bind chain, manager, facet bytecode, state machine, consumer, time configuration, gas limits, and protocol version.

### 2.3 Local EVM and state machine

Peers trust their execution environment to run the same bytecode deterministically. The state machine is application-controlled but must obey the integration contract. Its serialization, balance algebra, leader result, membership change, and outbound messages are consensus inputs.

The following must not influence committed output unless explicitly included in state or input:

- EVM caller identity;
- wall clock or uncommitted block timestamp;
- random source;
- local database order;
- RPC response order;
- process, worker, or browser state;
- unavailable external contract state.

### 2.4 Peers and relays

Every peer and relay is untrusted. Authentication proves control of an address, not correct behavior. A connected participant may equivocate, withhold, replay, reorder, delay, flood, or selectively disclose data.

The intended first deployment is a small full mesh, such as a poker table. Full mesh limits routing complexity but does not make peers honest or remove partition attacks.

### 2.5 RPC providers

A provider can be stale, inconsistent, censor logs, omit transactions, or report a temporary fork. Current operation assumes at least one available provider that reports the canonical chain in time. The SDK does not run a light client.

### 2.6 Honest observer or watchtower

For every channel and every economically relevant partition, at least one non-Byzantine participant or authorized delegate must:

- remain online often enough to observe chain events;
- hold or fetch every required signed object and replay input;
- identify objective invalid behavior;
- pay for and submit the right transaction;
- obtain inclusion before the applicable deadline.

If all relevant participants and delegates collude, lose the data, or stay offline through a challenge window, V1 does not promise safety.

Current code has no complete watchtower protocol. Calling the assumption a watchtower does not solve authorization, privacy, payment, revocation, data sync, or failure handling.

### 2.7 Cryptography and keys

The design assumes Keccak collision resistance and secure ECDSA recovery under the exact signing scheme in use. A participant is responsible for its signing key and any delegate authorization.

Key compromise lets the attacker create apparently valid participant messages and may enable equivocation. The protocol has no general key rotation or recovery procedure in the current model.

## 3. Fault classification

### 3.1 Objective Byzantine fault

An objective fault has signed or chain-verifiable evidence accepted by a defined fraud-proof verifier. Examples include conflicting signed blocks, an invalid signed transition, an invalid state proof, forged inbound ancestry, or an invalid signed dispute.

Objective evidence may support slashing. The verifier must derive the responsible address; a proof submitter cannot select an arbitrary target.

### 3.2 Availability failure

Disconnection, packet loss, slow response, process crash, missing local data, RPC failure, and refusal to sign are availability failures. They may trigger timeout, force publication, self-removal, resync, or chain fallback. They are not proof of dishonest intent.

### 3.3 Local policy violation

A peer may blacklist another peer for repeated malformed requests, resource abuse, or failure to provide data. This protects local resources. It does not change on-chain membership and cannot be used as slash evidence.

### 3.4 Application violation

An application transaction can be invalid under deterministic state-machine rules without proving that every relay or confirmer acted maliciously. Responsibility follows the signed role and the specific fraud-proof rule. Integrators must not turn an application revert into an unrelated participant slash.

## 4. Required security invariants

- **INV-SEC-1:** no participant is slashed from local reputation, transport state, or evidence that the contract cannot verify.
- **INV-SEC-2:** every slash target is derived from verified evidence and matches the proof's outer participant.
- **INV-SEC-3:** every accepted block links to one accepted predecessor on the same channel and fork.
- **INV-SEC-4:** a participant signs at most one conflicting block for a given author position.
- **INV-SEC-5:** no snapshot update can omit an already included inbound value or repeat an already processed outbound value.
- **INV-SEC-6:** no withdrawal is processed without a verified snapshot path and a linked new outbound range.
- **INV-SEC-7:** total deposits, in-state value, and total withdrawals conserve value under the state machine's balance algebra.
- **INV-SEC-8:** a slash or removal applied during reduction appears in successor membership, application state, outbound exits, and cumulative accounting.
- **INV-SEC-9:** dispute reduction is deterministic for a fixed chain state and valid evidence set.
- **INV-SEC-10:** the latest valid history is not discarded only because an older history received direct finality sooner.
- **INV-SEC-11:** chain-owned predicates have one enforcement definition; SDK prechecks cannot replace the contract decision.
- **INV-SEC-12:** deadlines use one chain-compatible time model and cannot be shortened by local clock error.
- **INV-SEC-13:** a crash cannot expose half of an accepted block, snapshot, message, or event-cursor update as canonical.
- **INV-SEC-14:** malformed, oversized, or repeated input has explicit CPU, memory, bandwidth, storage, and gas bounds.
- **INV-SEC-15:** old proof data remains verifiable until every dependent asset and challenge is closed.

## 5. Block production and finality threats

| Threat                         | Required control                                                                 | Current state and gap                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Wrong participant produces     | Replay expected author from pre-state and compare with signed header             | Implemented in validation and dispute paths; depends on deterministic participant order.              |
| Producer equivocates           | Preserve two conflicting valid signatures and apply `BlockDoubleSign`            | Handler exists; confirmation and virtual-vote interactions still need a formal responsibility review. |
| Invalid application transition | Replay exact pre-state and transaction; compare complete post-snapshot           | Handler and E2E paths exist; application hooks and replay gas need bounded coverage.                  |
| Wrong genesis                  | Bind first block to canonical genesis snapshot and deployment                    | Handler exists; deployment manifest binding is incomplete.                                            |
| Invalid timestamp              | Check predecessor-relative and chain-relative rules, including first-block grace | Handler exists; clock skew, reorg, and multi-provider policy are incomplete.                          |
| Broken ancestry                | Verify previous hash at every step                                               | Implemented in ordinary validation; mixed milestone/suffix verification is currently defective.       |
| Withheld block data            | Require chain calldata publication or allow timeout/dispute recovery             | Paths exist; cost griefing and retained-data bounds remain open.                                      |
| Signature replay               | Bind signed bytes to channel/fork and protocol domain                            | Headers bind many objects; a single versioned signature-domain policy is absent.                      |
| Confirmation inflation         | Recover unique active signers against the right membership                       | Implemented in several paths; all set-order and duplicate cases need common vectors.                  |
| Newer valid suffix discarded   | Carry valid signed suffix after final milestone                                  | Intended requirement; current proof builder and contract reject/drop mixed proofs.                    |

### 5.1 Virtual voting

The design allows signatures on later linked blocks to serve as evidence for earlier history. This improves throughput because execution does not wait for a full confirmation round after each transaction.

Its safety depends on all of these statements:

1. every later signature commits to one unbroken ancestry;
2. signer membership at each link is known from an accepted prior state;
3. a signer cannot support conflicting paths without objective evidence;
4. membership transitions have a final anchor before a new set controls proof threshold;
5. a valid later history carries forward during disputes;
6. proof construction and contract verification traverse the same sequence.

No formal model in the repository proves these together. Mixed milestone-plus-suffix support is missing, so current implementation does not meet the intended proof model.

## 6. Membership and stream threats

### 6.1 Deposits and joins

Chain deposit acceptance creates a pending inbound value, not immediate off-chain membership. A malicious or unavailable current group may delay inclusion. Force-join and dispute paths must make the deposit visible to successor computation within a bounded time.

Current risks:

- the SDK may mark a join pending before it observes the canonical deposit event;
- a reorg can remove an event that local state already used;
- no specified refund returns a deposit that never becomes usable membership;
- duplicate JOIN/top-up semantics depend on state-machine code;
- a joining participant may not have enough history to protect itself.

Required response is canonical event staging, bounded inclusion, a specified refund or forced successor path, and spectate-before-join verification.

### 6.2 Inbound chain

An attacker may forge a message block, skip a pending message, repeat a deposit, reorder blocks, or claim a head not stored on chain. Controls are chain-owned block hashes, height linkage, total-balance checks, snapshot commitments, and `ForgedInboundMessageBlock`/dispute verification.

The verifier must check the whole path, not only the final hash. Storage pruning must retain every block still needed by a proof.

### 6.3 Outbound chain

An attacker may invent an exit, repeat a withdrawal, skip an earlier output, alter total balance, or call the consumer directly. Controls are deterministic transition output, linked outbound hashes, snapshot proof, monotonically processed height, balance cap, and consumer invocation only through the manager.

External consumer calls require reentrancy and failure handling. Partial batching must preserve the exact next height and cannot mark later messages processed before an earlier failure.

### 6.4 Membership thresholds

Participant order affects leader selection. Participant set affects signatures and milestones. During a join or removal, verifiers need an explicit old-set/new-set rule. A membership change without a final anchor can let different groups believe different thresholds control the same proof position.

The intended rule requires an anchor around membership transitions. Long sequences of joins, top-ups, removals, and slashes need generated tests across proof and reduction paths.

## 7. Dispute and reduction threats

### 7.1 Invalid dispute input

A dispute may claim stale state, invalid proof, wrong header, unknown inbound head, inconsistent output, broken balance, wrong author, malformed block, invalid timeout, ineligible slash set, or unavailable audit data. The contract defines separate `DisputeFraudProofType` handlers for many of these cases.

The SDK should validate early to protect resources, but on-chain predicates remain authoritative. A local pass cannot make an invalid dispute safe; a local failure cannot slash without a contract-verifiable proof.

### 7.2 Commitment without usable data

Hash-only commitments reduce calldata in the common case. They also let a participant place an object in reduction that peers cannot decode or audit. Current SDK behavior can skip audit when a proof is undecodable or its last finalized state is unavailable and no fireable proof can be built.

This is not a safe acceptance rule. The protocol must define one of:

- mandatory full data for any commitment that lacks a known anchor;
- a data-request phase whose failure kills or excludes the commitment;
- a bounded proof of availability;
- automatic abstention plus a successor rule that cannot select unaudited data.

Until chosen, hash-only disputes without locally auditable data are a release blocker.

### 7.3 Evidence-window extension

Evidence submission changes `lastEvidenceSubmissionTimestamp`. The close rule must prevent late evidence from reopening an already expired window. Current logic can allow reopening after the deadline when the commitment array is empty. This permits griefing and changes who can reduce. The contract must reject new evidence after expiration, regardless of current commitment count.

### 7.4 Kill semantics

Valid dispute fraud proof kills the invalid commitment and slashes the disputer. An invalid eligible proof may slash its sender. The economic intent of this asymmetric rule needs explicit approval.

Current commitment removal uses swap-with-last. That changes survivor order. Reduction is intended to be order-independent, but relying on that claim without a permutation proof is unsafe. Either canonicalize the evidence set before reduction or prove all survivor permutations produce identical output.

Every opened window needs a successor. Current design has no complete rule when all commitments are killed.

### 7.5 Slash selection

The review describes the dispute's on-chain slash list as a subset of eligible slashes. Current reducer automatically unions all eligible on-chain slashes before the cutoff with dispute-provided values. These models differ economically and in successor state.

Whichever model is chosen must define:

- eligibility cutoff;
- scope to channel and originating fork;
- duplicate removal and canonical order;
- precedence over timeout and self-removal;
- cleanup lifetime;
- behavior when a participant was already removed;
- whether omission is invalid or intentional.

### 7.6 Timeout collusion

A timeout can remove a participant based on schedule, timestamps, predecessor linkage, calldata publication, and optional forced conditions. Colluding peers may delay or selectively disclose a predecessor block to make an honest participant appear late.

The earliest valid timeout should win across competing disputes. A slash has precedence over nonpunitive timeout removal. Required tests must cover withholding, late disclosure, forced timeout, previous producer collusion, same-height conflicts, and boundary timestamps.

### 7.7 Reduction replacement

The threshold fast path and challenge replacement must not shorten the challenge window or trust unverified output. Current paths can backdate the stored reduction timestamp, including after successful challenge replacement. A replacement result needs a fresh, explicit challenge interval unless a formally equivalent earlier deadline is proven safe.

Reducer eligibility is also not enforced in current code because the check is commented out. If eligibility is an anti-spam or fairness rule, it must be active on every reduction entry point. If anyone may reduce, the contract and economic model must say so.

## 8. Contract and asset threats

### 8.1 Delegatecall and storage

Facet delegatecalls share proxy storage. Risks include selector collision, storage slot collision, missing initialization, unauthorized facet change, and facet code that assumes a different storage version.

The current code uses diamond-like facets but lacks a complete versioned selector registry and storage migration model. Upgrade authority and rollback are not specified. Any refactor needed for code size must preserve storage layout or include a proven migration.

### 8.2 Contract size

Several deployed runtime artifacts exceed the 24,576-byte EVM limit. Local tests allow unlimited contract size. A contract that cannot deploy on the target chain provides no security. Code-size compliance with margin is a release gate.

### 8.3 Consumer calls

The consumer controls deposit and withdrawal asset effects. Threats include reentrancy, nonstandard tokens, fee-on-transfer assets, callbacks, partial failure, false return values, malicious custom message handling, and mismatch between manager balance and transferred value.

Each consumer must define:

- supported assets and exact balance algebra;
- custody location;
- transfer success check;
- callback and reentrancy boundary;
- atomicity of a message batch;
- residue and rounding treatment;
- behavior when the last participant exits;
- upgrade and emergency recovery policy.

### 8.4 Cleanup

Deleting dispute, slash, inbound, block-calldata, or snapshot data too early may prevent a valid challenge or withdrawal. Current cleanup paths need a dependency audit. A simple "channel closed" flag is not enough if an external withdrawal or old-fork proof remains unresolved.

## 9. Network and runtime threats

### 9.1 Authentication

The handshake uses a random 32-byte challenge and a domain-prefixed signed message. Guarded RPCs require completed authentication. This prevents unauthenticated callers from using participant-only methods and avoids signing a bare attacker-chosen block hash.

Authentication must bind one live transport session and expire on disconnect. A captured response must not authenticate a new session without a fresh challenge.

### 9.2 Flooding and amplification

Attackers may send large ABI objects, many signatures, deep proofs, spectator histories, invalid blocks that trigger EVM replay, or requests that fan out to all peers. A 16 MiB outer frame cap is too broad to control this work.

Required controls are method-specific byte/object limits, concurrency limits, per-peer token buckets, global work budgets, early shape validation, cancellation, bounded queues, and eviction that preserves recovery-critical objects.

### 9.3 Source attribution

Relays can send another participant's signed bad object. Queue and validation logic must keep transport source separate from cryptographic author and confirmer. A local penalty may apply to a source that repeatedly forwards invalid data; an on-chain slash applies only to the participant identified by objective proof.

Current queue storage caps retained source/signature attribution per entry at 128. The full merge, eviction, and Byzantine attribution behavior needs property testing.

### 9.4 Concurrency and abort

Blocks, events, dispute timers, spectator sync, and shutdown can race. The state manager mutex and abort paths reduce some races, but accepted state spans multiple in-memory stores. A failed replay must restore the exact pre-state. A crash requires durable atomicity, not only in-process rollback.

Local dispute replay must use a separate execution instance so it cannot overwrite live channel state. Current `EvmDiamondStateMachine` keeps separate live and dispute execution contexts; tests must continue to assert that isolation.

## 10. Storage and chain-observation threats

### 10.1 Volatile storage

Current protocol stores are memory-backed. Restart loses blocks, proofs, disputes, queues, snapshots, event progress, and encoded application state. This can make an honest participant unable to challenge or withdraw.

Durable transactional storage and tested crash recovery are production requirements, not later optimization.

### 10.2 Event ordering and reorganization

Current event progress stores only a maximum block number, and event dispatch may apply later logs before earlier logs. It cannot identify a same-height reorganization or restore removed effects.

The required cursor includes block hash, transaction index, and log index. Event effects and cursor move atomically. A rollback journal covers the supported reorg depth. The node stops producing when event lag can hide a relevant dispute or membership change.

### 10.3 Missing event support

`OutboundMessagesProcessed` is emitted by contracts but is not in the current `EventSyncService` supported dispatch set. A local mirror can retain stale withdrawal totals. This is a correctness and settlement risk.

### 10.4 Spectator poisoning

A spectator receives history from untrusted peers. It must verify chain anchors, every hash/signature, proof continuity, snapshot state hashes, event state, and disputed-fork status before promoting data.

Current spectate flow may blacklist a source on any request failure. Network failure is not objective Byzantine evidence. Sync should stage data, distinguish invalid from unavailable responses, and compare multiple sources before permanent local exclusion.

## 11. Fraud-proof coverage

### 11.1 Block fraud proofs

| Type                          | Objective claim                                                          | Main evidence                                     | Required target     |
| ----------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- | ------------------- |
| `BlockDoubleSign`             | one participant signed conflicting blocks for one author position        | two signed blocks plus shared position context    | equivocating signer |
| `BlockInvalidStateTransition` | signed block's post-state does not follow from pre-state and transaction | pre-state, signed block, replay data              | block producer      |
| `WrongGenesis`                | first block does not build from canonical fork genesis                   | genesis and signed block                          | block producer      |
| `InvalidTimestamp`            | signed block violates protocol/chain time rule                           | signed block, predecessor, chain/calldata context | responsible signer  |
| `ForgedInboundMessageBlock`   | signed block uses an inbound message block not committed by chain        | signed block and message evidence                 | block producer      |

### 11.2 Dispute fraud proofs

The current enum covers stale latest state, invalid output, invalid state proof, balance failure, invalid slash subset, several timeout faults, invalid block inside a proof, missing final/audit basis, invalid dispute reason, header mismatch, bad inbound hash, malformed block structure, and nonparticipant author.

Each handler needs a table in code review that records:

- accepted encoded proof schema;
- all preconditions and chain reads;
- derived slash target;
- success effect;
- malformed ABI and revert behavior;
- gas and data bounds;
- Solidity tests for true, false, boundary, duplicate, and wrong-target cases;
- SDK construction and E2E submission evidence.

### 11.3 Known coverage questions

The enum list is not a proof of completeness. Review is still needed for:

- confirmation equivocation across virtual-vote paths;
- membership threshold misuse across multiple changes;
- outbound custom message and consumer failure;
- malicious but hash-valid unavailable dispute data;
- reduction ordering and all-commitments-killed recovery;
- premature cleanup or event reorg effects;
- signature-domain replay across deployments;
- state-machine nondeterminism that both local and chain replay cannot observe safely;
- unavailable watchtower or censored proof transaction.

For each uncovered behavior, choose a validation rule, fraud proof, dispute input, recovery path, explicit trust assumption, or accepted limitation. Do not add punishment where only availability failed.

## 12. Privacy

Full-mesh participants observe protocol messages, addresses, timing, membership, and application traffic. Chain calldata, disputes, audit data, and withdrawals are public. A spectator or watchtower may receive complete signed history and application state.

Transport encryption does not hide information from participants, relays that see metadata, chain observers, or an authorized watchtower. Applications that need hidden state must define cryptographic protection compatible with deterministic replay and fraud proof generation.

Logs and crash uploads may contain personal or strategy-sensitive application data. Operators must define redaction, encrypted transport, access, retention, deletion, and consent policy.

## 13. Release blockers

V1 must not be approved for production until these are resolved and verified:

1. mixed milestone plus signed-suffix state proofs work in SDK and contract;
2. every dispute window, including all commitments killed, reaches one successor;
3. hash-only dispute data has a safe availability and audit rule;
4. slash selection and dispute-proof economics are approved;
5. evidence cannot reopen an expired window;
6. successful reduction replacement receives a safe challenge period;
7. time skew, chain reorg, and provider disagreement policy is defined;
8. protocol storage is durable and atomic;
9. event processing is ordered, reorg-safe, and complete;
10. method-specific network and proof bounds are enforced;
11. deployed contract bytecode fits target-chain limits;
12. consumer reentrancy and asset behavior is audited;
13. watchtower or equivalent honest-observer operation is specified and tested;
14. fraud-proof completeness and reduction convergence reviews are complete.

## 14. Security verification program

Required evidence includes:

- generated histories for direct and virtual finality under delay and partition;
- membership changes at every proof boundary;
- all fraud handlers with valid, invalid, malformed, duplicate, replayed, and wrong-target inputs;
- permutation and idempotence tests for dispute evidence and reduction;
- colluding timeout claims with late or selective disclosure;
- all-commitments-killed recovery;
- composite/custom balance conservation and withdrawal uniqueness;
- malicious, stale, and disagreeing RPC providers;
- event reorganization during join, dispute, reduction, and withdrawal;
- offline participant recovery through an authorized delegate;
- flood tests at every public RPC and proof boundary;
- maximum proof/calldata gas measurements;
- crash injection at every canonical storage transition;
- target-chain deployment without unlimited contract size;
- old proof verification after upgrade or facet migration.

Security approval must cite the exact test, property model, gas report, audit finding, or formal argument for each claim. "Covered by E2E" without the asserted scenario is not evidence.

## 15. Future work

Non-normative work includes private or randomly sampled watchtowers, subjective reputation for peer selection only, light-client chain verification, alternative data-availability layers, and formal models of virtual voting and reduction. None of these may be assumed by the V1 guarantee until implemented and moved into the normative design.
