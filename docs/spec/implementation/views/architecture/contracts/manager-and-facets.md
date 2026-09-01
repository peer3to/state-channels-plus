# `StateChannelManagerProxy` & Facets: ABI-Level Reference

> **Specification subject:** [specification/architecture/contracts.md](../../../../specification/enforcement/contracts.md)

> **Status:** Draft, reverse-engineered baseline. Pending engineer review.
> **Scope:** The manager's external surface, timing configuration, facet-by-facet reference,
> on-chain storage, events, and errors — the ABI-level contract. Protocol _behavior_ is kept thin
> here; the binding semantics live in [../protocol/disputes.md](../../../../specification/disputes/disputes.md),
> [../protocol/fraud-proofs.md](../../../../specification/disputes/fraud-proofs.md),
> [../protocol/state-proofs.md](../../../../specification/disputes/state-proofs.md), and
> [../protocol/cross-layer-messages.md](../../../../specification/settlement/cross-layer-messages.md).
> **Siblings:** [architecture.md](./architecture.md) (topology, size budget),
> [state-machine-base.md](./state-machine-base.md) (integrator contract). Struct fields:
> [../reference/data-types.md](../../../../specification/protocol-model/data-types.md).

## 1. Purpose & observable contract

[`StateChannelManagerProxy`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L25)
is the single on-chain address that governs channels: opening, joins/top-ups, block-calldata
commitments, disputes, fraud proofs, state proofs, snapshot advancement, and (through the
integrator's consumer facet) deposits and withdrawals. It implements seven functions itself and
routes the rest to facets by selector; the whole surface is **declared** on
[`StateChannelManagerInterface`](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L15),
which nothing implements — it is the caller-side type
([architecture.md §1](./architecture.md#1-purpose--observable-contract)). Events come from
[`StateChannelManagerEvents`](../../../../../../contracts/V1/StateChannelManagerEvents.sol#L6), which
that interface inherits.

The manager stores only commitments and minimal accounting, keyed by `channelId` (§5). It is
deployed by extending the proxy (or, for local tests,
[`LocalDiamond`](../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L20)) and wiring
the facet addresses in the constructor ([architecture.md §2](./architecture.md#2-current-topology)).

### Assumptions, constraints & dependencies

- One `AStateMachine` implementation serves all channels of a manager instance
  (`executeStateTransition` ignores `channelId` when selecting the machine — noted in source).
- Signature scheme everywhere: EIP-191 personal-sign over `keccak256(encodedData)`
  (`"\x19Ethereum Signed Message:\n32"` prefix), recovered with OpenZeppelin ECDSA — see
  `UtilityFacet.verifyThresholdSigned` / `retrieveSignerAddress`.
- Thresholds are **unanimous** over the relevant participant set; the on-chain threshold set is
  `(snapshot participants ∪ pending participants) − on-chain-slashed`
  (`StateChannelCommon._getOnChainThresholdSet`).
- Timing is measured in on-chain `block.timestamp` seconds against the configured windows (§3).

## 2. External surface (verified signatures)

All signatures below are verified against
[`StateChannelManagerInterface.sol`](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L15),
which declares the complete surface, and against the implementing proxy/facet bodies.
"Routes to" names the executing contract; `(self)` means the proxy body itself.

### 2.0 How a call reaches its contract

- Seven functions are declared on the proxy and dispatch directly:
  [`open`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L119),
  [`postBlockCalldata`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L92),
  [`depositAssetsComposable`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L199),
  [`withdrawAssetsComposable`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L243),
  [`executeStateTransition`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L249),
  [`multicall`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L264), and
  [`facetAddressForSelector`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L80).
- Everything else reaches
  [`fallback()`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L67),
  which delegatecalls the facet that the shared-storage route map
  [`_facetForSelector`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L286)
  returns for `msg.sig`, passing raw `msg.data`.
- The constructor installs routes with `_registerRoute(Facet.fn.selector, facetAddress)`. Duplicate
  registration and codeless route targets revert, lookup is constant-time, and runtime mutation is not exposed. Mutable
  governance routing remains separate future work.
- **Introspection.** `facetAddressForSelector(bytes4) returns (address)` is read-only and reports
  where the fallback would send a selector. Selectors the proxy declares itself never reach the
  fallback, so they are not in the table and this view reports the consumer facet for them.
- **Unconfigured selectors** resolve to `consumerFacetAddress`
  ([#L355](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L355)) —
  the fallback of last resort, which is how the integrator's consumer functions are reachable.
- **Deliberate exclusions (`notRouted`).** Some `public`/`external` facet functions are internal
  steps of a larger operation and are intentionally kept off the diamond surface, so they fall
  through to the consumer facet like any unknown selector. The authoritative list, with the reason
  per function, is
  [test/fixtures/ProxySelectorRoutingFixture.ts](../../../../../../test/fixtures/ProxySelectorRoutingFixture.ts#L33):
    - `DisputeVerificationFacet`: `checkDisputeAuditingDataCommitment`,
      `computeDisputeOutputSnapshotData`, `computeDisputeOutputState`, `generateDisputeOutputState`,
      `isDisputeOutputCorrect` (internal verification/computation steps; `LocalDiamond` delegatecalls
      the computation helpers with its own gas budget) and `killDispute` (driven from inside the
      dispute pipeline; exposing it would widen the attack surface).
    - `FraudProofFacet`: `runFraudProof` — a single step driven by `applyFraudProofs`, not callable
      on its own.
    - `UtilityFacet`: its 13 stateless helpers (§4.8), which `StateChannelCommon` calls directly on
      the facet deployment rather than through the diamond.

### 2.1 Channel lifecycle

| Function                                                                                             | Routes to                 | Semantics (thin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open(OpenChannelConfirmation calldata)`                                                             | (self) + consumer facet   | Opens a channel: rejects zero/duplicate `channelId` and duplicate participants (`RaceConditionChannelAlreadyOpen`, `ErrorDuplicateParticipant`), verifies the unanimous threshold signature over `encodedOpenChannel`, deposits composably per join (honoring `OpenChannel.isAtomic`), requires ≥ 2 successful joins, obtains genesis state from `AConsumerFacet.openChannelGenesis`, stores the genesis `StateSnapshot` (forkId = `keccak256(abi.encode(genesisSnapshotData))`), emits `ChannelOpened`.                                                                                                                                        |
| `joinChannel(JoinChannelConfirmation memory, bytes32 expectedSnapshotHash, bytes32 expectedForkId)`  | `JoinChannelFacet`        | Post-open admission (deposit side). See §4.1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `topUpBalance(JoinChannelConfirmation memory, bytes32 expectedSnapshotHash, bytes32 expectedForkId)` | `JoinChannelFacet`        | Balance top-up for an existing participant. See §4.1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `postBlockCalldata(SignedBlock memory, uint256 maxTimestamp)`                                        | (self)                    | Persists the commitment `keccak256(abi.encode(signedBlock, block.timestamp))` under `[channelId][msg.sender][forkId][transactionCnt]`. Guards: `block.timestamp <= maxTimestamp` (`RaceConditionBlockCalldataTimestampTooLate`), no overwrite (`ErrorBlockCalldataAlreadyPosted`), `msg.sender` must equal the block's author (`ErrorBlockCalldataMsgSenderNotBlockAuthor`). Does **not** verify the block — the sender vouches for the data; junk is later slashable against the commitment. Emits `BlockCalldataPosted`. Data-availability role: [../security/data-availability.md](../../../../specification/security/data-availability.md). |
| `multicall(bytes[] calldata)`                                                                        | (self, delegatecall loop) | Executes each call against the proxy itself, bubbling the first revert. Enables atomic compositions (e.g. upload dispute + reduce). A routed selector inside a call still reaches its facet, via the proxy's own fallback.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `facetAddressForSelector(bytes4 sig) returns (address)`                                              | (self, view)              | Read-only introspection: the facet the fallback would delegatecall for `sig`, or the consumer facet when `sig` is unrouted. See §2.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `fallback()`                                                                                         | routed facet / consumer   | Delegatecalls `_facetForSelector(msg.sig)` with raw `msg.data`; an unrouted selector lands on the integrator consumer facet (custom functions, `deposit`, `withdraw`, `openChannelGenesis`). Reachability caveat: [state-machine-base.md §7](./state-machine-base.md#7-aconsumerfacet-the-integrator-consumer-contract).                                                                                                                                                                                                                                                                                                                        |

### 2.2 Disputes and fraud proofs

Behavior: [../protocol/disputes.md](../../../../specification/disputes/disputes.md),
[../protocol/fraud-proofs.md](../../../../specification/disputes/fraud-proofs.md).

| Function                                                                                                                                                                                      | Routes to                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `uploadDispute(DisputeConfirmation memory)`                                                                                                                                                   | `DisputeManagerFacet`      |
| `uploadDisputeWithCalldata(DisputeConfirmation memory, DisputeAuditingData memory)`                                                                                                           | `DisputeManagerFacet`      |
| `challengeDisputeReduction(Dispute[] memory, StateSnapshot memory latestStateSnapshot, bytes memory encodedStateMachineState, MessageBlock[] memory inboundMessageBlocks)`                    | `DisputeVerificationFacet` |
| `reduce(Dispute[] memory) returns (ReduceOutput memory)`                                                                                                                                      | `DisputeVerificationFacet` |
| `reduceOutputToSnapshotData(bytes32 forkId, ReduceOutput memory, StateSnapshot memory, bytes memory, MessageBlock[] memory) returns (SnapshotData memory, bytes memory, MessageBlock memory)` | `DisputeVerificationFacet` |
| `reduceAndFinalize(Dispute[] memory, StateSnapshot memory, bytes memory, MessageBlock[] memory, bytes32 expectedReducedForkId)`                                                               | `DisputeVerificationFacet` |
| `applyFraudProofs(FraudProof[] memory, FraudProofVerificationContext memory)`                                                                                                                 | `FraudProofFacet`          |
| `applyDisputeFraudProofs(DisputeFraudProof[] memory)`                                                                                                                                         | `DisputeFraudProofFacet`   |
| `validateTimeoutCalldataPostedProof(TimeoutCalldataPosted memory, Dispute memory) returns (bool)`                                                                                             | `DisputeFraudProofFacet`   |
| `hasInvalidTimestamp(InvalidTimestampProof memory) returns (bool)`                                                                                                                            | `FraudProofFacet`          |
| `isLastMilestoneFinalByEveryone(Dispute memory) returns (bool)`                                                                                                                               | `DisputeFraudProofFacet`   |
| `hasStateProofHeaderMismatch(Dispute memory) returns (bool)`                                                                                                                                  | `DisputeFraudProofFacet`   |
| `isDisputeInboundHashValid(Dispute memory) returns (bool)`                                                                                                                                    | `DisputeFraudProofFacet`   |

### 2.3 State proofs and snapshots

Behavior: [../protocol/state-proofs.md](../../../../specification/disputes/state-proofs.md),
[../protocol/cross-layer-messages.md](../../../../specification/settlement/cross-layer-messages.md).

| Function                                                                                                                                                   | Routes to                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `verifyStateProof(Dispute memory, DisputeAuditingData memory) returns (bool)`                                                                              | `StateProofFacet`          |
| `isCorrectLatestState(Dispute memory, SnapshotData memory genesisStateSnapshotData) returns (bool)`                                                        | `StateProofFacet`          |
| `areSignedBlocksLinkedAndVerified(SignedBlock[] memory) returns (bool)`                                                                                    | `StateProofFacet`          |
| `isInvalidBlockStructureInStateProof(StateProof memory, uint256 blockIndex) returns (bool)`                                                                | `StateProofFacet`          |
| `findFirstInvalidBlockStructureInStateProof(StateProof memory) returns (bool found, uint256 blockIndex)`                                                   | `StateProofFacet`          |
| `verifyMilestones(bytes32 forkId, MilestoneProof[] memory, StateSnapshot[] memory, StateSnapshot memory thresholdStateSnapshot) returns (bool)`            | `StateProofFacet`          |
| `isMilestoneFinal(bytes32 forkId, SnapshotData memory thresholdSnapshotData, MilestoneProof memory) returns (bool isFinal, bytes32 finalizedSnapshotHash)` | `StateProofFacet`          |
| `updateStateSnapshotFork(bytes32 channelId, StateSnapshot memory newStateSnapshot, MessageBlock[] memory outboundMessageBlocks)`                           | `StateSnapshotFacet`       |
| `updateStateSnapshotSameFork(bytes32 channelId, MilestoneProof[] memory, StateSnapshot[] memory, MessageBlock[] memory outboundMessageBlocks)`             | `StateSnapshotFacet`       |
| `verifyBalanceInvariantCheckSnapshot(bytes32 channelId, SnapshotData memory, bytes memory encodedStateMachineState) returns (bool)`                        | `DisputeVerificationFacet` |
| `verifyOutboundMessageBlocks(MessageBlock[] memory, SnapshotData memory lowerSnapshot, SnapshotData memory upperSnapshot) returns (bool)`                  | `UtilityFacet` (view)      |
| `pruneOutboundMessageBlocks(MessageBlock[] memory, bytes32 lowerHash) returns (MessageBlock[] memory)`                                                     | `UtilityFacet` (pure)      |

### 2.4 Views

Every view on the diamond surface is routed to `UtilityFacet` and runs under `delegatecall`, so it
reads the proxy's storage (§4.8). Each one is a thin wrapper over a `StateChannelCommon` `internal`
accessor or a direct storage read.

| Function                                                                                                                                                                          | Returns                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `isChannelOpen(bytes32 channelId)`                                                                                                                                                | `(bool, StateSnapshot)` — open iff the stored snapshot has ≥ 1 participant.           |
| `getParticipants(bytes32 channelId)` / `getSnapshotParticipants(bytes32 channelId)`                                                                                               | Snapshot participants (both call the same accessor).                                  |
| `getPendingParticipants(bytes32 channelId)`                                                                                                                                       | Derived by walking the inbound chain for unconsumed `JOIN`s.                          |
| `getOnChainSlashedParticipants(bytes32)` / `getOnChainSlashedParticipantsUpToTimestamp(bytes32, uint256)` / `isParticipantSlashedOnChain(bytes32, address)`                       | On-chain slash set, whole or as of a timestamp.                                       |
| `getOnChainThresholdSet(bytes32 channelId)` / `canParticipateInDisputes(bytes32, address)`                                                                                        | Eligibility set (snapshot ∪ pending − slashed) and membership in it.                  |
| `getStateSnapshot(bytes32 channelId)` / `getChannelBalance(bytes32 channelId)`                                                                                                    | The canonical snapshot; the channel's balance/head accounting.                        |
| `getP2pTime() / getAgreementTime() / getChainFallbackTime() / getEvidenceTime() / getGasLimit() / getAllTimes()`                                                                  | Timing and execution config (§3).                                                     |
| `getBlockCallDataCommitment(bytes32 channelId, bytes32 forkId, uint256 blockHeight, address participant)`                                                                         | `(bool found, bytes32 commitment)`.                                                   |
| `hasInboundMessageBlock(bytes32 channelId, bytes32 messageBlockHash)`                                                                                                             | Whether the inbound block is persisted.                                               |
| `isBlockAuthentic(SignedBlock memory)`                                                                                                                                            | Block decodes and its signature recovers to the declared author.                      |
| `isForkDisputed(bytes32 channelId, bytes32 forkId)`                                                                                                                               | Whether a dispute window exists for the fork.                                         |
| `isGenesisSnapshotWithoutTimeCheck(StateSnapshot memory)`                                                                                                                         | `forkId == keccak256(abi.encode(snapshotData)) && blockHeight == 0`.                  |
| `isSnapshotNewer(StateSnapshot memory, StateSnapshot memory)`                                                                                                                     | Height comparison with a genesis-replacement special case.                            |
| `getWindowCommitments(bytes32, bytes32)` / `getDisputeWindowCreationTimestamp(bytes32, bytes32)` / `getReducedResult(bytes32, bytes32)` / `getDisputeWindows(bytes32, bytes32[])` | Dispute-window observation.                                                           |
| `isKillPeriodExpired(bytes32, bytes32)`                                                                                                                                           | `(bool windowExists, bool isExpired, uint256 killPeriodEnd, uint256 blockTimestamp)`. |
| `isReduceChallengePeriodExpired(bytes32, bytes32)`                                                                                                                                | Whether the reduction challenge period has passed.                                    |

`isGenesisSnapshotWithoutTimeCheck` and `isSnapshotNewer` are `pure`, so the storage context does
not matter for them; they are routed like the rest and are also `public` on the deployed facet
(§4.8).

The remaining `StateChannelCommon` accessors (genesis-timestamp derivation, state-machine
participant lookup, inbound/outbound chain application) are `internal` and have **no** diamond
surface; they are reachable only from within a facet's own code.

### 2.5 Diamond-internal (`onlySelf`)

All three are declared on the proxy and callable only via its self-CALL, which facets make as
`StateChannelManagerInterface(address(this)).fn(...)`
([architecture.md §2](./architecture.md#2-current-topology)):

| Function                                                                                                                                                          | Semantics                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `depositAssetsComposable(JoinChannel[] memory, bool isAtomic) returns (MessageBlock, Balance newTotalDeposits, JoinChannel[] successfulJoins)`                    | Delegates each join to `AConsumerFacet.deposit`; `isAtomic` makes any failure revert (`ErrorJoinChannelAtomicFailure`), otherwise failed joins are filtered out (≥ 1 must succeed). Builds and persists the inbound `JOIN` message block, advancing `channelBalances` heads and `totalDeposits`; emits `InboundMessagesProcessed`. |
| `withdrawAssetsComposable(ExitChannel memory) returns (bool)`                                                                                                     | Delegates to `AConsumerFacet.withdraw`.                                                                                                                                                                                                                                                                                            |
| `executeStateTransition(bytes32 channelId, bytes memory encodedState, Transaction memory) returns (bool, bytes encodedModifiedState, Message[] outboundMessages)` | `setState` on the machine, then `stateTransition`; returns success flag, resulting state, and outbound messages. Used by fraud-proof re-execution.                                                                                                                                                                                 |

## 3. Timing & execution configuration

Constructor parameters; a `0` argument selects the default. Values are seconds
(`gasLimit` is gas). Held as `internal` storage on
[`StateChannelManagerStorage`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol#L9)
and read externally through the routed views in §2.4.

| Parameter                                | Default (verified constant) | Role (thin — see protocol docs)                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p2pTime`                                | 15                          | Per-block p2p production window; timestamp-validity bound (`InvalidTimestamp` fraud proof).                                                                                                                                                                                                                                   |
| `agreementTime`                          | 5                           | Signature-collection window on top of `p2pTime`.                                                                                                                                                                                                                                                                              |
| `chainFallbackTime`                      | 30                          | Extra time to reach the chain before a timeout becomes valid. Timeout deadline is `previous + [evidenceTime if first block] + p2pTime + agreementTime + chainFallbackTime` (`DisputeFraudProofFacet._timeoutDeadline`).                                                                                                       |
| `evidenceTime`                           | 30                          | Length of the dispute evidence window, the kill period (measured from the last evidence submission), and the reduction challenge period; also the first-block grace term. [../protocol/disputes.md](../../../../specification/disputes/disputes.md), [../protocol/time.md](../../../../specification/protocol-model/time.md). |
| `gasLimit` (`_disputeExecutionGasLimit`) | 3,000,000                   | Gas bound for on-chain transition re-execution — MUST match the state machine's own `gasLimit` ([state-machine-base.md §1](./state-machine-base.md#1-purpose--observable-contract)).                                                                                                                                          |

## 4. Facet reference

Every facet extends
[`StateChannelCommon`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L13)
(shared storage + helpers: slash-set maintenance, pending-participant derivation, inbound/outbound
chain verification and application, snapshot/block linkage predicates, dispute-window commitment
helpers). Its members are all `internal`, so each facet compiles in only the bodies it calls
([architecture.md §3](./architecture.md#3-deployment-size-constraint)). Pure helpers live as free
functions in [utils/](../../../../../../contracts/V1/StateChannelDiamondProxy/utils)
(`GeneralUtils` — `_delegatecall`, array shrinking; `BlockUtils` — block field accessors;
`DisputeUtils` — dispute/window accessors, period predicates, `_hasDisputeReason`,
`_hasStateProofHeaderMismatch`).

`StateChannelCommon` reaches the utility facet's stateless helpers through
[`UtilityFacetInterface`](../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol#L10)
([report](../../../source/contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol.md)), an
abstract declaration of the seven helpers it calls. It exists to break a definition cycle:
`UtilityFacet is StateChannelCommon` (§4.8) while `StateChannelCommon` needs a type for
`utilityFacetAddress`. `UtilityFacet` implements it with `override`, so the compiler keeps the
declaration and the implementation in sync.

### 4.1 `JoinChannelFacet`

[Source](../../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L1).
`joinChannel` / `topUpBalance` share `_processJoinChannel(…, isTopUp)`:

- `msg.sender` must be the joining participant (`ErrorJoinChannelInvalidSubmitter`); the join must
  not be expired (`RaceConditionJoinChannelExpired`); the caller's `expectedForkId` and
  `expectedSnapshotHash` must match the current on-chain snapshot
  (`RaceConditionSnapshotForkMismatch`, `RaceConditionJoinChannelSnapshotMismatch`) — the submitter
  states which channel state it is comfortable joining.
- Membership split: `joinChannel` requires the participant is **not** already in
  snapshot ∪ pending (`ErrorJoinChannelParticipantAlreadyExists`) and that the fork is not under
  dispute (`RaceConditionForceInboundJoinForkDisputed`); `topUpBalance` requires it **is**
  (`ErrorTopUpBalanceParticipantNotFound`).
- Verifies the participant's own signature and the unanimous threshold of snapshot ∪ pending
  participants over `encodedJoinChannel`, then deposits atomically via `depositAssetsComposable`.
- Effect on-chain is an appended inbound `JOIN` message block; the channel applies it off-chain via
  the inbound stream ([../protocol/cross-layer-messages.md](../../../../specification/settlement/cross-layer-messages.md)),
  landing in the state machine's `_joinChannel`
  ([state-machine-base.md §2.3](./state-machine-base.md#23-_joinchannel-handles-both-admission-and-top-up)).

### 4.2 `StateSnapshotFacet`

[Source](../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L1). Advances the
canonical on-chain snapshot; both paths prune already-processed outbound blocks, verify the
outbound chain between old and new snapshot (`_verifyOutboundMessageBlocks`), process each
outbound message (`EXIT` → consumer `withdraw`; unknown types revert
`ErrorOutboundMessageTypeUnsupported`), and enforce `withdrawals ≤ deposits`
(`CantWithdrawMoreThanDeposits`). Emits `StateSnapshotUpdated`, `OutboundMessagesProcessed`,
`WithdrawalsUpdated`.

- `updateStateSnapshotFork(channelId, newStateSnapshot, outboundMessageBlocks)` — adopt a
  **successor fork** after dispute reduction: the new snapshot must be a genesis snapshot of its
  fork with the fork's derived genesis timestamp, reachable from the current fork by following
  expired reduced results (`disputeWindow.reducedResult` chain). No-op if already on the fork.
- `updateStateSnapshotSameFork(channelId, milestoneProofs, milestoneSnapshots, outboundMessageBlocks)` —
  advance **within the fork** by milestone finality proof: same fork required, snapshot must be
  newer, milestones verified via `verifyMilestones`, and the new snapshot must consume all pending
  inbound blocks (`RaceConditionPendingInboundNotConsumed`).
- Housekeeping: a channel reaching 0 participants is closed and its storage cleared (with a
  `TODO` in source: remaining funds to a treasury — unresolved); undisputed same-fork updates also
  clear old dispute data and consumed inbound blocks (`ChannelStorageCleared`).

### 4.3 `StateProofFacet`

[Source](../../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L1). Verifies that a
claimed latest state is proven within a fork
([../protocol/state-proofs.md](../../../../specification/disputes/state-proofs.md)): `verifyStateProof` (full check
against `DisputeAuditingData`), `isCorrectLatestState`, `areSignedBlocksLinkedAndVerified`
(hash-linkage + author signatures on the non-final suffix), `verifyMilestones` /
`isMilestoneFinal` (milestone finality with membership-union threshold sets, including skipped
milestones below the on-chain snapshot), and per-block structure checks
(`isInvalidBlockStructureInStateProof`, `findFirstInvalidBlockStructureInStateProof`).
Observed fact: a state proof may carry milestones **or** trailing signed blocks, but the current
checks reject a proof carrying both (`milestones.length != 0 && signedBlocks.length != 0` fails in
both `isCorrectLatestState` and `verifyStateProof`) — the non-final suffix rides inside the last
milestone's confirmations on this path. Contains live `hardhat/console.sol` logging
([architecture.md §3](./architecture.md#3-deployment-size-constraint)).

### 4.4 `DisputeManagerFacet`

[Source](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L1). Opens and
extends dispute windows. `uploadDispute` (no calldata; `postedAuditingData` must be false) and
`uploadDisputeWithCalldata` (auditing data must hash to `disputeAuditingDataHash`) share
`_uploadDispute`:

- `msg.sender` must be the disputer and eligible (`ErrorDisputerNotMsgSender`,
  `ErrorCantParticipateInDispute`).
- Timeout race-condition checks (`_disputeRaceConditionCheck`): posted calldata defeats a
  non-forced timeout; previous-producer calldata expectation must match; `minTimeStamp` and
  window-creation-time bounds.
- Per-address dispute throttle: one window-opening upload per `evidenceTime` per channel
  (`ErrorDisputeThrottled`, `disputerThrottle`).
- Window bookkeeping: creates the `DisputeWindow` on first upload; later uploads require the
  evidence period not expired (or an empty commitment list) and one post per participant
  (`ErrorDisputeAlreadyPosted`); every upload records the dispute commitment
  (`keccak256(abi.encode(dispute))`) and refreshes the kill period.
- Full-threshold confirmations (`_isDisputeThresholdFinal` over the on-chain threshold set)
  finalize immediately: periods are back-dated by `evidenceTime`, prior commitments dropped, and
  the dispute's `outputSnapshotDataHash` committed as the reduced result.
- Emits `DisputeCommitted` / `DisputeCommittedWithAuditingData`.

### 4.5 `DisputeVerificationFacet`

[Source](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L1). The
reduction engine ([../protocol/disputes.md](../../../../specification/disputes/disputes.md)): `reduce` (deterministic,
order-independent fold of the committed disputes: latest block by height with hash tie-break,
slash-set union filtered to snapshot ∪ pending, lowest-height timeout, self-removals,
inbound tip as of window expiry), `reduceOutputToSnapshotData` (verifies linkage of the supplied
latest snapshot/state/inbound blocks, applies slashes > timeout precedence, produces the successor
`SnapshotData` + modified state + outbound block), `reduceAndFinalize` (commit with
`expectedReducedForkId` idempotence), `challengeDisputeReduction` (recompute; wrong stored result →
slash the reducer and replace it; correct stored result → slash the challenger),
`killDispute` (remove a committed dispute during the kill period and slash its disputer),
`computeDisputeOutputSnapshotData` / `computeDisputeOutputState` / `generateDisputeOutputState`
(output-state construction helpers, also used by honest provers), `isDisputeOutputCorrect`, and
`verifyBalanceInvariantCheckSnapshot` (the aggregate `totalDeposits == totalWithdrawals +
getTotalStateBalance()` check protecting late joiners —
[../protocol/cross-layer-messages.md](../../../../specification/settlement/cross-layer-messages.md)). Contains live
`console.log` calls. At 19,945 deployed bytes it is the second-largest production deployable
([architecture.md §3](./architecture.md#3-deployment-size-constraint)). Six of its functions are
deliberately unrouted (§2.0).

### 4.6 `FraudProofFacet`

[Source](../../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L1). Block-level fraud
([../protocol/fraud-proofs.md](../../../../specification/disputes/fraud-proofs.md)). `applyFraudProofs(proofs, context)`:
for each not-yet-slashed target, `runFraudProof` dispatches on `FraudProofType`
(`BlockDoubleSign`, `BlockInvalidStateTransition` — full re-execution via
`executeStateTransition` including outbound/inbound message-block recomputation, `WrongGenesis`,
`InvalidTimestamp` — with calldata-commitment and forfeit-of-extra-time rules, and
`ForgedInboundMessageBlock`). A proof that fails, or whose proven offender differs from the
declared `participant`, slashes the **submitter** instead (`msg.sender`), if eligible. Successful
slashes enter the on-chain slash set (`addOnChainSlashedParticipant`, `ChainSlashed`) consumed by
later reductions.

### 4.7 `DisputeFraudProofFacet`

[Source](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L1). Proves a
_dispute_ fraudulent during its kill period. `applyDisputeFraudProofs(proofs)`: skips
uncommitted (already-killed) disputes, requires the kill period open, dispatches on
`DisputeFraudProofType` (17 types across dispute-content and timeout families —
[DisputeFraudProofTypes.sol](../../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L3) /
[ProofTypes.sol](../../../../../../contracts/V1/types/ProofTypes.sol#L3)). A valid proof kills the dispute
and slashes its disputer (`killDispute` → `DisputeKilled`); an invalid proof slashes the submitter.
Also exposes `validateTimeoutCalldataPostedProof` and the helper predicates routed to it (§2.2).
At 22,716 deployed bytes it is the largest deployable and the one closest to the EIP-170 ceiling —
1,860 bytes of headroom ([architecture.md §3](./architecture.md#3-deployment-size-constraint)).

### 4.8 `UtilityFacet`

[Source](../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L13). One
deployment with two surfaces, which is why it is
`UtilityFacet is UtilityFacetInterface, StateChannelCommon`:

- **Stateless helpers, reached by plain CALL** on the facet deployment by `StateChannelCommon`,
  the facets, and the proxy's `open` (not routed, §2.0):
  `verifyThresholdSigned` (unanimous EIP-191 threshold with per-signer dedup),
  `retrieveSignerAddress`, `decodeBlock` / `tryDecodeBlock`, and the address/bytes/exit-channel
  array operations. They need no storage context, so the facet's own storage is irrelevant to them.
- **Proxy-storage views, reached by delegatecall** through the routing table
  ([#L262 onward](../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L262)):
  the whole of §2.4 plus `verifyOutboundMessageBlocks` / `pruneOutboundMessageBlocks` (§2.3). Each
  is a thin wrapper over a `StateChannelCommon` `internal` accessor or a direct read of
  `disputeData`, so they need the shared layout and read the **proxy's** storage under
  delegatecall. That requirement is what makes the `StateChannelCommon` base necessary.

`isGenesisSnapshotWithoutTimeCheck` and `isSnapshotNewer` are `pure`, so the storage context is
irrelevant to them; both are routed, and `isGenesisSnapshotWithoutTimeCheck` is additionally
declared on `UtilityFacetInterface`. Observed inconsistency in
[`StateChannelCommon._getGenesisTimestamp`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L73):
one branch reaches it through the routed self-call
`StateChannelManagerInterface(address(this))`
([#L85](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L85)) while
another reaches the same `pure` function by plain CALL on the facet
([#L102](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L102)).
The results agree; the routed path just costs an extra CALL plus a delegatecall.

### 4.9 Consumer facet & test-only contracts

The integrator's `AConsumerFacet` is specified in
[state-machine-base.md §7](./state-machine-base.md#7-aconsumerfacet-the-integrator-consumer-contract).
[`LocalDiamond`](../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L20) (proxy
subclass with event-driven storage sync, zero consumer facet) and
[`LibraryTestContract`](../../../../../../contracts/V1/helpers/LibraryTestContract.sol#L4) (delegatecall
forwarder for library tests) are test-support only and MUST NOT be deployed to production.

`LocalDiamond` redeclares
[`isBlockAuthentic`](../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L442) so
local deployments keep its debug
[`_isBlockAuthentic`](../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L446)
override: a declared function dispatches before the fallback, whereas production routes that
selector to `UtilityFacet`.

Because routed selectors are absent from the proxy's own compiled ABI, SDK callers bind both:
[`src/utils/localDiamond.ts`](../../../../../../src/utils/localDiamond.ts)
([report](../../../source/src/utils/localDiamond.ts.md)) exports `LocalDiamondContract`
(`LocalDiamond & StateChannelManagerInterface`), the merged de-duplicated `localDiamondAbi`, and
`connectLocalDiamond(address, runner)`.

`LocalDiamond` is a temporary channel-local, event-fed mirror. Its handlers observe only the
selected channel, so it intentionally does not replicate the deployed manager's global
open-channel enumeration. This keeps channel computation on participant hardware, but event
observation is not proof of completeness. Chain/RPC reads remain authoritative where required;
the planned replacement is a verified light-client RPC, not a globally synchronized local mirror.

## 5. Storage model

[`StateChannelManagerStorage`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol#L7) —
all channel state keyed by `channelId`, minimized to commitments and accounting:

| Storage                      | Shape                                                                                            | Holds                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| config                       | `p2pTime`, `agreementTime`, `chainFallbackTime`, `evidenceTime`, `gasLimit` (`internal uint256`) | §3; read externally only through the routed `getP2pTime()`/… views (§2.4).                        |
| `stateMachineImplementation` | `AStateMachine`                                                                                  | The shared state-machine deployment.                                                              |
| facet addresses              | 9 × `address`                                                                                    | Set in constructor; not replaceable ([architecture.md §2](./architecture.md#2-current-topology)). |
| `channelBalances`            | `channelId → ChannelBalance`                                                                     | Inbound head/height, outbound processed height, `totalDeposits`, `totalWithdrawals`.              |
| `inboundMessageBlockMap`     | `channelId → (blockHash → MessageBlock)`                                                         | Persisted inbound (L1 → L2) message blocks; pruned on storage clear.                              |
| `stateSnapshots`             | `channelId → StateSnapshot`                                                                      | The canonical on-chain snapshot.                                                                  |
| `blockCalldataCommitments`   | `channelId → signer → forkId → blockHeight → bytes32`                                            | `hash(signedBlock, postTimestamp)` commitments from `postBlockCalldata`.                          |
| `disputeData`                | `channelId → DisputeData`                                                                        | On-chain slash list, per-fork `DisputeWindow` map, disputed-fork list.                            |
| `disputerThrottle`           | `channelId → disputer → uint256`                                                                 | Earliest next allowed dispute upload per address (anti-spam).                                     |

## 6. Events

[`StateChannelManagerEvents.sol`](../../../../../../contracts/V1/StateChannelManagerEvents.sol#L6) — the
SDK's chain listener consumes these. All verified:

| Event                                                                                                                                     | Emitted when                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ChannelOpened(bytes32 indexed channelId, StateSnapshot, bytes encodedState)`                                                             | `open` succeeds; carries genesis snapshot + full genesis state.                                                 |
| `StateSnapshotUpdated(bytes32 indexed, StateSnapshot)`                                                                                    | The canonical snapshot advances (either path).                                                                  |
| `BlockCalldataPosted(bytes32 indexed channelId, bytes32 indexed commitmentHash, address sender, SignedBlock, uint256 timestamp)`          | A calldata commitment is stored.                                                                                |
| `DisputeCommitted(bytes32 indexed, DisputeConfirmation, uint256 disputeCreationTimestamp, bool isFinal, uint256 windowCreationTimestamp)` | Dispute uploaded without auditing data.                                                                         |
| `DisputeCommittedWithAuditingData(…, DisputeAuditingData)`                                                                                | Dispute uploaded with auditing calldata.                                                                        |
| `ChainSlashed(bytes32 indexed, address participant, uint256 timestamp)`                                                                   | An address enters the on-chain slash set.                                                                       |
| `DisputeReducedResultCommitted(bytes32 indexed, bytes32 forkId, bytes32 reducedForkId, uint256 reductionTimestamp, address reducer)`      | A window's reduced result is committed (or replaced after a successful challenge).                              |
| `DisputeKilled(bytes32 indexed, bytes32 forkId, address disputer, bytes32 disputeHash)`                                                   | A committed dispute is proven fraudulent and removed.                                                           |
| `InboundMessagesProcessed(bytes32 indexed, MessageBlock)`                                                                                 | An inbound message block is appended (open/join/top-up).                                                        |
| `OutboundMessagesProcessed(bytes32 indexed, MessageBlock, uint256 timestamp, Balance totalWithdrawals)`                                   | An outbound block is processed during a snapshot update. Source carries a `TODO - this event is not used` note. |
| `WithdrawalsUpdated(bytes32 indexed, Balance totalWithdrawals)`                                                                           | Total withdrawals advance after outbound processing.                                                            |
| `ChannelStorageCleared(bytes32 indexed, bytes32 latestInboundMessageBlockHash)`                                                           | Per-channel dispute/inbound storage is pruned.                                                                  |

## 7. Errors

[`Errors.sol`](../../../../../../contracts/V1/StateChannelDiamondProxy/Errors.sol#L1) — custom errors in two
families:

- **Validation errors (`Error*`)** — the submitted argument is invalid regardless of timing: bad
  or missing signatures (`ErrorJoinChannelInvalidSignature`), malformed channel/join data
  (`ErrorInvalidChannelId`, `ErrorInvalidJoinChannel`, `ErrorDuplicateParticipant`,
  `ErrorAtLeastTwoParticipantsRequired`), snapshot/proof failures (`ErrorInvalidStateProof`,
  `ErrorInvalidStateSnapshot`, `ErrorInvalidLatestState`,
  `ErrorDisputeInboundMessageBlocksInvalid` — which carries the compared hashes, break index, and
  an `INBOUND_FAILURE_*` reason code), value-conservation (`CantWithdrawMoreThanDeposits`,
  `ErrorWithdrawalFailed`, `ErrorOutboundMessageBalanceMismatch`), fraud-proof rejections
  (`ErrorInvalidFraudProof`, `ErrorInvalidFraudProofType`, `ErrorDoubleSignBlocksNotSame`), and
  state-machine hook failures during re-execution (`ErrorDisputeStateMachineJoiningFailed`,
  `…SlashingFailed`, `…RemovingFailed`, `…InboundProcessingFailed`).
- **Race-condition guards (`RaceCondition*`)** — a state- or time-dependent precondition failed
  because of ordering between competing on-chain actions: `RaceConditionChannelAlreadyOpen`,
  `RaceConditionBlockCalldataTimestampTooLate`, `RaceConditionSnapshotForkMismatch`,
  `RaceConditionJoinChannelExpired` / `…JoinChannelSnapshotMismatch` /
  `…ForceInboundJoinForkDisputed` / `…PendingInboundNotConsumed`, the dispute-window family
  (`…DisputeEvidencePeriodExpired`, `…DisputeKillPeriodNotExpired`, `…DisputeKillPeriodExpired`,
  `…DisputeAlreadyReduced`, `…ReductionExpectationDoesntMatch`, `…DisputeAuditingRequired`), the
  timeout family (`…DisputeTimeoutCalldataPosted`,
  `…DisputeTimeoutPreviousBlockProducerPostedCalldataMismatch`, `…DisputeTimeoutNotMinTimestamp`,
  `…DisputeTimeoutWindowCreatedTooEarly`, `…UnexpectedBlockCalldataPosted`),
  `…GenesisTimestampNotAvailable`, `…OnChainSlashes`, and `…BlockHeightTooOld`. These are the
  guards that make the optimistic, time-boxed protocol safe under concurrent submissions.

Notes, verified in source: `ErrorDisputeThrottled` sits in the race-condition block despite its
`Error*` name (naming inconsistency to clean up); the `INBOUND_FAILURE_*` codes are deliberate
`uint8` constants rather than an enum because `scripts/generate-enums.ts` numbers generated TS
enums by discovery order and a new enum would renumber `FraudProofType` /
`DisputeFraudProofType`.

## 8. Verification

Concrete test evidence is owned by the downstream verification layer. This section defines implementation-specific obligations only.

### Implementation test plan

These are concrete component-level tests required by the implementation obligations in this document. Exercise public boundaries with real domain values and collaborators. Every listed permutation is required unless an engineer records why it is not applicable.

| Plan item                                               | Requirement / invariant                           | Setup and stimulus                                                                                                      | Expected result                                                                                                                                                                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-con-11-vdgjya.t1"></a>`REQ-CON-11-VDGJYA.T1` | <a id="req-con-11-vdgjya"></a>`REQ-CON-11-VDGJYA` | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | `open` MUST reject duplicate participants and already-open channels, verify a unanimous threshold signature over `encodedOpenChannel`, and require ≥ 2 successful deposits before storing the genesis snapshot.                          | <a id="req-con-11-vdgjya.t1.p1"></a>`REQ-CON-11-VDGJYA.T1.P1` — valid case<br><a id="req-con-11-vdgjya.t1.p2"></a>`REQ-CON-11-VDGJYA.T1.P2` — matching commitment<br><a id="req-con-11-vdgjya.t1.p3"></a>`REQ-CON-11-VDGJYA.T1.P3` — correct identity/signature<br><a id="req-con-11-vdgjya.t1.p4"></a>`REQ-CON-11-VDGJYA.T1.P4` — zero value<br><a id="req-con-11-vdgjya.t1.p5"></a>`REQ-CON-11-VDGJYA.T1.P5` — duplicate delivery<br><a id="req-con-11-vdgjya.t1.p6"></a>`REQ-CON-11-VDGJYA.T1.P6` — malformed input<br><a id="req-con-11-vdgjya.t1.p7"></a>`REQ-CON-11-VDGJYA.T1.P7` — direct invalid/opposite case<br><a id="req-con-11-vdgjya.t1.p8"></a>`REQ-CON-11-VDGJYA.T1.P8` — mismatched commitment<br><a id="req-con-11-vdgjya.t1.p9"></a>`REQ-CON-11-VDGJYA.T1.P9` — predecessor linkage<br><a id="req-con-11-vdgjya.t1.p10"></a>`REQ-CON-11-VDGJYA.T1.P10` — genesis linkage<br><a id="req-con-11-vdgjya.t1.p11"></a>`REQ-CON-11-VDGJYA.T1.P11` — stale fork<br><a id="req-con-11-vdgjya.t1.p12"></a>`REQ-CON-11-VDGJYA.T1.P12` — foreign fork<br><a id="req-con-11-vdgjya.t1.p13"></a>`REQ-CON-11-VDGJYA.T1.P13` — wrong identity/signature<br><a id="req-con-11-vdgjya.t1.p14"></a>`REQ-CON-11-VDGJYA.T1.P14` — missing identity/signature<br><a id="req-con-11-vdgjya.t1.p15"></a>`REQ-CON-11-VDGJYA.T1.P15` — duplicate identity/signature<br><a id="req-con-11-vdgjya.t1.p16"></a>`REQ-CON-11-VDGJYA.T1.P16` — forged identity/signature<br><a id="req-con-11-vdgjya.t1.p17"></a>`REQ-CON-11-VDGJYA.T1.P17` — membership boundary<br><a id="req-con-11-vdgjya.t1.p18"></a>`REQ-CON-11-VDGJYA.T1.P18` — exact balance/boundary<br><a id="req-con-11-vdgjya.t1.p19"></a>`REQ-CON-11-VDGJYA.T1.P19` — one beyond the boundary<br><a id="req-con-11-vdgjya.t1.p20"></a>`REQ-CON-11-VDGJYA.T1.P20` — maximum value<br><a id="req-con-11-vdgjya.t1.p21"></a>`REQ-CON-11-VDGJYA.T1.P21` — value conservation<br><a id="req-con-11-vdgjya.t1.p22"></a>`REQ-CON-11-VDGJYA.T1.P22` — replay delivery<br><a id="req-con-11-vdgjya.t1.p23"></a>`REQ-CON-11-VDGJYA.T1.P23` — concurrent delivery<br><a id="req-con-11-vdgjya.t1.p24"></a>`REQ-CON-11-VDGJYA.T1.P24` — adversarial input<br><a id="req-con-11-vdgjya.t1.p25"></a>`REQ-CON-11-VDGJYA.T1.P25` — partial failure<br><a id="req-con-11-vdgjya.t1.p26"></a>`REQ-CON-11-VDGJYA.T1.P26` — retry and recovery                                                                                             |
| <a id="inv-con-12-mxrtgg.t1"></a>`INV-CON-12-MXRTGG.T1` | <a id="inv-con-12-mxrtgg"></a>`INV-CON-12-MXRTGG` | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Processed withdrawals never exceed resolved deposits for a channel: every outbound message application re-checks `totalWithdrawals ≤ totalDeposits` (`CantWithdrawMoreThanDeposits`).                                                    | <a id="inv-con-12-mxrtgg.t1.p1"></a>`INV-CON-12-MXRTGG.T1.P1` — valid case<br><a id="inv-con-12-mxrtgg.t1.p2"></a>`INV-CON-12-MXRTGG.T1.P2` — zero value<br><a id="inv-con-12-mxrtgg.t1.p3"></a>`INV-CON-12-MXRTGG.T1.P3` — direct invalid/opposite case<br><a id="inv-con-12-mxrtgg.t1.p4"></a>`INV-CON-12-MXRTGG.T1.P4` — exact balance/boundary<br><a id="inv-con-12-mxrtgg.t1.p5"></a>`INV-CON-12-MXRTGG.T1.P5` — one beyond the boundary<br><a id="inv-con-12-mxrtgg.t1.p6"></a>`INV-CON-12-MXRTGG.T1.P6` — maximum value<br><a id="inv-con-12-mxrtgg.t1.p7"></a>`INV-CON-12-MXRTGG.T1.P7` — value conservation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| <a id="req-con-13-c7acx2.t1"></a>`REQ-CON-13-C7ACX2.T1` | <a id="req-con-13-c7acx2"></a>`REQ-CON-13-C7ACX2` | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Block-calldata commitments are append-only and author-bound: no overwrite, `msg.sender` must be the block's author, and posting must beat `maxTimestamp`.                                                                                | <a id="req-con-13-c7acx2.t1.p1"></a>`REQ-CON-13-C7ACX2.T1.P1` — valid case<br><a id="req-con-13-c7acx2.t1.p2"></a>`REQ-CON-13-C7ACX2.T1.P2` — matching commitment<br><a id="req-con-13-c7acx2.t1.p3"></a>`REQ-CON-13-C7ACX2.T1.P3` — correct identity/signature<br><a id="req-con-13-c7acx2.t1.p4"></a>`REQ-CON-13-C7ACX2.T1.P4` — before deadline<br><a id="req-con-13-c7acx2.t1.p5"></a>`REQ-CON-13-C7ACX2.T1.P5` — direct invalid/opposite case<br><a id="req-con-13-c7acx2.t1.p6"></a>`REQ-CON-13-C7ACX2.T1.P6` — mismatched commitment<br><a id="req-con-13-c7acx2.t1.p7"></a>`REQ-CON-13-C7ACX2.T1.P7` — predecessor linkage<br><a id="req-con-13-c7acx2.t1.p8"></a>`REQ-CON-13-C7ACX2.T1.P8` — genesis linkage<br><a id="req-con-13-c7acx2.t1.p9"></a>`REQ-CON-13-C7ACX2.T1.P9` — stale fork<br><a id="req-con-13-c7acx2.t1.p10"></a>`REQ-CON-13-C7ACX2.T1.P10` — foreign fork<br><a id="req-con-13-c7acx2.t1.p11"></a>`REQ-CON-13-C7ACX2.T1.P11` — wrong identity/signature<br><a id="req-con-13-c7acx2.t1.p12"></a>`REQ-CON-13-C7ACX2.T1.P12` — missing identity/signature<br><a id="req-con-13-c7acx2.t1.p13"></a>`REQ-CON-13-C7ACX2.T1.P13` — duplicate identity/signature<br><a id="req-con-13-c7acx2.t1.p14"></a>`REQ-CON-13-C7ACX2.T1.P14` — forged identity/signature<br><a id="req-con-13-c7acx2.t1.p15"></a>`REQ-CON-13-C7ACX2.T1.P15` — membership boundary<br><a id="req-con-13-c7acx2.t1.p16"></a>`REQ-CON-13-C7ACX2.T1.P16` — at deadline<br><a id="req-con-13-c7acx2.t1.p17"></a>`REQ-CON-13-C7ACX2.T1.P17` — after deadline<br><a id="req-con-13-c7acx2.t1.p18"></a>`REQ-CON-13-C7ACX2.T1.P18` — maximum honest skew                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| <a id="req-con-14-mbv0sv.t1"></a>`REQ-CON-14-MBV0SV.T1` | <a id="req-con-14-mbv0sv"></a>`REQ-CON-14-MBV0SV` | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Dispute uploads are participant-gated and throttled: disputer == `msg.sender`, disputer eligible (snapshot ∪ pending − slashed), one window-opening upload per `evidenceTime` per address, one evidence post per participant per window. | <a id="req-con-14-mbv0sv.t1.p1"></a>`REQ-CON-14-MBV0SV.T1.P1` — valid case<br><a id="req-con-14-mbv0sv.t1.p2"></a>`REQ-CON-14-MBV0SV.T1.P2` — matching commitment<br><a id="req-con-14-mbv0sv.t1.p3"></a>`REQ-CON-14-MBV0SV.T1.P3` — correct identity/signature<br><a id="req-con-14-mbv0sv.t1.p4"></a>`REQ-CON-14-MBV0SV.T1.P4` — before deadline<br><a id="req-con-14-mbv0sv.t1.p5"></a>`REQ-CON-14-MBV0SV.T1.P5` — new participant<br><a id="req-con-14-mbv0sv.t1.p6"></a>`REQ-CON-14-MBV0SV.T1.P6` — malformed input<br><a id="req-con-14-mbv0sv.t1.p7"></a>`REQ-CON-14-MBV0SV.T1.P7` — direct invalid/opposite case<br><a id="req-con-14-mbv0sv.t1.p8"></a>`REQ-CON-14-MBV0SV.T1.P8` — mismatched commitment<br><a id="req-con-14-mbv0sv.t1.p9"></a>`REQ-CON-14-MBV0SV.T1.P9` — predecessor linkage<br><a id="req-con-14-mbv0sv.t1.p10"></a>`REQ-CON-14-MBV0SV.T1.P10` — genesis linkage<br><a id="req-con-14-mbv0sv.t1.p11"></a>`REQ-CON-14-MBV0SV.T1.P11` — stale fork<br><a id="req-con-14-mbv0sv.t1.p12"></a>`REQ-CON-14-MBV0SV.T1.P12` — foreign fork<br><a id="req-con-14-mbv0sv.t1.p13"></a>`REQ-CON-14-MBV0SV.T1.P13` — wrong identity/signature<br><a id="req-con-14-mbv0sv.t1.p14"></a>`REQ-CON-14-MBV0SV.T1.P14` — missing identity/signature<br><a id="req-con-14-mbv0sv.t1.p15"></a>`REQ-CON-14-MBV0SV.T1.P15` — duplicate identity/signature<br><a id="req-con-14-mbv0sv.t1.p16"></a>`REQ-CON-14-MBV0SV.T1.P16` — forged identity/signature<br><a id="req-con-14-mbv0sv.t1.p17"></a>`REQ-CON-14-MBV0SV.T1.P17` — membership boundary<br><a id="req-con-14-mbv0sv.t1.p18"></a>`REQ-CON-14-MBV0SV.T1.P18` — at deadline<br><a id="req-con-14-mbv0sv.t1.p19"></a>`REQ-CON-14-MBV0SV.T1.P19` — after deadline<br><a id="req-con-14-mbv0sv.t1.p20"></a>`REQ-CON-14-MBV0SV.T1.P20` — maximum honest skew<br><a id="req-con-14-mbv0sv.t1.p21"></a>`REQ-CON-14-MBV0SV.T1.P21` — existing participant<br><a id="req-con-14-mbv0sv.t1.p22"></a>`REQ-CON-14-MBV0SV.T1.P22` — removed participant<br><a id="req-con-14-mbv0sv.t1.p23"></a>`REQ-CON-14-MBV0SV.T1.P23` — slashed participant<br><a id="req-con-14-mbv0sv.t1.p24"></a>`REQ-CON-14-MBV0SV.T1.P24` — concurrent membership change<br><a id="req-con-14-mbv0sv.t1.p25"></a>`REQ-CON-14-MBV0SV.T1.P25` — adversarial input<br><a id="req-con-14-mbv0sv.t1.p26"></a>`REQ-CON-14-MBV0SV.T1.P26` — partial failure<br><a id="req-con-14-mbv0sv.t1.p27"></a>`REQ-CON-14-MBV0SV.T1.P27` — retry and recovery |
| <a id="req-con-15-6m91qc.t1"></a>`REQ-CON-15-6M91QC.T1` | <a id="req-con-15-6m91qc"></a>`REQ-CON-15-6M91QC` | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | A committed dispute proven fraudulent during the kill period MUST be killed and its disputer slashed; an invalid dispute-fraud-proof submission slashes the submitter instead.                                                           | <a id="req-con-15-6m91qc.t1.p1"></a>`REQ-CON-15-6M91QC.T1.P1` — valid case<br><a id="req-con-15-6m91qc.t1.p2"></a>`REQ-CON-15-6M91QC.T1.P2` — matching commitment<br><a id="req-con-15-6m91qc.t1.p3"></a>`REQ-CON-15-6M91QC.T1.P3` — before deadline<br><a id="req-con-15-6m91qc.t1.p4"></a>`REQ-CON-15-6M91QC.T1.P4` — new participant<br><a id="req-con-15-6m91qc.t1.p5"></a>`REQ-CON-15-6M91QC.T1.P5` — malformed input<br><a id="req-con-15-6m91qc.t1.p6"></a>`REQ-CON-15-6M91QC.T1.P6` — direct invalid/opposite case<br><a id="req-con-15-6m91qc.t1.p7"></a>`REQ-CON-15-6M91QC.T1.P7` — mismatched commitment<br><a id="req-con-15-6m91qc.t1.p8"></a>`REQ-CON-15-6M91QC.T1.P8` — predecessor linkage<br><a id="req-con-15-6m91qc.t1.p9"></a>`REQ-CON-15-6M91QC.T1.P9` — genesis linkage<br><a id="req-con-15-6m91qc.t1.p10"></a>`REQ-CON-15-6M91QC.T1.P10` — stale fork<br><a id="req-con-15-6m91qc.t1.p11"></a>`REQ-CON-15-6M91QC.T1.P11` — foreign fork<br><a id="req-con-15-6m91qc.t1.p12"></a>`REQ-CON-15-6M91QC.T1.P12` — at deadline<br><a id="req-con-15-6m91qc.t1.p13"></a>`REQ-CON-15-6M91QC.T1.P13` — after deadline<br><a id="req-con-15-6m91qc.t1.p14"></a>`REQ-CON-15-6M91QC.T1.P14` — maximum honest skew<br><a id="req-con-15-6m91qc.t1.p15"></a>`REQ-CON-15-6M91QC.T1.P15` — existing participant<br><a id="req-con-15-6m91qc.t1.p16"></a>`REQ-CON-15-6M91QC.T1.P16` — removed participant<br><a id="req-con-15-6m91qc.t1.p17"></a>`REQ-CON-15-6M91QC.T1.P17` — slashed participant<br><a id="req-con-15-6m91qc.t1.p18"></a>`REQ-CON-15-6M91QC.T1.P18` — concurrent membership change<br><a id="req-con-15-6m91qc.t1.p19"></a>`REQ-CON-15-6M91QC.T1.P19` — adversarial input<br><a id="req-con-15-6m91qc.t1.p20"></a>`REQ-CON-15-6M91QC.T1.P20` — partial failure<br><a id="req-con-15-6m91qc.t1.p21"></a>`REQ-CON-15-6M91QC.T1.P21` — retry and recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Future Work

_Non-normative._

- Keep this document the ABI source of truth as routing becomes replaceable per facet
  ([architecture.md §4](./architecture.md#4-remaining-refactor-direction)).
- Resolve the source `TODO`s surfaced here: treasury destination for funds remaining when a
  channel closes with 0 participants (§4.2); whether `onChainSlashes` may be cleared during
  storage cleanup while windows run in parallel (`_clearDisputeData` comment); the unused
  `OutboundMessagesProcessed` event (§6); gas-limiting `verifyMilestones`/`verifyStateProof`
  against unverifiable oversized proofs (`StateProofFacet` comment).
- Replace the `hasPosted` address array with a participant bitmask (source comment in
  [DisputeTypes.sol](../../../../../../contracts/V1/types/DisputeTypes.sol#L3)).
- Rename `ErrorDisputeThrottled` into one family consistently.
- Per-channel state-machine mapping (today one implementation serves all channels).
- Unit coverage for the gaps in §8.

## Implementation traceability

| Requirement / invariant                                        | Statement                                                                                                                                                                                                                                | Implementation status | Implementation evidence                                                                                                                                                                                                                                                                     | Gap / divergence |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-CON-11-VDGJYA`](manager-and-facets.md#req-con-11-vdgjya) | `open` MUST reject duplicate participants and already-open channels, verify a unanimous threshold signature over `encodedOpenChannel`, and require ≥ 2 successful deposits before storing the genesis snapshot.                          | Covered               | [StateChannelManagerProxy.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L119) (`open`)                                                                                                                                                          | None.            |
| [`INV-CON-12-MXRTGG`](manager-and-facets.md#inv-con-12-mxrtgg) | Processed withdrawals never exceed resolved deposits for a channel: every outbound message application re-checks `totalWithdrawals ≤ totalDeposits` (`CantWithdrawMoreThanDeposits`).                                                    | Covered               | [StateSnapshotFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L127) (`_applyOutboundMessageBlocks`)                                                                                                                                               | None.            |
| [`REQ-CON-13-C7ACX2`](manager-and-facets.md#req-con-13-c7acx2) | Block-calldata commitments are append-only and author-bound: no overwrite, `msg.sender` must be the block's author, and posting must beat `maxTimestamp`.                                                                                | Covered               | [StateChannelManagerProxy.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L92) (`postBlockCalldata`)                                                                                                                                              | None.            |
| [`REQ-CON-14-MBV0SV`](manager-and-facets.md#req-con-14-mbv0sv) | Dispute uploads are participant-gated and throttled: disputer == `msg.sender`, disputer eligible (snapshot ∪ pending − slashed), one window-opening upload per `evidenceTime` per address, one evidence post per participant per window. | Covered               | [DisputeManagerFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L40) (`_uploadDispute`); [StateChannelManagerStorage.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol#L57) (`disputerThrottle`)        | None.            |
| [`REQ-CON-15-6M91QC`](manager-and-facets.md#req-con-15-6m91qc) | A committed dispute proven fraudulent during the kill period MUST be killed and its disputer slashed; an invalid dispute-fraud-proof submission slashes the submitter instead.                                                           | Covered               | [DisputeFraudProofFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L17) (`applyDisputeFraudProofs`); [DisputeVerificationFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L270) (`killDispute`) | None.            |
