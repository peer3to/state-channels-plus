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

Lobby input checks delegate to the shared topic/timeout validators, then the application state machine checks positive balance. Validation order and the original messages stay unchanged. See [LocalP2pSigner.ts](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L288).

1. **One facade for signing + protocol collection** so integrators never touch services directly.
2. **One generation captured at entry, re-read before every effect the call can still produce.**
   `connectToChannel` is a long sequential composition and a leave can settle under any of its awaits,
   so it captures `stateManager.channelGeneration` once, immediately after the operation guard ([#L173](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L173)),
   and calls `stateManager.isStaleChannelWork()` at each point where a resumed call would leave a mark.
   Before joining channel discovery ([#L231](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L231)): joining there would subscribe the reused runtime to the topic
   of the channel it left and overwrite the discovery key its next reset has to release — neither is
   undone by the call returning `false` afterwards, and the status check just above it is no substitute,
   because a next channel that is already open clears it. Before `membershipService.topUpBalance` ([#L247](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L247))
   and before `membershipService.joinChannel` ([#L262](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L262)): collecting the join confirmation is a network round
   trip over the peer set, and the collected authorization stays perfectly valid, which is the problem —
   submitting it is an on-chain write that would put the departed signer back into the channel it just
   left, the one consequence of late work that no later local cleanup can undo. The two membership
   checks used to capture their own generation just before the round trip; they now read the entry
   capture, so the whole call is fenced against one leave rather than each step against its own.
   A stale
   round returns `false` rather than submitting. `false` is the existing operational-failure answer of `connectToChannel`,
   so the caller needs no new outcome ([`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)).
3. **Host-owned composition** keeps live profiles, attempts, timers, and retry state out of the runtime port.

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

| Source file                                                                | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LocalP2pSigner.ts](../../../../../../../src/evm/signer/LocalP2pSigner.ts) | [`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3), [`REQ-TJOIN-6-0HEVYH`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh), [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay), [`INV-TJOIN-1-R3K75D`](../../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-1-r3k75d), [`REQ-TJOIN-2-MFWADG`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-2-mfwadg), [`REQ-LIF-10-QR8NQ9`](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) |

[`INV-TJOIN-1-R3K75D` (Exact target ownership)](../../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-1-r3k75d): [connectToChannel](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L160) normalizes and retains one channel ID through matching, negotiation, discovery and membership.

[`REQ-TJOIN-2-MFWADG` (Separated matching and handoff)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-2-mfwadg): [connectToChannel](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L189) uses the separated matching topic, completes the winning lobby handoff or releases the observed-open loser, then joins the selected raw discovery key.

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Signing confinement per the identity rules.

- The single-channel guard is unchanged in behaviour — a runtime holding a nonzero channel id still rejects a different target before any mutation — but its message now names leaving rather than building a new runtime ([#L179](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L179)), because a completed leave is the release that makes the next selection legal ([`REQ-TJOIN-6-0HEVYH` (Single-channel runtime ownership)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh)).
- Neither join path submits for a channel the runtime has left: the generation captured at entry
  ([#L173](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L173)) is re-checked before `membershipService.topUpBalance` ([#L247](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L247)) and before `membershipService.joinChannel` ([#L262](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L262)), and a
  moved generation returns `false` instead, so work begun for the channel left cannot re-establish the
  departed signer's membership of it ([`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)).
- Nor does a resumed selection attach the returned runtime to the channel it left: the same
  captured generation is re-read before `joinChannelDiscovery` ([#L227](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L227)), so a connect that resumes
  after the leave joins no topic and leaves the discovery key its next reset releases alone
  ([`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)).
- `connectToChannel` joins the exact channel topic through `p2pManager.joinChannelDiscovery` ([#L231](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L231)) rather than the raw discovery join, so the manager records the key and can leave that topic itself during the channel reset without the signer having to hand it back ([`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Gap / divergence                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`INV-TJOIN-1-R3K75D`](../../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-1-r3k75d) | Covered               | **Here:** [connectToChannel](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L160) normalizes and retains one channel ID through matching, negotiation, discovery and membership. **Other files:** [StateManager](../../stateManager/StateManager.ts.md) owns the selected channel; [LobbyMatchingService](../../rpc/network/services/lobbyMatching/LobbyMatchingService.ts.md) owns matching; [SpectateService](../../rpc/network/services/spectate/SpectateService.ts.md) verifies synchronization.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | None demonstrated.                                                                |
| [`REQ-TJOIN-2-MFWADG`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-2-mfwadg) | Covered               | **Here:** [connectToChannel](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L189) uses the separated matching topic, completes the winning lobby handoff or releases the observed-open loser, then joins the selected raw discovery key. **Other files:** [LobbyMatchingService](../../rpc/network/services/lobbyMatching/LobbyMatchingService.ts.md) cancels the matching timer on acceptance and owns transport handoff.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | None demonstrated.                                                                |
| [`REQ-LIF-10-QR8NQ9`](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)                       | Covered               | **Here:** one channel generation is captured at entry ([#L173](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L173)) and re-read before each effect the call can still produce — before joining channel discovery ([#L227](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L227)), and before `topUpBalance` ([#L247](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L247)) and `joinChannel` ([#L262](../../../../../../../src/evm/signer/LocalP2pSigner.ts#L262)), returning `false`, so a resumed connect neither subscribes the returned runtime to the topic of the channel it left nor puts a departed signer back on chain. **Other files:** [StateManager](../../stateManager/StateManager.ts.md) owns the generation and the `isStaleChannelWork` predicate; [JoinChannelService](../../rpc/network/services/joinChannel/JoinChannelService.ts.md) owns the collection round; [MembershipService](../../stateManager/membership/MembershipService.ts.md) owns the submission this path declines to make; [P2PManager](../../P2PManager.ts.md) owns the discovery topic and the remembered key this path declines to overwrite. | None; this row covers the discovery-attachment and membership contributions only. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                          | Obligation                   | Public entry and setup                                                                                                                                                                                                                               | Oracle and forbidden effects                                                                                                                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-local-p2p-signer-1-q80vpw"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW` | Targeted connect composition | Call the public signer through unopened, matched, opened, synced, pending, and participating states, and with the channel released while the confirmation round is held, and while the chain status refresh that precedes the discovery join is held | The signer sequentially delegates each phase and returns the final owner result without retaining an attempt object; a call that outlived its channel returns `false`, joins no discovery topic, and submits nothing | <a id="unit-test-local-p2p-signer-1-q80vpw.p1"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P1` — unopened false; <a id="unit-test-local-p2p-signer-1-q80vpw.p2"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P2` — targeted opening; <a id="unit-test-local-p2p-signer-1-q80vpw.p3"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P3` — observer sync; <a id="unit-test-local-p2p-signer-1-q80vpw.p4"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P4` — pending reuse; <a id="unit-test-local-p2p-signer-1-q80vpw.p5"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P5` — participating reuse; <a id="unit-test-local-p2p-signer-1-q80vpw.p6"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P6` — channel left during the signature round trip: a `shouldJoin` connect whose collected confirmation arrives after the runtime released the channel returns `false` and makes no membership submission at all; <a id="unit-test-local-p2p-signer-1-q80vpw.p7"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P7` — channel left before the discovery join: a connect parked on the chain status refresh that resumes after the runtime released the channel and selected another open one returns `false` and makes no `joinChannelDiscovery` call, counted at that call so the not-opened exit cannot be mistaken for the fence |

## Related source reports

## Channel ownership and leave contribution

The signer rejects a different selected target before any clear or set, removes the public setter, and gates
connect and membership operations while a channel leave is pending. Its internal leave route delegates to the
state manager service. That route is internal to `P2pInstance.leaveChannel`; calling it directly waits for
settled removal and the channel reset, and it never disposes the outer runtime. The different-target rejection
is unchanged; only its message now points the caller at leaving rather than at building a new runtime. These boundaries implement [`REQ-TJOIN-6-0HEVYH` (Single-channel runtime ownership)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh) and contribute to [`REQ-TJOIN-7-NNGTAY` (Channel leave and runtime reuse)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay).

| Requirement / invariant                                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                         | Gap / divergence |
| ------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-TJOIN-6-0HEVYH`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh) | Covered               | **Here:** normalized different-ID rejection occurs before clear/set and the public setter is absent. **Other files:** the worker protocol and host expose no setter request.                                                                                                                                                                     | None.            |
| [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) | Covered               | **Here:** leave delegates to the single service operation and channel or membership work is gated while it is active; the guard that rejects a different target stays in force until the leave has settled and released the ID. **Other files:** the leave service owns progress and the channel reset, and the instance stays alive afterwards. | None.            |

- [identity.md](../../../../../specification/protocol-model/identity.md), [P2pRuntimeHost](../../rpc/internal/roots/P2pRuntimeHostRoot.ts.md).

## Targeted connect implementation

`connectToChannel` is a sequential composition wrapper. It selects the requested channel, refreshes chain
state, calls the generic matcher and negotiation only for unopened auto-open work, joins the exact raw topic,
and delegates sync and membership to their existing owners. It keeps no active-attempt object, waiter,
normalization copy, or lifecycle engine. `joinLobby` remains a distinct wrapper.

Component obligations use [`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW`](LocalP2pSigner.ts.md#unit-test-local-p2p-signer-1-q80vpw): `.P1` terminal targeted `false` without
implicit rematch, `.P2` fresh explicit same-ID pre-sync retry, plus separate disposed-observer and committed
preservation permutations. See [`REQ-TJOIN-1-5VGR1F` (Independent public options)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f)–[`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7).

Shared operation owners: [errorMessage.ts.md](../../utils/errorMessage.ts.md), [bytes32.ts.md](../../utils/bytes32.ts.md), [ADiamondStateMachine.ts.md](../../ADiamondStateMachine.ts.md).
