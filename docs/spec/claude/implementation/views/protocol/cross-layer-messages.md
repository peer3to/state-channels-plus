# Cross-Layer Message Streams — Implementation

> **Specification subject:** [specification/settlement/cross-layer-messages.md](../../../specification/settlement/cross-layer-messages.md)

> **Agent authoring status:** Current implementation analysis assembled; source ownership and conclusions require engineer verification.
> **Engineer verification:** Pending.

## Contents

- [Implementation overview](#implementation-overview)
    - [Specification adherence](#specification-adherence)
    - [Specification contradiction](#specification-contradiction)
    - [Missing](#missing)
- [Assumptions and constraints](#assumptions-and-constraints)
- [System design](#system-design)
- [System integration test plan](#system-integration-test-plan)
- [Source inventory](#source-inventory)
- [Conformance traceability](#conformance-traceability)

## Implementation overview

**Status:** Partial; engineer verification pending.

### Specification adherence

The repository contains concrete source evidence for the specification requirements and invariants
listed in the conformance table. The principal cross-layer message streams mechanisms are implemented
through the source boundaries described below, but their source ownership, edge cases, and test
coverage have not yet received the complete file-by-file engineer audit required for a conformance
claim.

### Specification contradiction

Known current-versus-intended divergences are recorded in [System design](#system-design) and in the
`Gap / divergence` column of [Conformance traceability](#conformance-traceability). The audit is not
yet complete enough to claim that list is exhaustive. **Required resolution:** classify every
recorded divergence as a defect, an approved implementation choice, or an open design decision, then
fix or approve it before marking the subject conformant.

### Missing

- Source ownership has not yet been reduced to one detailed report per inventoried file.
  **Required resolution:** audit every inventory row, remove unrelated ownership, and add its source
  report with exact specification IDs, design decisions, assumptions, constraints, and unit-test
  obligations.
- System integration cases have not yet been assigned stable `INTEGRATION-TEST-*` permutations.
  **Required resolution:** replace the provisional plan below with exhaustive, independently
  coverable integration cases and oracles.
- Exact test evidence remains in the matching verification migration queue. **Required resolution:**
  map every unit and integration permutation to inspected repository tests or an explicit gap.

## Assumptions and constraints

- The linked source entry points and data boundaries are the current implementation under review;
  comments or historical design prose are not treated as implementation evidence.
- Conformance depends on the assumptions and limits in the owning specification in addition to the
  implementation-specific conditions recorded in the system design and conformance table below.
- A source link establishes only that a mechanism exists. It does not prove all required behavior,
  failure atomicity, concurrency properties, or cross-runtime equivalence until the planned tests
  and engineer audit are complete.
- Current implementation status is limited to this repository revision and becomes stale when any
  mapped specification, source boundary, or verification evidence changes.

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

- **Append.** [`StateChannelCommon._appendInboundMessages`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L1)
  builds the next block (parent = current `ChannelBalance` tip, height = tip height + 1,
  `totalBalance` = previous `totalDeposits` plus each message balance via the state machine's
  `addBalance`), persists it in `inboundMessageBlockMap[channelId][hash]`
  (`ErrorInboundMessageBlockAlreadyPersisted` guards duplicates), advances
  `ChannelBalance.latestInboundMessageBlockHash/Height` and `totalDeposits`, and emits
  `InboundMessagesProcessed`. Callers: `open` and `joinChannel`/`topUpBalance` via
  `depositAssetsComposable` ([`StateChannelManagerProxy`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L19)).
- **Channel-side consumption.** The channel's processed tip is the latest snapshot's
  `latestInboundMessageBlockHash`. A block author packages the pending inbound range into its
  next channel block (`Block.messageBlocks`); applying the block applies each message in order
  through `processInboundMessage` and rolls `totalDeposits` forward to the last inbound block's
  `totalBalance` ([`StateManager.applyInboundMessageBlocksToState` / `createStateSnapshot`](../../../../../../src/stateManager/StateManager.ts#L1104)).
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
  [`StateSnapshotFacet`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L8)).
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
  ([`StateManager.createStateSnapshot`](../../../../../../src/stateManager/StateManager.ts#L1118)). The new
  snapshot (committed by the channel block) carries the new outbound tip. Dispute reduction
  appends at most one deterministic outbound block the same way (`timestamp = 0` for determinism;
  [`DisputeVerificationFacet.generateDisputeOutputState`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L19)).
- **Range verification (on-chain).**
  [`StateChannelCommon._verifyOutboundMessageBlocks`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L1)
  checks, between a lower and an upper snapshot: hash linkage starting at the lower tip, height
  contiguity (+1 per block), the recomputed running balance equals the upper snapshot's
  `totalWithdrawals`, the final height equals the upper snapshot's height, and the final hash
  equals the upper snapshot's tip. A non-descendant or otherwise invalid range fails this check.
- **Duplicate skipping.** `_pruneOutboundMessageBlocks` drops the already-processed prefix of a
  supplied range: it discards blocks up to the first block whose `previousBlockHash` equals the
  chain's processed tip. If nothing links to the tip, the range verification decides (a fully
  processed range prunes to empty and verifies trivially only when tips match).
- **Processing.** `_applyOutboundMessageBlocks`
  ([`StateSnapshotFacet`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L8))
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
  [`DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L464)
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

Abort semantics ([`SpectateService.abort`](../../../../../../src/rpc/services/spectate/SpectateService.ts#L97)):
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

[`DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot(channelId, snapshotData, encodedState)`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L28)
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

| Site                            | Mechanism                                                                                                                                                                                                                                                                             | Status                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Spectate-before-join, step 2.11 | `verifyBalanceInvariantCheckSnapshot` via `staticCall` on the latest finalized snapshot; abort on failure                                                                                                                                                                             | Implemented ([SpectateService](../../../../../../src/rpc/services/spectate/SpectateService.ts#L34))                                        |
| Dispute fraud proof             | `DisputeInvalidBalanceInvariant`: a dispute whose proven latest finalized state violates the invariant slashes the disputer ([`DisputeFraudProofFacet._handleDisputeInvalidBalanceInvariant`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L1)) | Implemented                                                                                                                                |
| On-chain snapshot update        | none — code comment declares the intent to add it as the last check on snapshot update                                                                                                                                                                                                | **Gap** (`Current:` not checked; `Intended:` checked — open question in §2.3)                                                              |
| Join submission (`joinChannel`) | none — the joiner is expected to have spectated (fail-closed) first                                                                                                                                                                                                                   | **Gap / by design?** **Open question:** whether an on-chain check at join time is wanted given the spectate-path check is client-side only |

- **REQ-MSG-12.** Any party MUST be able to verify the invariant for a claimed snapshot using
  only on-chain data plus the snapshot's state and linked ranges — i.e. without trusting any
  channel participant. **Current:** holds via the public facet function.

## System integration test plan

For every conformance row, refine the specification permutations with the concrete public entry points, state/storage boundaries, failure and recovery paths, concurrency/interleaving risks, and platform-specific behavior introduced by this implementation. This section defines obligations only; exact test evidence belongs in the matching verification document.

The supporting implementation analyses contain the currently authored component-level permutations. They remain obligations until consolidated into this subject document; they must not be treated as concrete test evidence here.

No stable system-integration cases have been consolidated in this subject yet. The required schema
is retained so the omission is explicit and generated analysis can track the migration.

| Integration test ID | Specification IDs | Specification test IDs | Setup and stimulus | Expected result | Required permutations |
| ------------------- | ----------------- | ---------------------- | ------------------ | --------------- | --------------------- |

## Source inventory

Every source file relevant to this specification belongs here. A missing file is an implementation-documentation gap even when the code itself works.

| Source file                                                                                                                                                       | Specification IDs                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [contracts/V1/AStateMachine.sol](../../../../../../contracts/V1/AStateMachine.sol#L3)                                                                             | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/helpers/LibraryTestContract.sol](../../../../../../contracts/V1/helpers/LibraryTestContract.sol#L3)                                                 | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L13)        | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L3)               | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L3)     | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/Errors.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/Errors.sol#L1)                                         | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L8)                       | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L3)                     | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L3)                             | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L3)                 | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L3)     | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol#L3) | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L3)                       | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L3)                 | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L3)                             | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol#L3)                     | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L3)                 | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol#L3)                 | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelManagerEvents.sol](../../../../../../contracts/V1/StateChannelManagerEvents.sol#L3)                                                     | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/StateChannelManagerInterface.sol](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L3)                                               | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/types/DataTypes.sol](../../../../../../contracts/V1/types/DataTypes.sol#L5)                                                                         | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/types/DisputeFraudProofTypes.sol](../../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L3)                                               | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/types/DisputeTypes.sol](../../../../../../contracts/V1/types/DisputeTypes.sol#L6)                                                                   | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/types/MessageTypeHashes.sol](../../../../../../contracts/V1/types/MessageTypeHashes.sol#L1)                                                         | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [contracts/V1/types/ProofTypes.sol](../../../../../../contracts/V1/types/ProofTypes.sol#L3)                                                                       | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/evm/signer/ClientP2pSigner.ts](../../../../../../src/evm/signer/ClientP2pSigner.ts#L24)                                                                      | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/evm/signer/LocalP2pSigner.ts](../../../../../../src/evm/signer/LocalP2pSigner.ts#L25)                                                                        | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/ProfileManager.ts](../../../../../../src/ProfileManager.ts#L1)                                                                                               | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/rpc/services/initHandshake/InitHandshakeService.ts](../../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts#L2)                             | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/rpc/services/joinChannel/JoinChannelRpcMethods.ts](../../../../../../src/rpc/services/joinChannel/JoinChannelRpcMethods.ts#L1)                               | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/rpc/services/joinChannel/JoinChannelService.ts](../../../../../../src/rpc/services/joinChannel/JoinChannelService.ts#L2)                                     | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/rpc/services/spectate/SpectateRpcMethods.ts](../../../../../../src/rpc/services/spectate/SpectateRpcMethods.ts#L1)                                           | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/rpc/services/spectate/SpectateService.ts](../../../../../../src/rpc/services/spectate/SpectateService.ts#L1)                                                 | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/rpc/services/stateTransition/StateTransitionRpcMethods.ts](../../../../../../src/rpc/services/stateTransition/StateTransitionRpcMethods.ts#L1)               | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/rpc/services/stateTransition/StateTransitionService.ts](../../../../../../src/rpc/services/stateTransition/StateTransitionService.ts#L1)                     | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/stateManager/BlockQueueManager.ts](../../../../../../src/stateManager/BlockQueueManager.ts#L48)                                                              | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/stateManager/snapshotUpdate/SnapshotUpdateService.ts](../../../../../../src/stateManager/snapshotUpdate/SnapshotUpdateService.ts#L41)                        | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/stateManager/StateManager.ts](../../../../../../src/stateManager/StateManager.ts#L1)                                                                         | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/stateManager/validationStrategy/BlockValidationStrategy.ts](../../../../../../src/stateManager/validationStrategy/BlockValidationStrategy.ts#L1)             | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/stateManager/validationStrategy/SpectatingValidationStrategy.ts](../../../../../../src/stateManager/validationStrategy/SpectatingValidationStrategy.ts#L229) | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/storage/BlockStorage.ts](../../../../../../src/storage/BlockStorage.ts#L1)                                                                                   | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/storage/ForceJoinStorage.ts](../../../../../../src/storage/ForceJoinStorage.ts#L1)                                                                           | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/storage/MessageBlockStorage.ts](../../../../../../src/storage/MessageBlockStorage.ts#L74)                                                                    | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/storage/QueueStorage.ts](../../../../../../src/storage/QueueStorage.ts#L1)                                                                                   | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/types/spectate.ts](../../../../../../src/types/spectate.ts#L1)                                                                                               | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |
| [src/stateManager/snapshotUpdate/index.ts](../../../../../../src/stateManager/snapshotUpdate/index.ts#L1)                                                         | `INV-MSG-1`, `INV-MSG-2`, `INV-MSG-3`, `INV-MSG-4`, `INV-MSG-5`, `INV-MSG-6`, `REQ-MSG-1`, `REQ-MSG-2`, `REQ-MSG-3`, `REQ-MSG-4`, `REQ-MSG-5`, `REQ-MSG-6`, `REQ-MSG-7`, `REQ-MSG-8`, `REQ-MSG-9`, `REQ-MSG-10`, `REQ-MSG-11`, `REQ-MSG-12` |

### Supporting implementation analyses

- [architecture/sdk/rpc/join-channel.md](../architecture/sdk/rpc/join-channel.md)
- [architecture/sdk/rpc/state-transition.md](../architecture/sdk/rpc/state-transition.md)
- [architecture/sdk/rpc/spectate.md](../architecture/sdk/rpc/spectate.md)
- [architecture/contracts/manager-and-facets.md](../architecture/contracts/manager-and-facets.md)

## Conformance traceability

This table records whether the repository currently implements each requirement. It does not change the requirement or claim approval; code evidence remains pending until an engineer verifies it.

| Requirement / invariant | Implementation status                      | Source evidence                                                                                                                                                                                                                                                                          | Design decisions / assumptions                                                                     | Implementation-specific test obligations                                                                                                                                          | Gap / divergence                                                                   |
| ----------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `INV-MSG-1`             | Implemented; engineer verification pending | [StateChannelCommon.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L3) (`_appendInboundMessages`, `_verifyOutboundMessageBlocks`, `_verifyInboundMessageBlocks`); [MessageBlockStorage.ts](../../../../../../src/storage/MessageBlockStorage.ts#L1) | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-MSG-1.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `INV-MSG-2`             | Implemented; engineer verification pending | `ErrorInboundMessageBlockAlreadyPersisted`; `_pruneOutboundMessageBlocks` + `_verifyOutboundMessageBlocks`                                                                                                                                                                               | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-MSG-2.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `INV-MSG-3`             | Implemented; engineer verification pending | `_appendInboundMessages`, `_applyOutboundMessageBlocks`, [StateManager.createStateSnapshot](../../../../../../src/stateManager/StateManager.ts#L1118)                                                                                                                                    | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-MSG-3.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `INV-MSG-4`             | Implemented; engineer verification pending | [StateSnapshotFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L3) (`CantWithdrawMoreThanDeposits`)                                                                                                                                             | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-MSG-4.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `INV-MSG-5`             | Implemented; engineer verification pending | [StateSnapshotFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L3) (`isSnapshotNewer`, fork walk)                                                                                                                                               | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-MSG-5.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `INV-MSG-6`             | Implemented; engineer verification pending | [DisputeVerificationFacet.verifyBalanceInvariantCheckSnapshot](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L464)                                                                                                                                | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-MSG-6.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-MSG-1`             | Implemented; engineer verification pending | [DataTypes.sol](../../../../../../contracts/V1/types/DataTypes.sol#L3) `SnapshotData`; [DisputeVerificationFacet.reduceOutputToSnapshotData](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L143)                                                  | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-MSG-1.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-MSG-2`             | Implemented; engineer verification pending | [StateChannelCommon.\_isDisputeInboundHashValid](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L1)                                                                                                                                                      | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-MSG-2.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-MSG-3`             | Implemented; engineer verification pending | [StateManager](../../../../../../src/stateManager/StateManager.ts#L107) (`findBrokenInboundMessageChainBlock`, `detectForgedInboundMessageBlock`); `ForgedInboundMessageBlock` proof                                                                                                     | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-MSG-3.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-MSG-4`             | Implemented; engineer verification pending | [StateSnapshotFacet.\_updateStateSnapshot](../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L1)                                                                                                                                                            | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-MSG-4.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-MSG-5`             | Implemented; engineer verification pending | Supported by `updateStateSnapshotSameFork` + prefix pruning                                                                                                                                                                                                                              | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-MSG-5.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-MSG-6`             | Implemented; engineer verification pending | [StateSnapshotFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L3)                                                                                                                                                                              | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-MSG-6.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-MSG-7`             | Implemented; engineer verification pending | `RaceConditionPendingInboundNotConsumed`; [SnapshotUpdateService](../../../../../../src/stateManager/snapshotUpdate/SnapshotUpdateService.ts#L37)                                                                                                                                        | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-MSG-7.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-MSG-8`             | Implemented; engineer verification pending | No contract entry point processes an `ExitChannel` outside `_updateStateSnapshot`                                                                                                                                                                                                        | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-MSG-8.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-MSG-9`             | Implemented; engineer verification pending | [SpectateService.applySyncResponse / abort](../../../../../../src/rpc/services/spectate/SpectateService.ts#L96); [SpectatingValidationStrategy](../../../../../../src/stateManager/validationStrategy/SpectatingValidationStrategy.ts#L21)                                               | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-MSG-9.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-MSG-10`            | Implemented; engineer verification pending | [JoinChannelFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L3); [JoinChannelService.ts](../../../../../../src/rpc/services/joinChannel/JoinChannelService.ts#L1)                                                                                | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-MSG-10.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-MSG-11`            | Implemented; engineer verification pending | [StateManager.maybeInitiateForceJoinDispute](../../../../../../src/stateManager/StateManager.ts#L1563); [DisputeVerificationFacet.reduce](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L61) inbound-tip selection                                | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-MSG-11.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-MSG-12`            | Implemented; engineer verification pending | Public [verifyBalanceInvariantCheckSnapshot](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L711)                                                                                                                                                  | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-MSG-12.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
