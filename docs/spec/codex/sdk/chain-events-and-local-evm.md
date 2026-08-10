# Chain event synchronization and local EVM mirroring

## Status and authority

This chapter defines canonical log ingestion and local contract state reconstruction. Contract event meanings are in [interfaces and events](../contracts/interfaces-events-and-errors.md).

## 1. Purpose

The SDK uses a local manager deployment to run the same proof and view logic without chain calls for every check. That mirror is correct only if all canonical manager events are applied once, in order, and rolled back on reorganization. Event sync also provides calldata blocks, dispute evidence, slashes, reduction results, inbound messages, and adopted snapshots to higher-level managers.

## 2. Design decisions and rationale

### 2.1 Raw canonical log is the durable source

Decoded handlers can change with SDK versions. Storing raw topics/data and ABI version lets the runtime rebuild. Derived LocalDiamond state and TypeScript stores are caches over that journal.

### 2.2 Live subscription is a hint, range query closes gaps

Provider subscriptions can disconnect or miss logs. Startup and reconnect query from durable cursor to latest safe block. Live logs join the same ordered queue; they do not bypass cursor continuity.

### 2.3 Event handling is ordered before semantic callbacks

The local EVM mirror, typed storage, and durable cursor update before block validation, dispute audit, reduction, or user hooks see the event. A callback cannot act on an event that would be lost after crash.

### 2.4 Production chain breaks mirror ties

A mirror is allowed to be behind during catch-up. Before creating a punitive proof from a stateful predicate, the SDK confirms production state when local and expected data disagree.

## 3. Boundary and responsibilities

`StateChannelEventListener` owns provider subscription generation. `EventSyncService` filters, queries, orders, deduplicates, dispatches, and recovers missing data. `EventHandler` applies local contract handlers and TypeScript side effects. Storage owns journal and cursor. Managers react only after durable application.

## 4. Data model and owned state

### 4.1 Canonical coordinate

Use `(blockNumber, transactionIndex, logIndex, blockHash)`. Event identity also includes chain ID, manager address, and transaction hash. Current Ethers log `index` is log index. A key of address, transaction hash, and log index deduplicates one branch but needs block hash for reorganization.

### 4.2 Block application state

For each block, track expected queried log count, pending count, applied count, failed status, block hash, and parent continuity. A block becomes cursor-publishable only after all supported logs through it are durably applied and every earlier block range is complete.

### 4.3 Recovery keys

Calldata recovery key is channel, fork, height, and author. Dispute recovery key is channel, disputed fork, and commitment. In-flight maps coalesce repeated queries. Durable completion prevents process restart from repeating unsafe callbacks, while idempotent event apply still permits replay.

## 5. Inputs and preconditions

Subscription filter binds exact manager address, supported event topic set, and indexed channel ID. A decoded event is accepted only if emitter, channel, chain, ABI version, and block canonicality match runtime identity.

Event sync starts from deployment block or durable cursor minus reorganization safety overlap. It must know confirmation policy and target latest block.

## 6. Processing algorithm

### 6.1 Startup catch-up

1. Load durable cursor and block hash.
2. Ask provider whether cursor block remains canonical.
3. If not, find common ancestor and roll back journal effects.
4. Query supported logs in bounded ranges from next coordinate, with an overlap for provider quirks.
5. Fetch block headers for range and verify chain continuity.
6. sort logs by block, transaction index, and log index;
7. apply through one ordered channel-manager queue;
8. reconcile critical manager getters after reaching safe latest;
9. subscribe live from a generation bound to current channel;
10. query once more to close race between catch-up and subscription.

### 6.2 Schedule one log

1. Compute full event identity including block hash.
2. If identical journal row is applied, return its completion.
3. If same coordinate has different block hash, stop and start reorganization recovery.
4. Place log in ordered queue. Do not dispatch a later coordinate while an earlier supported log is missing or failed.
5. Begin storage transaction, insert raw journal row, decode, and validate channel.
6. invoke event-specific LocalDiamond handler;
7. update typed SDK stores and operation state;
8. store inverse data and advance coordinate;
9. commit;
10. after commit, trigger semantic managers and user hook.

An exception leaves cursor before the log and marks sync fatal. The runtime retries only after classifying transient provider or missing-data failure; it never skips.

### 6.3 Event-specific rules

- `ChannelOpened`: store genesis snapshot and encoded state, initialize streams, status, and mesh.
- `InboundMessagesProcessed`: store block before scheduling force inclusion or block validation.
- `BlockCalldataPosted`: verify commitment, store inclusion time before any await, mirror slot, then ingest through calldata strategy.
- dispute commitment: mirror exact window state, store confirmation and optional audit data, stop old-fork queue, validate or complete fast path.
- `ChainSlashed`: mirror unique slash, update eligibility, cancel invalid local actions.
- `DisputeKilled`: remove exact commitment, preserve survivor order, cancel its validation and proofs.
- reduced result: store event and join or challenge local reduction operation.
- snapshot updated: mirror snapshot, require local source material or recover it, then transition state manager.
- withdrawal and storage cleanup: mirror totals and prune only after durable retention checks.

### 6.4 Recover calldata by commitment

1. Query manager slot. If absent, return not found.
2. If local matching record exists, return it.
3. Select a block range from durable cursor and a conservative fallback based on chain time, not channel block height.
4. query `BlockCalldataPosted(channelId, commitment)` logs;
5. schedule matching logs through ordinary ordered event queue;
6. after apply, return record and whether validation was scheduled.

Current fallback receives channel block height in a helper that derives chain range; these domains must not be confused.

### 6.5 Recover missing dispute commitments

1. Query canonical window commitment list.
2. Identify hashes absent from local dispute store.
3. derive initial chain range from window creation timestamp and observed block interval;
4. query both dispute event types, filter by commitment, and schedule in canonical order;
5. expand range with bounded attempts;
6. fail recovery if any canonical commitment remains unavailable.

Reduction cannot proceed with a partial list.

### 6.6 Reorganization rollback

1. Pause authoring, proof, reduction, and snapshot submissions.
2. Find common canonical block.
3. Cancel event and operation generations after it.
4. Apply journal inverse records in reverse coordinate order, including LocalDiamond rebuild or rollback.
5. remove orphaned calldata times, slashes, commitments, reductions, snapshots, and derived timers;
6. reset cursor to common ancestor;
7. query and apply replacement branch;
8. reconcile manager getters and local application state hash;
9. resume only when safe latest reached.

Rebuilding LocalDiamond from a checkpoint plus replay is safer than writing inverse Solidity handlers for every event.

## 7. Outputs and postconditions

After each cursor advance, raw journal, LocalDiamond getters, typed storage, operation state, and cursor agree. Higher-level callbacks receive event coordinate and lifecycle generation. Recovery queries either return complete canonical data or fail without advancing dependent work.

## 8. Invariants

- **EVT-INV-1:** supported canonical log is applied once and never skipped.
- **EVT-INV-2:** log application order is full chain coordinate, not promise completion order.
- **EVT-INV-3:** raw journal, mirror mutation, typed store, and cursor commit atomically.
- **EVT-INV-4:** calldata is stored before validation can read it.
- **EVT-INV-5:** reduction sees every canonical surviving dispute commitment.
- **EVT-INV-6:** orphaned event effects cannot survive reorganization recovery.
- **EVT-INV-7:** a failed log stops later cursor publication.
- **EVT-INV-8:** listener generation rejects late callbacks after channel change or disposal.
- **EVT-INV-9:** mirror mismatch cannot directly produce punitive proof without production check.

## 9. Ordering, concurrency, and atomicity

Provider fetching and parsing can run in parallel. Application is ordered. Event-specific heavy validation runs after durable base application and may run concurrently under operation generations. A later snapshot callback may need to await the fork’s reduction operation when its local source material is not ready.

Changing channel ID removes old listener, increments generation, waits for owned scheduled work as policy requires, updates filter, and only then attaches the new listener.

## 10. Trust and security assumptions

One provider can omit or present stale logs. Critical recovery should support multiple-provider comparison. Confirmation depth reduces reorganization risk but cannot remove it. Event calldata can be large and maliciously encoded within contract acceptance rules.

LocalDiamond handlers are trusted mirror code but externally callable in the local environment. Only event sync may invoke them, with canonical coordinates.

## 11. Failure behavior and recovery

Parse failure, unsupported ABI at an expected event, LocalDiamond revert, or typed-store failure stops synchronization. Provider query failure retries without marking range complete. Missing block by hash during kill event handling retries provider or enters degraded, not skip.

On disposal, listener generation increments, provider handler is removed, scheduled event work is awaited to a bound, and remaining durable work resumes next startup.

## 12. Current implementation

`EventSyncService` filters eleven manager event types, keys in-flight work by address, transaction hash, and log index, tracks pending completion by block number, and publishes block-number watermark. It recovers calldata and dispute events with bounded queries. `EventHandler` mirrors events and starts semantic work. `StateChannelEventListener` uses a channel generation and waits up to 30 seconds on dispose.

Current storage persists only maximum processed block number in memory. Scheduled logs can dispatch concurrently, so handlers from later coordinates may complete before earlier ones. Coordinates passed to LocalDiamond use block number and log index, without transaction index or block hash. There is no reorganization rollback. `OutboundMessagesProcessed` is not in the event sync supported list, although contract declares it.

## 13. Difference from the intended design

| Classification     | Difference                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| bug                | block-number-only in-memory watermark is not a safe canonical cursor                                         |
| bug                | concurrent dispatch does not enforce complete log order across a block range                                 |
| missing            | durable raw journal and atomic cursor transaction                                                            |
| missing            | transaction index and block hash in event coordinates                                                        |
| missing            | reorganization detection, rollback, and replay                                                               |
| missing            | provider gap closure around subscription startup and reconnect                                               |
| documentation debt | supported event set omits `OutboundMessagesProcessed` and must state whether another event fully replaces it |
| missing            | systematic production getter reconciliation                                                                  |

## 14. Dependencies and cross-layer effects

Clock, storage, block pipeline, dispute validation, reduction, snapshot update, P2P membership, and user hooks all consume event state. Contract event field changes require ABI version and migration support.

## 15. Verification

Tests must reorder promise completion while keeping log coordinates fixed, deliver duplicates, omit a range, reconnect subscription, crash after every handler step, change block hash at cursor, reorganize each event type, switch channel during in-flight events, dispose with pending work, recover old calldata and disputes, and compare all mirror getters with production at the same block.

## 16. Future work

Verified compact checkpoints can shorten LocalDiamond rebuild. They must be tied to canonical block hash and manager storage commitments.
