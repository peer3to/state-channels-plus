# Peer-RPC Model — The Client-Node Protocol Boundary

> **Specification subject:** [specification/architecture/rpc.md](../../../../../specification/peer-communication/rpc.md)

> **Status:** Draft, reverse-engineered baseline. Pending engineer review.
> **Scope:** The peer-RPC system as the protocol's peer-to-peer entry-point surface: service
> registration, typed proxy derivation, wire envelope, guards, delivery modes,
> correlation/timeout/error semantics, failure outcomes, and rate limiting. This is the deep
> reference behind the component summary in [components.md](../components.md) §2. Layering context:
> [architecture.md](../architecture.md); flow-level behavior of the main consumer:
> [block-confirmation-pipeline.md](../block-confirmation-pipeline.md).

## Service documents

This README owns the shared model — dispatch, guards, wire contract, outcome classes. Each
exported service has its own document in this directory that owns that service's algorithm,
Byzantine assessment, invariants, and verification:

| Service | Document |
| --- | --- |
| `InitHandshakeService` | [handshake.md](./handshake.md) |
| `WebRTCSetupService` | [webrtc-setup.md](./webrtc-setup.md) |
| `StateTransitionService` | [state-transition.md](./state-transition.md) |
| `JoinChannelService` | [join-channel.md](./join-channel.md) |
| `SpectateService` | [spectate.md](./spectate.md) |
| `IsForkDisputedService` | [is-fork-disputed.md](./is-fork-disputed.md) |
| `OpenChannelNegotiationService` (unwired) | [open-channel-negotiation.md](./open-channel-negotiation.md) |

## 1. Purpose & observable contract

The SDK is blockchain-node software that runs on every client rather than on a central server.
Establishing a peer transport ([`src/transport/`](../../../../../../../src/transport)) is only the
connectivity layer: it moves opaque frames between processes and guarantees nothing about their
content. The RPC system defines the protocol's actual peer-to-peer entry points — which messages
one node may send to another, how they are routed to handlers, and where untrusted remote input
enters the local node.

This makes the RPC layer a **security boundary, not a code-organization preference**. Every public
RPC method is an adversarial ingress point: any connected peer (and, before the handshake guard,
any transport-level counterparty) can invoke it with arbitrary JSON-decodable arguments. The
boundary's contract is therefore twofold:

- **What it guarantees.** A frame reaching a handler has passed the frame-size cap, envelope-shape
  verification, service and method existence checks, and the service's guards
  ([`P2PManager.onRpc`](../../../../../../../src/P2PManager.ts#L200),
  [`ARpcService.runRPC`](../../../../../../../src/rpc/ARpcService.ts#L49)). Request/response replies are
  correlated, time-bounded, and only settled by the addressed peer.
- **What it does not guarantee.** Nothing about the *semantic* validity of parameters. The
  envelope is untrusted JSON; every handler remains responsible for decoding and validating its
  own payload before any state effect (§4; canonical owners are listed there).

Delivery is best-effort: no ordering across peers, no retries, no delivery receipts for
fire-and-forget sends, and — currently — no rate limiting beyond the frame-size cap (§9).

## 2. Design decision: service-oriented, type-safe extensibility

The extensibility model is deliberate: protocol functionality is packaged as **services**, and the
remotely callable surface of each service is a separate, deliberately small class.

### 2.1 The service / RpcMethods pair

A service (a subclass of [`ARpcService`](../../../../../../../src/rpc/ARpcService.ts#L10)) owns shared state,
internal helpers, and business logic — e.g.
[`IsForkDisputedService`](../../../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedService.ts#L8)
owns the per-peer acknowledgment maps, and
[`SpectateService`](../../../../../../../src/rpc/services/spectate/SpectateService.ts#L34) owns the in-flight
sync set and the whole payload-generation/verification machinery. It pairs with an **RpcMethods**
class (a subclass of [`ARpcMethods`](../../../../../../../src/rpc/ARpcMethods.ts#L4)) that exposes *only* the
deliberately public, remotely callable methods. The dispatcher instantiates the RpcMethods class
per incoming frame via `service.createRPCMethods(transport)`, binding `senderTransport` so a
handler knows which peer called it.

Under the declared-endpoint rule in [`REQ-RPC-6-E60S4J`](../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j), private helpers and mutable service state MUST NOT be exposed through
an `RpcMethods` class. Only methods whose remote invocation is an intended protocol entry point
belong there; everything else stays on the service. A method on an RpcMethods class is public to
every connected peer — putting it there *is* the act of opening a protocol entry point, and it
then carries the full ingress obligations of §4.

[`ARpcService.runRPC`](../../../../../../../src/rpc/ARpcService.ts#L49) resolves endpoints from
function-valued own properties on the methods instance and function-valued data properties on its
application prototype chain. It stops before [`ARpcMethods.prototype`](../../../../../../../src/rpc/ARpcMethods.ts#L4),
or `Object.prototype`, rejects `constructor`, and reads descriptors without executing accessors. Application subclasses
therefore inherit declared endpoint families, while `remoteRpc`, `toString`, `hasOwnProperty`, and
other base members are not remotely callable. A function-valued own property is an endpoint too;
helpers and stored callbacks belong on the service or in JavaScript `#private` fields.

### 2.2 MainRpcService — the root

[`MainRpcService`](../../../../../../../src/rpc/MainRpcService.ts#L14) is the dispatch root. Its constructor
instantiates the six built-in services as public properties (`initHandshakeService`,
`webRTCSetupService`, `stateTransitionService`, `spectateService`, `isForkDisputedService`,
`joinChannelService`); the property name is the wire-visible service name (`rpc.service`).
Registration is purely structural: [`P2PManager.onRpc`](../../../../../../../src/P2PManager.ts#L200) resolves
`rpc.service` with [`hasRpcService`](../../../../../../../src/utils/ObjectChecks.ts#L27), which
accepts a root property exposing the complete public service operations used by dispatch. There is no explicit
service registry or allowlist — a property of the root either is a service (dispatchable) or is
not (frame rejected, sender disconnected).

The same rule applies in [`RemoteRpcProxy`](../../../../../../../src/rpc/RemoteRpcProxy.ts): a
custom application service can come from a compatible SDK copy in another production chunk.
Constructor identity is not stable across module graphs, so it is not part of either local proxy
resolution or incoming dispatch. The structural check only classifies the service; normal RPC
guards and payload validation still apply.

[`OpenChannelNegotiationService`](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L44)
is exported but **not** instantiated by `MainRpcService`; it only becomes reachable when an
integrator's custom root wires it in (§2.5). Until wired, its name resolves to nothing and frames
addressed to it disconnect the sender like any unknown service.

`MainRpcService.dispose()` is the runtime-shutdown hook: `StateManager.dispose()` awaits it before
tearing down the p2p manager, timeout manager, and EVM, so a custom root can settle waits and
drain async work. The base implementation is a no-op.

### 2.3 Typed remote proxy derivation

[`RemoteRpcProxy.createProxy(localRpcRoot)`](../../../../../../../src/rpc/RemoteRpcProxy.ts#L1) derives the
**sending** surface (`p2pManager.remoteRpc`) from the **receiving** root. The type
`RemoteRpcProxyType<T>` maps every service property of the root to the `RpcHandleMethods` of its
paired RpcMethods class, with each method's return type rewritten into a delivery handle
([`RpcHandleProxy.ts`](../../../../../../../src/rpc/RpcHandleProxy.ts#L1)). At runtime the proxy fabricates,
for `remoteRpc.<service>.<method>(...params)`, an envelope `{service, method, params}` wrapped in
an [`RpcHandler`](../../../../../../../src/rpc/RpcHandler.ts#L35); no code generation and no per-service
sending stubs exist. Accessing a non-service property of the root through `remoteRpc` throws
(`"RemoteRpcProxy can only access services"`).

The effect is that local TypeScript callers cannot construct a wrong call — method names,
parameter types, and result types are all checked against the RpcMethods class — and the
receiving and sending surfaces cannot drift apart, because both are derived from the same class.
This is a *local-developer* safety property only; see §4 for what it does not protect.

### 2.4 Delivery modes — chosen by the caller, constrained by the method's type

The delivery handle exposed for a method depends on its declared return type
([`RpcHandleProxy.ts`](../../../../../../../src/rpc/RpcHandleProxy.ts#L1)):

| Method returns | Handle | Operations |
| --- | --- | --- |
| `void` / `Promise<void>` | `FireAndForgetRpcHandler` | `.broadcast()`, `.sendOne(target?)`, `.sendMultiple(targets)` |
| any value | `RequestRpcHandler<T>` | `.request(target?, {timeoutMs?})` → `Promise<T>` |

- **Broadcast** ([`P2PManager.broadcastRpc`](../../../../../../../src/P2PManager.ts#L102)) sends the envelope to
  every open connection. No `requestId` — no replies.
- **One-way send** (`sendOne`/`sendMultiple`, [`RpcHandler`](../../../../../../../src/rpc/RpcHandler.ts#L35))
  targets a transport or an EVM address (resolved via `ProfileManager`). A target with no open
  transport is a silent no-op — fire-and-forget delivery never reports failure.
- **Request/response** (`.request`) adds a `requestId` and returns a promise settled by the peer's
  reply (§6.4). An unresolvable target rejects locally.
- **Loopback:** omitting the target on `sendOne`/`request` delivers to self through
  [`LoopbackTransport`](../../../../../../../src/transport/LoopbackTransport.ts#L13) — the node invokes its own
  RPC methods through the normal plumbing (used by `hostRpc`, §3).

The mode is the caller's choice per call site; the method's implementation must therefore be safe
under every mode its type admits (e.g. a `void` method must tolerate being broadcast).

### 2.5 Custom roots — manifest + registry

Integrators extend the boundary by subclassing `MainRpcService` and shipping the subclass as a
[`CustomRpcManifest`](../../../../../../../src/rpc/registry.ts#L12) (`{module, exportName?, options?}`) via
`p2pSetup(options.customRpcManifest)` ([architecture.md](../architecture.md) §1.1). The host side
resolves the manifest with
[`resolveCustomRpcConstructor`](../../../../../../../src/rpc/resolveCustomRpcManifest.ts#L5) (dynamic module
load; throws unless the export is a constructor) and passes the constructor into
[`P2PManager`](../../../../../../../src/P2PManager.ts#L26), which instantiates it in place of the base root and
derives `remoteRpc` from it. Typing flows through the `TCustomRpc extends MainRpcService`
parameter, so custom services get the same typed sending surface as built-ins
(`RemoteRpcProxyType<TCustomRpc>`), including through `hostRpc` (§3). `customRpcOptions` without a
`customRpc` constructor is rejected.

Under the structural wire contract in [`REQ-RPC-1-FF89Z0`](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0), a custom root MUST follow the same pairing discipline as the built-ins:
each added entry point lives on an RpcMethods class behind a service, carries applicable guards,
and validates its own payload (§4). The registry deliberately provides no way to expose a bare
function — the service/RpcMethods shape is the only extension mechanism.

## 3. The `hostRpc` back-channel

The application never holds the internal managers ([architecture.md](../architecture.md) §1). Its
one path into node services is `P2pInstance.hostRpc`
([`ClientHostRpc.ts`](../../../../../../../src/evm/p2pRuntime/ClientHostRpc.ts#L1)): a client-realm proxy that
mirrors the host's `remoteRpc` surface exactly (`RemoteRpcProxyType<TCustomRpc>`). A chained call
`hostRpc.<service>.<method>(...params).<delivery>(...args)` is captured verbatim, forwarded over
the runtime port as a `hostRpc` request, and replayed by the host on its live `remoteRpc`
([`dispatchHostRpc`](../../../../../../../src/evm/p2pRuntime/P2pRuntimeHost.ts#L579)); for `request` the host
awaits and returns the result.

Target semantics are those of §2.4, evaluated on the host: **no target → loopback to the local
host's own RPC surface; a peer address → typed relay of the same call to that remote peer.** Only
addresses can be targets from the client — transports are not serializable across the port. The
port is a pure proxy: new delivery methods on `RpcHandler` work through it with no protocol
change.

This design is intentional. The application can interact with local node services (e.g. drive a
custom negotiation service) and explicitly address another peer, all **through** the RPC boundary
— without receiving internal service objects, and without a second, unguarded path into the node.
A loopback delivery enters `P2PManager.onRpc` like any frame; the only privilege it carries is
`LoopbackTransport.isTrusted`, which skips peer-session guards (§5.3) — appropriate because the
caller is the local application, not a peer.

## 4. Type safety vs. Byzantine safety

These are two different properties and the specification states them plainly, because conflating
them is how ingress bugs happen:

- **Type safety protects local callers.** The typed proxy (§2.3) prevents ordinary local
  TypeScript code from constructing a wrong call. It constrains *senders compiled against this
  codebase* and nothing else.
- **Wire data is untrusted JSON.** A Byzantine peer does not use the proxy; it sends arbitrary
  frames. At receipt the dispatcher verifies exactly: frame size, envelope shape (`service` and
  `method` strings, `params` an array — [`deserializeRpc`](../../../../../../../src/rpc/Rpc.ts#L41)), service
  existence, guards, method existence, and (for replies) response shape and request correlation.
  It does **not** verify parameter arity, parameter types, or semantic validity — `params` is
  spread raw into the handler (`method(...rpc.params)`).

The canonical owners split this boundary deliberately: [`REQ-RPC-1-FF89Z0`](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) owns decoding and canonical payloads, [`REQ-RPC-3-ZM9WR5`](../../../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5) owns service authorization, and [`REQ-RPC-5-CV1R1Y`](../../../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y) owns resource bounds. Every RPC endpoint is an adversarial ingress point and MUST, before any
state effect: authenticate the caller or rely on an explicit applicable guard; decode its payload
(encoded protocol structs through [`Codec`](../../../../../../../src/utils/Codec.ts#L175), §6.3) treating decode
failure as a handled protocol failure, never an escaping exception; validate semantic constraints
(shape, ranges, protocol preconditions, authorization); and bound its resource use. Equivalent
input arriving from another ingress path (chain events, local recovery) must receive comparably
explicit validation before it affects the internal system
([block-confirmation-pipeline.md](../block-confirmation-pipeline.md) §2).

Under [`REQ-RPC-1-FF89Z0`](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0), bigint-bearing values MUST cross the RPC boundary as canonical
`Codec.encode` strings, never raw JSON. [`serializeRpc`](../../../../../../../src/rpc/Rpc.ts#L38) enforces this
mechanically: `JSON.stringify` throws on a raw `BigInt`, surfacing the offending method instead of
silently coercing to a lossy number, and the test harness deliberately installs no
`BigInt.prototype.toJSON` shim.

Type safety at the caller and Byzantine safety at the receiver are complementary requirements, not
substitutes. Examples of the split done right:
[`InitHandshakeRpcMethods.onInitHandshakeRequest`](../../../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts#L25)
rejects a non-32-byte challenge and a non-finite time *before signing anything* (a NaN would slip
past the skew comparison);
[`SpectateService.applySyncResponse`](../../../../../../../src/rpc/services/spectate/SpectateService.ts#L96)
decodes the peer's payload inside its failure handling so undecodable bytes become an aborted
sync, not an unhandled rejection;
[`JoinChannelService.signJoinRequest`](../../../../../../../src/rpc/services/joinChannel/JoinChannelService.ts#L137)
recovers and cross-checks the embedded signature, channel, deadline, fork, and snapshot before
producing its own signature.

## 5. Guards — first-class session gating

Guards gate a service's entire public surface on objective preconditions about the *caller*,
before any method logic runs. They are the boundary's authentication/admission layer, distinct
from the per-endpoint payload validation of §4.

### 5.1 Mechanism

A guard subclasses [`AGuard`](../../../../../../../src/rpc/guards/AGuard.ts#L15): `check(rpc, transport)`
returns pass/fail; `onFailure(rpc, transport)` runs on the first failing guard and owns the
consequence (it may disconnect, blacklist, queue-and-retry via `service.runRPC`, or delegate to an
injected callback). Services declare `this.guards = [...]` in their constructors;
[`runGuards`](../../../../../../../src/rpc/guards/runGuards.ts#L10) evaluates them **sequentially in
declaration order**, short-circuiting on the first failure. Ordering is therefore meaningful and
part of a service's contract (cheap/structural guards should precede expensive ones).

Placement in the dispatch path ([`ARpcService.runRPC`](../../../../../../../src/rpc/ARpcService.ts#L49)):
guards run **before the method-existence check** — an unauthenticated peer probing a guarded
service hits the guard consequence even for nonexistent methods, and learns nothing about the
service's method names.

**Trusted-transport exception.** Guards are skipped entirely when `transport.isTrusted` — true
for [`LoopbackTransport`](../../../../../../../src/transport/LoopbackTransport.ts#L13) (self-delivery,
and likewise for [`MessagePortTransport`](../../../../../../../src/transport/MessagePortTransport.ts#L1), the
process's own worker threads under a [`PortRpcRouter`](../../../../../../../src/rpc/PortRpcRouter.ts#L1) —
§2.4/§3); every network transport reports `false`
([`ATransport.isTrusted`](../../../../../../../src/transport/ATransport.ts#L46)).

**Rejection behavior.** On guard failure the RPC is consumed (never dispatched). For
request-style frames the dispatcher additionally sends `{ok: false, error: "RPC request rejected
by guard"}` so the remote caller's promise rejects instead of timing out.

### 5.2 HandshakeCompletedGuard

[`HandshakeCompletedGuard`](../../../../../../../src/rpc/guards/HandshakeCompletedGuard.ts#L41) is the one
built-in guard. `check` passes iff the sender transport maps to a `PeerProfile` with
`isHandshakeCompleted` — i.e. the peer's EVM identity was proven by the challenge/response
handshake (§7, `initHandshakeService`). All built-in services except `InitHandshakeService` use it
(`StateTransitionService`, `SpectateService`, `IsForkDisputedService`, `JoinChannelService`,
`WebRTCSetupService`, plus the unwired `OpenChannelNegotiationService`). `InitHandshakeService`
is deliberately unguarded — it *is* the authentication mechanism and must accept pre-session
traffic.

`onFailure` distinguishes two cases:

1. **Handshake in progress** (`initHandshakeService.isNegotiating(transport)`): the RPC is
   enqueued per-transport and a single waiter per transport waits up to `2 × agreementTime` for
   completion; on success queued RPCs are replayed in arrival order through `service.runRPC`; on
   timeout the queue is cleared and the peer is disconnected and blacklisted (by EVM address when
   known, else by transport).
2. **No negotiation in progress**: a guarded RPC over an unverified transport is treated as
   malicious — disconnect + blacklist immediately.

**Open question:** the guard's retry queue and the request/response path interact badly. On guard
failure `runRPC` *always* sends the `"rejected by guard"` error response when a `requestId` is
present — including in the queue-and-wait case — so a request-style RPC arriving during handshake
negotiation is rejected immediately at the caller, and when the queued copy is later replayed its
(second) response carries an already-settled `requestId` and is silently dropped by the caller's
[`handleRpcResponse`](../../../../../../../src/P2PManager.ts#L167). The retry queue therefore only benefits
fire-and-forget RPCs; whether request-style RPCs should instead be held without an early error
(or never queued) is undecided. A secondary wrinkle: in the non-negotiating branch `onFailure`
disconnects the transport *before* `runRPC` attempts to send that error response on it.
(Divergence class: decision pending; observed in
[`ARpcService.runRPC`](../../../../../../../src/rpc/ARpcService.ts#L49) +
[`HandshakeCompletedGuard`](../../../../../../../src/rpc/guards/HandshakeCompletedGuard.ts#L41).)

### 5.3 Requirements for future guards

Under [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk), the guard mechanism is the designated place for caller-scoped
admission decisions, and new pre-conditions of that kind MUST be expressed as explicit guards
rather than ad-hoc checks duplicated across endpoints: authorization (is this peer allowed to
invoke this service — e.g. participant vs. spectator), admission state (channel status, join
progress), and other objective preconditions. Guards MUST be side-effect-free in `check` (pure
predicate) with all consequences in `onFailure`; each guard MUST document its ordering
constraints, trusted-transport applicability, and rejection behavior. Endpoint-level validation
(§4) remains mandatory regardless of guards — a guard authenticates or admits the *caller*, never
the *payload*.

## 6. The wire contract, stage by stage

### 6.1 Envelope and response schema

One JSON object per frame ([`Rpc.ts`](../../../../../../../src/rpc/Rpc.ts#L1)):

```
Rpc          = { service: string, method: string, params: any[], requestId?: string }
RpcResponse  = { rpcResponse: true, requestId: string, ok: boolean, result?: any, error?: string }
```

`requestId` present ⇔ the sender expects exactly one `RpcResponse` with the same `requestId`.
`deserializeRpc` accepts a frame only if `service` and `method` are strings and `params` is an
array (the dispatcher spreads it); `deserializeRpcResponse` requires the `rpcResponse: true`
marker, a string `requestId`, and a boolean `ok`. Anything else is undecodable → sender
disconnected. Incoming frames are classified response-first: a frame matching the response shape
is routed to correlation handling and never to service dispatch.

There is **no protocol-version field** in the envelope — see §6.9.

### 6.2 Send path

`remoteRpc.<service>.<method>(...params)` builds the envelope (§2.3) → delivery handle (§2.4) →
[`ATransport.send`](../../../../../../../src/transport/ATransport.ts#L43) serializes with `serializeRpc` and
hands the string to the concrete transport's `_send`. Responses use `sendRpcResponse` /
`serializeRpcResponse` on the transport the request arrived on.

### 6.3 Encoding and decoding rules

The envelope itself is plain JSON; params and results MUST be JSON-serializable values.
Bigint-bearing ethers structs cross as `Codec.encode`d strings — ABI encoding against the
canonical ethers type strings ([`Codec`](../../../../../../../src/utils/Codec.ts#L175), `Type` enum covering
blocks, confirmations, joins, proofs, sync payloads, …) — and are `Codec.decode`d inside the
receiving endpoint ([`REQ-RPC-1-FF89Z0`](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)). One serialization mechanism (Codec) for all protocol structs;
raw `BigInt` in an envelope throws at the sender (§4). Examples on the wire:
`encodedSignedJoinChannel` (join), `encodedSyncPayload` (spectate);
`BlockConfirmationStruct` crosses as a JSON object whose numeric fields are strings/hex by ethers
struct convention and is authenticated and re-validated in the pipeline.

### 6.4 Receive path — the complete dispatch algorithm

[`P2PManager.onRpc(serializedRpc, transport)`](../../../../../../../src/P2PManager.ts#L1) is the single entry
point for every frame from every transport (network and loopback):

1. **Frame-size cap.** `Buffer.byteLength(serializedRpc, "utf8") > MAX_RPC_FRAME_BYTES` (16 MiB,
   [`Rpc.ts`](../../../../../../../src/rpc/Rpc.ts#L1)) → log, disconnect, stop — *before* any `JSON.parse`, so
   an oversized frame cannot force unbounded parse work. The cap is measured in wire-relevant UTF-8
   bytes; a frame exactly at the cap is admitted and the first byte over is rejected.
2. **Response classification.** If the frame decodes as an `RpcResponse` → correlation handling
   (§6.5), stop.
3. **Envelope verification.** `deserializeRpc` failure → disconnect.
4. **Service existence.** `rpc.service` must resolve on the local root to an object exposing
   complete public service shape (`hasRpcService`) → else disconnect.
5. **Guards** (inside `runRPC`, skipped for trusted transports): first failure → consequence per
   guard + error response if `requestId` (§5.1); frame consumed.
6. **Endpoint resolution.** The name must resolve to a function-valued own data property on the
   methods instance or its application prototype chain before `ARpcMethods.prototype` or
   `Object.prototype`; otherwise `runRPC` returns `false` → disconnect.
7. **Invocation.** `createRPCMethods(transport)` binds the sender; the method runs with `params`
   spread raw.
   - **Request path** (`requestId` present): the handler's awaited return value is sent as
     `{ok: true, result}`; a thrown/rejected error is caught, logged, and sent as
     `{ok: false, error}` — the connection is **kept** (deliberate: handler errors report to the
     caller instead of dropping the session).
   - **Fire-and-forget path:** an async rejection is logged and the sender is **disconnected**
     (no blacklist); a synchronous throw returns `false` → disconnect via `onRpc`.
8. **Dispatcher backstop.** Any exception escaping the above disconnects the transport.

```mermaid
flowchart TD
    F[transport frame] --> S{size ≤ 16 MiB?}
    S -- no --> D1[disconnect]
    S -- yes --> R{RpcResponse shape?}
    R -- yes --> C[correlation: requestId + addressed-peer check]
    R -- no --> E{valid Rpc envelope?}
    E -- no --> D2[disconnect]
    E -- yes --> SV{service exists on root?}
    SV -- no --> D3[disconnect]
    SV -- yes --> G{guards pass? &#40;skipped if trusted&#41;}
    G -- no --> GF[guard onFailure + error response if requestId]
    G -- yes --> M{method exists?}
    M -- no --> D4[disconnect]
    M -- yes --> H[RpcMethods handler: decode + validate + service call]
    H -- request path --> RESP[ok/error response to sender]
    H -- fire-and-forget error --> D5[disconnect]
```

A handled request makes one response-send attempt. If that send fails, the dispatcher logs the
transport failure and disconnects it without a second response or an unhandled rejection. This
resolves [`DEF-8-HWJ10N`](../../../../../audit/open-findings.md#def-8-hwj10n).

### 6.5 Correlation, timeout, cancellation, disconnect, and error semantics

[`P2PManager.sendRpcRequest`](../../../../../../../src/P2PManager.ts#L123):

- **Correlation.** `requestId` is a node-local monotonically increasing counter rendered as a
  string; the pending-request table maps it to `{resolve, reject, transport, timeout}`.
  Uniqueness is per sender per process; unpredictability is *not* relied on — response
  authenticity rests entirely on transport binding (below), not on guessing resistance.
- **Timeout.** Default `timeConfig.agreementTime` seconds (converted to ms), overridable per call
  via `{timeoutMs}`; scheduled on the `TimeoutManager`. Expiry removes the entry and rejects with
  a descriptive error. There is no cancellation API beyond the timeout — a caller cannot abort an
  in-flight request, and the remote handler is never cancelled (its late response is silently
  dropped, below).
- **Addressed-peer rule ([`REQ-RPC-2-SZDTTM`](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)).** Only the peer the request was sent to may settle it.
  [`handleRpcResponse`](../../../../../../../src/P2PManager.ts#L167) compares peer *identity*
  ([`ATransport.isSamePeer`](../../../../../../../src/transport/ATransport.ts#L28), checksum-address based) —
  not transport object identity — so a WebRTC upgrade still settles pending requests; a response
  from any other peer **blacklists and disconnects the responder**.
- **Unknown/late responses.** A response whose `requestId` has no pending entry (already settled,
  timed out, or never issued) is silently ignored — no disconnect. Unsolicited response spam is
  thus penalty-free (bounded only by frame handling; see §9).
- **Error propagation.** `{ok: false}` rejects the caller's promise with `Error(response.error)`.
  Remote error strings are attacker-controlled text; callers MUST NOT parse or branch on them for
  protocol decisions.
- **Disconnect.** `disconnectConnection` rejects every pending request bound to that transport
  object ("Peer disconnected before RPC response arrived") and cancels their timers. After a
  transport upgrade, requests issued on the *old* transport are rejected when it is retired
  (object-identity match in `rejectPendingRpcRequestsForTransport`), even though the peer remains
  connected — callers are expected to retry against the address, which resolves to the live
  transport.
- **Send failure.** A synchronous `transport.send` throw settles the request immediately and
  cancels its timer.

### 6.6 Scheduling and mutex boundaries

RPC handlers run as ordinary tasks on the single-threaded host runtime; nothing in the RPC layer
acquires the `StateManager` mutex. This is deliberate and load-bearing: peer ingest is the
cheap, mergeable, out-of-order regime, and only the downstream dequeue-and-execute path takes the
mutex ([block-confirmation-pipeline.md](../block-confirmation-pipeline.md) §3.1, [`REQ-BCP-3-1GCEH9`](../block-confirmation-pipeline.md#req-bcp-3-1gceh9)/4).
Consequently an RPC endpoint MUST NOT assume exclusive access to live state — it hands validated
input to the owning manager, which enforces its own concurrency discipline. The block-queue
boundedness argument also lands here: the queue deliberately has no cap of its own because the
*RPC layer* is the intended admission-control point (§9).

Inline-host deployments can wrap every incoming-RPC handler invocation in the integrator's
`handlerExecutionContext` ([architecture.md](../architecture.md) §1.1) — a scheduling hook, not a
security control.

### 6.7 Replay and idempotence expectations

The RPC layer itself has **no replay protection**: no nonces on requests, no dedup of identical
frames. Idempotence is an endpoint responsibility, and the built-ins illustrate the accepted
patterns:

- **Idempotent-by-merge.** Block confirmations: re-delivery merges signatures (set union); a
  duplicate is a no-op (`DUPLICATE`) — replay is harmless by construction
  ([block-confirmation-pipeline.md](../block-confirmation-pipeline.md) §3.1).
- **Replay-as-violation.** A duplicate handshake ack and a duplicate dispute-acknowledgment
  request are protocol violations → disconnect + blacklist
  ([`InitHandshakeRpcMethods.onInitHandshakeAck`](../../../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts#L114),
  [`IsForkDisputedRpcMethods`](../../../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods.ts#L6)).
- **Concurrency-limited.** Spectate allows one in-flight sync per peer (`inFlightByPeerAddress`).

Under [`REQ-RPC-4-9VX0B9`](../../../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9), every endpoint MUST be explicitly one of: idempotent under re-delivery,
or replay-rejecting with a defined consequence. An endpoint whose replay silently double-applies a
state effect is a defect.

### 6.8 Service lifecycle, disposal, transport replacement

- **Construction.** Root and services are built once per `P2PManager` (per runtime); services are
  long-lived singletons; RpcMethods instances are per-dispatch and stateless beyond
  `senderTransport`.
- **Disposal.** `StateManager.dispose()` awaits `localRpc.dispose()` (custom-root drain hook,
  §2.2), then `P2PManager.dispose()` disconnects all transports — rejecting all pending requests —
  and disposes discovery. Handlers already in flight are not cancelled; long-running service work
  checks `stateManager.isDisposed` at its own checkpoints (e.g.
  [`InitHandshakeService.maybeFinalizeHandshakeOnceFromTransport`](../../../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts#L238)).
- **Transport replacement.** Peer identity is the EVM address; profiles (and blacklist state)
  survive transport churn ([`ProfileManager`](../../../../../../../src/ProfileManager.ts#L7), [`INV-SDK-6-CCG31H`](../components.md#inv-sdk-6-ccg31h)). The
  WebRTC upgrade retires the old transport after an `agreementTime` grace; address-targeted
  delivery always resolves the current transport, and response correlation tolerates the upgrade
  (§6.5). Services that must survive churn key their state by address, not transport
  (IsForkDisputed acks, spectate in-flight set); handshake negotiation state is deliberately
  transport-keyed (`WeakMap`/`WeakSet`) because it *is* per-connection.

### 6.9 Versioning and compatibility

**Current:** there is no protocol-version negotiation anywhere in the RPC layer. The envelope has
no version field; no version is exchanged in the handshake; the only versioned identifier on the
wire is the handshake domain string `peer3:init-handshake:v1` ([`REQ-SDK-3-91XMZR`](../components.md#req-sdk-3-91xmzr)), which scopes exactly
one message type. Two peers running incompatible SDK revisions discover it only through
downstream failures (unknown service/method → disconnect; undecodable Codec payloads → endpoint
failure).

**Intended:** an explicit compatibility policy is required before production — at minimum a
protocol version established at handshake time with a defined mismatch outcome (refuse the
session cleanly rather than blacklist), and its relationship to the signature-domain decision in
[`OQ-29-EFY4NF`](../../../../../specification/open-questions.md#oq-29-efy4nf) (which must bind protocol version into signed domains). Divergence
class: **missing**. **Open question:** the concrete versioning scheme (wire-envelope field vs.
handshake exchange, compatibility ranges, coupling to [`OQ-29-EFY4NF`](../../../../../specification/open-questions.md#oq-29-efy4nf)'s domain tags) is undesigned.

## 7. Built-in services — summaries

The per-endpoint deep content — algorithm, endpoint validation, Byzantine assessment, invariants,
verification — lives in the per-service documents ([Service documents](#service-documents) above).
This section keeps only the one-line ingress summary. All services except `initHandshakeService`
are behind `HandshakeCompletedGuard`; component-level summary table in
[components.md](../components.md) §2.

- **`initHandshakeService`** ([handshake.md](./handshake.md)) — unguarded challenge/response
  authenticator; completion marks the session authenticated (opening every guarded service) and
  may start the WebRTC upgrade and post-handshake sync. Malformed requests and duplicate acks
  carry disconnect/blacklist consequences (§8).
- **`stateTransitionService`** ([state-transition.md](./state-transition.md)) — one-way
  block-confirmation gossip; the **sole peer entry** into the block-confirmation pipeline
  ([block-confirmation-pipeline.md](../block-confirmation-pipeline.md) §4).
- **`spectateService`** ([spectate.md](./spectate.md)) — request/response proof-backed sync under
  the mutual-cooperation rule; outgoing failure handling over-blacklists (**[`DEF-5-E8TP9N`](../../../../../audit/open-findings.md#def-5-e8tp9n)**,
  [../../open-questions.md](../../../../../specification/open-questions.md)).
- **`isForkDisputedService`** ([is-fork-disputed.md](./is-fork-disputed.md)) — one
  dispute-acknowledgment round per disputed fork per peer; violations → disconnect + blacklist
  (dispute context: [dispute-pipeline.md](../dispute-pipeline.md)).
- **`joinChannelService`** ([join-channel.md](./join-channel.md)) — request/response
  join-signature collection with the full [`REQ-RPC-3-ZM9WR5`](../../../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5) authorization chain; validation failures are
  penalty-free request errors.
- **`webRTCSetupService`** ([webrtc-setup.md](./webrtc-setup.md)) — one-way WebRTC signaling;
  every failure is caught and logged only — silent ignore.
- **`openChannelNegotiationService`**
  ([open-channel-negotiation.md](./open-channel-negotiation.md)) — open-terms negotiation;
  exported but **unwired** by default. Invalid or out-of-sequence input returns early — silent
  ignore. Wiring decision tracked in [components.md](../components.md) Future Work.

## 8. Outcome classification — what each failure does

Verified consequences per failure class. "Blacklist" is by EVM address on the `PeerProfile`
(survives transport churn); blacklisting a transport with **no profile yet is a disconnect only**
(the optional-chained `profile?.blacklist()` in
[`disconnectAndBlacklistPeer`](../../../../../../../src/P2PManager.ts#L174) is a no-op) — pre-handshake
"blacklist" outcomes are therefore weaker than they read. **Open question:** whether pre-profile
blacklisting should pin the transport-level address (when present) so a rejected peer cannot
simply reconnect; today only `disconnectAndBlacklistPeerByEvmAddress` paths persist the ban.
(Divergence class: decision pending.)

| Failure | Where | Consequence |
| --- | --- | --- |
| Oversized frame | `onRpc` step 1 | Disconnect |
| Undecodable frame / bad envelope | `onRpc` step 3 | Disconnect |
| Unknown service | `onRpc` step 4 | Disconnect |
| Unknown method | `runRPC` | Disconnect |
| Guard failure — unverified transport | `HandshakeCompletedGuard` | Disconnect + blacklist (+ error response if request) |
| Guard failure — handshake in progress | `HandshakeCompletedGuard` | Queue + retry after handshake; timeout → disconnect + blacklist; request-style additionally gets an immediate error (see §5.2 open question) |
| Request handler throws | `runRPC` request path | Error response; connection kept |
| Fire-and-forget handler rejects/throws | `runRPC` | Disconnect (no blacklist) |
| Malformed handshake request / skew violation | `initHandshakeService` | Disconnect + request error |
| Duplicate handshake ack | `initHandshakeService` | Disconnect + blacklist |
| Handshake response invalid/timeout (outgoing) | `initHandshakeService` | Disconnect |
| Handshake ack timeout | `initHandshakeService` | Blacklist by verified address, else disconnect |
| Block confirmation judged Byzantine (strategy verdict `false`) | `stateTransitionService` → pipeline | Disconnect + blacklist |
| Block confirmation invalid but tolerated (duplicate, wrong fork, unknown sender…) | pipeline strategies | Ignore (entry dropped or queued; connection kept) — see [block-confirmation-pipeline.md](../block-confirmation-pipeline.md) §9 |
| Provable equivocation / invalid transition in ingested blocks | pipeline, not RPC layer | Fraud-proof / dispute work ([dispute-pipeline.md](../dispute-pipeline.md)); the RPC layer itself never constructs proofs |
| Unprovable spectate request | `spectateService` responder | Disconnect + blacklist requester + request error |
| Spectate sync failure (outgoing, any cause) | `spectateService` caller | Disconnect + blacklist responder — **[`DEF-5-E8TP9N`](../../../../../audit/open-findings.md#def-5-e8tp9n)**, over-broad |
| Fork-not-disputed / duplicate dispute-ack request | `isForkDisputedService` responder | Disconnect + blacklist + request error |
| Dispute-ack rejection/error/timeout (outgoing) | `isForkDisputedService` caller | Disconnect + blacklist |
| Join-signature validation failure | `joinChannelService` | Request error only; connection kept |
| WebRTC signaling failure (any) | `webRTCSetupService` | Silent ignore |
| Response from non-addressed peer | `handleRpcResponse` | Disconnect + blacklist responder |
| Response with unknown/expired `requestId` | `handleRpcResponse` | Silent ignore |

**Open question:** the classification is inconsistent across services in ways no recorded decision
explains: join-signature abuse is penalty-free (error only) while an unprovable spectate request
is an immediate permanent blacklist; fire-and-forget handler errors disconnect but request handler
errors keep the connection (letting a peer probe guarded request endpoints with invalid payloads
indefinitely at zero cost); WebRTC signaling swallows everything. Each choice is individually
defensible (join requests can be honestly stale; request errors are the documented contract;
signaling is best-effort), but the intended per-class policy — *which* failures are Byzantine
evidence vs. honest-failure tolerable — has never been stated and should be decided once,
centrally, rather than per endpoint. (Divergence class: decision pending.)

## 9. Rate limiting

**Current:** the only resource bound at this boundary is the 16 MiB frame cap (§6.4) plus
per-entry structural caps downstream in the block queue. Nothing prevents a peer from sending an
unbounded *number* of individually valid RPCs — handshake attempts, spectate requests (each
triggering proof generation, which is expensive), join-signature requests (penalty-free errors,
§8), block confirmations (each scheduling ingest work), or unsolicited responses (silently
ignored but parsed). Remote peers can therefore consume unbounded CPU, memory, bandwidth, and
scheduled-task capacity. Divergence class: **missing** (accepted direction, not implemented).

**Intended (engineer direction, 2026-08-10 — [`OQ-6-4JPNE5`](../../../../../specification/open-questions.md#oq-6-4jpne5)):** enforcement lives in
a **single, central rate limiter at the RPC level**, shared across all RPC services (possibly
scoped per peer) — deliberately *not* per-service limits — so one clean mechanism protects
everything, including custom-root services that would otherwise each reinvent (or forget)
limiting. The natural seat is the common dispatch path (`P2PManager.onRpc`), upstream of parse
and dispatch. This limiter is also what bounds the pre-execution block queue: a finite admission
rate times the fixed entry lifetime gives a bounded queue, so the queue needs no cap of its own
([block-confirmation-pipeline.md](../block-confirmation-pipeline.md) §3.1).

Open design content within [`OQ-6-4JPNE5`](../../../../../specification/open-questions.md#oq-6-4jpne5) (required before production):

- **Rate and burst** — the unit of limiting (frames, bytes, admission cost) and steady-state vs.
  burst allowances.
- **Queue/backpressure** — whether over-limit frames are dropped, delayed, or answered with an
  explicit throttle error, and how that interacts with request timeouts.
- **Prioritization** — the node MUST remain responsive to protocol-critical recovery and dispute
  messages under load; a priority scheme (e.g. dispute/handshake traffic above bulk sync) is part
  of the design.
- **Identity scope** — per-peer (EVM address) vs. per-transport vs. global, and pre-handshake
  attribution when no address is proven yet.
- **Resource accounting** — whether expensive endpoints (spectate proof generation) carry a
  higher cost than cheap ones under the single limiter.
- **Penalties** — whether exceeding limits is throttled (honest-burst tolerant) or escalates to
  disconnect/blacklist, and the thresholds between those.
- **Sub-question (within [`OQ-6-4JPNE5`](../../../../../specification/open-questions.md#oq-6-4jpne5)):** whether an additional fixed per-peer limit — or any per-service
  granularity on top of the central limiter — is wanted at all. The decided direction is the
  single shared limiter; per-service granularity is open only as this narrower refinement.

## 10. Assumptions, constraints & dependencies

- Single JS realm per host; handlers interleave via the scheduler, never preemptively
  ([components.md](../components.md) §11). The RPC layer holds no locks (§6.6).
- Peer identity and blacklist state depend on `ProfileManager` and the handshake service;
  transport-level addresses are untrusted until handshake verification writes the checksummed
  address onto the transport.
- Timeouts are denominated in `timeConfig.agreementTime`, read from the chain
  ([../protocol/time.md](../../../../../specification/protocol-model/time.md)); clock quality per
  [`Clock`](../../../../../../../src/Clock.ts#L3).
- Trust context: peers are Byzantine; the transport provides no authentication or delivery
  guarantees ([../security/trust-model.md](../../../../../specification/security/trust-model.md), RPC observation
  assumptions in [../security/open-security-review.md](../../../../../audit/security-assessment.md)).
- Full-mesh topology: broadcast cost is O(peers); design target is small partitions.

## 11. Canonical requirement ownership

The neutral [RPC specification](../../../../../specification/peer-communication/rpc.md#requirements-and-invariants)
is the only owner of canonical RPC requirement and test-plan meanings. This implementation view
records status and evidence without redefining those IDs.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| --- | --- | --- | --- |
| [`INV-RPC-1-SJS2T6`](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6) | Partial | Handshake and service reports prove mutual success, pre-auth rejection, and half-auth isolation. | Forged, stale, and reconnect identity permutations remain exact-evidence gaps where no mapped test exists. |
| [`REQ-RPC-1-FF89Z0`](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Partial | `Rpc`, `Codec`, transport, cross-module, and service reports own wire and structural evidence. | Version-mismatch handling is absent. |
| [`REQ-RPC-2-SZDTTM`](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm) | Partial | `P2PManager` owns response, error, timeout, disconnect, peer binding, cleanup, and disposal; `ARpcService` owns one-attempt response delivery. | No cancellation API exists. |
| [`REQ-RPC-3-ZM9WR5`](../../../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5) | Partial | Service-owned block, sync, join, dispute, and signaling reports. | Join has one complete mapped matrix. Block, sync, dispute, transport-upgrade, and unwired open-channel authorization remain unassigned where no single declaration proves the full family oracle. |
| [`REQ-RPC-4-9VX0B9`](../../../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9) | Partial | Service-owned block merge/order, handshake replay, dispute replay, and sync concurrency evidence. | Block-delivery retry after failure has no exact no-duplicate-effect oracle. |
| [`REQ-RPC-5-CV1R1Y`](../../../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y) | Missing | The fixed frame cap and sync in-flight limit provide narrow local bounds. | No central pending-count, aggregate, per-peer, proof-work, or signaling-work bound; see [`OQ-6-4JPNE5`](../../../../../specification/open-questions.md#oq-6-4jpne5). |
| [`REQ-RPC-6-E60S4J`](../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) | Covered | `P2PManager` and `ARpcService` own the ordered ingress and endpoint-resolution stages. | None demonstrated. |
| [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) | Partial | `runGuards`, `HandshakeCompletedGuard`, `ARpcService`, and loopback/network tests. | Request-style retry is ineffective during negotiation; see [`OQ-34-FY08V2`](../../../../../specification/open-questions.md#oq-34-fy08v2). |
| [`REQ-RPC-8-44XECF`](../../../../../specification/peer-communication/rpc.md#req-rpc-8-44xecf) | Missing | No compatibility field or handshake negotiation exists. | All compatibility permutations remain unassigned under [`OQ-34-FY08V2`](../../../../../specification/open-questions.md#oq-34-fy08v2). |

## 12. Implementation integration test plan

Canonical permutation meanings stay in the neutral specification. These integration IDs group
cross-file implementation evidence and link to those canonical owners.

| Integration test ID | Canonical owners | Setup and expected result | Required permutations |
| --- | --- | --- | --- |
| <a id="integration-test-rpc-2-pbz4qy"></a>`INTEGRATION-TEST-RPC-2-PBZ4QY` | [`INV-RPC-1-SJS2T6`](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6), [`REQ-RPC-6-E60S4J`](../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) | Dispatch authenticated and unauthenticated frames through real sessions; failed ingress stays isolated from unrelated sessions. | <a id="integration-test-rpc-2-pbz4qy.p1"></a>`INTEGRATION-TEST-RPC-2-PBZ4QY.P1` authenticated dispatch; <a id="integration-test-rpc-2-pbz4qy.p2"></a>`INTEGRATION-TEST-RPC-2-PBZ4QY.P2` pre-auth rejection; <a id="integration-test-rpc-2-pbz4qy.p3"></a>`INTEGRATION-TEST-RPC-2-PBZ4QY.P3` crafted endpoint isolation; <a id="integration-test-rpc-2-pbz4qy.p4"></a>`INTEGRATION-TEST-RPC-2-PBZ4QY.P4` multibyte oversized offender isolation. |
| <a id="integration-test-rpc-3-zkfxgt"></a>`INTEGRATION-TEST-RPC-3-ZKFXGT` | [`REQ-RPC-2-SZDTTM`](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm) | Race every implemented settlement outcome and require one winner plus registry/timer cleanup. | <a id="integration-test-rpc-3-zkfxgt.p1"></a>`INTEGRATION-TEST-RPC-3-ZKFXGT.P1` response/error/send cleanup; <a id="integration-test-rpc-3-zkfxgt.p5"></a>`INTEGRATION-TEST-RPC-3-ZKFXGT.P5` disposal cleanup; <a id="integration-test-rpc-3-zkfxgt.p6"></a>`INTEGRATION-TEST-RPC-3-ZKFXGT.P6` response/timeout; <a id="integration-test-rpc-3-zkfxgt.p7"></a>`INTEGRATION-TEST-RPC-3-ZKFXGT.P7` response/disconnect; <a id="integration-test-rpc-3-zkfxgt.p8"></a>`INTEGRATION-TEST-RPC-3-ZKFXGT.P8` replacement/unknown/duplicate response; <a id="integration-test-rpc-3-zkfxgt.p9"></a>`INTEGRATION-TEST-RPC-3-ZKFXGT.P9` remote-error/timeout; <a id="integration-test-rpc-3-zkfxgt.p10"></a>`INTEGRATION-TEST-RPC-3-ZKFXGT.P10` response/remote-error; <a id="integration-test-rpc-3-zkfxgt.p11"></a>`INTEGRATION-TEST-RPC-3-ZKFXGT.P11` remote-error/disconnect; <a id="integration-test-rpc-3-zkfxgt.p12"></a>`INTEGRATION-TEST-RPC-3-ZKFXGT.P12` timeout/disconnect; <a id="integration-test-rpc-3-zkfxgt.p13"></a>`INTEGRATION-TEST-RPC-3-ZKFXGT.P13` foreign responder; <a id="integration-test-rpc-3-zkfxgt.p14"></a>`INTEGRATION-TEST-RPC-3-ZKFXGT.P14` concurrent distinct/duplicate response. |
| <a id="integration-test-rpc-4-exz35f"></a>`INTEGRATION-TEST-RPC-4-EXZ35F` | [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) | Run guards in order across trusted loopback and untrusted network paths; one failure owns the consequence. | <a id="integration-test-rpc-4-exz35f.p1"></a>`INTEGRATION-TEST-RPC-4-EXZ35F.P1` order and short-circuit; <a id="integration-test-rpc-4-exz35f.p2"></a>`INTEGRATION-TEST-RPC-4-EXZ35F.P2` loopback bypass; <a id="integration-test-rpc-4-exz35f.p3"></a>`INTEGRATION-TEST-RPC-4-EXZ35F.P3` pre-handshake consequence; <a id="integration-test-rpc-4-exz35f.p4"></a>`INTEGRATION-TEST-RPC-4-EXZ35F.P4` unrelated-session isolation. |
| <a id="integration-test-rpc-5-acp2qt"></a>`INTEGRATION-TEST-RPC-5-ACP2QT` | [`REQ-RPC-1-FF89Z0`](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Install one structural custom root and deliver through inline and worker hosts. | <a id="integration-test-rpc-5-acp2qt.p1"></a>`INTEGRATION-TEST-RPC-5-ACP2QT.P1` structural recognition; <a id="integration-test-rpc-5-acp2qt.p2"></a>`INTEGRATION-TEST-RPC-5-ACP2QT.P2` inline host; <a id="integration-test-rpc-5-acp2qt.p3"></a>`INTEGRATION-TEST-RPC-5-ACP2QT.P3` worker host; <a id="integration-test-rpc-5-acp2qt.p4"></a>`INTEGRATION-TEST-RPC-5-ACP2QT.P4` request/error delivery. |
| <a id="integration-test-rpc-6-009egg"></a>`INTEGRATION-TEST-RPC-6-009EGG` | [`REQ-RPC-3-ZM9WR5`](../../../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5), [`REQ-RPC-4-9VX0B9`](../../../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9) | Reuse service-owned authorization and replay tests; no shared omnibus test duplicates their payload matrices. | <a id="integration-test-rpc-6-009egg.p3"></a>`INTEGRATION-TEST-RPC-6-009EGG.P3` join authorization; <a id="integration-test-rpc-6-009egg.p4"></a>`INTEGRATION-TEST-RPC-6-009EGG.P4` handshake replay; <a id="integration-test-rpc-6-009egg.p5"></a>`INTEGRATION-TEST-RPC-6-009EGG.P5` dispute replay; <a id="integration-test-rpc-6-009egg.p6"></a>`INTEGRATION-TEST-RPC-6-009EGG.P6` block authorization; <a id="integration-test-rpc-6-009egg.p7"></a>`INTEGRATION-TEST-RPC-6-009EGG.P7` sync authorization; <a id="integration-test-rpc-6-009egg.p8"></a>`INTEGRATION-TEST-RPC-6-009EGG.P8` block merge; <a id="integration-test-rpc-6-009egg.p9"></a>`INTEGRATION-TEST-RPC-6-009EGG.P9` sync concurrency. |
| <a id="integration-test-rpc-7-p5rcgj"></a>`INTEGRATION-TEST-RPC-7-P5RCGJ` | [`REQ-RPC-1-FF89Z0`](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0), [`REQ-RPC-2-SZDTTM`](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm), [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) | Serve one root over a trusted worker port: the same envelope and correlation core as the peer path, guards bypassed only because the transport is trusted, an unknown name answered rather than disconnected, closure settling only that line's requests. | <a id="integration-test-rpc-7-p5rcgj.p1"></a>`INTEGRATION-TEST-RPC-7-P5RCGJ.P1` trusted-port dispatch and reply; <a id="integration-test-rpc-7-p5rcgj.p2"></a>`INTEGRATION-TEST-RPC-7-P5RCGJ.P2` far error restored in full; <a id="integration-test-rpc-7-p5rcgj.p3"></a>`INTEGRATION-TEST-RPC-7-P5RCGJ.P3` unknown name answered, line kept; <a id="integration-test-rpc-7-p5rcgj.p4"></a>`INTEGRATION-TEST-RPC-7-P5RCGJ.P4` closure settles only that line |

## Future Work

*Non-normative.*

- The central RPC rate limiter ([`OQ-6-4JPNE5`](../../../../../specification/open-questions.md#oq-6-4jpne5)) and its prioritization scheme (§9).
- Protocol-version negotiation at handshake time (§6.9), coordinated with the signature-domain
  decision ([`OQ-29-EFY4NF`](../../../../../specification/open-questions.md#oq-29-efy4nf)).
- A uniform failure-outcome policy (which failure classes are Byzantine evidence vs. tolerable),
  replacing today's per-endpoint choices (§8), including revisiting [`DEF-5-E8TP9N`](../../../../../audit/open-findings.md#def-5-e8tp9n).
- Guard library growth per §5.3: participant-authorization and admission-state guards, so
  services like `spectateService`/`joinChannelService` stop re-deriving caller status inline.
- Persist pre-profile bans by transport-level address (§8 open question).
- Wire `OpenChannelNegotiationService` or document integrator wiring as the supported path
  ([open-channel-negotiation.md](./open-channel-negotiation.md);
  [components.md](../components.md) Future Work).

## Implementation traceability

The detailed status table in [Canonical requirement ownership](#canonical-requirement-ownership)
is authoritative for this view. Source-level evidence remains in the linked reports, and exact
test assignments remain in verification reports. The neutral specification owns all canonical
test-plan meanings; unsupported cancellation, central rate limiting, compatibility negotiation,
and open-channel wire authorization stay visible as gaps rather than receiving partial mappings.
