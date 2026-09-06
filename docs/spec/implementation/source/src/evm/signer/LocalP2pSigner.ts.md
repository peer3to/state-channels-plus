# LocalP2pSigner.ts — Source Report

> **Source:** [src/evm/signer/LocalP2pSigner.ts](../../../../../../../src/evm/signer/LocalP2pSigner.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

In addition to the existing host-side signing surface, `joinLobby(topic, options)` owns ordinary discovery
and `connectToChannel(channelId, options)` separately owns fixed-target selection, optional opening,
exact-channel synchronization, and optional membership. Both wrappers independently consume the same generic
matcher and direct negotiation outcome. They never call each other and cannot own matching concurrently.
Matcher deadlines and both public cancellation routes end unmatched work only. `connectToChannel` returns a
Boolean at the option-selected sync or receipt-confirmed membership boundary; expected operational failures
return `false`.

The inline signer facade: local key-backed signing plus the join-collection entry (`collectJoinChannelConfirmation` via the service).

## Key design decisions

Lobby input checks delegate to the shared topic/timeout validators, then the application state machine checks positive balance. Validation order and the original messages stay unchanged. See [LocalP2pSigner.ts](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L283).

1. **One facade for signing + protocol collection** so integrators never touch services directly.
2. **Host-owned composition** keeps live profiles, attempts, timers, and retry state out of the runtime port.
3. **`disconnectFromPeers` leaves discovery first, and is therefore async** ([#L392](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L392)).
   Closing connections while the runtime still observes their discovery keys only pauses the peers:
   discovery re-dials them and the caller's disconnect silently undoes itself. The public operation
   therefore awaits `leaveAllDiscoveryKeys` before `disconnectAll`
   ([#L394](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L394), [#L395](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L395)), but only after the lobby's own
   lifecycle owner has torn its session down ([#L392](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L392)). The lobby topic is one of the observed keys, its
   transports are deliberately outside `openConnections`, and its session suspensions lift only in its
   cleanup — so leaving that key from here would strand open lobby transports, unliftable suspensions,
   and a match promise that has no default timeout to end it. Routing through `dispose` keeps
   ownership where it is instead of folding lobby transports into the ordinary set. Returning a promise is the observable
   consequence — a caller that does not await cannot know the leave completed — so the runtime port and
   the client facade await it too. Nothing here bans, suspends, or excludes an identity; a later
   `connectToChannel` ([#L159](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L159)) re-observes its key and peers reconnect normally
   ([`REQ-UPG-7-KQPXRE`](../../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LocalP2pSigner.ts](../../../../../../../src/evm/signer/LocalP2pSigner.ts) | [`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3), [`REQ-TJOIN-6-0HEVYH`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh), [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay), [`INV-TJOIN-1-R3K75D`](../../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-1-r3k75d), [`REQ-TJOIN-2-MFWADG`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-2-mfwadg), [`REQ-UPG-7-KQPXRE`](../../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre) |

[`INV-TJOIN-1-R3K75D`](../../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-1-r3k75d): [connectToChannel](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L160) normalizes and retains one channel ID through matching, negotiation, discovery and membership.

[`REQ-TJOIN-2-MFWADG`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-2-mfwadg): [connectToChannel](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L186) uses the separated matching topic, completes the winning lobby handoff or releases the observed-open loser, then joins the selected raw discovery key.

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Signing confinement per the identity rules.
- The public disconnect operation stops observing every discovery key before closing transports and
  records no penalty against any identity.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Gap / divergence                                             |
| ------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`INV-TJOIN-1-R3K75D`](../../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-1-r3k75d) | Covered               | **Here:** [connectToChannel](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L160) normalizes and retains one channel ID through matching, negotiation, discovery and membership. **Other files:** [StateManager](../../stateManager/StateManager.ts.md) owns the selected channel; [LobbyMatchingService](../../rpc/services/lobbyMatching/LobbyMatchingService.ts.md) owns matching; [SpectateService](../../rpc/services/spectate/SpectateService.ts.md) verifies synchronization.                                                                                                                   | None demonstrated.                                           |
| [`REQ-TJOIN-2-MFWADG`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-2-mfwadg) | Covered               | **Here:** [connectToChannel](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L186) uses the separated matching topic, completes the winning lobby handoff or releases the observed-open loser, then joins the selected raw discovery key. **Other files:** [LobbyMatchingService](../../rpc/services/lobbyMatching/LobbyMatchingService.ts.md) cancels the matching timer on acceptance and owns transport handoff.                                                                                                                                                                                     | None demonstrated.                                           |
| [`REQ-UPG-7-KQPXRE`](../../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre)         | Partial               | **Here:** `disconnectFromPeers` first disposes the lobby session that owns its own topic, transports, and suspensions, then awaits the leave of every remaining observed discovery key before `disconnectAll` ([#L392](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L392)), and `connectToChannel` ([#L159](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L159)) re-observes the channel key afterwards. **Other files:** [P2PManager](../../P2PManager.ts.md) owns the observed-key set; [EventHandler](../../eventHandlers/EventHandler.ts.md) applies the same ordering at channel close. | Neither the set nor the leave primitive is implemented here. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                          | Obligation                   | Public entry and setup                                                                              | Oracle and forbidden effects                                                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-local-p2p-signer-1-q80vpw"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW` | Targeted connect composition | Call the public signer through unopened, matched, opened, synced, pending, and participating states | The signer sequentially delegates each phase and returns the final owner result without retaining an attempt object | <a id="unit-test-local-p2p-signer-1-q80vpw.p1"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P1` — unopened false; <a id="unit-test-local-p2p-signer-1-q80vpw.p2"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P2` — targeted opening; <a id="unit-test-local-p2p-signer-1-q80vpw.p3"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P3` — observer sync; <a id="unit-test-local-p2p-signer-1-q80vpw.p4"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P4` — pending reuse; <a id="unit-test-local-p2p-signer-1-q80vpw.p5"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P5` — participating reuse |

## Related source reports

## Channel ownership and leave contribution

The signer rejects a different selected target before any clear or set, removes the public setter, and gates
connect and membership operations while terminal leave is pending. Its internal leave route delegates to the
state manager service. That route is internal to `P2pInstance.leaveChannel`; calling it directly waits for
settled removal but does not dispose the outer runtime. These boundaries implement [`REQ-TJOIN-6-0HEVYH`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh) and contribute to [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay).

| Requirement / invariant                                                                                             | Implementation status | Evidence                                                                                                                                                                                                        | Gap / divergence |
| ------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-TJOIN-6-0HEVYH`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh) | Covered               | **Here:** normalized different-ID rejection occurs before clear/set and the public setter is absent. **Other files:** the worker protocol and host expose no setter request.                                    | None.            |
| [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) | Covered               | **Here:** leave delegates to the single service operation and channel or membership work is gated while it is active. **Other files:** the leave service owns progress and the instance owns terminal disposal. | None.            |

- [identity.md](../../../../../specification/protocol-model/identity.md), [P2pRuntimeHost](../p2pRuntime/P2pRuntimeHost.ts.md).

## Targeted connect implementation

`connectToChannel` is a sequential composition wrapper. It selects the requested channel, refreshes chain
state, calls the generic matcher and negotiation only for unopened auto-open work, joins the exact raw topic,
and delegates sync and membership to their existing owners. It keeps no active-attempt object, waiter,
normalization copy, or lifecycle engine. `joinLobby` remains a distinct wrapper.

Component obligations use [`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW`](LocalP2pSigner.ts.md#unit-test-local-p2p-signer-1-q80vpw): `.P1` terminal targeted `false` without
implicit rematch, `.P2` fresh explicit same-ID pre-sync retry, plus separate disposed-observer and committed
preservation permutations. See [`REQ-TJOIN-1-5VGR1F`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f)–[`REQ-TJOIN-5-Q795M7`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7).

Shared operation owners: [errorMessage.ts.md](../../utils/errorMessage.ts.md), [bytes32.ts.md](../../utils/bytes32.ts.md), [ADiamondStateMachine.ts.md](../../ADiamondStateMachine.ts.md).
