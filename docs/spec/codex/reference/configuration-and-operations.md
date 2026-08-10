# Configuration, deployment, and operations

## Status and authority

This chapter defines the configuration contract and the minimum operating procedure for a V1 deployment. Values shown as current defaults describe the repository, not safe production recommendations. A release manifest must replace implicit defaults with reviewed values.

## 1. Configuration model

### 1.1 SDK precedence

`createConfig` resolves SDK configuration in this order, from lowest to highest priority:

1. defaults in `src/utils/config.ts`;
2. `peer3.config.ts`, or the caller-provided file-level replacement;
3. process environment variables;
4. explicit `createConfig` overrides.

The result is one process-lifetime singleton. Callers should create it once during setup. Mutating environment variables after initialization does not reconfigure existing managers or workers.

Environment parsing accepts common boolean strings, finite numeric strings, plain strings, and either JSON or comma/space-separated string arrays. Invalid values are ignored and fall back to the lower-precedence value. Production startup must instead report invalid security-sensitive values and stop. Silent fallback is unsafe for provider endpoints, worker limits, timeouts, and logging policy.

### 1.2 Protocol time configuration

The manager and each local diamond use the same four second-based values:

| Value               | Meaning                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `p2pTime`           | Nominal time for the next participant to produce a block.                            |
| `agreementTime`     | Time for peers to confirm, exchange, and converge on material.                       |
| `chainFallbackTime` | Additional time before chain fallback or timeout action is valid.                    |
| `evidenceTime`      | Evidence, kill, and reduction-challenge window duration; also the first-block grace. |

The on-chain proxy constructor fixes these values for the deployment. SDK setup must read them from the deployed manager and reject a caller-supplied mismatch. Local diamonds must be deployed with the exact same values.

`scripts/V1/deploy.ts` currently defaults every value to zero. Zero values are useful for some tests but unsafe for a live deployment because they erase response and challenge windows. Production deployment must require all four values explicitly and must reject zero.

The timeout formulas and clock assumptions are defined in [Protocol time and data availability](../protocol/time-and-data-availability.md).

### 1.3 Current SDK keys

| Key                                        | Current default         | Operational meaning                                                                             |
| ------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `PROVIDER_URL`                             | `http://localhost:8545` | JSON-RPC endpoint for chain reads, logs, and transactions.                                      |
| `LOG_LEVEL`                                | `info`                  | Minimum local log severity.                                                                     |
| `LOG_SKIP_WRITING`                         | `false`                 | Disables file output when true.                                                                 |
| `LOG_EXCLUDE_TAGS`                         | empty                   | Comma-separated exclusion filter.                                                               |
| `EXCLUDE_LOG_TAGS`                         | empty                   | Legacy/parallel exclusion input; ownership should be consolidated.                              |
| `HOLEPUNCH_RELAYER_URLS`                   | empty in defaults       | Relay URLs used by Holepunch transport.                                                         |
| `LOCAL_DISCOVERY_REGISTRY_URL`             | empty                   | Local/test discovery service.                                                                   |
| `VM_DEDICATED_THREAD`                      | `false`                 | Runs contract execution on its dedicated worker path.                                           |
| `RUN_SDK_IN_THREAD`                        | `false`                 | Runs the SDK through the threaded runtime path.                                                 |
| `EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS` | `0`                     | Disabled at zero; otherwise throws when delay exceeds threshold and enables timing diagnostics. |
| `SIGNER_RECOVERY_CACHE_MAX`                | `100000`                | Maximum cached message-signature recoveries per thread.                                         |
| `CRASH_LOG_UPLOAD_ENDPOINT`                | empty                   | Enables crash upload when nonempty.                                                             |
| `CRASH_LOG_API_TOKEN`                      | empty                   | Credential for crash upload.                                                                    |
| `CRASH_LOG_MAX_SIZE_MB`                    | `10`                    | Maximum uploaded crash log size.                                                                |

The `DEBUG_*` switches expose subsystem logging for the state manager, dispute handler, P2P manager, RPC layer, channel contract, and local transport. They must not change protocol behavior.

### 1.4 Required production keys not yet modeled

The current `Config` type is not enough to operate a persistent node. A production configuration schema also needs:

- chain identifier and expected genesis block;
- manager deployment address and deployment manifest hash;
- minimum chain confirmations and reorg rollback depth;
- durable database path or connection;
- database encryption and backup policy;
- event scan start block and maximum batch size;
- per-method RPC size, concurrency, and rate limits;
- per-peer and global queue limits;
- spectator sync byte and object limits;
- proof and auditing-data limits;
- transaction fee, replacement, nonce, and retry policy;
- graceful shutdown deadline;
- metrics and health endpoints;
- unsafe development mode as an explicit flag.

Until these values exist, defaults remain scattered across services and cannot be audited as one policy.

## 2. Deployment manifest

Each deployed manager needs an immutable manifest distributed with the SDK release. The manifest must contain:

- protocol and schema version;
- chain ID and manager address;
- creation transaction hash and block hash;
- proxy and every facet address;
- runtime bytecode hash for proxy, facets, local diamond, state machine, and consumer;
- compiler version, optimizer settings, and source commit;
- four time values;
- dispute execution gas limit;
- supported message and fraud-proof types;
- state machine and consumer identifiers;
- upgrade authority and upgrade procedure, if upgrades are enabled;
- ABI bundle hash.

Peers must compare the manifest during channel setup and spectator sync. Sharing a manager address is not enough when local execution uses separately deployed bytecode.

## 3. Build and release gates

### 3.1 Reproducible build

The release build must pin Node, Yarn, Solidity, Hardhat, dependency lockfile, optimizer, and `viaIR` settings. Generated enum and artifact files must be regenerated and the worktree checked for unexplained changes.

The expected package path is:

1. compile Solidity and TypeChain;
2. regenerate enum translations and artifact bundle;
3. compile Node and browser TypeScript targets;
4. copy required runtime utilities;
5. build the package archive;
6. verify archive contents and hashes against the manifest.

### 3.2 Contract size gate

The EVM runtime bytecode limit is 24,576 bytes. Current repository artifacts exceed it for multiple contracts. Measurements from the generated artifacts include:

| Contract                   | Runtime bytes | Over limit |
| -------------------------- | ------------: | ---------: |
| `LocalDiamond`             |        41,552 |     16,976 |
| `StateChannelManagerProxy` |        30,959 |      6,383 |
| `DisputeFraudProofFacet`   |        26,436 |      1,860 |
| `DisputeVerificationFacet` |        24,783 |        207 |

`hardhat.config.ts` sets `allowUnlimitedContractSize: true`, so local deployment does not prove deployability. Production release must fail when any deployed runtime exceeds the target chain limit. The architecture chapter describes the required facet and proxy split work.

### 3.3 Gas and calldata gates

Release evidence must measure:

- channel opening and each deposit mode;
- inbound and outbound message processing;
- every block and dispute fraud proof;
- maximum accepted state proof;
- maximum accepted dispute and auditing payload;
- reduction, challenge replacement, and finalization;
- worst-case cleanup;
- state machine execution at its configured gas limit.

Tests that use a one-billion block gas limit for parallel throughput are not valid production gas evidence.

## 4. Startup sequence

A node becomes ready only after these steps succeed:

1. parse and strictly validate configuration;
2. open the durable database and acquire its single-writer lease;
3. load the deployment manifest and verify chain ID;
4. fetch manager bytecode and compare it with the manifest;
5. read on-chain time values and compare them with local diamond values;
6. recover the event journal and roll back any noncanonical chain suffix;
7. replay unapplied canonical logs into the local EVM mirror;
8. recover staged block, dispute, queue, and snapshot commits;
9. verify current snapshot bytes and application state hash for every active channel;
10. start chain event polling/subscription;
11. start authenticated transport listeners;
12. resume channel timers from protocol timestamps;
13. advertise readiness.

The node must not accept a transition request while its chain mirror or canonical state is still recovering.

## 5. Chain provider policy

### 5.1 Reads

Provider reads are untrusted inputs until checked against the expected chain and canonical block hashes. A provider can be stale, omit logs, return inconsistent heads, or censor a transaction.

Critical reads should record the block number and hash. Multi-call results must come from one block tag. A node using failover providers must compare chain identity and must not combine results from unrelated heads.

### 5.2 Event ingestion

The durable cursor is the tuple:

`(blockNumber, blockHash, transactionIndex, logIndex)`

Current `EventSyncStorage` retains only a maximum block number, and current dispatch can process logs concurrently. This does not define a safe order and cannot roll back a reorg. Required behavior is:

1. fetch a bounded canonical range;
2. order by block, transaction index, then log index;
3. apply each event idempotently to the local mirror and derived storage;
4. commit event effects and cursor atomically;
5. retain a rollback journal for the configured confirmation depth;
6. compare stored block hashes before extending the cursor.

`OutboundMessagesProcessed` must be part of the supported event set. It is currently missing from `EventSyncService` dispatch and can leave local withdrawal accounting stale.

### 5.3 Transactions

Every chain transaction needs a stable operation ID, nonce ownership, fee policy, receipt tracking, and idempotent retry rule. A dropped submission is not proof that the operation did not land. On restart, the SDK must reconcile pending operations against receipts and emitted events before sending replacements.

## 6. Network operating limits

The transport layer has an outer payload cap of 16 MiB, while queue storage limits per-entry source and signature attribution. These controls do not form a full resource policy.

Production limits must be lower and method-specific. At minimum enforce:

- maximum encoded request and response bytes;
- maximum blocks, milestones, messages, signatures, disputes, and audit blocks per request;
- maximum concurrent requests per peer and globally;
- token-bucket request rate per authenticated peer;
- maximum queue entries and bytes per channel/fork/source;
- maximum signature recovery work per second;
- maximum spectator sessions and sync bytes;
- timeout and cancellation for local EVM calls;
- temporary penalties distinct from permanent Byzantine exclusion.

Reject input before expensive ABI decoding, signature recovery, database writes, or EVM replay when its outer size already violates policy.

## 7. Storage operations

### 7.1 Backup and restore

Backups must include the event journal, signed protocol objects, snapshot/state pairs, message chains, pending transactions, and schema metadata. A backup is usable only if it is transactionally consistent or includes the journal needed to reach consistency.

Restore procedure:

1. restore into an empty database;
2. validate schema and deployment identity;
3. verify hash-addressed object integrity;
4. compare saved event block hashes with chain canonical hashes;
5. roll back the divergent suffix if needed;
6. replay canonical events;
7. validate every advertised current snapshot;
8. start networking only after validation passes.

### 7.2 Retention

Signed blocks, proofs, message blocks, and snapshots may be deleted only when no open channel, unresolved dispute, withdrawal, spectator checkpoint, or supported old protocol version can reference them. Time-based deletion alone is insufficient.

### 7.3 Corruption

Hash mismatch, undecodable canonical bytes, missing state for an advertised snapshot, or a broken ancestry link puts that channel into recovery-only mode. The node must stop producing and confirming blocks for it. It may repair from another peer only after independently verifying hashes, signatures, chain anchors, and proof continuity.

## 8. Monitoring

### 8.1 Required metrics

Per process and per channel, expose:

- canonical chain head and event cursor lag;
- reorg count and rollback depth;
- local mirror apply failures;
- current fork, snapshot height, and finalized height;
- queued block count and bytes by source/fork;
- block production and confirmation latency;
- peer connection and authenticated handshake counts;
- RPC requests, rejects, timeouts, bytes, and concurrency by method/peer;
- disputes by phase and time remaining;
- fraud proofs generated, submitted, accepted, and rejected by type;
- pending chain transactions and age;
- database write latency, failed transactions, and size;
- worker restarts, event-loop delay, and local EVM execution latency;
- signer recovery cache size and eviction rate.

### 8.2 Alerts

Page an operator when:

- event lag approaches any protocol response window;
- a local channel view differs from the chain or peer quorum;
- a dispute or challenge deadline is close without a tracked action;
- a transaction remains unconfirmed beyond replacement policy;
- the database cannot commit or verify a canonical object;
- the local diamond bytecode or time configuration differs from the manifest;
- all peers for an active channel are unreachable;
- crash upload includes secrets or exceeds its configured limit;
- contract balance conservation fails.

## 9. Runbooks

### 9.1 Event lag

Stop block production if chain lag can hide a dispute, slash, join, or settlement event. Keep ingesting canonical logs in bounded batches. Rebuild the local mirror if event order or cursor integrity is uncertain. Resume only after channel state and all active deadlines are recomputed.

### 9.2 Active dispute

Record fork, window timestamps, commitments, available audit data, local proposed reduction, and all deadlines. Fetch missing signed objects from more than one peer. Run objective checks locally. Submit required evidence or fraud proof with enough confirmation margin. Do not rely on an in-memory timer as the only trigger.

### 9.3 Failed settlement

Determine whether failure is proof validity, balance mismatch, unsupported consumer message, gas limit, or transaction submission. Preserve the exact calldata and block tag used for simulation. Do not retry unchanged calldata indefinitely. If value is locked, mark the channel as not closed until the contract state confirms withdrawal completion.

### 9.4 Chain reorg

Pause actions derived from the removed suffix. Roll back the event journal and local EVM to the common ancestor. Mark receipts from removed blocks as pending again. Replay replacement logs in canonical order. Revalidate any block, dispute, or join whose decision used removed events.

### 9.5 Peer equivocation

Preserve both signed objects and transport metadata. Verify they meet an objective fraud-proof type before submission. Disconnect or quarantine the peer according to local policy. Do not convert a timeout, malformed request, or unavailable response into an on-chain accusation without objective signed evidence.

### 9.6 Graceful shutdown

Stop accepting new RPC work, drain or cancel active executions, persist staged objects and pending operation state, flush the event cursor transaction, close transports, terminate workers, and release the database lease. Restart must be safe after a forced stop at each step.

## 10. Secrets and privacy

Signer keys, provider credentials, relay credentials, and crash upload tokens must not enter protocol logs or sync payloads. Crash logs can contain signed blocks, application calldata, participant addresses, and state. Operators need redaction, access control, encrypted transport, bounded retention, and explicit user consent where required.

Debug settings must never log private keys or raw secret-bearing configuration. A crash upload endpoint must use authenticated TLS in production; the repository's localhost example is development-only.

## 11. Current implementation and release blockers

Current strengths include layered configuration, Node/browser build targets, worker isolation options, structured logging, deployment helpers, and broad test harness support.

Production blockers are:

- zero default protocol times in deployment helpers;
- contract runtime sizes above the EVM limit;
- in-memory protocol storage;
- event cursor without block hashes or log position;
- no reorg rollback journal;
- incomplete event dispatch;
- no central method-specific network resource policy;
- no immutable deployment manifest or runtime bytecode check;
- no documented key, transaction, backup, or restore policy;
- no production gas and calldata bounds.

## 12. Verification checklist

Before a release, record evidence for:

- clean reproducible build from the locked source revision;
- deployed and local bytecode hash equality;
- EIP-170 size compliance;
- nonzero reviewed time configuration on chain and locally;
- event replay and reorg recovery;
- process crash at every storage commit point;
- provider failover and stale-provider rejection;
- RPC flood, oversized request, and slow-peer behavior;
- dispute action under event lag and restart;
- package contents and generated artifact consistency;
- backup restore to a fresh node;
- secret redaction in normal and crash logs.

## 13. Source map

| Subject                          | Current source                                                             |
| -------------------------------- | -------------------------------------------------------------------------- |
| SDK configuration and precedence | `src/utils/config.ts`                                                      |
| Example file configuration       | `peer3.config.ts`                                                          |
| Time types and first-block grace | `src/types/time.ts`                                                        |
| Deployment time defaults         | `scripts/V1/deploy.ts`                                                     |
| Hardhat limits and compiler      | `hardhat.config.ts`                                                        |
| Build and test entry points      | `package.json`                                                             |
| Event listener and sync          | `src/StateChannelEventListener.ts`, `src/stateManager/EventSyncService.ts` |
| Runtime worker limits            | `src/evm/node/workerResourceLimits.ts`                                     |
| Crash log upload                 | `src/utils/logging/`, `scripts/logging/`                                   |

## 14. Future work

Non-normative operational work includes verified-RPC clients, automated fee policy, remote watchtower operation, alternate storage backends, and public deployment dashboards. These additions must not replace the baseline startup and recovery checks.
