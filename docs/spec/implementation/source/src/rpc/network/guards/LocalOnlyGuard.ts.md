# LocalOnlyGuard.ts — Source Report

> **Source:** [src/rpc/network/guards/LocalOnlyGuard.ts](../../../../../../../../src/rpc/network/guards/LocalOnlyGuard.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md)

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

The reusable host-only guard. A service that installs it accepts only the node's own calls: trusted
loopback delivery bypasses guards at [service dispatch](../../../../../../../../src/rpc/network/ANetworkRpcService.ts#L68),
so every invocation that reaches this guard came from another peer. The guard rejects it, hands the
sender to the canonical disconnect owner with the blacklist policy, and suppresses the dispatcher's
guard-failure response for exactly the request it rejected. It is exported through the
[guard barrel](index.ts.md) and the [public SDK entry](../../../index.ts.md), for poker and other
consumers; the implementation is shared between node and browser builds.

## Key design decisions

1. **Extends the base guard directly and always fails.** `check()` returns `false`
   ([#L16-L18](../../../../../../../../src/rpc/network/guards/LocalOnlyGuard.ts#L16-L18)). It needs no
   predicate over the caller because loopback trust is decided before guards run; the guard adds no
   trust to any network transport and does not widen the loopback path.
2. **Punishment belongs to the canonical disconnect owner.** `onFailure` calls
   `P2PManager.disconnectConnection(transport, DisconnectPolicy.BLACKLIST, "remote call to a local-only RPC")`
   and returns normally ([#L20-L27](../../../../../../../../src/rpc/network/guards/LocalOnlyGuard.ts#L20-L27)).
   Identity effects therefore come from [P2PManager](../../../P2PManager.ts.md): a transport whose
   registered profile has a proven address is blacklisted by identity with a recorded verdict and every
   live transport of that identity closes; a registered profile still negotiating, with no proven
   address, is marked excluded in memory with no recorded verdict; a transport with a proven address but
   no profile records the address verdict and closes; a transport with neither closes with no recorded
   verdict or persistent ban. The guard copies no identity lookup,
   warning, or rejection helper from [HandshakeCompletedGuard](HandshakeCompletedGuard.ts.md) and never
   throws.
3. **Response suppression is scoped to the request this guard rejected.** `onFailure` records the exact
   rejected `Rpc` object in a `WeakSet` held with the other fields at the top of the class
   ([#L13-L14](../../../../../../../../src/rpc/network/guards/LocalOnlyGuard.ts#L13-L14)), and the
   override of `AGuard.suppressesFailureResponse` returns `true` only for a recorded request
   ([#L29-L33](../../../../../../../../src/rpc/network/guards/LocalOnlyGuard.ts#L29-L33)). The dispatcher
   asks only the failing guard ([ANetworkRpcService](../ANetworkRpcService.ts.md)), so a rejection by an
   earlier guard in the chain keeps its declared `RPC request rejected by guard` response. The sender is
   already disconnected, so nothing more is sent for the rejected request: no failure-response attempt,
   no response-send error, and no response-path disconnect. The `WeakSet` lets a rejected request be
   collected once dispatch is done.
4. **No deferral.** Unlike the [shared deferred-admission guard](DeferredAdmissionGuard.ts.md), a call
   over a transport that is still negotiating its handshake is rejected at once and never queued or
   replayed after the handshake completes.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------- |
| Inputs       | The rejected `Rpc` and its inbound network transport; the owning service's `p2pManager`.      |
| Outputs      | `false` from `check`; `true` from `suppressesFailureResponse` only for a request it rejected. |
| Owned state  | A `WeakSet<Rpc>` of requests this instance rejected.                                          |
| Side effects | One canonical blacklist disconnect per rejected call (closure, and a verdict when proven).    |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                           | Specification IDs                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LocalOnlyGuard.ts](../../../../../../../../src/rpc/network/guards/LocalOnlyGuard.ts) | [`REQ-RPC-7-9CBSHK`](../../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk), [`REQ-RPC-6-E60S4J`](../../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) |

- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk):
  owns host-only admission, the normal return of its failure handler, and the request-scoped response
  suppression. The caller's request settles through the session closure, not through a guard-error response.
- [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j):
  states the blacklist outcome of the fixed ladder; the identity-dependent result (recorded verdict for a
  proven peer, transport loss only for an unknown one) is applied by the disconnect owner.

## Assumptions, dependencies, trust boundaries, and limits

- Trusted loopback is the only guard bypass ([ANetworkRpcService](../ANetworkRpcService.ts.md)); the
  WebSocket-backed local transport and every network transport stay untrusted.
- Punishment is only as strong as the proven identity. A sender with neither a profile nor a proven
  address loses only its transport and may reconnect under a fresh transport key; it still reaches no
  protected endpoint.
- In [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk), "without a recorded verdict" means no identity or address verdict. For a
  transport with neither a profile nor a proven address, `P2PManager` passes the transport to
  [`ProfileManager.blacklistPeer`](../../../ProfileManager.ts.md), which marks a profile only when one is
  attached to that transport and otherwise does nothing. Nothing is barred, not even the transport
  handle: the close is the only effect, and a new connection is not barred.
- Suppression depends on the dispatcher consulting the failing guard's `suppressesFailureResponse`; the
  guard does not change dispatcher behavior for any other guard.
- The rejection reason string is generic; it names no service or method.

## Specification adherence

- Host-only admission as a guard whose check never admits a remote caller, with all consequences in
  `onFailure` ([`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)).
- Identity-dependent punishment through the one canonical disconnect owner
  ([`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Gap / divergence |
| ------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-7-9CBSHK`](../../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) | Covered               | **Here:** always-failing check ([#L16](../../../../../../../../src/rpc/network/guards/LocalOnlyGuard.ts#L16)), canonical blacklist disconnect with a normal return ([#L20](../../../../../../../../src/rpc/network/guards/LocalOnlyGuard.ts#L20)), request-scoped suppression ([#L31](../../../../../../../../src/rpc/network/guards/LocalOnlyGuard.ts#L31)). **Other files:** loopback bypass and the suppression hook call in [ANetworkRpcService](../ANetworkRpcService.ts.md); chain order in [runGuards](runGuards.ts.md); the default hook in [AGuard](AGuard.ts.md); closure and identity effects in [P2PManager](../../../P2PManager.ts.md). | None.            |
| [`REQ-RPC-6-E60S4J`](../../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) | Covered               | **Here:** states `DisconnectPolicy.BLACKLIST` for every rejected call ([#L22](../../../../../../../../src/rpc/network/guards/LocalOnlyGuard.ts#L22)). **Other files:** [P2PManager](../../../P2PManager.ts.md) resolves the tier against the proven identity and records the verdict through [ProfileManager](../../../ProfileManager.ts.md); [DisconnectPolicy](../../../DisconnectPolicy.ts.md) defines the ladder.                                                                                                                                                                                                                                | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                          | Obligation                                                                                            | Public entry and setup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Oracle and forbidden effects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-local-only-guard-1-gk4gr8"></a>`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8` | Host-only admission, identity-dependent canonical punishment, and request-scoped response suppression | Two real harness peers load the production guard on a target service and on a guard-chain service behind a real earlier guard; peer 0 receives, peer 1 calls over the real network session. Identity states are staged on real transports: an authenticated session; a negotiating transport with its real registered pre-handshake profile (the receiver holds its own handshake initiation); neither profile nor proven address, and a proven address without profile, by unregistering the real profile for the call and restoring it afterwards; a later call on the retired transport by re-injecting a captured real request frame through the network router entry point. The loopback case calls through the receiver's local RPC proxy. | Caller settlement (`Peer disconnected before RPC response arrived` or the declared rejection); endpoint invocations; dispatch-error log count (`onFailure` returns normally); record-only disconnect decisions with tier, reason, and origin (direct, response-failure path, or the closed transport's own close bookkeeping); profile blacklist state and stored verdict count; blacklist, suspension, and connection queries; transport closure and open-connection membership; dispatcher response attempts and response frames sent on the delivery's exact transport for each request id; `Failed to send RPC response` log count; handshake waiter calls. Forbidden: execution, deferral or replay, a guard exception, any response or response-send error for a suppressed request, a second disconnect decision from the response path. | <a id="unit-test-local-only-guard-1-gk4gr8.p1"></a>`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P1` — trusted loopback call runs its endpoint once with no disconnect decision and no new verdict; <a id="unit-test-local-only-guard-1-gk4gr8.p2"></a>`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P2` — authenticated request with a registered profile: handler returns, no execution, profile blacklisted and address verdict recorded, transport closed and removed, one `BLACKLIST` decision, no response and no response-send error; <a id="unit-test-local-only-guard-1-gk4gr8.p3"></a>`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P3` — authenticated one-way call: handler returns, no execution, profile blacklisted, transport closed, one `BLACKLIST` decision, no response and no response-send error; <a id="unit-test-local-only-guard-1-gk4gr8.p4"></a>`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P4` — registered profile still negotiating: rejected at once with no handshake wait, no execution before or after handshake completion, no response; <a id="unit-test-local-only-guard-1-gk4gr8.p5"></a>`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P5` — no profile and no proven address: the canonical owner closes the transport only, no new verdict, no address verdict, no response; <a id="unit-test-local-only-guard-1-gk4gr8.p6"></a>`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P6` — proven address without a profile: address verdict recorded, transport closed, no execution, no response; <a id="unit-test-local-only-guard-1-gk4gr8.p7"></a>`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P7` — earlier passing guard then this guard rejects: one rejection, one `BLACKLIST` decision, no response, no execution; <a id="unit-test-local-only-guard-1-gk4gr8.p8"></a>`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P8` — earlier guard fails first: this guard never runs, no disconnect decision, the earlier guard's declared rejection response is sent unchanged; <a id="unit-test-local-only-guard-1-gk4gr8.p9"></a>`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P9` — `suppressesFailureResponse` is `true` for the exact request it rejected and `false` for a different request; <a id="unit-test-local-only-guard-1-gk4gr8.p10"></a>`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P10` — two overlapping rejected calls and a later call on the retired transport: every handler returns, nothing executes or waits for a handshake, profile stays blacklisted, only `BLACKLIST` decisions, no response. |

## Related source reports

- [AGuard.ts](AGuard.ts.md) — base contract and the default `suppressesFailureResponse`.
- [runGuards.ts](runGuards.ts.md) — ordered evaluation and first-failure handling.
- [DeferredAdmissionGuard.ts](DeferredAdmissionGuard.ts.md) — the request-scoped suppression pattern this guard follows, with deferral.
- [HandshakeCompletedGuard.ts](HandshakeCompletedGuard.ts.md) — the authenticated-RPC guard.
- [ANetworkRpcService.ts](../ANetworkRpcService.ts.md) — loopback bypass and guard-failure response dispatch.
- [P2PManager.ts](../../../P2PManager.ts.md) — canonical disconnect and identity punishment.
- [index.ts](index.ts.md) and [src/index.ts](../../../index.ts.md) — exports.
