# State Channels Plus specification

## Status and authority

This is a reverse-engineered design draft for engineer review. It combines the intended design in `temp/SPECIFICATION-REVIEW.md` with current repository behavior. It is not a summary of the code. It records decisions needed to implement, test, operate, and audit the system.

After engineer approval, normative statements in this tree define intent. Code implements that intent. Tests provide evidence. Current code behavior is never promoted into a requirement only because it exists.

Read [the chapter contract](conventions/subsystem-chapter.md) before changing a technical chapter. It defines the required structure, difference labels, and traceability rule.

## 1. System purpose

State Channels Plus lets a small group run a deterministic application state machine through signed peer-to-peer blocks while using a base chain for escrow, ordered cross-layer messages, final recovery, objective fault enforcement, data publication, snapshot adoption, and withdrawals.

Normal execution is off chain. It does not stop after every block for unanimity. A deterministic author builds on the latest valid state, peers replay it, and signatures on descendants vote for their ancestry. Final states can advance the chain snapshot on the same fork. Valid non-final states can enter a dispute and be carried into a mandatory successor fork.

The intended V1 topology is a full mesh for small partitions, normally a poker table of about six participants and roughly no more than ten. This limit affects signature thresholds, gossip cost, proof size, gas, and liveness. Supporting a larger group needs a new design, not only higher configuration values.

## 2. Design authority labels

Normative words **must**, **must not**, **required**, **should**, and **may** describe intended behavior. Each implementation-facing chapter separates:

- design decisions and rationale;
- exact required algorithm and invariants;
- current implementation evidence;
- differences classified as bug, missing, decision pending, or documentation debt;
- verification already present and still required.

The [decision register](open-questions.md) contains unresolved choices. A pending choice is not safe to implement by guessing. When a current implementation already chose one side, the chapter reports it without treating it as approved.

## 3. System in one page

### 3.1 Parts

1. The integrator state machine defines application state, deterministic transition, participant order, next author, balance algebra, inbound processing, slash, removal, and outbound effects.
2. The TypeScript SDK connects peers and chain, runs the state machine, forms and validates blocks, collects signatures, builds state proofs, stores evidence, and orchestrates recovery.
3. The manager contract stores the adopted snapshot, inbound and outbound progress, calldata commitments, slash set, dispute windows, and reduced successor paths.
4. The consumer adapter escrows and releases application assets.
5. The base chain provides ordered execution, timestamps, event history, public calldata, and enforceable settlement.

### 3.2 Commitments

Serialized application state hashes into `SnapshotData`. Fork ID is the hash of a fork’s genesis `SnapshotData`. A full `StateSnapshot` is committed by a block. Encoded block bytes commit to parent, transaction, resulting snapshot, and included inbound range. Signatures bind exact bytes and recursive ancestry.

Snapshots also commit to membership, inbound and outbound stream heads and heights, and cumulative deposits and withdrawals. This is the contract between application execution and escrow accounting.

### 3.3 Normal execution

The state machine selects the next author. The author builds one block, signs, stores, and gossips it. Receivers authenticate, queue, order, replay, compare the resulting snapshot, persist, sign, and gossip confirmation. They may accept and build the child before the parent is final.

Unanimous distinct signer coverage finalizes an anchor. Coverage can be direct on one block or virtual across a linked descendant segment. Membership changes require proof under the old/resulting/pending union. Milestones retain final anchors. A state proof may have milestone anchors plus a non-final signed suffix.

### 3.4 Cross-layer effects

Deposits, joins, and other L1-to-channel actions form an inbound hash chain. Exits, withdrawals, and other channel-to-L1 actions form an outbound hash chain. Each destination proves and applies only the descendant range after its processed tip.

A join is not complete at deposit. It is pending until the channel consumes its inbound message. An exit is not paid when produced. It is settled when a finalized same-fork or successor snapshot advances the manager and proves the outbound difference.

### 3.5 Fault and recovery

Objective faults attempt a fraud proof immediately. A successful proof creates one timestamped logical slash and removes that participant from recovery eligibility. The application penalty is applied later during successor generation.

A dispute is separate. Valid inputs are selected on-chain slashes, deterministic next-author timeout, voluntary self-removal, and forced inbound progress. Eligible participants submit proved latest views. Invalid commitments can be killed. After the cutoff, reduction selects the longest valid proved history, merges recovery inputs with fixed precedence, replays application changes, and creates one successor fork.

The successor becomes canonical after its reduction challenge period and snapshot adoption. Peers then rebuild membership, timers, mesh, and execution from successor genesis.

## 4. Lifecycle

```text
verify chain and spectate with no funds at risk
        |
        v
open or collect unanimous admission signatures
        |
        v
deposit acknowledged -> inbound JOIN -> pending participant
        |
        v
block consumes JOIN -> active application participant
        |
        v
author -> authenticate -> order -> replay -> store -> sign -> gossip
        |                                  |
        |                                  +-> objective fault -> fraud proof -> slash set
        |
        +-> direct or virtual finality -> same-fork snapshot update
        |
        +-> timeout, slash, self-removal, or forced inbound progress
                                             |
                                             v
                                   dispute evidence and kills
                                             |
                                             v
                                      deterministic reduction
                                             |
                                             v
                                     mandatory successor fork
                                             |
                                             v
                                challenge expiry and fork adoption
                                             |
                                             v
                                  process new outbound difference
                                             |
                                             v
                                      settle or resume execution
```

Best case still requires a base-chain deposit/open and later snapshot advancement/settlement. Joins, top-ups, calldata publication, fraud proofs, disputes, challenges, and forced recovery add cost.

## 5. Hard assumptions and limits

- The target chain remains live and its finalized execution is correct.
- A client can reach a sufficiently honest and fresh provider, or compare providers when required.
- At least one honest participant or authorized watchtower in each relevant partition observes and acts before chain deadlines.
- Application state-machine execution and serialization are deterministic across all supported runtimes and contract replay.
- V1 authoring is round-robin or behaviorally equivalent under the state machine. Non-final carry-forward is not proved for other policies.
- Participants retain or can recover data needed through dispute and settlement horizons.
- V1 chain calldata fallback can be expensive and lets an adversary shift availability cost to users.
- Production needs explicit proof, frame, queue, channel-size, gas, and storage bounds.
- Current in-memory SDK storage does not satisfy crash safety.
- Current contract artifacts exceed the EIP-170 size limit and local Hardhat ignores that limit.

## 6. Reading order

### Foundation

| Document | Purpose |
| --- | --- |
| [Governance](governance.md) | decision ownership, change process, status, traceability, versioning |
| [System model](system-model.md) | actors, authority, state domains, commitments, global invariants |
| [State-machine integration](integration/state-machine.md) | application API, determinism, serialization, balance and effect contract |

### Protocol

| Document | Purpose |
| --- | --- |
| [Protocol root](protocol/README.md) | protocol objects, lifecycle, layer authority |
| [Execution and finality](protocol/execution-and-finality.md) | authoring, validation, virtual votes, milestones, non-final progress |
| [Messages and membership](protocol/messages-membership-and-settlement.md) | streams, spectate, join, exits, settlement |
| [Time and availability](protocol/time-and-data-availability.md) | chain clock, windows, calldata fallback, timeouts |
| [Dispute recovery](protocol/disputes-and-fraud-proofs.md) | proof separation, evidence, reduction, successor |
| [Network trust](protocol/network-topology-and-trust.md) | full mesh, partitions, identity, resource limits |

### SDK

| Document | Purpose |
| --- | --- |
| [SDK root](sdk/README.md) | components, lifecycle, concurrency contract |
| [Runtime and networking](sdk/runtime-and-networking.md) | host/worker, signer roles, RPC, transports, disposal |
| [Block pipeline](sdk/block-confirmation-pipeline.md) | every intake path through validation, storage, signing, and escalation |
| [Dispute pipeline](sdk/dispute-sync-and-reduction.md) | construction, audit, proofs, reduction, challenge, adoption |
| [Storage and recovery](sdk/storage-and-crash-recovery.md) | durable schema, transactions, retention, restart |
| [Chain event sync](sdk/chain-events-and-local-evm.md) | canonical journal, LocalDiamond, gaps, reorganization |
| [Spectate and join](sdk/spectating-and-joining.md) | fail-closed sync, admission, deposit, forced inclusion |

### Contracts

Start with [the contract root](contracts/contracts.md). It links architecture/storage, admission/messages, state proofs, fraud proofs, dispute lifecycle, reduction/snapshots, and interface/event chapters.

### Audit and operations

| Document | Purpose |
| --- | --- |
| [Types and encodings](reference/data-types-and-storage.md) | field-level meanings and commitment rules |
| [Configuration and operations](reference/configuration-and-operations.md) | deployment values, metrics, limits, runbooks |
| [Security](security.md) | assets, adversaries, threats, controls, known gaps |
| [Verification](verification.md) | evidence matrix and required scenario families |
| [Open decisions](open-questions.md) | unresolved gates with options and consequences |
| [Review coverage](traceability/review-coverage.md) | owning section and disposition for every review note |

## 7. Current production blockers

The design cannot be called production-ready until at least these are closed:

1. milestone plus non-final suffix works in SDK and contract;
2. every opened dispute has an all-evidence-killed successor rule;
3. slash selection and proof/challenge economic penalties are approved;
4. hash-only audit data has forced publication or safe invalidation;
5. clock skew, lag, provider, and reorganization policy is measured and implemented;
6. SDK storage, event journal, non-equivocation records, and restart recovery are durable;
7. proof, message, RPC, gossip, channel-size, and gas bounds are enforced;
8. contracts fit production code-size limits under a safe Diamond and storage layout;
9. consumer reentrancy and asset model are audited;
10. verification covers adversarial partitions, restarts, reorganizations, and full settlement.

## 8. Future work

Non-normative directions are kept in the owning chapters and the decision register. They include alternate data availability, larger topologies, private watchtowers, lower-cost reduction, light-client chain observation, and stateless replay. They do not reduce the production blockers above.
