# System model, authority, and global invariants

## Status and authority

This chapter defines the shared vocabulary and whole-system properties. Focused chapters may refine a property but must not contradict it silently.

## 1. Purpose

The system spans peers, local execution, application code, manager contracts, consumer assets, providers, and the base chain. The model identifies which layer can answer which question, what must be committed, and which failures the design can recover from.

## 2. Actors and roles

| Role                 | Meaning                                                 | Authority and limits                                                                                            |
| -------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| proposed participant | address in an unopened proposal                         | can approve exact opening; no channel duty before on-chain open                                                 |
| spectator            | verified read-only replica                              | no funds, author slot, threshold vote, or recovery duty                                                         |
| pending participant  | canonical inbound JOIN deposit not yet consumed         | participates in on-chain recovery threshold; not yet application author unless successor/transition includes it |
| active participant   | address in application snapshot and not slashed         | authors, validates, confirms, disputes, reduces, and challenges according to schedule                           |
| block author         | `getNextToWrite` result for one state                   | may propose exactly the next block; signature does not make it valid                                            |
| confirmer            | eligible participant signing exact block bytes          | commits to block ancestry and must not equivocate                                                               |
| disputer             | participant responsible for one committed recovery view | may be penalized for an objectively invalid commitment                                                          |
| proof submitter      | caller presenting objective evidence                    | target must be determined by proof, not caller choice                                                           |
| reducer              | participant committing deterministic successor          | accountable for a wrong result under approved challenge policy                                                  |
| challenger           | participant recomputing a committed result              | accountable only under approved false-challenge policy                                                          |
| integrator           | application state-machine and consumer author           | defines application behavior within manager constraints                                                         |
| watchtower           | authorized delegate acting for an offline participant   | not complete in V1; authorization and privacy are unresolved                                                    |
| RPC provider         | view into base chain                                    | may delay, omit, or lie; not the chain itself                                                                   |
| base chain           | ordered contract execution and timestamp authority      | final arbiter after confirmation/reorganization policy                                                          |

An address may hold several roles over time. Membership and balance are separate. A participant may have zero balance; an escrow depositor may be pending before it is an application participant.

## 3. State domains and authority

| State                                        | Authority                                 | Replicas and caches                            |
| -------------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| adopted channel snapshot                     | manager contract                          | SDK storage and LocalDiamond                   |
| current off-chain valid head                 | deterministic replay plus signed ancestry | each peer’s durable block/state store          |
| final anchors and signatures                 | exact signed bytes and proof rules        | agreement storage                              |
| inbound source stream and total deposits     | manager contract                          | event journal, LocalDiamond, SDK message store |
| outbound processed tip and total withdrawals | manager contract                          | event journal, LocalDiamond, SDK message store |
| application state bytes                      | content hash plus data availability       | peer storage, dispute audit data               |
| objective slash set                          | manager contract                          | LocalDiamond and SDK event store               |
| dispute commitment order and phase           | manager contract                          | event journal and dispute store                |
| local network blacklist                      | one SDK runtime                           | never chain or slash authority                 |
| local time estimate                          | one SDK clock                             | scheduling only                                |

If a cache differs from its authority, the SDK pauses dependent punitive work, reconciles, and then resumes. It does not choose whichever value is convenient.

## 4. Commitment hierarchy

```text
encoded application state
        |
        +-- keccak256 --> SnapshotData.stateMachineStateHash

ordered participants + stream tips/heights + balances + origin fork
        |
        +-----------------------> SnapshotData
                                      |
                                      +-- keccak256 --> forkId at fork genesis

SnapshotData + forkId + blockHeight + timestamp
        |
        +-----------------------> StateSnapshot
                                      |
                                      +-- keccak256 --> Block.stateSnapshotHash

transaction + parent block hash + included inbound blocks + snapshot hash
        |
        +-----------------------> encoded Block
                                      |
                                      +-- keccak256 --> block identity
                                      +-- signature --> author/confirmation commitment
```

The ABI representation is part of the protocol. Address order, array order, zero values, and nested bytes all affect hashes. A semantically similar value with different encoding is different evidence.

## 5. Channel and fork model

### 5.1 Channel identity

`channelId` identifies one manager record and application instance. V1 accepts a proposed nonzero ID at open. Uniqueness is enforced by absence of an adopted snapshot. Production should bind ID derivation to chain, manager, application version, participants, and nonce or document why caller choice is safe across deployments.

### 5.2 Fork identity

A fork begins with genesis `SnapshotData`; its hash is `forkId`. Genesis full snapshot has block height zero and an authoritative timestamp. Transaction zero links to that full genesis snapshot. Later blocks link to encoded parent block.

Normal execution does not change `forkId`. A dispute creates successor `SnapshotData` with `originForkId` equal to the disputed fork. Its hash is the successor ID. Successor execution restarts block count at zero.

### 5.3 Canonical states

“Canonical” has three scopes:

- canonical on-chain snapshot: currently adopted manager state;
- canonical off-chain head: latest valid head a peer follows on an undisputed fork;
- canonical recovery successor: reduced result whose challenge period expired, even before snapshot adoption.

Chapters must name the scope. Calling an unadopted local block “on-chain canonical” is wrong.

## 6. State transition model

One application transition is a pure function of prior encoded state, transaction, ordered inbound range, and versioned protocol context. It outputs success or failure, encoded state, participants, balance state, and ordered outbound messages.

Ambient local wall time, network sender, provider response, filesystem, random source, and mutable global process state are prohibited inputs unless their values are committed in the transaction or protocol context and verified identically on every path.

The accepted block transition also updates snapshot timestamp, block height, stream heads, cumulative balances, and fork linkage. These manager fields are not left for application code to invent.

## 7. Safety invariants

- **SYS-INV-1, deterministic replay:** identical prior committed inputs produce identical output bytes and success result in peer and contract replay.
- **SYS-INV-2, authenticated authoring:** every accepted block is signed by the deterministic next author and linked to its accepted predecessor or genesis.
- **SYS-INV-3, non-equivocation:** one signer does not sign different block bytes for the same channel, fork, and position; if it does, evidence is objective.
- **SYS-INV-4, confirmation after validation:** a peer signs only after full replay and durable storage.
- **SYS-INV-5, balance conservation:** total deposits equal total withdrawals plus application-controlled balance under the application balance algebra.
- **SYS-INV-6, stream ancestry:** destination tips move only to proved descendants and process each message block once.
- **SYS-INV-7, membership authorization:** membership changes use old/resulting/pending threshold context and cannot be asserted by the new set alone.
- **SYS-INV-8, valid-state carry-forward:** dispute reduction begins from the latest valid proved history under deterministic height and hash rules.
- **SYS-INV-9, objective enforcement:** subjective network or reputation facts never directly slash.
- **SYS-INV-10, mandatory successor:** every completed dispute window has exactly one deterministic successor fork.
- **SYS-INV-11, atomic external effects:** a failed snapshot update leaves manager snapshot, stream tips, balances, and consumer assets unchanged.
- **SYS-INV-12, restart safety:** crash cannot erase signed commitments, cause double sign, skip canonical events, or extend deadlines.
- **SYS-INV-13, version agreement:** bytes are interpreted under one explicit protocol, ABI, state-machine, and consumer version.

## 8. Liveness properties

### 8.1 Normal liveness

When scheduled authors and network links are available, peers produce, validate, and confirm blocks without chain transactions. A slow confirmer does not stop immediate valid execution, but it can delay direct finality.

### 8.2 Author failure

After peer, agreement, and chain publication windows, an eligible participant can open timeout recovery. The unavailable author may be removed without being called Byzantine.

### 8.3 Data failure

Missing block data uses peer RPC then author chain calldata. Missing dispute auditing data needs a forced publication or invalidation rule. The latter is incomplete.

### 8.4 Peer disagreement

Each eligible participant commits one proved latest view. Objective invalid views are killed. Deterministic reduction creates successor regardless of arrival order.

### 8.5 Value recovery

A participant can settle through a finalized same-fork snapshot or finalized successor snapshot. This assumes chain access, retained evidence, executable proof size, and at least one timely honest actor or watchtower.

## 9. Failure domains

| Failure                          | Expected scope                         | Recovery                                                                                    |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| malformed frame                  | one peer request                       | reject or disconnect                                                                        |
| invalid block                    | one history path and offender evidence | fraud proof and dispute                                                                     |
| missing next block               | one fork position                      | RPC, calldata, timeout                                                                      |
| worker crash                     | one runtime worker                     | rebuild from durable state; stop signing meanwhile                                          |
| storage failure                  | one runtime or channel                 | degraded, recover backup/peers, never sign without non-equivocation state                   |
| provider outage                  | chain-dependent work                   | switch provider and resync                                                                  |
| chain reorganization             | all events after ancestor              | rollback journal, replay, cancel stale operations                                           |
| contract adapter bug             | every channel using deployment         | pause, upgrade/migrate under approved governance, or recover through immutable version path |
| all relevant observers Byzantine | affected partition                     | outside safety assumption                                                                   |

## 10. Scale and cost limits

Full-mesh messages grow as `N(N-1)`. Unanimous signature checks, proof arrays, dispute commitments, and some contract loops grow with participants or history. V1 must enforce a participant maximum and proof/message bounds chosen from measured target hardware and chain gas.

The system shifts ordinary work off chain but not all cost. Opening/deposit and final settlement are on chain in the best case. An adversary can add calldata, proof, dispute, and challenge cost. Product claims must state common and worst-case fees and latency.

## 11. Current implementation and differences

The repository implements the main objects and many paths, but durable storage, complete event reorganization, production contract deployment, mixed state proofs, missing-audit enforcement, and all-evidence-killed recovery remain incomplete. Those are violations or unresolved requirements, not model exceptions.

## 12. Verification

Global property tests must generate histories with membership changes, delayed signatures, valid and invalid forks, stream ranges, slashes, timeouts, and evidence permutations. They must assert deterministic replay, balance conservation, stream once-only processing, non-equivocation, order-independent reduction, successor uniqueness, and restart equivalence.

## 13. Future work

Non-normative model extensions include larger network partitions, other leader policies, alternate chain and data-availability authorities, confidential state, and aggregate signatures. Each requires a new safety and liveness argument.
