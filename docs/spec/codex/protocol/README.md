# State-channel protocol

## Status and authority

This directory defines rules shared by peers, SDK implementations, and contracts. It is above implementation details and below the system model. Contract and SDK chapters must implement these rules or record a difference.

## 1. Purpose

The protocol lets a small group run one deterministic application state machine without putting every transition on a base chain. Peers exchange signed blocks in a full mesh, continue execution before finality, and use the chain when they need ordered data availability, objective fault enforcement, or one canonical successor.

The target group is small: normally a poker table of about six and roughly no more than ten participants. The proof, network, timeout, and gas model assumes that size. Larger groups are not supported by implication.

## 2. Design decisions and rationale

### 2.1 Safety comes from commitments and chain enforcement

Peers do not trust each other. Every block, confirmation, dispute, and cross-layer stream step is signed or hash-linked. The base chain orders recovery and enforces objective outcomes. P2P communication improves cost and speed but is not the final arbiter.

### 2.2 Normal progress is continuous

The deterministic next author builds on the latest valid state without waiting for unanimous confirmation. Later signatures vote for ancestry. This keeps the common path responsive while preserving a route to finality and dispute recovery.

### 2.3 Finality and recovery are different

A finalized snapshot can advance on the same fork. A non-final but valid latest state can enter a dispute and be carried into a successor. Finality is not a condition for a valid transition to exist, and dispute resolution is not a rollback to the last final state.

### 2.4 Membership is part of consensus context

Joining and removal change the signer threshold and author schedule. A membership change must be proved under both old and new context at the transition. Pending on-chain joins participate in recovery threshold logic before the adopted application snapshot consumes them.

### 2.5 External effects are streams

L1-to-channel and channel-to-L1 actions use ordered, hash-linked message streams. A snapshot commits to processed tips. This one mechanism handles deposits, joins, exits, withdrawals, and later custom messages.

### 2.6 V1 keeps data availability chain-backed

Peers try direct delivery first. If data remains unavailable, the author posts it to the chain. This avoids a new trust assumption but exposes users to calldata fees, latency, and griefing. It is a known V1 weakness.

## 3. Boundary, responsibilities, and document map

The protocol owns the rules that all implementations must agree on: object meaning, authoring, validation, finality, stream order, time windows, objective enforcement, dispute inputs, reduction, and successor creation. It does not own application transaction rules, asset adapter behavior, peer storage technology, provider selection, or operator policy except where those choices affect protocol correctness.

| Chapter | Defines |
| --- | --- |
| [Execution and finality](execution-and-finality.md) | blocks, authoring, validation, signatures, virtual votes, milestones, non-final progress |
| [Messages, membership, and settlement](messages-membership-and-settlement.md) | cross-layer streams, open, spectate, join, exit, snapshot advancement, close |
| [Time and data availability](time-and-data-availability.md) | chain clock, author slots, delivery windows, calldata fallback, timeout boundaries |
| [Disputes and fraud proofs](disputes-and-fraud-proofs.md) | objective proof separation, valid dispute inputs, phases, reduction, successor rule |
| [Network topology and trust](network-topology-and-trust.md) | full mesh, partitions, honest-peer assumption, gossip resource controls |

Contract algorithms are in [the contract root](../contracts/contracts.md). SDK pipelines are under [the SDK root](../sdk/README.md).

## 4. Protocol objects

| Object | Role |
| --- | --- |
| channel | one application instance, participant set, fork history, message streams, and escrow context |
| fork | one authoring history beginning at genesis snapshot data |
| snapshot | commitment to application state, membership, stream heads, and cumulative balances |
| block | one signed application transaction plus resulting snapshot commitment and inbound range |
| confirmation | another signature over exact block bytes |
| milestone | linked block confirmations that finalize an earlier snapshot under one membership hop |
| state proof | genesis or milestone anchors plus a possible non-final descendant suffix |
| fraud proof | objective evidence of one protocol violation |
| dispute | one participant’s proved latest view plus recovery inputs |
| successor | new fork genesis computed from completed dispute reduction |

## 5. Top-level lifecycle

1. Proposed participants sign one opening payload and deposit assets on chain.
2. The chain emits channel genesis, including a genesis snapshot and inbound stream commitment.
3. Each peer verifies chain state, creates a local runtime, connects to every other participant, and begins deterministic authoring.
4. The next author executes one transaction and any eligible inbound messages, signs the block, stores it, and gossips it.
5. Receivers authenticate, order, replay, validate, persist, sign, and gossip confirmation. They may build the next valid block before the parent is final.
6. Direct and virtual votes finalize older states. Final anchors are retained as milestones.
7. A finalized same-fork snapshot may be submitted to process outbound effects.
8. If data is missing, peers use RPC and then chain calldata. If a deterministic author is unavailable, an eligible participant starts timeout recovery.
9. Objective fraud is proved directly and updates the slash set.
10. A dispute gathers proved latest views, selected slashes, timeout, self-removal, and forced inbound progress.
11. Invalid commitments are killed. The surviving set is reduced to the longest valid state and merged recovery actions.
12. The state machine applies inbound messages, slashes, and removals to create a mandatory successor fork.
13. After reduction challenge completes, the chain adopts the successor snapshot and processes outbound differences.
14. Peers rebuild author schedule and network membership from the successor and return to normal execution.
15. When no participants remain and all valid outbound effects are processed, the channel closes.

## 6. Protocol invariants

- **PRT-INV-1:** one channel fork has one deterministic next author for each valid state.
- **PRT-INV-2:** a valid signature commits to exact bytes and their hash-linked ancestry.
- **PRT-INV-3:** one participant must not sign conflicting blocks for the same fork position.
- **PRT-INV-4:** every accepted block is replayed from a stored predecessor and produces its claimed snapshot.
- **PRT-INV-5:** membership changes are authorized across the old and new threshold context.
- **PRT-INV-6:** cross-layer messages are processed once, in order, without gaps.
- **PRT-INV-7:** every completed dispute creates exactly one canonical successor.
- **PRT-INV-8:** objective fraud and ordinary unavailability have different evidence and consequences.
- **PRT-INV-9:** identical valid dispute evidence reduces to identical successor bytes regardless of arrival order.
- **PRT-INV-10:** on-chain time, not a peer wall clock, decides protocol deadlines.
- **PRT-INV-11:** a participant can recover its valid value through the base chain under the stated honest-peer and availability assumptions.

## 7. Cross-layer authority

| Question | Authority |
| --- | --- |
| Was this application transition valid? | deterministic state-machine replay against committed predecessor |
| Did this participant sign these bytes? | signature verification |
| Which recovery transaction happened first? | canonical chain order |
| Was a deadline reached? | canonical chain timestamp under stated chain rules |
| Which snapshot is adopted? | manager contract state |
| Which peer message arrived first locally? | local fact only; it cannot decide canonical outcome |
| Is an unconfirmed block final? | no, but it may still be a valid descendant carried into dispute |

## 8. Failure scope

A malformed message should fail one intake item. A bad peer should be isolated without stopping honest peer connections. A bad block should stop progress on its descendant path and create proof or dispute work. A local runtime crash should recover from durable state and canonical events. A base-chain outage stops time-dependent recovery and settlement but must not make peers invent a different authority.

## 9. Current implementation

The repository implements most V1 paths but not every requirement in this root. Material gaps include milestone-plus-suffix contract verification, durable SDK storage, complete reorganization handling, explicit clock skew bounds, gossip rate limits, production contract size, a finished Diamond layout, forced publication of dispute audit data, and the no-surviving-commitment successor rule.

These gaps are specified in their focused chapters. They must not be treated as optional cleanup.

## 10. Difference from the intended design

The root-level differences are mixed state-proof rejection, missing durable/reorg-safe operation, unspecified production resource bounds, oversized contracts, incomplete dispute-data availability, and no all-commitments-killed successor. Focused chapters own the exact behavior and source evidence.

## 11. Verification

Protocol verification combines model-level properties, unit tests, contract tests, multi-peer E2E, adversarial schedules, network partitions, clock variation, and restart/reorganization tests. The [verification chapter](../verification.md) maps current evidence and required additions.

## 12. Future work

Non-normative work includes larger network topologies, alternate data-availability layers, aggregate signatures, private watchtower networks, and optimistic reduction fast paths. None changes the V1 rules until its trust and compatibility effects are approved.
