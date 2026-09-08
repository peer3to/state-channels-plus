# LocalDiscoveryServer.ts — Source Report

> **Source:** [src/utils/node/LocalDiscoveryServer.ts](../../../../../../../src/utils/node/LocalDiscoveryServer.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

The Node local-discovery server: registry startup, plaintext peer advertisement, bounded local
WebSocket dialing, and direct `LocalTransport` brokering for development and test topologies. A
rendezvous leave stops registry and listener admission while established transports remain owned by
the channel. Full runtime cleanup owns final server, socket, retry, and pending-handshake teardown.

## Key design decisions

1. **Advertised identity is metadata only.** Every brokered connection still enters the mutual
   authentication handshake
   ([`INV-AUTH-1-J0PRYA`](../../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya)).
2. **Socket readiness precedes protocol handshake.** A client-ready/server-ready frame pair ensures
   both `LocalTransport` listeners exist before either side sends handshake RPCs.
3. **Cleanup closes admission immediately.** Once `_cleanupRequested` is set, timers stop retrying
   and an inbound client-ready frame is closed without acknowledgement, transport construction, or
   handshake startup. This covers a retry that reaches the peer server while its runtime is being
   disposed.
4. **The rendezvous key is generic.** The same exact caller value can represent an existing-channel
   join or a lobby topic. Only equal keys connect and the lower address dials once
   ([`isPrimaryDialer`](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L1018)). The key
   stays in discovery-session metadata; it is not copied onto the resulting transport.
5. **Discovery leave is not transport close.** Leaving removes discovery admission but keeps accepted
   peer sockets alive. Runtime `cleanup` remains the sole final owner of those sockets.
6. **Topic membership owns replacement dialing.** One active dial and one bounded-backoff retry chain are
   retained per session and peer endpoint. An authenticated close may redial only while that exact topic
   session remains active, its manager is live, and the peer is not blacklisted. `leave` removes the session
   before cancelling its timers and closing pending, unauthenticated dials, so callbacks cannot recreate
   discovery work. Manager disposal also suppresses retries during transport teardown. A completed authenticated
   transport leaves the pending set and remains under channel ownership. The lift-driven redial of
   decision 10 is session-owned in the same way: it dials only through sessions still registered for the
   manager, so a topic already left ([`leave`](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L871)
   deletes the session first) has nothing left to dial from.
7. **One live connection per unique peer across topics.** Dial admission checks the runtime's open
   connections, the peer profile's live authenticated transports, and a per-runtime set of peers with a
   dial in flight on any observed topic. A peer that is already connected or being dialed through another
   topic is not dialed again, which mirrors the Hyperswarm behavior the derived-to-raw targeted handoff
   relies on in production.
8. **Repeated observation keeps one session.** [connectToPeers](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L616) joins a pending startup or reuses the active runtime/topic session. It never replaces a live session's ownership. The pending-join map is cleared after either startup outcome, and `leave` awaits a pending startup before removing it.

9. **The local backend mirrors the production swarm's ban behavior, or tests prove the wrong thing.**
   Hyperswarm never dials a peer whose peer info is banned; the local server dials from its own
   registry and would happily keep re-dialing a peer the runtime has banned. It therefore skips the
   dial when the peer is blacklisted or reconnect-banned ([#L1114](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L1114)) and logs the skip.
   Without this, a reconnect ban is a no-op under the local backend and the redial loop it exists to
   stop stays invisible in every local and distributed test run
   ([`REQ-AUTH-4-JWCF71`](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71),
   [`REQ-RUNTIME-4-B0N70Y`](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)).

10. **The side that placed the suspension owns dialing back.** Only the primary dialer of a pair
    runs a retry loop here ([`isPrimaryDialer`](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L1004)),
    so a reconnect suspension placed by that side stops the pair's only dialer. The suspension is
    one-sided and the suspended peer is never told about it, so it cannot know when the suspension is
    over — the side that placed it is the only side that knows, and therefore the side that dials
    back. [`redialPeer`](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L1024) is called
    from [`P2PManager.allowReconnect`](../../../../../../../src/P2PManager.ts#L673) only when the ban
    was actually lifted, and dials the peer once on every session that observed its announced port.
    Nothing is dialed while the ban stands: the dial would be refused at admission anyway and
    [`connectToSinglePeer`](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L1114) skips
    it as `reconnect-banned`; a pair that already reconnected skips as `peer-connected` and a peer
    this side excluded as `blacklisted`. The port comes from
    [`announcedPeerPorts`](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L43), which
    [`handlePeerAnnouncement`](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L905)
    records for every matching announcer, primary or not, and the session carries its own
    `myPeerAddress`/`myPeerPort` ([#L36](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L36))
    so the redial needs no caller plumbing
    ([`REQ-LOBBY-9-N894C0`](../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)).

11. **The accepting side never dials a closed route back.** An earlier revision armed a delayed
    takeover from the acceptor on every inbound `LocalTransport` close. That is unsound: close intent
    is not carried on the wire — [`ATransport.close`](../../../../../../../src/transport/ATransport.ts#L60)
    takes its expectation flag locally and `LocalTransport` sends a bare socket close whose code and
    reason the receiver discards — so "the primary suspended me" and "the primary left on purpose"
    are the same observable event from the acceptor. A takeover therefore resurrected transports to
    peers that had deliberately dropped the feed. The acceptor consequently registers no `onClosed`
    dial at all ([#L691](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L691) starts the
    handshake and nothing else)
    ([`REQ-LOBBY-9-N894C0`](../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)).

- **A skipped retry names its reason.** When a scheduled re-dial finds nothing to do (cleanup, disposal, a dial already active, the peer counted as connected, a blacklist, or a reconnect ban), the skip is logged at debug level with the reason; a dropped retry is the end of the road for that key because no announcement follows it, and one such silent skip left an honest peer without the reduced fork's first block.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Registry configuration, rendezvous key and advertised peer metadata, WebSocket registration/ready frames, and a `P2PManager`.                                                                                                           |
| Outputs      | Registry peer lists, brokered `LocalTransport` instances, and handshake starts.                                                                                                                                                         |
| Owned state  | Registry and peer servers, active sockets, topic sessions (each holding its own advertised address and listening port), pending dials, active-dial keys, retry counters/timers, per-session announced peer ports, and the cleanup gate. |
| Side effects | Opens/closes loopback WebSockets, schedules bounded retries, and starts handshakes through the owning `P2PManager`.                                                                                                                     |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                            | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LocalDiscoveryServer.ts](../../../../../../../src/utils/node/LocalDiscoveryServer.ts) | [`INV-AUTH-1-J0PRYA`](../../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya), [`REQ-AUTH-4-JWCF71`](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71), [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-LOBBY-9-N894C0`](../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0), [`REQ-RUNTIME-4-B0N70Y`](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y), [`REQ-UPG-7-KQPXRE`](../../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre) |

## Assumptions, dependencies, trust boundaries, and limits

- This implementation is Node-only and uses loopback WebSockets; browser discovery has a separate
  platform adapter.
- Registry metadata is untrusted until the normal handshake proves the remote identity.
- `cleanup` owns all local-discovery resources and must run before the associated runtimes are
  discarded.

## Specification adherence

- Accepted connections cannot bypass the normal identity handshake.
- Dial admission honours both ban states, so a banned or suspended peer is not re-dialed under the
  local backend any more than it would be by the production swarm.
- Cleanup sets its gate before closing resources, suppresses scheduled reconnect work, and now
  rejects a client-ready frame that races with teardown before it can create a transport or touch a
  disposed runtime.
- An eligible peer transport can be recreated while the topic remains observed. Session identity,
  canonical dial ownership, one-active-dial state, capped exponential backoff, and the existing blacklist
  check bound that lifecycle. Topic leave cancels every session-owned retry.
- A one-sided suspension does not leave the pair permanently unreachable, and the side that placed
  it is what restores reachability: lifting the ban dials the peer back on every session that still
  observes its announced port. Nothing dials while the ban stands, and the side that only accepted
  the route never dials a close back, so a peer that left deliberately stays gone.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                                                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Gap / divergence                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`INV-AUTH-1-J0PRYA`](../../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya) / [`REQ-AUTH-4-JWCF71`](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71) | Covered               | **Here:** discovery metadata only selects a peer endpoint; accepted sockets start `InitHandshakeService` and teardown rejects pre-handshake work without assigning an identity penalty. **Other files:** the handshake owns proof and penalties.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | None.                                                                                         |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)                                                                                                              | Covered               | **Here:** cleanup gates new registry/peer work, clears retries, terminates sockets, closes servers, and waits for all close operations. The inbound ready-frame gate prevents a late handshake from mutating disposed runtime state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | None.                                                                                         |
| [`REQ-LOBBY-9-N894C0`](../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)                                                                                                  | Covered               | **Here:** an active topic redials an eligible closed peer through one canonical bounded-backoff chain, rejects blacklisted endpoints, and cancels session timers before leave closes registry/listener ownership. [`redialPeer`](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L1024) keeps a one-sided suspension from making the pair permanently unreachable: the side that placed it dials back when it lifts it, over every still-registered session that recorded the peer's announced port. The accepting side arms no dial on close ([#L691](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L691)), so a deliberate departure is not reversed. Accepted channel sockets remain separate. **Other files:** [P2PManager](../../P2PManager.ts.md) calls that redial from `allowReconnect`; [ProfileManager](../../ProfileManager.ts.md) holds the suspension the standing ban is refused under, and [InitHandshakeService](../../rpc/services/initHandshake/InitHandshakeService.ts.md) performs that refusal without an exclusion. | None.                                                                                         |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)                                                                                                              | Partial               | **Here:** the dial gate refuses a blacklisted or reconnect-banned peer ([#L1114](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L1114)), matching the production swarm's refusal to dial banned peer info, so ban semantics are observationally equal on both backends. [`redialPeer`](../../../../../../../src/utils/node/LocalDiscoveryServer.ts#L1024) supplies what the swarm gets for free: there the banned peer keeps dialing and reconnects on its own once the ban lifts, while here the pair has a single dialer, so the banning side must dial back itself when it lifts. **Other files:** [ProfileManager](../../ProfileManager.ts.md) owns both ban states; [P2PManager](../../P2PManager.ts.md) triggers the redial on a lift.                                                                                                                                                                                                                                                                                                           | Only the dial side is mirrored; the swarm's internal ban bookkeeping has no local equivalent. |
| [`REQ-UPG-7-KQPXRE`](../../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre)                                                                                                   | Partial               | **Here:** leaving a rendezvous removes registry membership and listener admission, so a left key stops producing dials under the local backend. **Other files:** [P2PManager](../../P2PManager.ts.md) owns the observed-key set and the leave-all primitive.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | This file observes no keys of its own.                                                        |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                      | Obligation                            | Public entry and setup                                                                                                                       | Oracle and forbidden effects                                                                                                                                                                                                                                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-local-discovery-server-1-1w1gy5"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5` | Topic-owned local discovery lifecycle | Use real loopback discovery, authenticated managers, transport close, blacklist, reconnect suspension and its lift, topic leave, and cleanup | One eligible replacement while observed, always from the side that owns the dial — including after that side lifts a suspension it placed; no replacement while a suspension stands, after leave, blacklist, or cleanup, and never from the side that only accepted the route; at most one pending dial/retry per session peer | <a id="unit-test-local-discovery-server-1-1w1gy5.p1"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P1` — valid client-ready frame before cleanup acknowledges and starts one handshake; <a id="unit-test-local-discovery-server-1-1w1gy5.p2"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P2` — malformed ready frame closes without transport or handshake; <a id="unit-test-local-discovery-server-1-1w1gy5.p3"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P3` — valid ready frame after cleanup begins closes without acknowledgement, transport, or handshake; <a id="unit-test-local-discovery-server-1-1w1gy5.p4"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P4` — pending dial and retry callbacks cannot create a post-cleanup transport; <a id="unit-test-local-discovery-server-1-1w1gy5.p5"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P5` — authenticated close creates a different transport while the exact topic remains observed; <a id="unit-test-local-discovery-server-1-1w1gy5.p6"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P6` — topic leave stops later replacement; <a id="unit-test-local-discovery-server-1-1w1gy5.p7"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P7` — blacklist plus close produces no replacement; <a id="unit-test-local-discovery-server-1-1w1gy5.p8"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P8` — a peer with a live authenticated transport on another observed topic is not dialed again; <a id="unit-test-local-discovery-server-1-1w1gy5.p9"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P9` — concurrent and repeated joins create one listener, leave removes it even during startup, and a later join establishes a usable session; <a id="unit-test-local-discovery-server-1-1w1gy5.p10"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P10` — deduplicates an in-flight dial across topics before authentication; <a id="unit-test-local-discovery-server-1-1w1gy5.p11"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P11` — a registry entry for a blacklisted peer and one for a reconnect-banned peer are both skipped without a dial, while an unbanned entry still dials; <a id="unit-test-local-discovery-server-1-1w1gy5.p13"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P13` — after the canonical dialer suspends the peer and closes the transport, that side holds no transport for as long as the ban stands, and lifting the ban on that same side dials the peer back while the topic is still observed; <a id="unit-test-local-discovery-server-1-1w1gy5.p14"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P14` — the side that only accepted the route runs no inbound handshake after the canonical dialer closes the transport, so a close it cannot attribute is never dialed back |

## Related source reports

- Consumers per the views.
