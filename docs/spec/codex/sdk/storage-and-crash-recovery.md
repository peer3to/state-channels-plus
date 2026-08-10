# SDK storage, atomicity, retention, and crash recovery

## Status and authority

This chapter defines the production persistence contract. Current `src/storage` classes are in-memory implementations and do not satisfy restart requirements.

## 1. Purpose

The SDK signs non-equivocating commitments and must prove old state during recovery. A process restart cannot erase what the peer signed, which messages it processed, which event coordinate it applied, or when a queued item first appeared. Storage is therefore part of protocol safety, not a cache layer.

## 2. Design decisions and rationale

### 2.1 Content-address immutable protocol objects

Blocks, snapshots, encoded states, message blocks, disputes, and proofs are stored by their protocol hash. Immutable values make deduplication and verification simple. Mutable status and indexes live in separate records.

### 2.2 One transactional database per runtime authority

Cross-module writes for one accepted block or event commit in one database transaction. Independent Map wrappers cannot provide atomic block, snapshot, state, queue, cursor, and signature updates.

### 2.3 Keep signed evidence longer than execution caches

Non-equivocation records, finalized anchors, dispute commitments, slash events, and unprocessed outbound messages have long safety horizons. Decoded model caches and stale future queue items can expire sooner. Retention follows proof need, not object size alone.

### 2.4 Store canonical and speculative namespaces separately

Spectate sync, dispute replay, local reduction candidates, and unconfirmed chain operations must not overwrite canonical active-fork state. Promotion to canonical happens through an atomic validated transition.

### 2.5 Schema migrations are resumable and versioned

The runtime refuses signing until storage migration and invariant checks finish. A crash during migration resumes from durable per-step markers.

## 3. Boundary and responsibilities

The database adapter owns transactions, durability, compare-and-set, migration, encryption, and backup. Typed repositories own schemas and indexes. Managers decide semantic retention. Event sync owns canonical journal and rollback. Worker runtimes use host storage APIs or isolated caches; they do not keep untracked authoritative state.

## 4. Data model and owned state

### 4.1 Identity and metadata

Store schema version, SDK protocol version, chain ID, manager address and code version, application artifact hashes, local signer address, channel IDs, last clean shutdown, and migration state. Opening a database with different identity fails unless an explicit import or migration verifies compatibility.

### 4.2 Core object tables

| Table               | Primary key                        | Required secondary indexes                                          |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| blocks              | block hash                         | `(channel, fork, height)`, parent hash, state snapshot hash, author |
| block signatures    | `(block hash, signer)`             | signer and fork/height for non-equivocation                         |
| snapshots           | snapshot hash                      | `(channel, fork, blockHeight)`, genesis by fork                     |
| application states  | state hash                         | reference count and creation source                                 |
| message blocks      | `(channel, direction, block hash)` | height, parent, processed status                                    |
| participant changes | `(channel, fork, height)`          | fork ordered scan                                                   |
| calldata records    | `(channel, author, fork, height)`  | block hash, canonical event coordinate                              |
| disputes            | dispute hash                       | channel/fork/window, disputer, status                               |
| audit data          | audit hash                         | dispute hash, availability and validation status                    |
| proofs              | proof hash                         | target, dispute hash, type, submission status                       |
| slash records       | `(channel, participant)`           | event coordinate and timestamp                                      |
| windows             | `(channel, disputed fork)`         | phase deadlines and canonical commitment version                    |
| queues              | block hash                         | `(channel, fork, height)`, first seen, priority                     |
| operations          | `(channel, type, generation)`      | fork, transaction hash, status                                      |
| event journal       | full chain coordinate              | channel, event family, block hash                                   |
| event cursors       | `(chain, manager)`                 | last finalized and last applied coordinate                          |

### 4.3 Non-equivocation records

Before signing a block, dispute, admission, reduction attestation, or other slashable commitment, store its domain key and hash. For blocks, domain includes channel, fork, transaction count, signer, and commitment class. Compare-and-set rejects a different hash for the same domain.

### 4.4 Queue record

Persist encoded block confirmation, first seen chain-clock estimate, source peers up to cap, signature source attribution up to cap, chain timestamp, overflow flag, attempts, last error class, next retry, and fixed expiry. Restore must not reset first seen.

### 4.5 Event journal

Store chain ID, manager address, block number, block hash, parent block hash where available, transaction index, log index, transaction hash, event signature, raw topics/data, decoded ABI version, before-image or inverse mutation, and application status. A block-number-only cursor is insufficient for duplicates and reorganization.

## 5. Inputs and preconditions

Database open requires exclusive runtime identity lock or a storage engine that provides safe multi-process transactions. Schema and artifact identity must match. Encryption key and filesystem durability settings must be available before active mode.

Every write transaction carries expected channel generation and, for canonical mutation, expected fork and head. Stale writers fail compare-and-set.

## 6. Processing algorithm

### 6.1 Accept a new block atomically

1. Begin transaction and lock channel head record.
2. Require expected fork and parent still current.
3. Insert immutable block, snapshot, encoded state, and message blocks by hash; identical existing bytes are accepted, different bytes at same hash are corruption.
4. insert valid signatures with uniqueness by signer;
5. compare-and-set local signing domain before adding local signature;
6. update coordinate, height, parent, snapshot, participant-change, and stream indexes;
7. remove or mark completed queue entry;
8. advance canonical local head and operation generation;
9. commit with configured durability;
10. only after commit send confirmation and higher-level events.

### 6.2 Merge signatures atomically

Lock block record, insert only new authenticated signer rows, update finality and milestone records if threshold changes, commit, then broadcast. A duplicate signature is an idempotent no-op.

### 6.3 Apply a chain event atomically

1. Begin transaction and require expected cursor coordinate.
2. insert raw journal row; identical duplicate returns no-op;
3. apply decoded event mutation to mirror tables and store inverse data;
4. update derived deadlines and cancelable operation state;
5. advance cursor to complete coordinate;
6. commit;
7. notify managers after commit.

### 6.4 Store a chain submission

Before broadcast, store operation type, exact calldata hash, sender, nonce expectation, target chain, fork generation, and status `prepared`. After provider returns transaction hash, persist `submitted`. Receipt and canonical event update separate statuses. Restart reconciles all prepared/submitted operations by nonce, transaction hash, and contract state.

### 6.5 Startup recovery

1. Acquire database identity lock.
2. verify schema and run resumable migration;
3. check immutable object hashes and key indexes for active channels;
4. find transactions left open or operations in prepared/submitted state;
5. restore event cursor and replay canonical gap;
6. roll back orphaned events if stored block hash is not canonical;
7. rebuild derived caches from base records;
8. restore queues with original expiry and run expired work as scheduled tasks;
9. restore pending proof, reduction, challenge, and snapshot operations from canonical phase;
10. verify local EVM state hash against active snapshot;
11. enter active mode only after all checks pass.

### 6.6 Retention and pruning

An object is prunable only when no live channel, proof, dispute, event rollback window, unprocessed stream, pending operation, or non-equivocation rule references it.

Minimum rules:

- keep all locally signed commitments for channel lifetime plus configured audit horizon;
- keep fork genesis, adopted snapshots, final milestones, and membership hops while a descendant fork can reference them;
- keep dispute and audit data through reduction challenge, successor adoption, and chain finality horizon;
- keep outbound blocks until manager processed tip passes them and reorganization horizon expires;
- keep inbound blocks until every live snapshot/proof lower bound passes them and contract cleanup is final;
- keep event inverse data through reorganization horizon;
- drop expired unreferenced future queue entries after diagnostics horizon.

Reference counts are advisory; pruning also checks semantic watermarks.

### 6.7 Backup and restore

A backup includes database checkpoint, identity metadata, encryption version, and canonical chain coordinate. Restore replays from that coordinate and verifies active state hashes before signing. Copying only selected tables is unsupported because it can lose non-equivocation or cursor data.

## 7. Outputs and postconditions

Every committed canonical state can be reconstructed after crash. A visible local signature has its bytes and signing domain stored. Event cursor always matches applied mirror state. Pruned data has a recorded reason and watermark.

## 8. Invariants

- **STO-INV-1:** hash-keyed object bytes hash to their key.
- **STO-INV-2:** one block coordinate in one accepted fork maps to one canonical block hash.
- **STO-INV-3:** local signer cannot store two hashes for one non-equivocation domain.
- **STO-INV-4:** block acceptance and all resulting indexes commit atomically.
- **STO-INV-5:** event cursor and event mutation commit atomically.
- **STO-INV-6:** speculative namespace cannot be read as canonical without promotion.
- **STO-INV-7:** restart preserves original deadlines and operation generations.
- **STO-INV-8:** no object is pruned while a live proof, stream, rollback, or settlement path references it.
- **STO-INV-9:** migration cannot enter active mode halfway.
- **STO-INV-10:** storage corruption fails closed before signing.

## 9. Ordering, concurrency, and atomicity

Transactions serialize by channel head and event cursor. Different channels may write in parallel. Content-addressed immutable inserts can run concurrently, but canonical index promotion uses compare-and-set. Background pruning uses a snapshot and rechecks references in the deletion transaction.

Worker caches may lag. Main database generation is authority. A worker result includes the input generation and is discarded if it no longer matches.

## 10. Trust and security assumptions

Local storage may be read or corrupted by an attacker with device access. Encryption at rest protects confidentiality, not integrity against a running compromised process. Hash checks detect accidental or some malicious corruption but cannot recover missing data without backup or peers.

User signing keys should not be stored in protocol database unless the application explicitly chooses that custody model. Database values can contain private game state and require access control and redacted diagnostics.

## 11. Failure behavior and recovery

Transaction failure leaves no partial canonical change. Disk full or durability error moves runtime to degraded before it signs or acknowledges more work. Corrupt immutable object quarantines the channel and attempts peer/chain recovery only if the commitment proves expected bytes.

An incomplete submitted transaction is reconciled, not blindly resent, to avoid nonce replacement and duplicate economic action. A failed migration keeps old schema intact where possible and records the exact step.

## 12. Current implementation

`Storage.ts` composes separate in-memory classes wrapped by deep-copy proxies. Core repositories use JavaScript `Map`. There is no database transaction spanning them. `EventSyncStorage` stores only latest processed block number per channel. Queue source attribution has a per-entry cap of 128 but the queue itself has no complete durable/global budget.

Tests cover individual storage modules and deep-copy behavior, but process restart creates a new empty store.

## 13. Difference from the intended design

| Classification | Difference                                                                          |
| -------------- | ----------------------------------------------------------------------------------- |
| missing        | durable database adapter and schema                                                 |
| missing        | cross-repository atomic transactions and compare-and-set                            |
| bug            | block-number-only event cursor cannot safely identify duplicates or reorganizations |
| missing        | non-equivocation record independent of block cache lifetime                         |
| missing        | canonical versus speculative namespaces                                             |
| missing        | operation and chain transaction journal                                             |
| missing        | retention watermarks, pruning audit, backup, and restore                            |
| missing        | schema migration and identity compatibility checks                                  |
| missing        | encryption and private-state handling policy                                        |

## 14. Dependencies and cross-layer effects

Every SDK subsystem depends on storage. Contract proof horizons determine retention. Event reorganization determines journal horizon. Network limits determine queue budget. Application privacy determines encryption and log redaction.

## 15. Verification

Run crash injection after every write in block acceptance, signature merge, event application, dispute construction, proof submission, reduction, and snapshot adoption. On restart, assert no double sign, no cursor skip, same deadlines, and same canonical hashes. Also test disk full, corruption, concurrent writers, migration crash, backup restore, prune race, reorganization beyond and within horizon, and worker stale generation.

## 16. Future work

Provide Node and browser adapters with identical transaction semantics, likely a server-grade embedded database for Node and IndexedDB-backed transactional storage for browser. Capability differences must not weaken signing safety.
