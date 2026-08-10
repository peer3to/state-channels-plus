# Cross-Layer Message Streams

> **Status:** Draft, reverse-engineered baseline. Pending engineer review.
> **Scope:** The two ordered message streams between the base layer (L1) and the channel (L2):
> shared stream infrastructure first, then its consumers — join/admission, top-up, withdrawal,
> exit, removal, slashing — plus spectate-before-join synchronization and the channel-balance
> invariant that makes late joining safe.
> **ID prefix:** `MSG` (`INV-MSG-n`, `REQ-MSG-n`). See the [traceability table](#traceability).

Related documents: [concepts/history-and-commitments.md](../concepts/history-and-commitments.md)
(snapshot commitment hierarchy), [protocol/disputes.md](./disputes.md) (forced inbound inclusion
as a dispute input; successor forks), [protocol/finality.md](./finality.md) (milestone finality
required by snapshot advance), [protocol/fraud-proofs.md](./fraud-proofs.md)
(`ForgedInboundMessageBlock`, `DisputeInvalidBalanceInvariant`),
[security/trust-model.md](../security/trust-model.md).

---

## 1. Shared stream infrastructure

### 1.1 Purpose & observable contract

The channel and the base layer communicate exclusively through two **mirror-image,
general-purpose, ordered message streams**. They are _not_ join- and exit-specific special cases;
joins, top-ups, exits, withdrawals, removals, and slashes are consumers of the same machinery
(§§4–7).

- **Inbound stream (L1 → L2).** The base layer appends; the channel consumes. Carries `JOIN`
  messages today and is dispatched by type, so it can carry any base-layer-to-channel
  instruction ([`AStateMachine.processInboundMessage`](../../../../contracts/V1/AStateMachine.sol)
  routes unknown types to the integrator hook `_processCustomInboundMessage`).
- **Outbound stream (L2 → L1).** The channel appends; the base layer consumes. Carries `EXIT`
  messages today and is likewise dispatched by type
  ([`StateChannelCommon._processOutboundMessage`](../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol)).

Each stream is a hash-linked chain of **message blocks**. In either direction, the destination
tracks its **processed source-stream tip**, verifies a supplied linked range from that tip to a
newer committed tip, applies the range in order, and advances its marker. The committed tips make
it possible to prove ordering, prevent replay and omission, and catch up incrementally.

**Message format** ([`DataTypes.sol`](../../../../contracts/V1/types/DataTypes.sol)):

| Struct         | Fields                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Message`      | `messageType`, `participant`, `balance`, `data`                               | `messageType` is a hashed constant from [`MessageTypeHashes.sol`](../../../../contracts/V1/types/MessageTypeHashes.sol): `MESSAGE_TYPE_JOIN = keccak256("JOIN_CHANNEL_MESSAGE")`, `MESSAGE_TYPE_EXIT = keccak256("EXIT_CHANNEL_MESSAGE")`. `data` is the ABI-encoded payload (`JoinChannel` / `ExitChannel`). `balance` MUST equal the payload's balance (checked for exits: `ErrorOutboundMessageBalanceMismatch`). |
| `MessageBlock` | `previousBlockHash`, `blockHeight`, `messages[]`, `totalBalance`, `timestamp` | Block identity is `keccak256(abi.encode(messageBlock))`. `previousBlockHash` links to the parent (`bytes32(0)` at stream genesis). `blockHeight` increments by exactly 1 per block. `totalBalance` is the **running cumulative sum** of every message balance from stream genesis through this block — cumulative deposits on the inbound stream, cumulative withdrawals on the outbound stream.                     |

**Commitments.** A channel block commits to the inbound blocks it consumes by embedding them
(`Block.messageBlocks`). A state snapshot commits to both stream tips:
`SnapshotData.latestInboundMessageBlockHash/Height`, `latestOutboundMessageBlockHash/Height`,
plus the cumulative `totalDeposits` and `totalWithdrawals`. Dispute reduction outputs commit to
the same fields in the successor-fork genesis snapshot
([`DisputeVerificationFacet.reduceOutputToSnapshotData`](../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol)).
The chain's own progress markers live in
`ChannelBalance` ([`StateChannelManagerStorage`](../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol)):
`latestInboundMessageBlockHash/Height`, `latestOutboundMessageBlockHeight`, `totalDeposits`,
`totalWithdrawals`.

**Current:** `ChannelBalance` stores the outbound _height_ but not the outbound _tip hash_; the
processed outbound tip hash is read from the current on-chain snapshot
(`stateSnapshots[channelId].snapshotData.latestOutboundMessageBlockHash`). The two structs are
updated together in the same transaction, so they cannot diverge, but the "processed marker" is
split across two storage locations. **Intended:** unspecified whether this split is deliberate.
**Open question:** should the outbound processed tip hash be mirrored into `ChannelBalance` so
the marker is self-contained?

### 1.2 Inbound stream mechanics (Current)

The **base layer is the sole author** of inbound blocks, so their authenticity needs no
signatures — existence in chain storage is the proof.

- **Append.** [`StateChannelCommon._appendInboundMessages`](../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol)
  builds the next block (parent = current `ChannelBalance` tip, height = tip height + 1,
  `totalBalance` = previous `totalDeposits` plus each message balance via the state machine's
  `addBalance`), persists it in `inboundMessageBlockMap[channelId][hash]`
  (`ErrorInboundMessageBlockAlreadyPersisted` guards duplicates), advances
  `ChannelBalance.latestInboundMessageBlockHash/Height` and `totalDeposits`, and emits
  `InboundMessagesProcessed`. Callers: `open` and `joinChannel`/`topUpBalance` via
  `depositAssetsComposable` ([`StateChannelManagerProxy`](../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol)).
- **Channel-side consumption.** The channel's processed tip is the latest snapshot's
  `latestInboundMessageBlockHash`. A block author packages the pending inbound range into its
  next channel block (`Block.messageBlocks`); applying the block applies each message in order
  through `processInboundMessage` and rolls `totalDeposits` forward to the last inbound block's
  `totalBalance` ([`StateManager.applyInboundMessageBlocksToState` / `createStateSnapshot`](../../../../src/stateManager/StateManager.ts)).
- **Validation by peers.** Every validator checks (a) the packaged inbound blocks chain correctly
  from the previous snapshot's inbound tip (`findBrokenInboundMessageChainBlock` → treated as an
  invalid state transition), and (b) every packaged inbound block exists locally or on-chain
  (`detectForgedInboundMessageBlock`, backed by the on-chain view
  `hasInboundMessageBlock`); a fabricated block is provable fraud
  (`ForgedInboundMessageBlock`, see [protocol/fraud-proofs.md](./fraud-proofs.md)).
- **On-chain ancestry check for disputes.** A dispute's claimed inbound tip must be an ancestor
  (or equal) of the chain's tip: `_isDisputeInboundHashValid` walks the persisted chain from the
  chain tip toward genesis and also requires the claimed height to match the stored height.
- **Pruning.** When a snapshot advance clears storage, inbound blocks from the new snapshot's tip
  backwards are deleted (`_clearOldInboundMessageBlocks` in
  [`StateSnapshotFacet`](../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol)).
  `_resolveTotalDeposits` falls back to the snapshot's committed `totalDeposits` when the tip
  block itself has been pruned.

### 1.3 Outbound stream mechanics (Current)

The **channel is the author** of outbound blocks; the base layer never stores them. It stores only
its processed tip and totals, and verifies any claimed range against a snapshot whose validity is
established separately (finality proof or finalized dispute reduction — §2).

- **Append (off-chain).** When a state transition emits outbound messages
  (`AStateMachine.getOutboundMessages`), the author packages them into exactly one outbound
  message block per channel block: parent = previous snapshot's outbound tip, height + 1,
  `totalBalance` = previous `totalWithdrawals` plus the new message balances
  ([`StateManager.createStateSnapshot`](../../../../src/stateManager/StateManager.ts)). The new
  snapshot (committed by the channel block) carries the new outbound tip. Dispute reduction
  appends at most one deterministic outbound block the same way (`timestamp = 0` for determinism;
  [`DisputeVerificationFacet.generateDisputeOutputState`](../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol)).
- **Range verification (on-chain).**
  [`StateChannelCommon._verifyOutboundMessageBlocks`](../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol)
  checks, between a lower and an upper snapshot: hash linkage starting at the lower tip, height
  contiguity (+1 per block), the recomputed running balance equals the upper snapshot's
  `totalWithdrawals`, the final height equals the upper snapshot's height, and the final hash
  equals the upper snapshot's tip. A non-descendant or otherwise invalid range fails this check.
- **Duplicate skipping.** `_pruneOutboundMessageBlocks` drops the already-processed prefix of a
  supplied range: it discards blocks up to the first block whose `previousBlockHash` equals the
  chain's processed tip. If nothing links to the tip, the range verification decides (a fully
  processed range prunes to empty and verifies trivially only when tips match).
- **Processing.** `_applyOutboundMessageBlocks`
  ([`StateSnapshotFacet`](../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol))
  applies every message in order: `EXIT` → `withdrawAssetsComposable` → consumer facet
  `withdraw(ExitChannel)`; after each message it enforces
  `totalWithdrawals ≤ totalDeposits` (`CantWithdrawMoreThanDeposits`), then advances
  `ChannelBalance.totalWithdrawals` and `latestOutboundMessageBlockHeight` and emits
  `WithdrawalsUpdated` (plus `OutboundMessagesProcessed` per block — marked `TODO - this event is
not used` in code).
- **Custom outbound types.** `_processOutboundMessage` routes unknown types to
  `_processCustomOutboundMessage`, which unconditionally reverts
  (`ErrorOutboundMessageTypeUnsupported`). **Current:** only `EXIT` is processable on-chain, and
  the override point sits on `StateChannelCommon`, which integrators do not extend (their
  extension points are the state machine and the consumer facet). **Intended:** the streams are
  general-purpose in both directions. **Open question:** how does an integrator register custom
  outbound message handling — consumer-facet dispatch, a facet override, or a registry?

### 1.4 Incremental catch-up and batching

The recursive hash linkage permits incremental catch-up. If the base layer has processed outbound
tip _A_ and receives proof of a finalized snapshot committing to descendant tip _B_, it processes
the linked _A → B_ difference and advances its marker to _B_.

- **REQ-MSG-5 (batchability).** Catch-up MUST be splittable into smaller ranges without changing
  the result: processing _A → M_ then _M → B_ (via any intermediate committed snapshot _M_) MUST
  leave the same marker, totals, and consumer effects as processing _A → B_ at once.
  **Current:** supported operationally — `updateStateSnapshotSameFork` accepts any newer proven
  milestone snapshot as the upper bound and can be called repeatedly; `_pruneOutboundMessageBlocks`
  skips the already-processed prefix, so overlapping submissions are safe. There is no on-chain
  check that _forces_ full catch-up in one transaction; the snapshot chosen as upper bound defines
  the batch. No test exercises split-batch equivalence explicitly (`none — gap` in traceability).
- **Atomicity.** A snapshot advance is atomic: any failure in range verification or message
  processing reverts the whole update (no partial marker progress within one transaction).
  Partial progress across transactions exists only at snapshot granularity (REQ-MSG-5).
- **Ancestry proof.** Ordering/ancestry is proven by the hash-linked range itself, anchored at the
  chain's stored tip; the _authority_ of the upper tip comes from the snapshot's own proof path
  (milestone finality or finalized reduction, §2). A tip that is not a descendant of the processed
  tip cannot produce a verifying range (`ErrorOutboundMessageBlocksInvalid`).
- **Failure behavior.** Invalid ranges revert with `ErrorOutboundMessageBlocksInvalid` (outbound)
  or the structured `ErrorDisputeInboundMessageBlocksInvalid` diagnostics (inbound, in
  reduction). Reverts leave both markers untouched.

**Note (inbound height check).** `_verifyInboundMessageBlocks` checks height contiguity only
_between_ supplied blocks; the first supplied block's height is not checked against the lower
tip's height. Hash linkage makes the height redundant for ancestry, and the on-chain append
assigns heights canonically, so this is not exploitable on inbound data the chain itself
persisted. **Open question:** should the first-block height be bound to the lower snapshot for
defense in depth?

### 1.5 Assumptions, constraints & dependencies

- The state machine's `Balance` algebra (`addBalance`, `areBalancesEqual`,
  `isBalanceLesserThan`) is deterministic and total for all balances that enter either stream
  (see [concepts/state-machines.md](../concepts/state-machines.md)).
- Outbound-range processing depends on snapshot validity being established _before_
  `_updateStateSnapshot` runs (finality proof or finalized reduction — §2). The stream layer does
  not re-verify signatures.
- Inbound-block authenticity depends on the chain being the sole author (append happens only via
  `onlySelf`-guarded deposit paths).
- Consumer `withdraw` is integrator code; a reverting or `false`-returning withdraw blocks the
  entire snapshot advance (`ErrorWithdrawalFailed`). **Open question:** a malicious or broken
  consumer asset (e.g. a token that reverts on transfer to a specific address) can wedge the
  outbound stream for everyone; is per-message skip/quarantine needed?

### 1.6 Invariants

- **INV-MSG-1 (ordered, linked streams).** Each stream is a single hash-linked chain per channel
  with heights increasing by exactly 1; a message block's identity is
  `keccak256(abi.encode(block))`.
- **INV-MSG-2 (no replay, no omission).** The destination processes each message block exactly
  once and in order: already-processed blocks are skipped (inbound: persistence guard; outbound:
  prefix pruning), and a range that omits or reorders blocks cannot verify against the committed
  tips.
- **INV-MSG-3 (cumulative totals).** `totalBalance` of the stream tip equals the balance-algebra
  sum of all message balances since stream genesis; on-chain `totalDeposits` /
  `totalWithdrawals` equal the tip totals of the processed prefixes.
- **INV-MSG-4 (withdrawals capped by deposits).** At every point of outbound processing,
  `totalWithdrawals ≤ totalDeposits` (`CantWithdrawMoreThanDeposits`).
- **INV-MSG-5 (marker monotonicity).** Processed tips only advance to descendants of the current
  tip; snapshot advance requires strictly newer snapshots (`isSnapshotNewer` /
  `RaceConditionBlockHeightTooOld`).

### 1.7 Verification

Locally: range verification predicates (`_verifyOutboundMessageBlocks`,
`_verifyInboundMessageBlocks`, `_pruneOutboundMessageBlocks`) against crafted valid, truncated,
reordered, non-descendant, and duplicate ranges; totals mismatches; height gaps. Through
boundaries: snapshot advance with mixed processed/unprocessed ranges; consumer withdraw failure;
inbound forgery via block validation. System: full open → execute → exit lifecycles and
adversarial snapshot submissions. Existing evidence:
[test/e2e/E2E-MaliciousUpdateSnapshot.test.ts](../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts),
[test/e2e/E2E-StateSnapshots.test.ts](../../../../test/e2e/E2E-StateSnapshots.test.ts),
[test/stateManager/SnapshotUpdateService.test.ts](../../../../test/stateManager/SnapshotUpdateService.test.ts).
Split-batch equivalence (REQ-MSG-5) and custom-message-type coverage: `none — gap`.

---

## 2. Withdrawal: incremental outbound processing during snapshot advance

### 2.1 Purpose & observable contract

An `ExitChannel` is **not** submitted standalone. It is an outbound message inside the ordered
L2 → L1 stream, and it is _processed_ — funds released — only when the on-chain snapshot advances
past the outbound block that contains it. Producing an exit off-chain requires no finality;
finality (or a finalized dispute reduction) is required at the moment a snapshot is submitted
on-chain.

Two snapshot-advance paths exist
([`StateSnapshotFacet`](../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol)):

1. **Same-fork update — `updateStateSnapshotSameFork`.** Prove the finality of a newer snapshot
   on the canonical fork: milestone proofs are verified against the current on-chain snapshot's
   threshold context (`verifyMilestones` via
   [`StateProofFacet`](../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol)),
   the new snapshot must be strictly newer, and — **Current** — its inbound tip must equal the
   chain's inbound head (`RaceConditionPendingInboundNotConsumed`): a same-fork advance is
   blocked until the channel has consumed every pending inbound message. The SDK holds
   submission until then ([`SnapshotUpdateService.prepareUpdateSnapshotSameFork`](../../../../src/stateManager/snapshotUpdate/SnapshotUpdateService.ts)).
2. **Successor-fork update — `updateStateSnapshotFork`.** After a dispute reduces and its
   reduction challenge period expires, adopt the successor fork's genesis snapshot: the contract
   walks the reduced-result chain from the current on-chain fork, requiring each hop's challenge
   period to be expired, until it reaches the target fork; the submitted snapshot must be the
   genesis-shaped snapshot of that fork with the recorded genesis timestamp. The SDK's
   [`SnapshotUpdateService.prepareUpdateStateSnapshotFork`](../../../../src/stateManager/snapshotUpdate/SnapshotUpdateService.ts)
   performs the mirror walk off-chain and multicalls the fork update together with a same-fork
   update when both apply.

In **either** path, `_updateStateSnapshot` compares the chain's processed outbound tip (current
snapshot) with the new snapshot's committed tip, prunes the already-processed prefix, verifies the
linked difference, processes only the new blocks (`EXIT` → consumer `withdraw`), advances the
marker and withdrawal totals, and stores the new snapshot.

### 2.2 Snapshot-advance sequence

```mermaid
sequenceDiagram
    participant SDK as Submitter (SDK / anyone with the proof)
    participant SSF as StateSnapshotFacet (L1)
    participant SPF as StateProofFacet / DisputeWindows
    participant CF as ConsumerFacet

    Note over SDK: holds newer snapshot S_new committing outbound tip B,<br/>plus the linked outbound range and the proof path
    SDK->>SSF: updateStateSnapshotSameFork(milestoneProofs, snapshots, range)<br/>or updateStateSnapshotFork(S_new, range)
    alt same-fork path
        SSF->>SPF: verifyMilestones(fork, proofs, snapshots, S_current)
        SSF->>SSF: require S_new newer + inbound tip == chain inbound head
    else successor-fork path
        SSF->>SPF: walk reducedResult chain; require each<br/>reduce-challenge period expired; S_new is fork genesis
    end
    SSF->>SSF: prune range prefix already processed<br/>(old tip A = S_current.outbound tip)
    SSF->>SSF: verify linked range A -> B<br/>(hash links, heights, running totals)
    loop each new outbound message
        SSF->>CF: withdraw(ExitChannel) via withdrawAssetsComposable
        CF-->>SSF: assets released to participant
        SSF->>SSF: totalWithdrawals += balance;<br/>require totalWithdrawals <= totalDeposits
    end
    SSF->>SSF: store S_new; advance outbound marker to B;<br/>emit StateSnapshotUpdated, WithdrawalsUpdated
```

### 2.3 Current / Intended divergences and open questions

- **Current:** `_updateStateSnapshot` does **not** run the channel-balance invariant check (§6).
  A code comment in
  [`DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot`](../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol)
  states the check is trivial and _"we'll add [it] as the last check onSnapshotUpdate"_.
  **Intended:** run it on every snapshot update so the on-chain snapshot is always a
  non-poisonous single source of truth. **Open question:** confirm and implement, or record the
  deliberate decision to leave snapshots poisonous-but-detectable.
- **Current:** closing a channel (0 participants) deletes the snapshot and clears storage, with a
  literal `TODO! send all remaining funds to the treasury` — residual funds handling is
  unimplemented. **Open question:** where do unwithdrawn residuals go on close?
- **Current:** `updateStateSnapshotFork` returns silently (no revert, no event) when the chain is
  already on the target fork. Callers cannot distinguish "already done" from "did nothing".
  **Open question:** is silent success intended for multicall composability?
- **Current:** debug `console.log` calls remain in `verifyBalanceInvariantCheckSnapshot`
  (hardhat's `console.sol`). Must be removed for production deployment.

### 2.4 Verification

Same-fork advance with pending inbound (must be rejected), stale snapshots, forged milestone
proofs, tampered outbound ranges, withdrawal-cap violations, successor-fork adoption before and
after challenge expiry, and repeated/overlapping submissions. Evidence:
[test/e2e/E2E-StateSnapshots.test.ts](../../../../test/e2e/E2E-StateSnapshots.test.ts),
[test/e2e/E2E-MaliciousUpdateSnapshot.test.ts](../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts),
[test/stateManager/SnapshotUpdateService.test.ts](../../../../test/stateManager/SnapshotUpdateService.test.ts),
[test/e2e/E2E-ParticipantLifecycle.test.ts](../../../../test/e2e/E2E-ParticipantLifecycle.test.ts).

---

## 3. Spectate-before-join

### 3.1 Purpose & observable contract

Spectating is a **pre-commit synchronization mode, not an on-chain transaction**. A prospective
participant (or any observer) queries chain data, connects to channel peers, obtains the channel's
history proof, verifies it against the on-chain source of truth, verifies internal finality, and
replicates state — all without committing funds or incurring any channel obligation.

Spectating is **fail-closed**: there is exactly one successful synchronization path
([`SpectateService.applySyncResponse`](../../../../src/rpc/services/spectate/SpectateService.ts)),
and _any_ data-availability, validation, finality, transport, or peer-behavior failure lets the
spectator abort with nothing at risk. Aborting is a safe, expected outcome — it is not evidence
that a dispute is needed. No step of the sync sends an on-chain transaction: all contract
verification runs against the spectator's local EVM or as `staticCall` simulations against its
RPC provider.

**Requester flow (Current).** `SpectateService.sync` sends a `SyncRequest`
(`channelId`, optional pinned `forkId`/`blockHeight`) to one peer; the responder's
`generateSyncPayload` returns a `SyncPayload`: the reduced dispute-window chain from the on-chain
snapshot's fork to the tip fork (with the disputes, latest states, and inbound blocks needed to
re-run each reduction), the tip fork's genesis snapshot + encoded state, a `StateProof`
(milestones + trailing signed blocks), milestone snapshots, the latest finalized encoded state,
and the outbound message-block ranges covering on-chain tip → fork genesis → latest finalized
snapshot. The requester then verifies everything locally, simulates the on-chain advance,
persists, and replays unfinalized blocks through the standard block-confirmation pipeline under
[`SpectatingValidationStrategy`](../../../../src/stateManager/validationStrategy/SpectatingValidationStrategy.ts).

### 3.2 Abort conditions (Current, enumerated)

Request path (peer blacklisted; sync abandoned):

1. RPC timeout, transport error, or the responder declining (responder returns `undefined` for:
   malformed/unsafe requested height, a fork it cannot prove as the derived tip, a height above
   its latest, or a missing state proof).

Verification path (`applySyncResponse`; each aborts the sync): 2. Payload fails to decode, or any verification step throws. 3. Round-trip time exceeds `agreementTime`. 4. A claimed dispute window does not exist on-chain or its kill period has not expired. 5. More than one dispute window still needs reduction. 6. A window's locally recomputed reduction does not match the payload's claimed successor fork. 7. The tip fork's genesis snapshot is inconsistent (fork mismatch, not genesis-shaped, or state
hash ≠ hash of supplied encoded state). 8. The on-chain snapshot is already ahead of the proved height (stale proof). 9. Either outbound message-block range fails `verifyOutboundMessageBlocks`. 10. Latest-mode: the tip fork is disputed on-chain. Pinned mode: tip fork ≠ requested fork. 11. The milestone state proof fails `verifyMilestones`. 12. The latest finalized state hash does not match the supplied encoded state. 13. The channel-balance invariant fails (`verifyBalanceInvariantCheckSnapshot`, §6). 14. The simulated on-chain advance (`multicall` `staticCall` of pending `reduceAndFinalize` +
`updateStateSnapshotFork` + `updateStateSnapshotSameFork`) reverts. 15. A proved finalized block conflicts with a block already in local storage. 16. Replaying an unfinalized block through the confirmation pipeline fails. 17. Pinned mode: the proof's latest block does not reach the requested height.

Abort semantics ([`SpectateService.abort`](../../../../src/rpc/services/spectate/SpectateService.ts)):
if the node is not yet participating (or pending), the whole state manager aborts — a full local
stop with no residue; if it is already a participant using spectate-sync for recovery, only the
offending peer is cut and blacklisted. While spectating,
`SpectatingValidationStrategy` keeps the same fail-closed split: provable participant fraud
(double-sign, invalid transition, forged inbound block, objective bad timestamp) → abort and stop
following; non-provable junk (outsider authors, malformed linkage, stray signatures) → drop and
blacklist the sender, keep spectating.

- **REQ-MSG-9.** Spectating MUST NOT create any on-chain or channel obligation; every abort path
  MUST leave no partial local commitment that could later bind the spectator. **Current:**
  persistence happens only after all verification (steps 2–14) succeeds, under the state-manager
  mutex, and is skipped when local storage is already ahead.
- **Current:** a code TODO notes the local simulation of snapshot updates "need[s] dummy
  contracts to process withdrawals" — a consumer facet whose `withdraw` touches real external
  state may make simulation infeasible for spectators. **Open question:** how are
  consumer-facet side effects stubbed during spectate simulation?

### 3.3 Verification

Honest sync, stale proofs, byzantine payloads at each abort point, DoS via repeated aborts, and
persistence of proved state. Evidence:
[test/e2e/E2E-Spectate.test.ts](../../../../test/e2e/E2E-Spectate.test.ts),
[test/e2e/E2E-SpectateStaleProofGuard.test.ts](../../../../test/e2e/E2E-SpectateStaleProofGuard.test.ts),
[test/e2e/E2E-SpectatingAbortDoS.test.ts](../../../../test/e2e/E2E-SpectatingAbortDoS.test.ts),
[test/e2e/E2E-SpectatorStateProofPersistence.test.ts](../../../../test/e2e/E2E-SpectatorStateProofPersistence.test.ts),
[test/unit/SpectateService.test.ts](../../../../test/unit/SpectateService.test.ts).

---

## 4. Join and admission (inbound-stream consumer)

### 4.1 Purpose & observable contract

Joining expands the on-chain participant set and requires **unanimous authorization**: the joiner
signs the `JoinChannel`, and the full current threshold set — snapshot participants ∪ pending
participants, minus on-chain-slashed — must countersign
([`JoinChannelFacet._processJoinChannel`](../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol)
via `verifyThresholdSigned`). The flow:

1. **Sync first (§3).** The joiner spectates to the latest proven state before committing funds.
2. **Collect signatures (off-chain).**
   [`JoinChannelService.collectJoinChannelConfirmation`](../../../../src/rpc/services/joinChannel/JoinChannelService.ts)
   pins the expected on-chain snapshot hash and fork, signs the `JoinChannel`
   (`channelId`, `participant`, `deadlineTimestamp`, `balance`), and requests a signature from
   every threshold participant. Peers validate in `signJoinRequest`: requester's transport
   identity == joiner == signer of the join, channel matches, deadline not passed, pinned
   snapshot/fork match the chain, and the local signer is in the threshold set. The per-request
   timeout is `min(agreementTime, deadline − chainTime)`.
3. **Submit + deposit (on-chain).** The joiner submits
   `joinChannel(confirmation, expectedSnapshotHash, expectedForkId)`; `msg.sender` must be the
   joiner. The facet checks the deadline, the pinned snapshot/fork (race guards), that the joiner
   is not already in the threshold set, that the fork is not disputed, the joiner's signature,
   and the threshold signatures; then `depositAssetsComposable` pulls the deposit through the
   consumer facet and appends a `JOIN` message block to the **inbound stream** (§1.2). Deposit
   acknowledgment on the base layer _is_ the production of the inbound message.
4. **Off-chain inclusion.** A block author packages the pending inbound block(s) into its next
   channel block; applying them runs `_joinChannel` on the state machine, which admits the member
   and credits the balance. From that block's snapshot on, the joiner is a snapshot participant.
5. **Forced inclusion (fallback).** If prompt inclusion fails, the joiner forces it through the
   dispute game — forced inbound-message inclusion is one of the four dispute inputs
   (cross-ref [protocol/disputes.md](./disputes.md)). **Current:** on submitting the join, the
   SDK records the local block height
   ([`StateManager.joinChannel`](../../../../src/stateManager/StateManager.ts),
   [`ForceJoinStorage`](../../../../src/storage/ForceJoinStorage.ts)); if `N = |participants| + 1`
   further blocks pass without the joiner becoming a participant, it fires a dispute
   (`maybeInitiateForceJoinDispute`). Reduction selects as the successor fork's inbound tip the
   chain's inbound head as of the dispute-window expiry (walking back past newer blocks) and
   applies the pending inbound blocks — including the join — to the output state
   ([`DisputeVerificationFacet.reduce` / `reduceOutputToSnapshotData`](../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol)).
   The successor-fork genesis therefore contains the joiner as a participant; from then on the
   joiner is covered by leader election and receives its authoring slot.

**Pending participants matter before inclusion.** `getPendingParticipants` derives joiners from
`JOIN` messages in the persisted inbound chain; pending participants are already part of the
on-chain threshold set for later joins and disputes (`getOnChainThresholdSet`,
`canParticipateInDisputes`) even before any channel block includes them.

**Top-up.** `topUpBalance` runs the same pipeline with `isTopUp = true`: the participant must
already exist, the disputed-fork check is skipped, and the resulting inbound `JOIN` message is
applied by `_joinChannel`, which — per its contract
([`AStateMachine._joinChannel`](../../../../contracts/V1/AStateMachine.sol)) — adds a new
participant _or_ credits an existing participant's balance without changing membership.

### 4.2 Current / Intended divergences and open questions

- **Unanimity is currently mechanical.** `signJoinRequest` auto-signs every structurally valid
  request (a code TODO says: _"add a configurable admission filter, including optional
  snapshot-scoped consent"_). **Intended:** unanimous _authorization_ implies participants may
  decline. **Open question:** the admission-policy hook, and whether declining is
  protocol-visible or indistinguishable from unavailability.
- **Deadlines.** The joiner chooses `deadlineTimestamp` freely; the contract only checks
  `deadline ≥ block.timestamp` at submission. There is no specified bound tying the deadline to
  protocol windows. **Open question:** required deadline bounds.
- **Refund / exit at failure points.** If the deposit lands (inbound message exists) but the join
  is never included and the force-join dispute cannot be brought or fails, no refund path is
  specified: the deposit is inside `totalDeposits`, and the joiner's only exits are inclusion
  (then a normal exit) or dispute self-removal once a pending participant is dispute-eligible.
  **Open question:** specify refund/exit behavior for every failure point (deposit acknowledged
  but never included; channel closes while pending; joiner's fork pinned snapshot goes stale
  mid-flow — currently surfaced as `RaceCondition*` reverts and an SDK abort).
- **Force-join trigger.** `N = |participants| + 1` blocks is an SDK heuristic, not a specified
  deadline; the contract enforces no inclusion deadline for inbound messages outside the dispute
  path. **Open question:** the normative inclusion deadline and its relation to
  `p2pTime`/`agreementTime`.
- **Concurrent joins.** A second join invalidates the first join's pinned snapshot only when the
  snapshot advances; joins pin `expectedSnapshotHash`, so concurrent admissions race
  (SDK TODO: _"support concurrent joins by collecting safe extra signatures before
  submission"_). **Open question:** concurrent-join semantics.

### 4.3 Verification

Honest admission, race conditions on pinned snapshots, invalid/missing signatures, expired
deadlines, top-up of existing participants, deposit-without-inclusion plus force-join recovery,
and non-responsive peers during signature collection. Evidence:
[test/e2e/E2E-JoinChannelRaceConditions.test.ts](../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts),
[test/e2e/E2E-ForceJoinDispute.test.ts](../../../../test/e2e/E2E-ForceJoinDispute.test.ts),
[test/rpc/joinChannel/JoinChannelSignatureRequest.test.ts](../../../../test/rpc/joinChannel/JoinChannelSignatureRequest.test.ts),
[test/V1/DiamondProxy/StateChannelManager/OpenChannel.test.ts](../../../../test/V1/DiamondProxy/StateChannelManager/OpenChannel.test.ts),
[test/e2e/E2E-ParticipantLifecycle.test.ts](../../../../test/e2e/E2E-ParticipantLifecycle.test.ts).

---

## 5. Exit, removal, and slashing (outbound-stream consumers)

A normal state transition **may, but need not**, produce an outbound exit: application logic calls
[`AStateMachine._addExitChannel`](../../../../contracts/V1/AStateMachine.sol) (or
`_addOutboundMessage` for other types), and the author packages the transition's outbound
messages into the block's outbound message block (§1.3). Producing the message requires no
finality; the exit becomes withdrawable when a snapshot committing to (or past) its outbound
block is adopted on-chain (§2).

Dispute-derived exits use the same stream: reduction applies slashes (`_slashParticipant`),
removals/timeouts and self-removals (`_removeParticipant`) to the output state and packages the
resulting `ExitChannel`s into one deterministic outbound block committed by the successor-fork
genesis snapshot (`generateDisputeOutputState`). Normal exits, dispute-derived exits, and any
future outbound instruction are processed by the identical incremental mechanism — there is no
separate withdrawal transaction type.

**Observed asymmetry (Current).** The external wrapper `slashParticipant` appends the resulting
`ExitChannel` to the outbound buffer itself; `removeParticipant` returns it to the caller without
appending (the dispute path collects both explicitly, so outcomes match there). **Decided
(2026-08-10, [OQ-18](../open-questions.md)):** the asymmetry is not intended — both wrappers
MUST record the exit identically via `_addExitChannel`; removal differs from slashing only in
being less aggressive at the hook level (it may return the full held balance instead of applying
a penalty). Implementation fix pending (REQ-SM-8).

Verification: lifecycle exits and dispute-driven removals/slashes —
[test/e2e/E2E-ParticipantLifecycle.test.ts](../../../../test/e2e/E2E-ParticipantLifecycle.test.ts),
[test/e2e/E2E-Timeouts.test.ts](../../../../test/e2e/E2E-Timeouts.test.ts),
[test/e2e/E2E-DisputeManager.test.ts](../../../../test/e2e/E2E-DisputeManager.test.ts).

---

## 6. The channel-balance invariant

### 6.1 Purpose

Channels grow, and a late joiner synchronizes from a finalized snapshot instead of replaying
history from genesis. Existing participants have verified every transition, so an inflated
balance could never get past an honest validator — but a _unanimous colluding_ participant set
can finalize any state it likes. Agreement alone does not prove economic soundness. Before
joining, depositing, or relying on a synced state, anyone must be able to verify that the
channel's **aggregate** claimed balance is backed by deposits minus withdrawals under the
application's balance algebra. The invariant is about aggregate accounting, not distribution:
it does not care whether Bob has 4 and Alice 6 or Bob 8 and Alice 2 — only that the total is 10.

**The attack it prevents:** colluding participants finalize a snapshot whose in-channel balances
sum to more than the channel controls, induce a newcomer to deposit, withdraw the real collateral
through valid-looking exits, and leave the newcomer holding an unpayable in-channel balance.

### 6.2 Definition (Current)

[`DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot(channelId, snapshotData, encodedState)`](../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol)
returns true iff, using the state machine's balance algebra:

1. `snapshotData.stateMachineStateHash == keccak256(encodedState)` (state binding);
2. `snapshotData.totalDeposits == ` on-chain deposits resolved at the snapshot's inbound tip
   (`_resolveTotalDeposits`) — deposits only ever happen on-chain, so the snapshot cannot claim
   deposits the chain has not seen;
3. `snapshotData.totalWithdrawals ≥ ` on-chain processed withdrawals — the snapshot cannot
   un-process a withdrawal the chain already paid out;
4. `totalDeposits == totalWithdrawals + getTotalStateBalance(state)` — **INV-MSG-6**, the balance
   invariant proper, with `getTotalStateBalance` supplied per balance model by the integrator
   (see [concepts/state-machines.md](../concepts/state-machines.md); a composite/multi-asset
   model must make its `Balance` algebra encode the aggregate).

Proof inputs: the claimed snapshot's `SnapshotData`, its full encoded state-machine state, and
the verified inbound/outbound ranges connecting the snapshot's tips to the chain (the function
assumes the caller verified those chains — the spectate flow does exactly that in steps 9 of
§3.2 before step 13).

### 6.3 When it is checked (Current) and gaps

| Site                            | Mechanism                                                                                                                                                                                                                                                                    | Status                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Spectate-before-join, step 2.11 | `verifyBalanceInvariantCheckSnapshot` via `staticCall` on the latest finalized snapshot; abort on failure                                                                                                                                                                    | Implemented ([SpectateService](../../../../src/rpc/services/spectate/SpectateService.ts))                                                  |
| Dispute fraud proof             | `DisputeInvalidBalanceInvariant`: a dispute whose proven latest finalized state violates the invariant slashes the disputer ([`DisputeFraudProofFacet._handleDisputeInvalidBalanceInvariant`](../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol)) | Implemented                                                                                                                                |
| On-chain snapshot update        | none — code comment declares the intent to add it as the last check on snapshot update                                                                                                                                                                                       | **Gap** (`Current:` not checked; `Intended:` checked — open question in §2.3)                                                              |
| Join submission (`joinChannel`) | none — the joiner is expected to have spectated (fail-closed) first                                                                                                                                                                                                          | **Gap / by design?** **Open question:** whether an on-chain check at join time is wanted given the spectate-path check is client-side only |

- **REQ-MSG-12.** Any party MUST be able to verify the invariant for a claimed snapshot using
  only on-chain data plus the snapshot's state and linked ranges — i.e. without trusting any
  channel participant. **Current:** holds via the public facet function.

### 6.4 Verification

Honest late joins, colluding undercollateralized snapshots, malformed proofs, and mixed balance
models. Evidence:
[test/e2e/disputeValidation/balanceInvariant.test.ts](../../../../test/e2e/disputeValidation/balanceInvariant.test.ts),
[test/e2e/E2E-Spectate.test.ts](../../../../test/e2e/E2E-Spectate.test.ts) (invariant runs inside
every successful sync), assertion helpers in
[test/harness/actions/assert/AssertSnapshotActions.ts](../../../../test/harness/actions/assert/AssertSnapshotActions.ts).
Mixed/composite asset-model coverage: `none — gap`.

---

## Future Work

_Non-normative._

- **General-purpose outbound consumers.** Design the integrator hook for custom outbound message
  types (today `_processCustomOutboundMessage` reverts; §1.3) symmetric to
  `_processCustomInboundMessage`, plus arbitrary-message tests in both directions.
- **Per-message failure isolation.** Explore skip/quarantine semantics so one wedged consumer
  `withdraw` cannot block the whole outbound stream (§1.5).
- **Admission policy.** The configurable admission filter and snapshot-scoped consent for
  `signJoinRequest`; possibly protocol-visible declines (§4.2).
- **Refund path for stranded deposits.** A first-class refund for acknowledged-but-never-included
  joins, instead of relying on force-join disputes (§4.2).
- **Batched joins.** `depositAssetsComposable` already accepts arrays and `JoinChannelBlock`
  exists in the types; specifying multi-join batching could amortize inbound-stream costs.
- **Spectate simulation stubs.** Dummy consumer contracts so spectators can simulate snapshot
  advances whose withdrawals touch external assets (§3.2).
- **Invariant on snapshot update.** Implement the declared intent to run the balance-invariant
  check as the last step of every snapshot update (§2.3, §6.3).
- **Marker consolidation.** Mirror the outbound tip hash into `ChannelBalance` (§1.1).

---

## Traceability

<a id="traceability"></a>

| ID         | Statement (abbreviated)                                                                                                       | Implementation                                                                                                                                                                                                                                                         | Verification evidence                                                                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-MSG-1  | Each stream is one hash-linked chain per channel; heights +1; identity = `keccak256(abi.encode(block))`                       | [StateChannelCommon.sol](../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol) (`_appendInboundMessages`, `_verifyOutboundMessageBlocks`, `_verifyInboundMessageBlocks`); [MessageBlockStorage.ts](../../../../src/storage/MessageBlockStorage.ts) | [E2E-MaliciousUpdateSnapshot.test.ts](../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts)                                                                                                                                                           |
| INV-MSG-2  | No replay, no omission: each block processed exactly once, in order                                                           | `ErrorInboundMessageBlockAlreadyPersisted`; `_pruneOutboundMessageBlocks` + `_verifyOutboundMessageBlocks`                                                                                                                                                             | [E2E-MaliciousUpdateSnapshot.test.ts](../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts), [E2E-StateSnapshots.test.ts](../../../../test/e2e/E2E-StateSnapshots.test.ts)                                                                            |
| INV-MSG-3  | Tip `totalBalance` = cumulative sum of message balances; chain totals match processed prefixes                                | `_appendInboundMessages`, `_applyOutboundMessageBlocks`, [StateManager.createStateSnapshot](../../../../src/stateManager/StateManager.ts)                                                                                                                              | [E2E-StateSnapshots.test.ts](../../../../test/e2e/E2E-StateSnapshots.test.ts)                                                                                                                                                                             |
| INV-MSG-4  | `totalWithdrawals ≤ totalDeposits` at every outbound processing step                                                          | [StateSnapshotFacet.sol](../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol) (`CantWithdrawMoreThanDeposits`)                                                                                                                                    | [E2E-MaliciousUpdateSnapshot.test.ts](../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts)                                                                                                                                                           |
| INV-MSG-5  | Processed tips advance only to strictly newer descendants                                                                     | [StateSnapshotFacet.sol](../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol) (`isSnapshotNewer`, fork walk)                                                                                                                                      | [SnapshotUpdateService.test.ts](../../../../test/stateManager/SnapshotUpdateService.test.ts)                                                                                                                                                              |
| INV-MSG-6  | Balance invariant: `totalDeposits == totalWithdrawals + getTotalStateBalance(state)` with chain-anchored deposits/withdrawals | [DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot](../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol)                                                                                                                         | [balanceInvariant.test.ts](../../../../test/e2e/disputeValidation/balanceInvariant.test.ts)                                                                                                                                                               |
| REQ-MSG-1  | Snapshots MUST commit both stream tips + totals; dispute outputs likewise                                                     | [DataTypes.sol](../../../../contracts/V1/types/DataTypes.sol) `SnapshotData`; [DisputeVerificationFacet.reduceOutputToSnapshotData](../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol)                                                    | [E2E-StateSnapshots.test.ts](../../../../test/e2e/E2E-StateSnapshots.test.ts)                                                                                                                                                                             |
| REQ-MSG-2  | A dispute's claimed inbound tip MUST be an ancestor of the chain tip with matching height                                     | [StateChannelCommon.\_isDisputeInboundHashValid](../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol)                                                                                                                                             | [test/e2e/disputeValidation](../../../../test/e2e/disputeValidation)                                                                                                                                                                                      |
| REQ-MSG-3  | Packaged inbound blocks MUST chain from the previous snapshot tip and exist on-chain; fabrication is provable fraud           | [StateManager](../../../../src/stateManager/StateManager.ts) (`findBrokenInboundMessageChainBlock`, `detectForgedInboundMessageBlock`); `ForgedInboundMessageBlock` proof                                                                                              | [E2E-FraudProofsBlockConfirmation.test.ts](../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts)                                                                                                                                                 |
| REQ-MSG-4  | Outbound processing MUST verify the linked range and skip the processed prefix before consuming                               | [StateSnapshotFacet.\_updateStateSnapshot](../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol)                                                                                                                                                   | [E2E-MaliciousUpdateSnapshot.test.ts](../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts)                                                                                                                                                           |
| REQ-MSG-5  | Catch-up MUST be batchable into smaller ranges with identical results                                                         | Supported by `updateStateSnapshotSameFork` + prefix pruning                                                                                                                                                                                                            | none — gap (no split-batch equivalence test)                                                                                                                                                                                                              |
| REQ-MSG-6  | Snapshot advance MUST require finality (same-fork) or finalized reduction + expired challenge period (successor fork)         | [StateSnapshotFacet.sol](../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol)                                                                                                                                                                     | [E2E-StateSnapshots.test.ts](../../../../test/e2e/E2E-StateSnapshots.test.ts), [E2E-FinalDispute.test.ts](../../../../test/e2e/E2E-FinalDispute.test.ts)                                                                                                  |
| REQ-MSG-7  | Same-fork advance MUST consume all pending inbound messages                                                                   | `RaceConditionPendingInboundNotConsumed`; [SnapshotUpdateService](../../../../src/stateManager/snapshotUpdate/SnapshotUpdateService.ts)                                                                                                                                | [SnapshotUpdateService.test.ts](../../../../test/stateManager/SnapshotUpdateService.test.ts)                                                                                                                                                              |
| REQ-MSG-8  | Exits MUST be withdrawable only through snapshot advance (no standalone submission)                                           | No contract entry point processes an `ExitChannel` outside `_updateStateSnapshot`                                                                                                                                                                                      | [E2E-ParticipantLifecycle.test.ts](../../../../test/e2e/E2E-ParticipantLifecycle.test.ts)                                                                                                                                                                 |
| REQ-MSG-9  | Spectating MUST be fail-closed: any failure aborts with no funds or obligations at risk                                       | [SpectateService.applySyncResponse / abort](../../../../src/rpc/services/spectate/SpectateService.ts); [SpectatingValidationStrategy](../../../../src/stateManager/validationStrategy/SpectatingValidationStrategy.ts)                                                 | [E2E-Spectate.test.ts](../../../../test/e2e/E2E-Spectate.test.ts), [E2E-SpectateStaleProofGuard.test.ts](../../../../test/e2e/E2E-SpectateStaleProofGuard.test.ts), [E2E-SpectatingAbortDoS.test.ts](../../../../test/e2e/E2E-SpectatingAbortDoS.test.ts) |
| REQ-MSG-10 | Joining MUST carry the joiner's signature plus the full threshold set's signatures, pinned to an expected snapshot/fork       | [JoinChannelFacet.sol](../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol); [JoinChannelService.ts](../../../../src/rpc/services/joinChannel/JoinChannelService.ts)                                                                                | [E2E-JoinChannelRaceConditions.test.ts](../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts), [JoinChannelSignatureRequest.test.ts](../../../../test/rpc/joinChannel/JoinChannelSignatureRequest.test.ts)                                          |
| REQ-MSG-11 | A deposited-but-unincluded joiner MUST be able to force inclusion via the dispute game and then be covered by leader election | [StateManager.maybeInitiateForceJoinDispute](../../../../src/stateManager/StateManager.ts); [DisputeVerificationFacet.reduce](../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol) inbound-tip selection                                    | [E2E-ForceJoinDispute.test.ts](../../../../test/e2e/E2E-ForceJoinDispute.test.ts)                                                                                                                                                                         |
| REQ-MSG-12 | Anyone MUST be able to verify the balance invariant trustlessly for a claimed snapshot                                        | Public [verifyBalanceInvariantCheckSnapshot](../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol)                                                                                                                                           | [balanceInvariant.test.ts](../../../../test/e2e/disputeValidation/balanceInvariant.test.ts), [E2E-Spectate.test.ts](../../../../test/e2e/E2E-Spectate.test.ts)                                                                                            |
