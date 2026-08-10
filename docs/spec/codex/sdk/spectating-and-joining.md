# SDK spectating, admission signing, joining, top-up, and forced inclusion

## Status and authority

This chapter defines the client path from outsider to verified spectator, pending participant, and active participant. Spectating never creates an obligation. Contract admission rules are in [opening and admission](../contracts/admission-calldata-and-messages.md).

## 1. Purpose

A joiner should inspect and replicate a channel before risking funds. The SDK must verify peer-supplied state against the manager, finality, streams, and balance invariant. After that, it gathers unanimous admission signatures, deposits, watches the inbound message, and uses forced inclusion if normal block production does not apply the join.

## 2. Design decisions and rationale

### 2.1 Spectate is one atomic promotion

Peer data is staged outside canonical active storage. Only a complete verified payload is promoted. A failed sync can leave diagnostic cache but cannot change channel status, authoring state, manager mirror, or funds.

### 2.2 Verify what could be submitted on chain

The spectator does not only check a peer’s hashes. It prepares the reduction and snapshot-update calldata implied by the payload and runs a production-compatible static multicall. This proves that the claimed finalized state can follow the manager’s current snapshot under contract rules.

### 2.3 Admission signatures bind the verified point

Expected snapshot hash and fork ID are signed or carried in the signature request and rechecked by every signer. The chain rechecks them at inclusion. A joiner never submits a signature set gathered for a different state.

### 2.4 Pending status begins after durable transaction intent

The SDK must distinguish prepared, submitted, included, pending application inclusion, and active. It should not become pending merely because it called the contract method. Crash and transaction replacement need a durable journal.

## 3. Boundary and responsibilities

`SpectateService` requests, verifies, stages, and promotes sync payload. Serving peers generate payload. Event sync fetches manager truth and windows. Local EVM simulates contract path. `JoinChannelService` gathers and validates signatures. `StateManager` owns status and chain transaction. Force-join storage and block hook track inclusion delay.

## 4. Data model and owned state

### 4.1 Sync request

Request binds channel, local initialization time, and optional target fork and block height. Channel comes from local request closure, never a peer echo. Target omission means latest safe spectating state.

### 4.2 Sync payload

Payload needs:

- manager snapshot basis;
- every dispute window between that snapshot and claimed latest fork;
- exact disputes, source states, inbound ranges, and reduced fork IDs;
- latest fork genesis snapshot and encoded state;
- state proof and paired milestone snapshots;
- latest finalized encoded state;
- outbound ranges from manager snapshot through successor genesis and latest final snapshot;
- unfinalized suffix blocks and any inbound data needed to continue live sync;
- protocol, ABI, artifact, chain, manager, channel, and generation identity.

### 4.3 Spectator staging namespace

Store payload hash, serving peer, request target, start and deadline, validation stage, fetched chain coordinates, immutable objects, and failure reason. It grants no active block signing and does not replace canonical current channel state until promotion transaction.

### 4.4 Admission operation

Store exact `JoinChannel`, participant signature, threshold set and its chain coordinate, collected signatures by address, expected snapshot and fork, deadline, transaction intent/hash, inclusion event, inbound message hash/height, submission block height, and status.

## 5. Inputs and preconditions

Spectate starts only from a nonparticipating lifecycle, authenticated peer, supported channel size/version, and verified manager identity. At most one sync per serving peer and one promotion per local channel generation run concurrently.

Join requires successful promoted sync, local signer equals join participant, unexpired chain deadline, exact balance and asset approval, undisputed target fork, and connection to every threshold participant or another approved signature collection route.

## 6. Processing algorithm

### 6.1 Request sync

1. Record local request with chain-clock estimate and operation generation.
2. Select an authenticated participant peer.
3. send request by participant address, not a transport object that may be replaced;
4. set timeout no later than `agreementTime` and operation deadline;
5. on response, require same request generation and bound peer;
6. measure elapsed conservative protocol time. Too slow is safe failure, not proof of Byzantine behavior.

Transport timeout should disconnect or deprioritize the serving peer under network policy. It should not permanently blacklist a participant merely for ordinary unavailability.

### 6.2 Decode and identity validation

1. Enforce payload byte and collection bounds before decode.
2. Decode inside owned error boundary.
3. verify chain, manager, channel, protocol, ABI, and application artifact identities;
4. verify optional requested fork and height constraints;
5. hash every embedded object and reject internal reference mismatch;
6. create staging namespace. Do not write canonical stores.

### 6.3 Fetch authoritative basis

1. Read current manager snapshot from production chain at a recorded block tag.
2. replay it into a clean LocalDiamond staging instance;
3. fetch each claimed dispute window from manager and recover all commitment events;
4. require payload commitment lists and reduced results match chain;
5. require each traversed window’s kill deadline passed;
6. if a result is not final, abort latest spectate or use an explicit policy that remains read-only. Current code locally reduces at most one unresolved window; this is not general enough.

### 6.4 Verify successor path

For each dispute window in order:

1. validate exact dispute and auditing data as the dispute pipeline does;
2. compute or confirm reduction from complete commitment list;
3. require computed successor equals payload reduced fork;
4. verify successor genesis snapshot data, encoded state hash, origin fork, and authoritative timestamp;
5. advance staging LocalDiamond only through a valid reduced path;
6. reject missing, repeated, or forked path segments.

The final successor must be not disputed for a latest-state request. A historical target must equal requested fork.

### 6.5 Verify finality and streams

1. Choose latest finalized snapshot from last milestone or fork genesis.
2. reject if manager is already on the same fork at a greater height than payload proves;
3. verify outbound range from manager snapshot to latest fork genesis;
4. verify milestones from fork genesis through latest finalized snapshot, including membership hops;
5. require finalized encoded state hash matches snapshot;
6. verify outbound range within latest fork;
7. verify inbound commitments and source data needed by proof;
8. verify balance conservation on production-compatible contract;
9. reject conflicting block at any staged fork/height.

### 6.6 Simulate contract catch-up

Build one ordered multicall containing any required reduction finalization, successor snapshot update, and same-fork milestone update. Execute as static call against production manager state at a consistent block tag. A stale block tag result must be refreshed before promotion.

Static-call failure aborts with typed reason. It does not submit a transaction during spectating.

### 6.7 Promote verified state

Inside one storage transaction and state-manager mutex:

1. Recheck lifecycle and operation generation.
2. recheck canonical manager snapshot and dispute version used by validation;
3. require local canonical state has not advanced beyond or conflicted with payload;
4. write genesis, finalized blocks, milestone snapshots, encoded states, streams, dispute material, and proof records from staging;
5. set latest local state to finalized snapshot and state;
6. queue non-final suffix through `SpectatingValidationStrategy` rather than marking it accepted by payload alone;
7. set status `SYNCED` only after transaction commits;
8. remove staging namespace and report success.

### 6.8 Abort

Cancel request, validation, and staged worker generation. Delete or quarantine staging records. Keep status nonparticipating, close only the offending connection under network policy, and return a typed safe-abort reason. Never create a dispute or chain transaction solely because spectating failed.

### 6.9 Collect admission signatures

1. Require local signer is join participant.
2. Read manager snapshot and complete on-chain participant union at one block tag.
3. build join with deadline and asset balance;
4. sign exact encoded join as participant;
5. for every threshold address, request signature over exact join bytes plus expected snapshot and fork;
6. each remote signer verifies joiner signature and peer identity, channel, deadline from chain time, expected manager snapshot/fork, local threshold membership, participant not already present for a new join, asset/admission policy, and no active dispute;
7. recover every returned signature to expected address;
8. deduplicate and require full threshold set;
9. persist complete prepared admission operation.

Current code has a TODO for configurable admission filtering. Production needs an application hook that is deterministic, snapshot-scoped, and explains refusal without leaking private state.

### 6.10 Submit and track join

1. Recheck chain time, snapshot, fork, dispute state, asset allowance, and signatures.
2. persist prepared transaction intent;
3. submit from join participant;
4. persist transaction hash and move to `SUBMITTED`;
5. on canonical inbound event matching join, move to `PENDING_PARTICIPANT`, store inbound hash/height and local block height at acknowledgment;
6. connect under pending participant role and monitor normal inclusion;
7. when a validated local snapshot includes participant, move to `PARTICIPATING`;
8. when a finalized/adopted snapshot confirms it, clear admission operation after retention horizon.

A revert from stale snapshot, fork, deadline, dispute, signature, or membership returns to `SYNCED` and requires new signatures. Already-included transaction is reconciled, not reset blindly.

### 6.11 Forced inclusion

Track active block turns after deposit acknowledgment. V1 current logic triggers at submission local height plus `N`, where `N` is current participant count plus joiner. The intended rule must instead count deterministic author opportunities from the canonical inbound acknowledgment and remain valid across fork transition and membership change.

At deadline:

1. verify join inbound block remains unconsumed by latest valid state;
2. verify deposit is canonical and not refunded;
3. build forced-inbound dispute with latest proved state and requested inbound head;
4. participate in ordinary dispute reduction;
5. on successor inclusion, move to active if present;
6. if recovery cannot include it, use the specified refund or safe exit path, which is currently unresolved.

### 6.12 Top-up

Top-up reuses signature collection but requires existing or pending membership. It does not change membership threshold when consumed. Status remains pending or participating. A disputed-fork policy must be explicit before signers approve.

## 7. Outputs and postconditions

Spectate success produces verified durable local replica with no funds committed. Admission preparation produces exact signatures but no chain effect. Join inclusion produces escrow and pending inbound message. Active status requires state-machine inclusion. Settlement remains separate.

## 8. Invariants

- **JOIN-INV-1:** failed spectate creates no funds, signatures with channel duty, or active status.
- **JOIN-INV-2:** peer payload never writes canonical storage before complete verification.
- **JOIN-INV-3:** contract simulation starts from production manager state at recorded block tag.
- **JOIN-INV-4:** admission signatures bind exact join, snapshot, fork, channel, and deadline.
- **JOIN-INV-5:** every required threshold address signs once.
- **JOIN-INV-6:** pending participant begins from canonical deposit event, not local submission call.
- **JOIN-INV-7:** non-final suffix is replayed through normal validation.
- **JOIN-INV-8:** force inclusion uses canonical inbound acknowledgment and author turns.
- **JOIN-INV-9:** stale or failed join returns safely to synced without losing verified replica.

## 9. Ordering, concurrency, and atomicity

Multiple peers may be queried in parallel into separate staging namespaces. Only one payload promotes, chosen by complete verification and current manager version, not first response. Admission signature requests run in parallel but use one immutable expected snapshot. A concurrent chain update invalidates the whole set.

Join transaction receipt and inbound event may arrive in either callback order. Durable operation state merges them idempotently. Status transitions follow canonical evidence.

## 10. Trust and security assumptions

Serving peers can omit, fabricate, or overload payloads. Chain provider and local EVM are cross-checked as elsewhere. Current full payload can leak application state to a spectator; privacy and authorization policy must be application-specific and explicit.

Unanimous admission lets any current participant refuse a join. This is intended authority, not a liveness bug. It must not be represented as a slashable failure.

## 11. Failure behavior and recovery

Every invalid or missing sync item aborts safely. Provider or worker failure moves to degraded and keeps no partial promotion. Crash during promotion rolls back. Crash after submitted join recovers operation from chain transaction and event journal.

If a pending joiner is excluded from successor, SDK must not claim funds are recoverable until the refund rule is implemented and verified.

## 12. Current implementation

`SpectateService` verifies RTT, fetches manager snapshot and windows, locally reduces at most one unresolved window, validates successor genesis, stream ranges, milestones, balance invariant, and static multicall, then persists payload under mutex. It queues unfinalized work with spectate strategy. `JoinChannelService` gathers threshold signatures with expected snapshot/fork and validates remote requests. `StateManager.joinChannel` sets `PENDING_PARTICIPANT` before transaction completes and records a local force-join height.

The current sync entry is fire-and-forget and blacklists a peer on any request rejection. Payload data is written directly into ordinary in-memory stores after verification rather than a durable staging transaction. Current comments describe several intended steps as TODO.

## 13. Difference from the intended design

| Classification     | Difference                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| bug                | join status becomes pending before canonical deposit acknowledgment                                     |
| missing            | durable isolated staging namespace and atomic promotion                                                 |
| missing            | complete multi-window unresolved recovery support                                                       |
| missing            | payload version and application artifact identity binding                                               |
| missing            | admission policy hook beyond threshold signature validity                                               |
| decision pending   | force-join deadline defined from canonical turns across membership/fork changes                         |
| missing            | pending-deposit refund or escape path                                                                   |
| documentation debt | any spectate request failure currently blacklists peer, conflating unavailability and malicious payload |
| missing            | durable join transaction and restart reconciliation                                                     |

## 14. Dependencies and cross-layer effects

This path depends on event sync, storage, block pipeline, state proofs, dispute reduction, contract streams, P2P identity, application privacy, assets, and clock. Join changes future finality and leader schedule.

## 15. Verification

Tests must cover every payload field corruption, oversized data, wrong identity/version, current chain advancing during sync, multiple dispute windows, unresolved window, outbound and inbound gaps, balance inflation, state conflict, static multicall failure, concurrent peer payloads, crash during promotion, no funds on abort, admission signature forgery and staleness, disconnect during collection, chain race, receipt/event reordering, restart after submit, normal inclusion, force inclusion across fork, and refund once designed.

## 16. Future work

Selective disclosure and zero-knowledge application proofs may allow safer spectating without sharing private state. They change payload and state-machine verification assumptions.
