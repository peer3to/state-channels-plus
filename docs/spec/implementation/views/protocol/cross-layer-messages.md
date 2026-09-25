# Cross-Layer Message Streams — Implementation

> **Specification subject:** [specification/settlement/cross-layer-messages.md](../../../specification/settlement/cross-layer-messages.md)

## System design

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

- **Append.** [`StateChannelCommon._appendInboundMessages`](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L1)
  builds the next block (parent = current `ChannelBalance` tip, height = tip height + 1,
  `totalBalance` = previous `totalDeposits` plus each message balance via the state machine's
  `addBalance`), persists it in `inboundMessageBlockMap[channelId][hash]`
  (`ErrorInboundMessageBlockAlreadyPersisted` guards duplicates), advances
  `ChannelBalance.latestInboundMessageBlockHash/Height` and `totalDeposits`, and emits
  `InboundMessagesProcessed`. Callers: `open` and `joinChannel`/`topUpBalance` via
  `depositAssetsComposable` ([`StateChannelManagerProxy`](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L25)).
- **Channel-side consumption.** The channel's processed tip is the latest snapshot's
  `latestInboundMessageBlockHash`. A block author packages the pending inbound range into its
  next channel block (`Block.messageBlocks`); applying the block applies each message in order
  through `processInboundMessage` and rolls `totalDeposits` forward to the last inbound block's
  `totalBalance` ([`StateManager.applyInboundMessageBlocksToState` / `createStateSnapshot`](../../../../../src/stateManager/StateManager.ts#L478)).
- **Validation by peers.** Every validator checks (a) the packaged inbound blocks chain correctly
  from the previous snapshot's inbound tip (`findBrokenInboundMessageChainBlock` → treated as an
  invalid state transition), and (b) every packaged inbound block exists locally or on-chain
  (`detectForgedInboundMessageBlock`, backed by the on-chain view
  `hasInboundMessageBlock`); a fabricated block is provable fraud
  (`ForgedInboundMessageBlock`, see [protocol/fraud-proofs.md](../architecture/sdk/dispute-pipeline.md)).
- **On-chain ancestry check for disputes.** A dispute's claimed inbound tip must be an ancestor
  (or equal) of the chain's tip: `_isDisputeInboundHashValid` walks the persisted chain from the
  chain tip toward genesis and also requires the claimed height to match the stored height.
- **Pruning.** When a snapshot advance clears storage, inbound blocks from the new snapshot's tip
  backwards are deleted (`_clearOldInboundMessageBlocks` in
  [`StateSnapshotFacet`](../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L8)).
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
  ([`StateManager.createStateSnapshot`](../../../../../src/stateManager/StateManager.ts#L478)). The new
  snapshot (committed by the channel block) carries the new outbound tip. Dispute reduction
  appends at most one deterministic outbound block the same way (`timestamp = 0` for determinism;
  [`DisputeVerificationFacet.generateDisputeOutputState`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L18)).
- **Range verification (on-chain).**
  [`StateChannelCommon._verifyOutboundMessageBlocks`](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L1)
  checks, between a lower and an upper snapshot: hash linkage starting at the lower tip, height
  contiguity (+1 per block), the recomputed running balance equals the upper snapshot's
  `totalWithdrawals`, the final height equals the upper snapshot's height, and the final hash
  equals the upper snapshot's tip. A non-descendant or otherwise invalid range fails this check.
- **Duplicate skipping.** `_pruneOutboundMessageBlocks` drops the already-processed prefix of a
  supplied range: it discards blocks up to the first block whose `previousBlockHash` equals the
  chain's processed tip. If nothing links to the tip, the range verification decides (a fully
  processed range prunes to empty and verifies trivially only when tips match).
- **Processing.** `_applyOutboundMessageBlocks`
  ([`StateSnapshotFacet`](../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L8))
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

### 2.3 Current / Intended divergences and open questions

- **Current:** `_updateStateSnapshot` does **not** run the channel-balance invariant check (§6).
  A code comment in
  [`DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L463)
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

### 3.2 Abort conditions (Current, enumerated)

Request path (peer blacklisted; sync abandoned):

1. RPC timeout, transport error, or the responder declining (responder returns `undefined` for:
   malformed/unsafe requested height, a fork it cannot prove as the derived tip, a height above
   its latest, or a missing state proof).

Verification path (`applySyncResponse`; each aborts the sync): 2. Payload fails to decode, or any verification step throws. 3. Round-trip time exceeds `agreementTime`. 4. A claimed dispute window does not exist on-chain or its kill period has not expired. 5. More than one dispute window still needs reduction. 6. A window's locally recomputed reduction does not match the payload's claimed successor fork. 7. The tip fork's genesis snapshot is inconsistent (fork mismatch, not genesis-shaped, or state
hash ≠ hash of supplied encoded state). 8. The on-chain snapshot is already ahead of the proved height (stale proof). 9. Either outbound message-block range fails `verifyOutboundMessageBlocks`. 10. Latest-mode: the tip fork is disputed on-chain. Pinned mode: tip fork ≠ requested fork. 11. The milestone state proof fails `verifyMilestones`. 12. The latest finalized state hash does not match the supplied encoded state. 13. The channel-balance invariant fails (`verifyBalanceInvariantCheckSnapshot`, §6). 14. The simulated on-chain advance (`multicall` `staticCall` of pending `reduceAndFinalize` +
`updateStateSnapshotFork` + `updateStateSnapshotSameFork`) reverts. 15. A proved finalized block conflicts with a block already in local storage. 16. Replaying an unfinalized block through the confirmation pipeline fails. 17. Pinned mode: the proof's latest block does not reach the requested height.

Abort semantics ([`SpectateService.abort`](../../../../../src/rpc/network/services/spectate/SpectateService.ts#L98)):
if the node is not yet participating (or pending), the whole state manager aborts — a full local
stop with no residue; if it is already a participant using spectate-sync for recovery, only the
offending peer is cut and blacklisted. While spectating,
`SpectatingValidationStrategy` keeps the same fail-closed split: provable participant fraud
(double-sign, invalid transition, forged inbound block, objective bad timestamp) → abort and stop
following; non-provable junk (outsider authors, malformed linkage, stray signatures) → drop and
blacklist the sender, keep spectating.

- **[`REQ-MSG-9-BFN9P5` (Spectating MUST be fail-closed)](../../../specification/settlement/cross-layer-messages.md#req-msg-9-bfn9p5).** Spectating MUST NOT create any on-chain or channel obligation; every abort path
  MUST leave no partial local commitment that could later bind the spectator. **Current:**
  persistence happens only after all verification (steps 2–14) succeeds, under the state-manager
  mutex, and is skipped when local storage is already ahead.
- **Current:** a code TODO notes the local simulation of snapshot updates "need[s] dummy
  contracts to process withdrawals" — a consumer facet whose `withdraw` touches real external
  state may make simulation infeasible for spectators. **Open question:** how are
  consumer-facet side effects stubbed during spectate simulation?

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

### 6.2 Definition (Current)

[`DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot(channelId, snapshotData, encodedState)`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L27)
returns true iff, using the state machine's balance algebra:

1. `snapshotData.stateMachineStateHash == keccak256(encodedState)` (state binding);
2. `snapshotData.totalDeposits == ` on-chain deposits resolved at the snapshot's inbound tip
   (`_resolveTotalDeposits`) — deposits only ever happen on-chain, so the snapshot cannot claim
   deposits the chain has not seen;
3. `snapshotData.totalWithdrawals ≥ ` on-chain processed withdrawals — the snapshot cannot
   un-process a withdrawal the chain already paid out;
4. `totalDeposits == totalWithdrawals + getTotalStateBalance(state)` — **[`INV-MSG-6-1C22RD` (Balance invariant)](../../../specification/settlement/cross-layer-messages.md#inv-msg-6-1c22rd)**, the balance
   invariant proper, with `getTotalStateBalance` supplied per balance model by the integrator
   (see [concepts/state-machines.md](../concepts/state-machines.md); a composite/multi-asset
   model must make its `Balance` algebra encode the aggregate).

Proof inputs: the claimed snapshot's `SnapshotData`, its full encoded state-machine state, and
the verified inbound/outbound ranges connecting the snapshot's tips to the chain (the function
assumes the caller verified those chains — the spectate flow does exactly that in steps 9 of
§3.2 before step 13).

### 6.3 When it is checked (Current) and gaps

| Site                            | Mechanism                                                                                                                                                                                                                                                                          | Status                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Spectate-before-join, step 2.11 | `verifyBalanceInvariantCheckSnapshot` via `staticCall` on the latest finalized snapshot; abort on failure                                                                                                                                                                          | Implemented ([SpectateService](../../../../../src/rpc/network/services/spectate/SpectateService.ts#L35))                                   |
| Dispute fraud proof             | `DisputeInvalidBalanceInvariant`: a dispute whose proven latest finalized state violates the invariant slashes the disputer ([`DisputeFraudProofFacet._handleDisputeInvalidBalanceInvariant`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L1)) | Implemented                                                                                                                                |
| On-chain snapshot update        | none — code comment declares the intent to add it as the last check on snapshot update                                                                                                                                                                                             | **Gap** (`Current:` not checked; `Intended:` checked — open question in §2.3)                                                              |
| Join submission (`joinChannel`) | none — the joiner is expected to have spectated (fail-closed) first                                                                                                                                                                                                                | **Gap / by design?** **Open question:** whether an on-chain check at join time is wanted given the spectate-path check is client-side only |

- **[`REQ-MSG-12-1RRB0W` (Anyone MUST be able to verify the balance invariant trustlessly for a claimed…)](../../../specification/settlement/cross-layer-messages.md#req-msg-12-1rrb0w).** Any party MUST be able to verify the invariant for a claimed snapshot using
  only on-chain data plus the snapshot's state and linked ranges — i.e. without trusting any
  channel participant. **Current:** holds via the public facet function.
