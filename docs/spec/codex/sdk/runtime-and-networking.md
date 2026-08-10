# SDK runtime, RPC, transport, workers, and lifecycle

## Status and authority

This chapter defines runtime ownership and network execution. Protocol mesh and resource rules are in [network topology](../protocol/network-topology-and-trust.md).

## 1. Purpose

The runtime must expose one stable peer API while running in Node or browser, main thread or worker, and across several transports. It must preserve signer custody, request identity, channel isolation, error ownership, and clean shutdown across those variants.

## 2. Design decisions and rationale

### 2.1 Separate host authority from worker execution

Provider access, real signers, application callbacks, and process lifecycle remain with the host. EVM and P2P runtime work may run in workers. Worker messages use explicit request and event protocols; workers do not gain direct access to secrets or arbitrary host globals.

### 2.2 RPC services are registered capabilities

The runtime exposes a fixed main RPC tree plus an explicit custom manifest. A peer cannot call arbitrary object methods by property traversal. Each service creates methods bound to one transport and is guarded by handshake and role policy.

### 2.3 Transport failures are isolated

A broken WebRTC or Holepunch link closes one peer generation. It does not reject requests on other transports, dispose the state manager, or change protocol state by itself.

### 2.4 Signer roles are separate

Chain transaction signing, P2P message signing, local contract execution, deployment bridging, and nonce management use distinct adapters. A local EVM signer must not accidentally broadcast to the production chain, and a P2P signer must not receive unrestricted transaction authority.

## 3. Boundary and responsibilities

`P2pInstance` composes provider, signers, contract artifacts, state manager, storage, P2P manager, services, and workers. Runtime host/client classes proxy public API and events across a worker boundary. `P2PManager` owns connected transports and pending RPC requests. RPC registry resolves allowed services. Transport classes own connection-specific send and close.

## 4. Data model and owned state

### 4.1 Runtime identity

A runtime is bound to chain ID, manager address and code version, channel ID when selected, local participant address, application artifact versions, storage namespace, and lifecycle generation.

### 4.2 RPC envelope

Every request includes request ID, service and method identity, encoded arguments, and protocol version. Every response includes the same request ID and either encoded result or typed error. The receiving transport and authenticated peer are implicit security context and must not be caller-supplied payload fields.

### 4.3 Pending request record

A pending call stores request ID, target transport generation, expected peer address, deadline, resolve/reject owners, response decoder, and cancellation signal. Response from another transport or generation does not satisfy it.

### 4.4 Worker request record

Worker protocols use monotonically unique request IDs within runtime generation. Records include method, serialized inputs, deadline, owner, and transferred objects. Events use a separate namespace so a late event cannot resolve a call.

## 5. Inputs and preconditions

Runtime construction requires valid provider, signer adapters, contract artifacts, application state-machine and consumer artifacts, config, storage, logger, and supported environment features. Worker mode requires loadable worker entry and structured-clone-safe public inputs.

An RPC request executes only on active runtime, active authenticated transport, completed handshake, allowed role, registered service/method, valid argument schema, and available resource budget.

## 6. Processing algorithm

### 6.1 Runtime construction

1. Resolve config with precedence explicit override, environment, config file, then defaults.
2. Validate numeric bounds, URLs, worker flags, log config, and supported transport combination.
3. Bind provider network and initialize chain clock.
4. Create or open storage before any incoming callback can run.
5. Build signer adapters with minimum required authority.
6. Deploy or attach local EVM contracts and verify artifact code hashes.
7. Construct state, agreement, dispute, event, queue, reduction, and snapshot managers.
8. Construct RPC services and registry.
9. Start worker and transport listeners only after owners exist.
10. Replay state and move lifecycle to synchronizing.

Failure tears down all already created resources in reverse order.

### 6.2 Handshake

1. Transport opens in unauthenticated state.
2. Each side sends fresh random challenge plus chain, manager, channel, version, role, and preferred transport data.
3. Remote signs a domain-separated challenge string with P2P participant signer.
4. Verifier recovers address, checks expected membership or spectator policy, and binds it to transport generation.
5. Both sides exchange acknowledgment.
6. Only after acknowledgment does the handshake guard permit channel services.
7. Timeout or any mismatch closes the generation and rejects its pending requests.

Challenge hashes need replay cache until expiry. Domain separation includes protocol name, chain, manager, channel, transport generation, and direction.

### 6.3 RPC receive

1. Enforce outer 16 MiB frame cap and stricter method cap before parse.
2. Decode envelope and reject unknown or duplicate request ID.
3. Resolve service and method from static registry.
4. Run handshake, role, lifecycle, channel, and rate guards.
5. Validate argument schema and nested size.
6. Execute with transport-scoped context and cancellation.
7. Encode bounded result or stable typed error.
8. Send only if same transport generation remains active.

### 6.4 RPC request

1. Resolve target address to one authenticated active transport.
2. Allocate request ID and durable or in-memory pending owner.
3. Register timeout before send.
4. Send serialized request.
5. On response, verify transport generation and request ID, clear timeout, decode, and settle once.
6. On disconnect, disposal, or timeout, reject once and remove record.

Protocol-critical requests may retry another authenticated transport or peer only when the method is idempotent and result is independently validated.

### 6.5 Broadcast

Snapshot active connections, encode payload once, and schedule independent sends. Report per-peer failures. Do not mutate the connection set while iterating it. A broadcast API must not imply delivery or protocol acceptance.

### 6.6 Worker call

1. Host checks runtime generation and method allowlist.
2. Serialize signer references as limited host callbacks, never raw keys.
3. register pending request and deadline;
4. post request with explicit transfer list;
5. worker executes in its owned runtime and returns result or serialized error;
6. host validates response generation and settles once;
7. worker exit rejects all pending calls and moves runtime to degraded or disposed state.

### 6.7 Disposal

Disposal is idempotent. It stops service acceptance, cancels timers and request waiters, removes provider and transport listeners, aborts workers, drains storage, and closes connections. Every component’s `dispose` may be called after partial initialization.

## 7. Outputs and postconditions

A started runtime has one owner for every callback and can state its current chain, manager, channel, signer, and generation. An authenticated transport has one peer address. A settled request leaves no timeout or pending record. Disposal leaves no listener, connection, timer, worker, or unresolved promise owned by the runtime.

## 8. Invariants

- **RUN-INV-1:** one transport generation binds to at most one authenticated peer.
- **RUN-INV-2:** handshake proof is domain-separated and not replayable across channel or generation.
- **RUN-INV-3:** response settles only the request created for that transport generation.
- **RUN-INV-4:** registry lookup cannot reach unregistered prototype or object methods.
- **RUN-INV-5:** worker receives no broader signer capability than the requested operation.
- **RUN-INV-6:** per-peer failure does not stop other broadcasts.
- **RUN-INV-7:** every timeout, listener, detached promise, and worker request has an owner and cancellation path.
- **RUN-INV-8:** lifecycle generation rejects late callbacks after restart or disposal.

## 9. Ordering, concurrency, and atomicity

RPC methods run concurrently until they reach state-manager mutation. Pending request maps and connection maps need atomic check-and-set around IDs and generations. Handshake completion and disconnect may race; only the generation still registered as active can transition to authenticated.

Worker calls may complete out of order. Request IDs pair results. Host event forwarding preserves per-source sequence and includes a sequence number when state order matters.

## 10. Trust and security assumptions

Transport encryption protects links according to the transport, but protocol authenticity comes from signatures and handshake binding. Relays and signaling services can observe metadata or deny service. Custom RPC manifests are trusted application code and require resource and authorization review.

Serialized errors and logs may contain state, peer, or transaction data. Redaction rules apply before upload. Crash upload credentials remain host-only.

## 11. Failure behavior and recovery

Unknown method, guard failure, bad schema, size violation, or rate violation returns typed error or closes an abusive connection. Handler exception affects one request. State corruption or worker crash moves channel to degraded and stops signing.

Provider replacement reinitializes clock and event sync. Worker restart requires rebuilding its local EVM from durable state and canonical events before active work resumes.

## 12. Current implementation

`P2PManager` owns connections and pending requests. `InitHandshakeService` tracks in-flight, acknowledged, and completed transports. RPC registry and `HandshakeCompletedGuard` gate methods. Runtime host/client and worker modules proxy SDK execution. Signer adapters separate several roles. Transport classes cover local, loopback, WebRTC, and Holepunch.

Current config is a process-lifespan singleton. RPC request timeout is derived from `agreementTime`. The outer RPC cap is 16 MiB. There is no complete per-method rate and byte policy, durable pending-operation recovery, or lifecycle generation on every callback path.

## 13. Difference from the intended design

| Classification     | Difference                                                                           |
| ------------------ | ------------------------------------------------------------------------------------ |
| missing            | explicit domain fields and replay cache contract for every handshake path            |
| missing            | per-method schema, byte, work, and rate limits                                       |
| missing            | complete lifecycle generation checks for late callbacks                              |
| missing            | durable recovery policy for submitted chain operations and critical RPC work         |
| documentation debt | process-wide mutable config makes multiple differently configured runtimes difficult |
| missing            | formal signer capability matrix and worker secret audit                              |
| missing            | degraded-state and worker restart behavior across all public APIs                    |

## 14. Dependencies and cross-layer effects

Block and dispute pipelines rely on authenticated RPC, timeouts, worker execution, and cancellation. Storage and event sync control restart readiness. Network rate policy affects how often users pay chain fallback fees.

## 15. Verification

Tests must cover partial construction failure, repeated disposal, provider replacement, every transport, handshake replay and wrong domain, duplicate connections, disconnect during request, late response, ID collision, unregistered method traversal, oversized and deeply nested input, rate exhaustion, broadcast partial failure, worker crash at each operation, signer capability escape attempt, and zero live handles after disposal.

## 16. Future work

Multiple channels in one process should use instance-scoped config and resource budgets. Shared workers may improve cost only if channel isolation and fair scheduling remain explicit.
