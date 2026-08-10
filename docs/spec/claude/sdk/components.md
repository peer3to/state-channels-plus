# SDK Components — Observable Contracts

> **Status:** Draft, reverse-engineered baseline. Pending engineer review.
> **Scope:** Concise white-box reference for every SDK component: what it does,
> why it exists, dependencies, guarantees, non-guarantees, and verification.
> Flow-level behavior is specified in
> [block-confirmation-pipeline.md](./block-confirmation-pipeline.md) and
> [dispute-pipeline.md](./dispute-pipeline.md); layering in
> [architecture.md](./architecture.md).

## 1. AgreementManager

[`src/agreementManager/AgreementManager.ts`](../../../../src/agreementManager/AgreementManager.ts)

- **Purpose.** Interpretation layer over `Storage`: turns stored blocks,
  snapshots, and participant-change points into agreement facts and state
  proofs. Exists so that signature/threshold semantics live in one place
  instead of being re-derived by every pipeline.
- **Contract.** `didEveryoneSignBlock(block)` — threshold over the block's
  participant union. `getLatestSignedBlockByParticipant(fork, addr)` — newest
  block carrying the participant's signature (descending walk).
  `getStateProof(fork, height)` / `tryGetStateProof` — milestones per
  participant-set change point plus a latest milestone, else a linked
  `signedBlocks` suffix; never consumes a block above the requested height
  ([../protocol/state-proofs.md](../protocol/state-proofs.md)).
  `getReduceData(fork, reduceOutput)` — resolves a reduction output to its
  snapshot, machine state, and consumed inbound range.
- **Dependencies.** `Storage` only (pure reads); no chain access.
- **Guarantees.** Milestone construction implements virtual voting: threshold
  signers = previous anchor's participants ∪ the lowest block's resulting
  participants; signatures collected across later linked blocks count for the
  anchor. Built milestones are minimal (signatures filtered to the threshold
  set).
- **Non-guarantees.** No validation of the underlying blocks (the pipeline
  validated them before storage); throws on locally missing snapshots/states.
- **Verification.** [test/unit/AgreementManager.test.ts](../../../../test/unit/AgreementManager.test.ts);
  proof shape exercised by the dispute e2e suites.

## 2. P2PManager and the RPC layer

[`src/P2PManager.ts`](../../../../src/P2PManager.ts),
[`src/rpc/`](../../../../src/rpc)

- **Purpose.** Owns peer connectivity and message dispatch: open transports,
  peer profiles/blacklist, RPC framing, request/response correlation,
  broadcast.
- **Contract.** `broadcastRpc` sends to every open connection. `sendRpcRequest`
  resolves with the peer handler's return value; rejects on remote error,
  disconnect, or timeout (default `agreementTime`); only the addressed peer
  (by checksum identity, transport upgrades tolerated) may settle a request —
  a response from anyone else blacklists the responder. `onRpc` rejects
  oversized frames (`MAX_RPC_FRAME_BYTES`) and undecodable/unknown-service
  frames by disconnecting. Blacklisting is by EVM address via
  `ProfileManager`; `shouldSignBlock` and handshake admission consult it.
- **RPC model.** [`MainRpcService`](../../../../src/rpc/MainRpcService.ts) is
  the local dispatch root; `remoteRpc`
  ([`RemoteRpcProxy`](../../../../src/rpc/RemoteRpcProxy.ts)) is the typed
  sending mirror: `remoteRpc.<service>.<method>(...).broadcast() | .send(peer) | .request(peerOrTransport, {timeoutMs})`.
  The full protocol-boundary specification — service/`RpcMethods` split, guards,
  wire contract, failure-outcome classification — is [rpc/README.md](./rpc/README.md),
  with one per-service document beside it (algorithms + Byzantine assessment).
  Integrators extend the root via `customRpcManifest`
  ([`registry.ts`](../../../../src/rpc/registry.ts)); the root's `dispose()`
  is awaited before runtime teardown. Guards (e.g. `HandshakeCompletedGuard`)
  gate services behind an authenticated session.

| Built-in service                                                                                                        | Role                        | Notes                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`InitHandshakeService`](../../../../src/rpc/services/initHandshake/InitHandshakeService.ts)                            | Session authentication      | Challenge/response; responder signs the domain-tagged string `peer3:init-handshake:v1:<challengeHash>` — structurally incapable of colliding with a block signature (closes the pre-auth signing oracle). Failure/timeout → disconnect.                                                                                                                    |
| [`WebRTCSetupService`](../../../../src/rpc/services/WebRTCSetup/WebRTCSetupService.ts)                                  | Transport upgrade to WebRTC | Worker hosts drive it through the main-thread bridge port.                                                                                                                                                                                                                                                                                                 |
| [`StateTransitionService`](../../../../src/rpc/services/stateTransition/StateTransitionService.ts)                      | Block-confirmation gossip   | Sole peer entry into the block pipeline; handshake-guarded.                                                                                                                                                                                                                                                                                                |
| [`JoinChannelService`](../../../../src/rpc/services/joinChannel/JoinChannelService.ts)                                  | Join-signature collection   | Collects the unanimous `JoinChannelConfirmation` ([../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md)).                                                                                                                                                                                                                             |
| [`SpectateService`](../../../../src/rpc/services/spectate/SpectateService.ts)                                           | Proof-backed sync           | Request/response: serve a provable snapshot + suffix for `(channel, fork, height)`; an unprovable request blacklists the requester (mutual-cooperation rule), a failed response blacklists the responder. Also the block pipeline's sync probe.                                                                                                            |
| [`IsForkDisputedService`](../../../../src/rpc/services/isForkDisputedService/IsForkDisputedService.ts)                  | Dispute acknowledgment      | One round per disputed fork; records per-peer acks so building on an acknowledged dead fork is **locally attributable** (an unsigned in-memory observation — allows a local disconnect/blacklist, not a portable fraud proof; see [rpc/is-fork-disputed.md](./rpc/is-fork-disputed.md), [OQ-36](../open-questions.md)); non-acking peers are disconnected. |
| [`OpenChannelNegotiationService`](../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts) | Open-terms negotiation      | Exported for integrator wiring; **not** instantiated by `MainRpcService`.                                                                                                                                                                                                                                                                                  |

- **Non-guarantees.** No delivery ordering across peers, no retry, no gossip
  rate limiting (**Open question:** review §41 — policy undesigned).
- **Verification.** [test/rpc](../../../../test/rpc),
  [E2E-InitHandshake](../../../../test/e2e/E2E-InitHandshake.test.ts),
  [E2E-CustomRpcRequestResponse](../../../../test/e2e/E2E-CustomRpcRequestResponse.test.ts),
  [E2E-IsForkDisputed](../../../../test/e2e/E2E-IsForkDisputed.test.ts),
  [test/unit/SpectateService.test.ts](../../../../test/unit/SpectateService.test.ts),
  [E2E-Spectate](../../../../test/e2e/E2E-Spectate.test.ts).

## 3. Transports

[`src/transport/`](../../../../src/transport) —
[`ATransport`](../../../../src/transport/ATransport.ts) defines `_send` /
`onMessage` / `_close`; the base class handles serialization, disconnect
hooks, and peer-identity comparison (`isSamePeer`, checksum-based, tolerant of
upgrades). `isTrusted` is `false` for every network transport.

| Transport                                                                                                                                       | Selected                         | Contract                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`HolepunchTransport`](../../../../src/transport/HolepunchTransport.ts)                                                                         | Default (`HOLEPUNCH`)            | Hyperswarm socket per peer; discovery via [`Holepunch`](../../../../src/Holepunch.ts) topics (node: lazy swarm; browser: relay via `HOLEPUNCH_RELAYER_URLS`, preferred transport flips to WebRTC). |
| [`WebRTCTransport`](../../../../src/transport/WebRTCTransport.ts)                                                                               | Upgrade via `WebRTCSetupService` | Browser-capable data channel; old transport retired after an `agreementTime` grace (`ProfileManager.updateTransport`).                                                                             |
| [`LoopbackTransport`](../../../../src/transport/LoopbackTransport.ts)                                                                           | Always present                   | Trusted in-process "send to self"; bypasses peer guards; never a tracked peer.                                                                                                                     |
| [`LocalTransport`](../../../../src/transport/LocalTransport.ts) / [`BrowserLocalTransport`](../../../../src/transport/BrowserLocalTransport.ts) | `DEBUG_LOCAL_TRANSPORT`          | WebSocket/relay-hub transports for local and test meshes; report `HOLEPUNCH` as their type.                                                                                                        |

- **Non-guarantees.** No transport-level authentication (identity is
  established by the handshake service), no delivery guarantees.
- **Verification.** [E2E-RuntimeTransportModes](../../../../test/e2e/E2E-RuntimeTransportModes.test.ts);
  WebRTC upgrade paths in the browser suites ([test/browser](../../../../test/browser)).

## 4. Storage

[`src/storage/`](../../../../src/storage) — in-memory, per-domain stores behind
one [`Storage`](../../../../src/storage/Storage.ts) facade; every store is
wrapped in `deepCopyProxy` (callers get copies, not live references).
Cross-domain reads (`getStateSnapshot`, `getParticipantsUnion`,
`getPreviousBlockOrSnapshot`, `getPreviousRelevantTimestamp`) live on the
facade.

| Store                                                                                                                                                                                                                   | Holds                                                                                                    | Notable contract                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`BlockStorage`](../../../../src/storage/BlockStorage.ts)                                                                                                                                                               | Blocks by hash and `(fork, height)`; per-fork max height                                                 | `storeBlock` merges signatures for an equal block, refuses a conflicting body, and skips max-height advance under `justPersist` (imported history never fakes live progress). |
| [`QueueStorage`](../../../../src/storage/QueueStorage.ts)                                                                                                                                                               | Pending block entries                                                                                    | See [block-confirmation-pipeline.md](./block-confirmation-pipeline.md) §4 (attribution, caps, restore merging).                                                               |
| [`StateSnapshotStorage`](../../../../src/storage/StateSnapshotStorage.ts) / [`StateMachineStateStorage`](../../../../src/storage/StateMachineStateStorage.ts)                                                           | Snapshots by hash + genesis-by-fork; encoded states by hash                                              | Content-addressed; the pipeline verifies `hash(state) == snapshot.stateMachineStateHash` before trusting a pair.                                                              |
| [`MessageBlockStorage`](../../../../src/storage/MessageBlockStorage.ts) ×2                                                                                                                                              | Inbound and outbound message-block chains                                                                | `getMessageBlocksInRange(lower, upper]` walks the hash chain; `justPersist` stores without advancing the tip.                                                                 |
| [`BlockCalldataStorage`](../../../../src/storage/BlockCalldataStorage.ts)                                                                                                                                               | Posted calldata (signed block + on-chain timestamp) by `(fork, height, author)`                          | Feeds time validation and timeout logic.                                                                                                                                      |
| [`DisputeStorage`](../../../../src/storage/DisputeStorage.ts) / [`FraudProofStorage`](../../../../src/storage/FraudProofStorage.ts) / [`DisputeFraudProofStorage`](../../../../src/storage/DisputeFraudProofStorage.ts) | Dispute confirmations + `didIDispute`; fraud proofs per participant; one dispute fraud proof per dispute | See [dispute-pipeline.md](./dispute-pipeline.md) §8.                                                                                                                          |
| [`TimeoutStorage`](../../../../src/storage/TimeoutStorage.ts) / [`ForceExitStorage`](../../../../src/storage/ForceExitStorage.ts) / [`ForceJoinStorage`](../../../../src/storage/ForceJoinStorage.ts)                   | Pending timeout per fork; self-removal flag; join-submission height                                      | Dispute-input state.                                                                                                                                                          |
| [`ParticipantSetChangeStorage`](../../../../src/storage/ParticipantSetChangeStorage.ts)                                                                                                                                 | Membership-change heights per fork                                                                       | Drives milestone hops.                                                                                                                                                        |
| [`EventSyncStorage`](../../../../src/storage/EventSyncStorage.ts)                                                                                                                                                       | Latest fully processed chain block per channel                                                           | Watermark for event recovery lower bounds.                                                                                                                                    |

- **Non-guarantees.** No persistence across restart; no pruning (unbounded
  growth over channel lifetime). **Open question:** restart/recovery semantics
  are unspecified — currently a restarted peer must resync as a spectator.
- **Verification.** [test/storage](../../../../test/storage) unit suites.

## 5. Clock

[`src/Clock.ts`](../../../../src/Clock.ts) — process-wide singleton aligned to
chain time (protocol model: [../protocol/time.md](../protocol/time.md)).
`init(provider)` measures the offset between local wall time and the latest
block timestamp, iterating until the offset is within one average block time
(average over ≤10 recent blocks); re-initializes when a new provider arrives.
`getTimeInSeconds()` = local time + adjustment (synchronous, used by every
deadline in both pipelines); `getBlockchainTime()` reads the latest block;
`getAverageOnChainBlockTime()` feeds event-recovery span estimates.
Non-guarantees: no continuous re-sync after init; drift between syncs is
bounded only by the protocol's time tolerances. Verification:
[test/Clock.test.ts](../../../../test/Clock.test.ts).

## 6. Chain observation: StateChannelEventListener, EventSyncService, EventHandler

- [`StateChannelEventListener`](../../../../src/StateChannelEventListener.ts)
  subscribes one provider filter per channel (11 manager event topics filtered
  by channelId) and forwards every log to `EventSyncService`; generation
  counter + dispose barrier prevent stale delivery.
- [`EventSyncService`](../../../../src/stateManager/EventSyncService.ts)
  deduplicates logs by `(address, txHash, logIndex)`, tracks per-chain-block
  completion to publish a processed-block watermark (never past a failed log),
  dispatches to `EventHandler`, and owns targeted recovery: calldata
  commitments (`tryRecoverBlockCalldataAndScheduleValidation`) and missing
  dispute events (`ensureDisputesProcessed`) are re-queried from the chain so
  consumers never act on a window their storage cannot back. A failed log
  handler is fatal for that log: it stays cached rejected and its block never
  completes.
- [`EventHandler`](../../../../src/eventHandlers/EventHandler.ts) is the
  semantic layer: it mirrors every event **in its supported set** into the
  `LocalDiamond` first, then applies SDK effects (genesis install on
  `ChannelOpened`, status transitions and channel close on
  `StateSnapshotUpdated`, block ingest on `BlockCalldataPosted`, the whole
  dispute intake of [dispute-pipeline.md](./dispute-pipeline.md) §3.3/§6,
  inbound-message capture on `InboundMessagesProcessed`). The supported set is
  not the full contract event set: `OutboundMessagesProcessed` is not
  dispatched ([DEF-2](../open-questions.md#implementation-defects-with-a-proposed-direction))
  — `WithdrawalsUpdated` mirrors the aggregate withdrawal balance, but whether
  it is the intended complete substitute (outbound height/history) is an open
  decision. Ordering: the local-EVM mirror is
  gated by `(blockNumber, logIndex)` coordinates; a code TODO notes the TS
  side of `onStateSnapshotUpdated` is not yet coordinate-gated —
  **Open question:** whether out-of-order snapshot events can race the TS
  handler.
- **Verification.** [test/stateManager/EventSyncService.test.ts](../../../../test/stateManager/EventSyncService.test.ts),
  [test/storage/EventSyncStorage.test.ts](../../../../test/storage/EventSyncStorage.test.ts),
  dispute/e2e suites exercise the handlers.

## 7. EventBus

[`src/events/EventBus.ts`](../../../../src/events/EventBus.ts) — the one event
surface in every realm; kinds `p2pEventHooks`, `eventHandler`,
`contractEvents`. Contract: named listeners, kind-wide listeners, and
runtime-owned kind-wide adapters (survive `clear()`); dispatch order
exact-name → kind-wide → the single host-only bridge tap whose failure
propagates to the producer while local listeners stay isolated.
`attachContractEvents` mirrors bus contract events onto any structural ethers
instance; `createBusPublishingHooks` wraps app hooks so every hook call
publishes on the bus first. Details in [architecture.md](./architecture.md) §5.
Verification: [test/unit/EventBus.test.ts](../../../../test/unit/EventBus.test.ts),
[test/stateManager/EventBus.test.ts](../../../../test/stateManager/EventBus.test.ts).

## 8. ProfileManager

[`src/ProfileManager.ts`](../../../../src/ProfileManager.ts) — peer identity
registry mapping transport ↔ profile ↔ EVM address ↔ holepunch address.
Blacklist state lives on the profile (address-keyed, so it survives transport
churn). `updateTransport` performs the WebRTC upgrade: the new transport
carries the identity immediately; the old one is retired after an
`agreementTime` grace so in-flight traffic settles. Non-guarantee: profiles
are per-process only. Verification: covered indirectly by handshake/upgrade
e2e suites; `none — gap` for a dedicated unit suite.

## 9. Models

[`src/models/`](../../../../src/models) — rich wrappers over the on-chain
structs (field-level reference: [../reference/data-types.md](../reference/data-types.md)):

- [`Block`](../../../../src/models/Block.ts): lazy encode/hash, author +
  signer recovery (globally memoized), monotone `expandSignatures` /
  `removeConfirmationSignatures` (author signature is never removable),
  `didEveryoneSign`, `getRelevantTimestamp(nextAuthor)` — block timestamp if
  the next author signed it, else `max(onChainTimestamp, timestamp)`; the
  timestamp base for turn deadlines and forfeiture rules.
- [`StateSnapshot`](../../../../src/models/StateSnapshot.ts): snapshot +
  `snapshotData` hashing (`forkId` of a genesis = hash of its `snapshotData`).
- [`StateProof`](../../../../src/models/StateProof.ts): safe decode
  (`tryFrom`) of proof structs — undecodable peer data becomes `null`, not a
  crash.
- **Verification.** [test/models](../../../../test/models).

## 10. Configuration

[`src/utils/config.ts`](../../../../src/utils/config.ts) — process-lifespan
singleton set by `createConfig` during `p2pSetup`; precedence overrides >
`process.env` > `peer3.config.ts` > defaults. Operationally significant keys:
`PROVIDER_URL` (single chain endpoint; must resolve to WebSocket —
[architecture.md](./architecture.md) §3), `RUN_SDK_IN_THREAD`,
`VM_DEDICATED_THREAD`, `HOLEPUNCH_RELAYER_URLS`,
`LOCAL_DISCOVERY_REGISTRY_URL` + `DEBUG_LOCAL_TRANSPORT` (test meshes),
`SIGNER_RECOVERY_CACHE_MAX`, logging and crash-upload keys. Protocol timing is
**not** configured here — `TimeConfig` is read from the chain
(`getAllTimes`). Full reference:
[../reference/configuration.md](../reference/configuration.md).

## 11. Assumptions & constraints (component-wide)

- Single JS realm per host; components are not thread-safe and rely on the
  `StateManager` mutex plus task scheduling for interleaving control.
- All chain-facing components share the one provider and its trust assumption
  ([../security/trust-model.md](../security/trust-model.md)).
- Full-mesh topology: every participant connects to every other; message cost
  is quadratic, so the design target is small partitions (~≤10 participants;
  review §14).

## Future Work

_Non-normative._

- Persistent storage backend and pruning policy.
- Route `WebRTCSetupService` and local-discovery scans through
  `ProfileManager` (code TODO); unified discovery lifecycle API.
- Continuous clock re-sync and skew telemetry.
- Gossip rate limiting at the P2PManager/transport boundary (review §41).
- Wire `OpenChannelNegotiationService` into the default RPC root or document
  the integrator wiring pattern as the supported path.

## Traceability

| ID        | Statement                                                                                                         | Implementation                                                                                                                                    | Verification evidence                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-SDK-3 | Handshake signatures are domain-tagged and cannot collide with block signatures.                                  | [src/rpc/services/initHandshake/InitHandshakeService.ts](../../../../src/rpc/services/initHandshake/InitHandshakeService.ts) (`HANDSHAKE_DOMAIN`) | [test/e2e/E2E-InitHandshake.test.ts](../../../../test/e2e/E2E-InitHandshake.test.ts), [test/rpc/initHandshake](../../../../test/rpc/initHandshake)                   |
| REQ-SDK-4 | Only the addressed peer may settle an RPC request; oversized/undecodable frames disconnect.                       | [src/P2PManager.ts](../../../../src/P2PManager.ts) (`handleRpcResponse`, `onRpc`)                                                                 | [test/rpc/Rpc.test.ts](../../../../test/rpc/Rpc.test.ts), [test/e2e/E2E-CustomRpcRequestResponse.test.ts](../../../../test/e2e/E2E-CustomRpcRequestResponse.test.ts) |
| INV-SDK-4 | `BlockStorage` never overwrites a stored block with a conflicting body; `justPersist` never advances live height. | [src/storage/BlockStorage.ts](../../../../src/storage/BlockStorage.ts)                                                                            | [test/storage/BlockStorage.test.ts](../../../../test/storage/BlockStorage.test.ts)                                                                                   |
| INV-SDK-5 | The event pipeline's processed-block watermark never advances past an incomplete or failed log.                   | [src/stateManager/EventSyncService.ts](../../../../src/stateManager/EventSyncService.ts) (`publishCompletedBlocks`)                               | [test/stateManager/EventSyncService.test.ts](../../../../test/stateManager/EventSyncService.test.ts)                                                                 |
| INV-SDK-6 | Blacklisting is peer-identity-keyed and survives transport replacement.                                           | [src/ProfileManager.ts](../../../../src/ProfileManager.ts), [src/P2PManager.ts](../../../../src/P2PManager.ts)                                    | [test/e2e/E2E-ByzantineErrorAttribution.test.ts](../../../../test/e2e/E2E-ByzantineErrorAttribution.test.ts); none — gap (no dedicated upgrade-blacklist test)       |
