# Contract system specification

## Status and authority

This is the root of the contract specification. It defines the contract boundary and the full channel lifecycle. Focused chapters define each operation in implementable detail. All contract chapters follow the [subsystem chapter contract](../conventions/subsystem-chapter.md).

The current Solidity code is a prototype and evidence for existing behavior. Requirements in these documents describe the intended production system. Known differences are explicit. A difference must not be hidden by describing current code as the design.

## 1. Purpose

The contract system is the shared authority used when peers cannot finish a state-channel operation through the peer network. It does not execute every application transaction. Normal transaction execution, block exchange, confirmation, and state storage happen off chain. The contract provides the smaller set of operations that need a common, censorship-resistant order:

1. create the channel and escrow application assets;
2. append deposits and membership requests to the inbound stream;
3. publish block data when peer delivery fails;
4. record objective fraud and remove proven Byzantine participants;
5. collect competing views of the latest state;
6. reduce those views to one deterministic successor fork;
7. advance the adopted snapshot and execute outbound effects;
8. expose events from which a peer can rebuild the on-chain part of channel state.

The contract is not a general data-availability layer. It stores commitments and the minimal recovery streams needed to settle. It is also not the application state machine. Application rules live behind `AStateMachine` and the consumer boundary.

## 2. Design decisions and rationale

### 2.1 Optimistic execution with an on-chain recovery path

Peers should not pay chain fees for normal progress. They exchange signed blocks directly and use all-participant confirmation as the fast finality rule. Chain use begins only when data, agreement, or participation fails.

The rejected design is to post every block or state root on chain. That gives simple ordering but removes the main cost and latency benefit of the state channel.

### 2.2 Application-neutral manager, application-owned state machine

The manager owns fork, proof, dispute, stream, and snapshot rules. The application owns state transition, balance representation, join, slash, removal, deposit, and withdrawal behavior. This split lets one protocol host different applications without asking the manager to decode application state.

The consequence is that a state-machine or consumer call is security-sensitive. The manager must validate commitments and accounting before it accepts a resulting snapshot, and it must treat external asset movement as a reentrancy boundary.

### 2.3 Hash-addressed immutable evidence

Blocks, snapshots, message blocks, auditing data, and disputes are committed with `keccak256(abi.encode(value))`. A commitment binds the exact Solidity ABI representation, including array order. A proof cannot replace one representation with a semantically equivalent representation unless its hash is identical.

This choice avoids a second canonical encoder on chain. It also makes ABI layout a protocol compatibility surface.

### 2.4 Unanimous finality for small groups

The intended deployment is a small, fixed channel group, normally a poker table of about six participants and roughly no more than ten. A milestone becomes final only when every eligible participant in the relevant participant union signs it. This uses unanimity as a safety rule, not a probabilistic quorum.

Unanimity can stop progress when one participant disappears. Timeout and dispute recovery exist to remove that participant and create a new fork. The protocol therefore trades normal-path liveness for a simple finality rule and a slower recovery path.

### 2.5 A dispute always resolves by creating a successor fork

Dispute output is not an in-place rewrite of the disputed fork. The output snapshot data commits to `originForkId`, and its hash becomes a new `forkId`. This gives recovery a monotonic history: the old fork remains identifiable, while all further valid blocks name the successor.

The unresolved edge case is a window in which every commitment is killed. The intended rule still requires a deterministic successor. The exact no-surviving-evidence construction is not implemented and is tracked in [open questions](../open-questions.md).

### 2.6 Logical slash first, application consequence on successor generation

Proof handlers record a timestamped on-chain slash. The application-specific penalty is applied when dispute output state is generated. This separates objective proof verification from poker or asset-specific punishment.

The slash record is part of eligibility immediately. It must not wait for snapshot adoption before removing the participant from the threshold set.

### 2.7 Streams bridge the chain and the off-chain state machine

Deposits and joins enter an append-only inbound stream. Exits and withdrawals leave through a hash-linked outbound stream. Snapshots commit to both stream heads and cumulative balances. This lets the contract verify that a state transition consumed exactly the intended external effects without storing the full application state.

### 2.8 Recovery actions are public, effects are eligibility-gated

Anyone can relay public evidence where safe, but operations that can choose evidence, challenge a result, or incur a self-slash must bind `msg.sender` to an eligible channel participant. Public relaying and participant responsibility must not be confused.

Current entry points apply this rule inconsistently. Each focused chapter states the required caller rule.

## 3. Boundary and responsibilities

| Component                      | Owns                                                                                                                       | Must not decide                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Manager and facets             | channel snapshots, message-stream commitments, calldata commitments, dispute windows, slash records, reduction commitments | application transaction validity or application payout policy |
| `AStateMachine` implementation | deterministic state mutation, participant order, application balance operations, join, removal, slash                      | proof validity, dispute ordering, fork adoption               |
| Consumer facet                 | asset deposit and withdrawal integration, application-specific open behavior, custom outbound messages                     | state-channel consensus or evidence reduction                 |
| SDK                            | block construction, validation pipeline, evidence collection, proof construction, event mirroring                          | authoritative on-chain ordering                               |
| Local EVM mirror               | deterministic replay of contract calls and events for one peer                                                             | final L1 inclusion or reorganization truth                    |

All state-changing facet code executes through `delegatecall` in the manager storage context. A facet has no independent channel state. Any selector routing or facet replacement must preserve the storage namespace expected by the called code.

## 4. Contract document map

| Chapter                                                                       | Contents                                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [Architecture and storage](architecture-and-storage.md)                       | deployment, selector routing, storage ownership, upgrade rules, code-size limits             |
| [Opening, admission, and message streams](admission-calldata-and-messages.md) | open, join, top-up, deposits, inbound blocks, outbound blocks, calldata fallback             |
| [State proofs and finality](state-proofs-and-finality.md)                     | signed block chains, confirmations, milestones, snapshot linkage, intended proof composition |
| [Fraud proofs and slashing](fraud-proofs-and-slashing.md)                     | objective block faults, dispute faults, timeout faults, proof sender rules, kill semantics   |
| [Dispute lifecycle](dispute-lifecycle.md)                                     | eligibility, upload, windows, timers, threshold-final path, commitment removal               |
| [Reduction and snapshot adoption](reduction-and-snapshots.md)                 | deterministic merge, successor state generation, challenge, same-fork and cross-fork update  |
| [Interfaces, events, and errors](interfaces-events-and-errors.md)             | compatibility surface, event replay, revert classes, local mirror boundary                   |

## 5. End-to-end contract state machine

### 5.1 States

The contract does not store one enum for the channel lifecycle. Its state is derived from the adopted snapshot and the dispute window for a fork.

| Derived state   | Observable condition                                                | Allowed next operations                                                                      |
| --------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| absent          | adopted snapshot has zero `forkId`                                  | `open`                                                                                       |
| active          | adopted snapshot exists; no live dispute window for its fork        | deposit, join, top-up, calldata post, fraud proof, same-fork snapshot update, dispute upload |
| evidence        | window exists and evidence deadline has not passed                  | additional dispute upload, fraud proofs, threshold-final dispute                             |
| kill            | evidence is closed; kill deadline has not passed                    | dispute fraud proofs; no normal reduction finalization                                       |
| reduced         | reduced successor exists; challenge deadline is live                | challenge reduction                                                                          |
| successor final | reduced successor exists and challenge period expired               | cross-fork snapshot adoption                                                                 |
| closed          | successor state has zero participants and storage cleanup completed | no further channel progress under the same channel instance                                  |

The names above are specification terms. Current Solidity derives periods from timestamps rather than storing this enum.

### 5.2 Lifecycle algorithm

1. `open` verifies a nonzero unused channel ID, unique proposed participants, aligned participant and balance arrays, and signatures from all proposed participants.
2. The consumer deposits assets and builds genesis application state from the deposits that were accepted under the atomicity rule.
3. The manager creates a genesis inbound message block, a genesis snapshot, and a fork ID equal to the hash of genesis `SnapshotData`.
4. Peers execute and confirm blocks off chain. Any author may post its signed block as calldata before a caller-supplied maximum timestamp. The slot is write-once.
5. Deposits and joins append new inbound message blocks. They do not directly mutate the adopted application state.
6. A fully signed milestone may advance the adopted snapshot on the same fork after all pending inbound messages are consumed and outbound ancestry is verified.
7. A valid objective fraud proof records a slash. A valid dispute opens or extends the window for the disputed fork.
8. During evidence and kill processing, invalid dispute commitments may be removed. The window clock changes only according to the timer rules in [dispute lifecycle](dispute-lifecycle.md).
9. After evidence is fixed, peers reduce the exact surviving commitment sequence. Reduction selects one latest state, one eligible inbound cutoff, a slash set, at most one timeout result, and self-removals.
10. The application state machine consumes inbound messages, applies slash consequences, then applies voluntary or timeout removals. Its resulting state and outbound exits form successor `SnapshotData`.
11. The successor hash is committed as the reduced fork. A live challenge recomputes the same deterministic function from the committed evidence.
12. After the challenge deadline, `updateStateSnapshotFork` follows the finalized reduced-result path and adopts the successor genesis snapshot.
13. The manager verifies and applies new outbound blocks, updates cumulative withdrawals, and rejects any state in which withdrawals exceed deposits.
14. If the new application state has no participants, the manager closes the channel and clears recoverable per-channel storage according to the cleanup rule.

## 6. System-wide contract invariants

- **CON-INV-1:** `forkId == keccak256(abi.encode(genesisSnapshotData))` for every fork.
- **CON-INV-2:** a block belongs to exactly the channel and fork named in its signed transaction header.
- **CON-INV-3:** a calldata commitment slot `(channelId, author, forkId, transactionCnt)` is write-once.
- **CON-INV-4:** the adopted snapshot is changed only by valid same-fork milestone advancement or a finalized successor path.
- **CON-INV-5:** the inbound head and height name an existing ordered prefix of the on-chain inbound stream, or the zero head and zero height.
- **CON-INV-6:** the outbound head and height extend the previously adopted outbound head without gaps or forks.
- **CON-INV-7:** cumulative withdrawals never exceed cumulative deposits according to the application balance comparator.
- **CON-INV-8:** a slash record is unique per channel participant and carries the inclusion timestamp used for evidence cutoffs.
- **CON-INV-9:** a participant removed by an on-chain slash is not in the on-chain threshold set.
- **CON-INV-10:** a committed reduction is a deterministic function of the exact ordered surviving dispute commitments and the on-chain evidence cutoff.
- **CON-INV-11:** a dispute successor has `originForkId` equal to the disputed fork.
- **CON-INV-12:** failed validation leaves storage and external asset state unchanged because the whole transaction reverts.
- **CON-INV-13:** ABI encodings used for signatures and hashes are versioned compatibility surfaces.
- **CON-INV-14:** production deployment cannot rely on a local chain setting that ignores the EIP-170 runtime code-size limit.

## 7. Ordering, concurrency, and atomicity

Ethereum transaction order is the final order for competing recovery operations. Every operation that depends on a view read before submission must carry an explicit expectation, such as `maxTimestamp`, expected snapshot hash, expected fork ID, or expected reduced fork ID. The contract rechecks that expectation at execution time.

A revert is atomic across manager storage, delegate-called facets, state-machine calls, and consumer calls within the transaction. This does not remove reentrancy risk. Asset-moving consumer calls must either use a guard or follow checks-effects-interactions with no externally reachable inconsistent state.

Duplicate operations fall into three classes:

- idempotent success: adopting an already-adopted target fork returns without change;
- explicit stale failure: a duplicate calldata slot, duplicate evidence author, or old snapshot reverts;
- expectation check: a previously completed reduction succeeds only if the supplied expected result matches.

## 8. Trust and security assumptions

Any participant can be Byzantine. A disputer, challenger, reducer, proof submitter, block author, or RPC relay can provide malformed or strategically selected data. Signatures prove only that an address signed exact bytes. They do not prove that a block transition, dispute claim, or snapshot is valid.

The chain supplies transaction order and timestamps. The protocol assumes bounded timestamp drift accepted by the target chain. SDK local time is never authoritative for a contract deadline.

The configured state machine and consumer are trusted code under the deployment authority. Facet addresses and selector routing are also trusted configuration. A production upgrade mechanism must protect these values with explicit authorization and storage compatibility checks.

Proof arrays, dispute arrays, message blocks, and participant arrays are attacker-controlled dynamic data. Each public operation needs a bound that keeps both successful recovery and worst-case rejection executable within the block gas limit.

## 9. Failure behavior and recovery

Malformed evidence fails closed. It must not update a slash set, kill a commitment, select a successor, move funds, or advance the snapshot. A stale expectation also fails closed, but callers may rebuild from current events and retry.

Loss of peer-to-peer data is recovered first through peer RPC and then through `BlockCalldataPosted` events. Loss of local contract mirror state is recovered through ordered chain event replay plus direct view reconciliation. A chain reorganization requires rollback to a known block and deterministic replay; the current SDK does not yet implement a complete reorganization journal.

If proof verification cannot fit in the available gas, recovery can fail even when evidence is valid. This is a protocol failure, not only a performance problem. Production constants must bound channel size, proof length, message count, and auditing data size.

## 10. Current implementation

The prototype is under `contracts/V1/`. `StateChannelManagerProxy.sol` stores configuration and delegates named interface functions to facet addresses. Most shared behavior and storage-aware helpers are inherited from `StateChannelCommon.sol`. `LocalDiamond.sol` adds event application for isolated peer EVMs.

The manager currently uses Solidity `0.8.8` pragmas but repository artifacts were built with a newer configured compiler. Hardhat enables `allowUnlimitedContractSize`, and several runtime artifacts exceed the EIP-170 limit. The proxy is therefore not a production-deployable Diamond today.

## 11. Difference from the intended design

| Classification     | Difference                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| missing            | selector-to-facet Diamond routing, controlled upgrade authorization, initialization rules, rollback, and versioned root storage slots                                                    |
| bug                | current `verifyStateProof` rejects a proof that contains both milestone anchors and a trailing unfinalized signed-block suffix, while the intended proof model requires this composition |
| decision pending   | exact successor output when all dispute commitments are killed                                                                                                                           |
| decision pending   | whether a dispute may consume a selected subset of existing on-chain slashes or must include every eligible slash before the evidence cutoff                                             |
| missing            | explicit gas and size bounds for every attacker-controlled dynamic array                                                                                                                 |
| missing            | production code-size gate and removal of `allowUnlimitedContractSize`                                                                                                                    |
| missing            | complete reentrancy analysis and protection around consumer asset calls                                                                                                                  |
| documentation debt | public relay permission versus eligible participant responsibility is not consistently defined by current entry points                                                                   |

## 12. Dependencies and cross-layer effects

Contract encodings are consumed by SDK `ethers` bindings, EVM event replay, storage models, dispute construction, and tests. A struct field reorder changes signature and commitment bytes. A timer change affects SDK deadlines, timeout proofs, operations, and E2E duration. A threshold-set change affects block confirmation, milestone construction, joins, disputes, and fraud-proof eligibility.

Application integrators must satisfy the [state-machine contract](../integration/state-machine.md). SDK behavior is defined in the [runtime](../sdk/runtime-and-networking.md), [block pipeline](../sdk/block-confirmation-pipeline.md), and [dispute reduction](../sdk/dispute-sync-and-reduction.md) roots.

## 13. Verification

The contract suite must prove each invariant above with narrow Solidity or TypeScript tests and then exercise the same behavior through the SDK-to-contract E2E path. The minimum production gate includes:

1. runtime bytecode under 24,576 bytes for every deployed contract;
2. storage compatibility across every supported upgrade;
3. signature and hash vectors shared between Solidity and TypeScript;
4. state-proof vectors for genesis, finalized milestones, an unfinalized suffix, and milestone-plus-suffix composition;
5. every fraud-proof type with valid, invalid, malformed, ineligible-sender, and duplicate cases;
6. dispute boundary tests at every exact deadline;
7. deterministic reduction under every permutation of arrival order, while preserving commitment order;
8. successful and failed challenges with correct slash targets;
9. stream ancestry, cumulative balance, duplicate message, and external call rollback tests;
10. full channel open, progress, loss of peer data, dispute, successor adoption, and close.

Current tests live mainly under `test/V1/DiamondProxy/`, `test/V1/StateChannelDiamondProxy/`, and SDK E2E directories. The [verification chapter](../verification.md) records the repository-wide evidence and gaps.

## 14. Future work

After correctness gaps are closed, reduce calldata and storage cost with packed membership bitsets, proof batching, and better commitment indexing. These optimizations must retain the same visible evidence order and slash semantics.
