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
   join or a lobby topic. Only equal keys connect and the lower address dials once. The key stays in
   discovery-session metadata; it is not copied onto the resulting transport.
5. **Discovery leave is not transport close.** Leaving removes discovery admission but keeps accepted
   peer sockets alive. Runtime `cleanup` remains the sole final owner of those sockets.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Registry configuration, rendezvous key and advertised peer metadata, WebSocket registration/ready frames, and a `P2PManager`. |
| Outputs      | Registry peer lists, brokered `LocalTransport` instances, and handshake starts.                                               |
| Owned state  | Registry and peer servers, active sockets, discovery state, retry counters/timers, and the cleanup gate.                      |
| Side effects | Opens/closes loopback WebSockets, schedules bounded retries, and starts handshakes through the owning `P2PManager`.           |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                            | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LocalDiscoveryServer.ts](../../../../../../../src/utils/node/LocalDiscoveryServer.ts) | [`INV-AUTH-1-J0PRYA`](../../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya), [`REQ-AUTH-4-JWCF71`](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71), [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-LOBBY-9-N894C0`](../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0) |

## Assumptions, dependencies, trust boundaries, and limits

- This implementation is Node-only and uses loopback WebSockets; browser discovery has a separate
  platform adapter.
- Registry metadata is untrusted until the normal handshake proves the remote identity.
- `cleanup` owns all local-discovery resources and must run before the associated runtimes are
  discarded.

## Specification adherence

- Accepted connections cannot bypass the normal identity handshake.
- Cleanup sets its gate before closing resources, suppresses scheduled reconnect work, and now
  rejects a client-ready frame that races with teardown before it can create a transport or touch a
  disposed runtime.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                                                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                         | Gap / divergence |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`INV-AUTH-1-J0PRYA`](../../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya) / [`REQ-AUTH-4-JWCF71`](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71) | Covered               | **Here:** discovery metadata only selects a peer endpoint; accepted sockets start `InitHandshakeService` and teardown rejects pre-handshake work without assigning an identity penalty. **Other files:** the handshake owns proof and penalties. | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)                                                                                                              | Covered               | **Here:** cleanup gates new registry/peer work, clears retries, terminates sockets, closes servers, and waits for all close operations. The inbound ready-frame gate prevents a late handshake from mutating disposed runtime state.             | None.            |
| [`REQ-LOBBY-9-N894C0`](../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)                                                                                                  | Covered               | **Here:** rendezvous leave closes registry membership and listener admission while retaining accepted peer sockets for the selected channel. **Other files:** runtime cleanup closes the retained sockets.                                       | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                      | Obligation         | Public entry and setup                                                             | Oracle and forbidden effects                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-local-discovery-server-1-1w1gy5"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5` | Ready/cleanup race | Start a peer server, deliver direct ready frames before and after `cleanup` begins | Only a pre-cleanup valid frame acknowledges and starts one handshake; teardown creates no transport or post-cleanup retry | <a id="unit-test-local-discovery-server-1-1w1gy5.p1"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P1` — valid client-ready frame before cleanup acknowledges and starts one handshake; <a id="unit-test-local-discovery-server-1-1w1gy5.p2"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P2` — malformed ready frame closes without transport or handshake; <a id="unit-test-local-discovery-server-1-1w1gy5.p3"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P3` — valid ready frame after cleanup begins closes without acknowledgement, transport, or handshake; <a id="unit-test-local-discovery-server-1-1w1gy5.p4"></a>`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P4` — pending dial and retry callbacks cannot create a post-cleanup transport |

## Related source reports

- Consumers per the views.
