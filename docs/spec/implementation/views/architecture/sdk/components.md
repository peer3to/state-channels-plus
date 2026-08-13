# SDK Components — Observable Contracts

> **Specification subject:** [specification/architecture/sdk.md](../../../../specification/runtime/sdk.md)

> **Status:** Draft, reverse-engineered baseline. Pending engineer review.
> **Scope:** Concise white-box reference for every SDK component: what it does,
> why it exists, dependencies, guarantees, non-guarantees, and verification.
> Flow-level behavior is specified in
> [block-confirmation-pipeline.md](./block-confirmation-pipeline.md) and
> [dispute-pipeline.md](./dispute-pipeline.md); layering in
> [architecture.md](./architecture.md).

## 1. AgreementManager

[`src/agreementManager/AgreementManager.ts`](../../../../../../src/agreementManager/AgreementManager.ts#L1)

## 2. P2PManager and the RPC layer

[`src/P2PManager.ts`](../../../../../../src/P2PManager.ts#L1),
[`src/rpc/`](../../../../../../src/rpc)

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
- **RPC model.** [`MainRpcService`](../../../../../../src/rpc/MainRpcService.ts#L14) is
  the local dispatch root; `remoteRpc`
  ([`RemoteRpcProxy`](../../../../../../src/rpc/RemoteRpcProxy.ts#L21)) is the typed
  sending mirror: `remoteRpc.<service>.<method>(...).broadcast() | .send(peer) | .request(peerOrTransport, {timeoutMs})`.
  The full protocol-boundary specification — service/`RpcMethods` split, guards,
  wire contract, failure-outcome classification — is [rpc/README.md](./rpc/README.md),
  with one per-service document beside it (algorithms + Byzantine assessment).
  Integrators extend the root via `customRpcManifest`
  ([`registry.ts`](../../../../../../src/rpc/registry.ts#L1)); the root's `dispose()`
  is awaited before runtime teardown. Guards (e.g. `HandshakeCompletedGuard`)
  gate services behind an authenticated session.

| Built-in service                                                                                                                  | Role                        | Notes                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`InitHandshakeService`](../../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts#L29)                            | Session authentication      | Challenge/response; responder signs the domain-tagged string `peer3:init-handshake:v1:<challengeHash>` — structurally incapable of colliding with a block signature (closes the pre-auth signing oracle). Failure/timeout → disconnect.                                                                                                                                                |
| [`WebRTCSetupService`](../../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupService.ts#L17)                                  | Transport upgrade to WebRTC | Worker hosts drive it through the main-thread bridge port.                                                                                                                                                                                                                                                                                                                             |
| [`StateTransitionService`](../../../../../../src/rpc/services/stateTransition/StateTransitionService.ts#L7)                       | Block-confirmation gossip   | Sole peer entry into the block pipeline; handshake-guarded.                                                                                                                                                                                                                                                                                                                            |
| [`JoinChannelService`](../../../../../../src/rpc/services/joinChannel/JoinChannelService.ts#L28)                                  | Join-signature collection   | Collects the unanimous `JoinChannelConfirmation` ([../protocol/cross-layer-messages.md](../../../../specification/settlement/cross-layer-messages.md)).                                                                                                                                                                                                                                |
| [`SpectateService`](../../../../../../src/rpc/services/spectate/SpectateService.ts#L34)                                           | Proof-backed sync           | Request/response: serve a provable snapshot + suffix for `(channel, fork, height)`; an unprovable request blacklists the requester (mutual-cooperation rule), a failed response blacklists the responder. Also the block pipeline's sync probe.                                                                                                                                        |
| [`IsForkDisputedService`](../../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedService.ts#L8)                   | Dispute acknowledgment      | One round per disputed fork; records per-peer acks so building on an acknowledged dead fork is **locally attributable** (an unsigned in-memory observation — allows a local disconnect/blacklist, not a portable fraud proof; see [rpc/is-fork-disputed.md](./rpc/is-fork-disputed.md), [`OQ-36-WEN9T1`](../../../open-questions.md#oq-36-wen9t1)); non-acking peers are disconnected. |
| [`OpenChannelNegotiationService`](../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L44) | Open-terms negotiation      | Exported for integrator wiring; **not** instantiated by `MainRpcService`.                                                                                                                                                                                                                                                                                                              |

## 3. Transports

[`src/transport/`](../../../../../../src/transport) —
[`ATransport`](../../../../../../src/transport/ATransport.ts#L12) defines `_send` /
`onMessage` / `_close`; the base class handles serialization, disconnect
hooks, and peer-identity comparison (`isSamePeer`, checksum-based, tolerant of
upgrades). `isTrusted` is `false` for every network transport.

| Transport                                                                                                                                                          | Selected                         | Contract                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`HolepunchTransport`](../../../../../../src/transport/HolepunchTransport.ts#L6)                                                                                   | Default (`HOLEPUNCH`)            | Hyperswarm socket per peer; discovery via [`Holepunch`](../../../../../../src/Holepunch.ts#L11) topics (node: lazy swarm; browser: relay via `HOLEPUNCH_RELAYER_URLS`, preferred transport flips to WebRTC). |
| [`WebRTCTransport`](../../../../../../src/transport/WebRTCTransport.ts#L7)                                                                                         | Upgrade via `WebRTCSetupService` | Browser-capable data channel; old transport retired after an `agreementTime` grace (`ProfileManager.updateTransport`).                                                                                       |
| [`LoopbackTransport`](../../../../../../src/transport/LoopbackTransport.ts#L13)                                                                                    | Always present                   | Trusted in-process "send to self"; bypasses peer guards; never a tracked peer.                                                                                                                               |
| [`LocalTransport`](../../../../../../src/transport/LocalTransport.ts#L6) / [`BrowserLocalTransport`](../../../../../../src/transport/BrowserLocalTransport.ts#L12) | `DEBUG_LOCAL_TRANSPORT`          | WebSocket/relay-hub transports for local and test meshes; report `HOLEPUNCH` as their type.                                                                                                                  |

## 4. Storage

[`src/storage/`](../../../../../../src/storage) — in-memory, per-domain stores behind
one [`Storage`](../../../../../../src/storage/Storage.ts#L21) facade; every store is
wrapped in `deepCopyProxy` (callers get copies, not live references).
Cross-domain reads (`getStateSnapshot`, `getParticipantsUnion`,
`getPreviousBlockOrSnapshot`, `getPreviousRelevantTimestamp`) live on the
facade.

| Store                                                                                                                                                                                                                                               | Holds                                                                                                    | Notable contract                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`BlockStorage`](../../../../../../src/storage/BlockStorage.ts#L16)                                                                                                                                                                                 | Blocks by hash and `(fork, height)`; per-fork max height                                                 | `storeBlock` merges signatures for an equal block, refuses a conflicting body, and skips max-height advance under `justPersist` (imported history never fakes live progress). |
| [`QueueStorage`](../../../../../../src/storage/QueueStorage.ts#L26)                                                                                                                                                                                 | Pending block entries                                                                                    | See [block-confirmation-pipeline.md](./block-confirmation-pipeline.md) §4 (attribution, caps, restore merging).                                                               |
| [`StateSnapshotStorage`](../../../../../../src/storage/StateSnapshotStorage.ts#L10) / [`StateMachineStateStorage`](../../../../../../src/storage/StateMachineStateStorage.ts#L8)                                                                    | Snapshots by hash + genesis-by-fork; encoded states by hash                                              | Content-addressed; the pipeline verifies `hash(state) == snapshot.stateMachineStateHash` before trusting a pair.                                                              |
| [`MessageBlockStorage`](../../../../../../src/storage/MessageBlockStorage.ts#L16) ×2                                                                                                                                                                | Inbound and outbound message-block chains                                                                | `getMessageBlocksInRange(lower, upper]` walks the hash chain; `justPersist` stores without advancing the tip.                                                                 |
| [`BlockCalldataStorage`](../../../../../../src/storage/BlockCalldataStorage.ts#L6)                                                                                                                                                                  | Posted calldata (signed block + on-chain timestamp) by `(fork, height, author)`                          | Feeds time validation and timeout logic.                                                                                                                                      |
| [`DisputeStorage`](../../../../../../src/storage/DisputeStorage.ts#L15) / [`FraudProofStorage`](../../../../../../src/storage/FraudProofStorage.ts#L5) / [`DisputeFraudProofStorage`](../../../../../../src/storage/DisputeFraudProofStorage.ts#L8) | Dispute confirmations + `didIDispute`; fraud proofs per participant; one dispute fraud proof per dispute | See [dispute-pipeline.md](./dispute-pipeline.md) §8.                                                                                                                          |
| [`TimeoutStorage`](../../../../../../src/storage/TimeoutStorage.ts#L5) / [`ForceExitStorage`](../../../../../../src/storage/ForceExitStorage.ts#L1) / [`ForceJoinStorage`](../../../../../../src/storage/ForceJoinStorage.ts#L3)                    | Pending timeout per fork; self-removal flag; join-submission height                                      | Dispute-input state.                                                                                                                                                          |
| [`ParticipantSetChangeStorage`](../../../../../../src/storage/ParticipantSetChangeStorage.ts#L3)                                                                                                                                                    | Membership-change heights per fork                                                                       | Drives milestone hops.                                                                                                                                                        |
| [`EventSyncStorage`](../../../../../../src/storage/EventSyncStorage.ts#L6)                                                                                                                                                                          | Latest fully processed chain block per channel                                                           | Watermark for event recovery lower bounds.                                                                                                                                    |

## 5. Clock

## 6. Chain observation: StateChannelEventListener, EventSyncService, EventHandler

## 7. EventBus

## 8. ProfileManager

[`src/ProfileManager.ts`](../../../../../../src/ProfileManager.ts#L1) — peer identity
registry mapping transport ↔ profile ↔ EVM address ↔ holepunch address.
Blacklist state lives on the profile (address-keyed, so it survives transport
churn). `updateTransport` performs the WebRTC upgrade: the new transport
carries the identity immediately; the old one is retired after an
`agreementTime` grace so in-flight traffic settles. Non-guarantee: profiles
are per-process only. Verification: covered indirectly by handshake/upgrade
e2e suites; `none — gap` for a dedicated unit suite.

## 9. Models

[`src/models/`](../../../../../../src/models) — rich wrappers over the on-chain
structs (field-level reference: [../reference/data-types.md](../../../../specification/protocol-model/data-types.md)):

## 10. Configuration

[`src/utils/config.ts`](../../../../../../src/utils/config.ts#L1) — process-lifespan
singleton set by `createConfig` during `p2pSetup`; precedence overrides >
`process.env` > `peer3.config.ts` > defaults. Operationally significant keys:
`PROVIDER_URL` (single chain endpoint; must resolve to WebSocket —
[architecture.md](./architecture.md) §3), `RUN_SDK_IN_THREAD`,
`VM_DEDICATED_THREAD`, `HOLEPUNCH_RELAYER_URLS`,
`LOCAL_DISCOVERY_REGISTRY_URL` + `DEBUG_LOCAL_TRANSPORT` (test meshes),
`SIGNER_RECOVERY_CACHE_MAX`, logging and crash-upload keys. Protocol timing is
**not** configured here — `TimeConfig` is read from the chain
(`getAllTimes`). Full reference:
[../reference/configuration.md](../../operations/configuration.md).

## 11. Assumptions & constraints (component-wide)

- Single JS realm per host; components are not thread-safe and rely on the
  `StateManager` mutex plus task scheduling for interleaving control.
- All chain-facing components share the one provider and its trust assumption
  ([../security/trust-model.md](../../../../specification/security/trust-model.md)).
- Full-mesh topology: every participant connects to every other; message cost
  is quadratic, so the design target is small partitions (~≤10 participants;
  [security/trust-model.md](../../../../specification/security/trust-model.md)).

### Implementation test plan

These are concrete component-level tests required by the implementation obligations in this document. Exercise public boundaries with real domain values and collaborators. Every listed permutation is required unless an engineer records why it is not applicable.

| Plan item                                             | Requirement / invariant                         | Setup and stimulus                                                                                                      | Expected result                                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-sdk-3-91xmzr.t1"></a>`REQ-SDK-3-91XMZR.T1` | <a id="req-sdk-3-91xmzr"></a>`REQ-SDK-3-91XMZR` | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Handshake signatures are domain-tagged and cannot collide with block signatures.                                  | <a id="req-sdk-3-91xmzr.t1.p1"></a>`REQ-SDK-3-91XMZR.T1.P1` — valid case<br><a id="req-sdk-3-91xmzr.t1.p2"></a>`REQ-SDK-3-91XMZR.T1.P2` — correct identity/signature<br><a id="req-sdk-3-91xmzr.t1.p3"></a>`REQ-SDK-3-91XMZR.T1.P3` — direct invalid/opposite case<br><a id="req-sdk-3-91xmzr.t1.p4"></a>`REQ-SDK-3-91XMZR.T1.P4` — wrong identity/signature<br><a id="req-sdk-3-91xmzr.t1.p5"></a>`REQ-SDK-3-91XMZR.T1.P5` — missing identity/signature<br><a id="req-sdk-3-91xmzr.t1.p6"></a>`REQ-SDK-3-91XMZR.T1.P6` — duplicate identity/signature<br><a id="req-sdk-3-91xmzr.t1.p7"></a>`REQ-SDK-3-91XMZR.T1.P7` — forged identity/signature<br><a id="req-sdk-3-91xmzr.t1.p8"></a>`REQ-SDK-3-91XMZR.T1.P8` — membership boundary |
| <a id="req-sdk-4-1jdchm.t1"></a>`REQ-SDK-4-1JDCHM.T1` | <a id="req-sdk-4-1jdchm"></a>`REQ-SDK-4-1JDCHM` | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Only the addressed peer may settle an RPC request; oversized/undecodable frames disconnect.                       | <a id="req-sdk-4-1jdchm.t1.p1"></a>`REQ-SDK-4-1JDCHM.T1.P1` — valid case<br><a id="req-sdk-4-1jdchm.t1.p2"></a>`REQ-SDK-4-1JDCHM.T1.P2` — correct identity/signature<br><a id="req-sdk-4-1jdchm.t1.p3"></a>`REQ-SDK-4-1JDCHM.T1.P3` — direct invalid/opposite case<br><a id="req-sdk-4-1jdchm.t1.p4"></a>`REQ-SDK-4-1JDCHM.T1.P4` — wrong identity/signature<br><a id="req-sdk-4-1jdchm.t1.p5"></a>`REQ-SDK-4-1JDCHM.T1.P5` — missing identity/signature<br><a id="req-sdk-4-1jdchm.t1.p6"></a>`REQ-SDK-4-1JDCHM.T1.P6` — duplicate identity/signature<br><a id="req-sdk-4-1jdchm.t1.p7"></a>`REQ-SDK-4-1JDCHM.T1.P7` — forged identity/signature<br><a id="req-sdk-4-1jdchm.t1.p8"></a>`REQ-SDK-4-1JDCHM.T1.P8` — membership boundary |
| <a id="inv-sdk-4-15bvjq.t1"></a>`INV-SDK-4-15BVJQ.T1` | <a id="inv-sdk-4-15bvjq"></a>`INV-SDK-4-15BVJQ` | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | `BlockStorage` never overwrites a stored block with a conflicting body; `justPersist` never advances live height. | <a id="inv-sdk-4-15bvjq.t1.p1"></a>`INV-SDK-4-15BVJQ.T1.P1` — valid case<br><a id="inv-sdk-4-15bvjq.t1.p2"></a>`INV-SDK-4-15BVJQ.T1.P2` — zero/empty/no-op case where meaningful<br><a id="inv-sdk-4-15bvjq.t1.p3"></a>`INV-SDK-4-15BVJQ.T1.P3` — direct invalid/opposite case<br><a id="inv-sdk-4-15bvjq.t1.p4"></a>`INV-SDK-4-15BVJQ.T1.P4` — exact boundary<br><a id="inv-sdk-4-15bvjq.t1.p5"></a>`INV-SDK-4-15BVJQ.T1.P5` — failure/recovery<br><a id="inv-sdk-4-15bvjq.t1.p6"></a>`INV-SDK-4-15BVJQ.T1.P6` — relevant race                                                                                                                                                                                                        |
| <a id="inv-sdk-5-xxzcpz.t1"></a>`INV-SDK-5-XXZCPZ.T1` | <a id="inv-sdk-5-xxzcpz"></a>`INV-SDK-5-XXZCPZ` | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | The event pipeline's processed-block watermark never advances past an incomplete or failed log.                   | <a id="inv-sdk-5-xxzcpz.t1.p1"></a>`INV-SDK-5-XXZCPZ.T1.P1` — valid case<br><a id="inv-sdk-5-xxzcpz.t1.p2"></a>`INV-SDK-5-XXZCPZ.T1.P2` — malformed input<br><a id="inv-sdk-5-xxzcpz.t1.p3"></a>`INV-SDK-5-XXZCPZ.T1.P3` — direct invalid/opposite case<br><a id="inv-sdk-5-xxzcpz.t1.p4"></a>`INV-SDK-5-XXZCPZ.T1.P4` — adversarial input<br><a id="inv-sdk-5-xxzcpz.t1.p5"></a>`INV-SDK-5-XXZCPZ.T1.P5` — partial failure<br><a id="inv-sdk-5-xxzcpz.t1.p6"></a>`INV-SDK-5-XXZCPZ.T1.P6` — retry and recovery                                                                                                                                                                                                                        |
| <a id="inv-sdk-6-ccg31h.t1"></a>`INV-SDK-6-CCG31H.T1` | <a id="inv-sdk-6-ccg31h"></a>`INV-SDK-6-CCG31H` | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Blacklisting is peer-identity-keyed and survives transport replacement.                                           | <a id="inv-sdk-6-ccg31h.t1.p1"></a>`INV-SDK-6-CCG31H.T1.P1` — valid case<br><a id="inv-sdk-6-ccg31h.t1.p2"></a>`INV-SDK-6-CCG31H.T1.P2` — correct identity/signature<br><a id="inv-sdk-6-ccg31h.t1.p3"></a>`INV-SDK-6-CCG31H.T1.P3` — direct invalid/opposite case<br><a id="inv-sdk-6-ccg31h.t1.p4"></a>`INV-SDK-6-CCG31H.T1.P4` — wrong identity/signature<br><a id="inv-sdk-6-ccg31h.t1.p5"></a>`INV-SDK-6-CCG31H.T1.P5` — missing identity/signature<br><a id="inv-sdk-6-ccg31h.t1.p6"></a>`INV-SDK-6-CCG31H.T1.P6` — duplicate identity/signature<br><a id="inv-sdk-6-ccg31h.t1.p7"></a>`INV-SDK-6-CCG31H.T1.P7` — forged identity/signature<br><a id="inv-sdk-6-ccg31h.t1.p8"></a>`INV-SDK-6-CCG31H.T1.P8` — membership boundary |

## Future Work

_Non-normative._

- Persistent storage backend and pruning policy.
- Route `WebRTCSetupService` and local-discovery scans through
  `ProfileManager` (code TODO); unified discovery lifecycle API.
- Continuous clock re-sync and skew telemetry.
- Gossip rate limiting at the P2PManager/transport boundary
  ([`OQ-6-4JPNE5`](../../../../specification/open-questions.md#oq-6-4jpne5)).
- Wire `OpenChannelNegotiationService` into the default RPC root or document
  the integrator wiring pattern as the supported path.

## Implementation traceability

| Requirement / invariant                              | Statement                                                                                                         | Implementation status | Implementation evidence                                                                                                                                    | Gap / divergence |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-SDK-3-91XMZR`](components.md#req-sdk-3-91xmzr) | Handshake signatures are domain-tagged and cannot collide with block signatures.                                  | Covered               | [src/rpc/services/initHandshake/InitHandshakeService.ts](../../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts#L2) (`HANDSHAKE_DOMAIN`) | None.            |
| [`REQ-SDK-4-1JDCHM`](components.md#req-sdk-4-1jdchm) | Only the addressed peer may settle an RPC request; oversized/undecodable frames disconnect.                       | Covered               | [src/P2PManager.ts](../../../../../../src/P2PManager.ts#L1) (`handleRpcResponse`, `onRpc`)                                                                 | None.            |
| [`INV-SDK-4-15BVJQ`](components.md#inv-sdk-4-15bvjq) | `BlockStorage` never overwrites a stored block with a conflicting body; `justPersist` never advances live height. | Covered               | [src/storage/BlockStorage.ts](../../../../../../src/storage/BlockStorage.ts#L1)                                                                            | None.            |
| [`INV-SDK-5-XXZCPZ`](components.md#inv-sdk-5-xxzcpz) | The event pipeline's processed-block watermark never advances past an incomplete or failed log.                   | Covered               | [src/stateManager/EventSyncService.ts](../../../../../../src/stateManager/EventSyncService.ts#L1) (`publishCompletedBlocks`)                               | None.            |
| [`INV-SDK-6-CCG31H`](components.md#inv-sdk-6-ccg31h) | Blacklisting is peer-identity-keyed and survives transport replacement.                                           | Covered               | [src/ProfileManager.ts](../../../../../../src/ProfileManager.ts#L1), [src/P2PManager.ts](../../../../../../src/P2PManager.ts#L1)                           | None.            |
