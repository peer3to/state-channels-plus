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

- **Append.** [`StateChannelCommon._appendInboundMessages`](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L281)
  builds the next block (parent = current `ChannelBalance` tip, height = tip height + 1,
  `totalBalance` = previous `totalDeposits` plus each message balance via the state machine's
  `addBalance`), persists it in `inboundMessageBlockMap[channelId][hash]`
  (`ErrorInboundMessageBlockAlreadyPersisted` guards duplicates), advances
  `ChannelBalance.latestInboundMessageBlockHash/Height` and `totalDeposits`, and emits
  `InboundMessagesProcessed`. Callers: `open` and `joinChannel`/`topUpBalance` via
  `depositAssetsComposable` ([`StateChannelManagerProxy`](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L24)).
- **Channel-side consumption.** The channel's processed tip is the latest snapshot's
  `latestInboundMessageBlockHash`. A block author packages the pending inbound range into its
  next channel block (`Block.messageBlocks`); applying the block applies each message in order
  through `processInboundMessage` and rolls `totalDeposits` forward to the last inbound block's
  `totalBalance` ([`SnapshotAssemblyService.applyInboundMessageBlocksToState`](../../../../../src/stateManager/block/SnapshotAssemblyService.ts#L263) / [`createStateSnapshot`](../../../../../src/stateManager/block/SnapshotAssemblyService.ts#L148)).
- **Validation by peers.** Every validator checks (a) the packaged inbound blocks chain correctly
  from the previous snapshot's inbound tip (`findBrokenInboundMessageChainBlock` → treated as an
  invalid state transition), and (b) every packaged inbound block exists locally or on-chain
  (`detectForgedInboundMessageBlock`, backed by the on-chain view
  `hasInboundMessageBlock`); a fabricated block is provable fraud
  (`ForgedInboundMessageBlock`, see [protocol/fraud-proofs.md](../architecture/sdk/dispute-pipeline.md)).
- **On-chain ancestry check for disputes.** A dispute's claimed inbound tip must be an ancestor
  (or equal) of the chain's tip: `_isDisputeInboundHashValid` walks the persisted chain from the
  chain tip toward genesis and also requires the claimed height to match the stored height. Upload
  separately requires the anchor to equal the chain's inbound head (hash and height), so a committed
  dispute always passes this walk.
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
  ([`SnapshotAssemblyService.createStateSnapshot`](../../../../../src/stateManager/block/SnapshotAssemblyService.ts#L148)). The new
  snapshot (committed by the channel block) carries the new outbound tip. Dispute reduction
  appends at most one deterministic outbound block the same way (`timestamp = 0` for determinism;
  [`DisputeVerificationFacet._generateDisputeOutputState`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L366)).
- **Range verification (on-chain).**
  [`StateChannelCommon._verifyOutboundMessageBlocks`](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L393)
  checks, between a lower and an upper snapshot, in this order: hash linkage starting at the lower
  tip and height contiguity (+1 per block), then the final height equals the upper snapshot's
  height and the final hash equals the upper snapshot's tip; only then does it sum the message
  balances and require the sum to equal the upper snapshot's `totalWithdrawals`. Each failed check
  returns false. A non-descendant or otherwise invalid range fails this check. Because the chain
  is checked first, a forged balance that would overflow returns false and does not revert.
  **Residual:** a range authenticated by the upper tip whose balances overflow still reverts.
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
  [`DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L464)
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

### 3.2 Sync verification and failure boundaries

The [spectate view](../architecture/sdk/rpc/spectate.md) and
[SpectateService report](../../source/src/rpc/network/services/spectate/SpectateService.ts.md)
own the current algorithm. Sync is awaited and coalesces applicable in-flight requests.
Request timeout, refusal or transport loss takes a counted close and returns false. Invalid
payload evidence is rejected with a peer verdict; internal execution and chain-read errors
propagate fatally. The caller owns initial-runtime shutdown or established-runtime recovery.

Verification establishes the fork lineage, genesis, milestone proof from the successful trusted
start, outbound ranges, final-state bytes and balance invariant. It does not simulate snapshot
adoption. Pinned requests accept their fork or a verified successor; same-fork results must reach
the requested minimum. Latest mode derives the latest provable fork from chain dispute state.

Verified persistence precedes sequential tail replay. If a later replay block fails, earlier
verified progress may remain. Sync itself submits no transaction and creates no deposit or signing
obligation for a spectator. This distinction matters for
[`REQ-MSG-9-BFN9P5` (Spectating MUST be fail-closed)](../../../specification/settlement/cross-layer-messages.md#req-msg-9-bfn9p5):
retained verified data is not a channel commitment. No rollback of all local storage is promised.

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

[`DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot(channelId, snapshotData, encodedState)`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L464)
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

| Site                            | Mechanism                                                                                                                                                                                                                                                                            | Status                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Spectate-before-join, step 2.11 | `verifyBalanceInvariantCheckSnapshot` via `staticCall` on the latest finalized snapshot; abort on failure                                                                                                                                                                            | Implemented ([SpectateService](../../../../../src/rpc/network/services/spectate/SpectateService.ts#L547))                                  |
| Dispute fraud proof             | `DisputeInvalidBalanceInvariant`: a dispute whose proven latest finalized state violates the invariant slashes the disputer ([`DisputeFraudProofFacet._handleDisputeInvalidBalanceInvariant`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L343)) | Implemented                                                                                                                                |
| On-chain snapshot update        | none — code comment declares the intent to add it as the last check on snapshot update                                                                                                                                                                                               | **Gap** (`Current:` not checked; `Intended:` checked — open question in §2.3)                                                              |
| Join submission (`joinChannel`) | none — the joiner is expected to have spectated (fail-closed) first                                                                                                                                                                                                                  | **Gap / by design?** **Open question:** whether an on-chain check at join time is wanted given the spectate-path check is client-side only |

- **[`REQ-MSG-12-1RRB0W` (Anyone MUST be able to verify the balance invariant trustlessly for a claimed…)](../../../specification/settlement/cross-layer-messages.md#req-msg-12-1rrb0w).** Any party MUST be able to verify the invariant for a claimed snapshot using
  only on-chain data plus the snapshot's state and linked ranges — i.e. without trusting any
  channel participant. **Current:** holds via the public facet function.
