# Network topology, peer identity, and resource control

## Status and authority

This chapter defines the intended small-group P2P model and its limits. Exact gossip rate thresholds are unresolved and required before production.

## 1. Purpose

Peers need low-latency block, signature, and recovery data exchange without trusting a central relay. The network must keep one malicious or slow peer from exhausting resources or blocking connections to honest participants.

## 2. Design decisions and rationale

### 2.1 Full mesh for small channels

Every active participant attempts a direct logical connection to every other active participant. For the target size, full mesh reduces relay trust, gives each peer independent data sources, and supports all-participant confirmation.

This is not a general large-network gossip protocol. At ten participants there are 45 pairwise links. Beyond the supported limit, connection, broadcast, signature, and proof costs need a different design.

### 2.2 Transport is replaceable, identity is not

Local, WebRTC, and Holepunch transports may carry the same RPC frames. The authenticated channel participant address and handshake challenge define protocol identity. A relay URL or socket identity does not.

### 2.3 At least one honest peer per relevant partition

Safety and recovery assume at least one non-Byzantine participant in every network partition whose state can affect recovery. If every participant in one relevant partition colludes, the protocol does not guarantee honest evidence from that partition reaches the chain.

### 2.4 Recovery traffic has priority

Blocks needed for the next position, confirmations that create finality, dispute auditing data, and chain-event reconciliation are more important than redundant gossip or optional queries. Backpressure must preserve protocol-critical work.

## 3. Boundary and responsibilities

P2P manager owns peer lifecycle and broadcast. Transports own byte delivery and transport-specific setup. RPC owns request identity, framing, method authorization, and response matching. State manager owns semantic validation and prioritization. Chain fallback owns final V1 availability.

## 4. Data model and connection state

Each peer record contains participant address, channel, protocol version, transport type, connection generation, handshake state, supported RPC manifest, last activity, resource counters, and disconnect reason.

Connection states are discovered, connecting, transport-ready, challenged, authenticated, active, draining, and closed. Only active peers can invoke channel RPC methods. Spectators use a restricted role and method set.

## 5. Inputs and preconditions

A connection becomes active only when both sides agree on chain ID, manager address, channel ID, protocol and ABI version, participant or spectator role, and a fresh signed handshake challenge. Replayed challenge responses, wrong participant, mismatched channel, or unsupported version close the connection.

Every frame is bounded before allocation and decode. Current RPC framing has a 16 MiB cap; production needs smaller per-method limits inside that outer cap.

## 6. Processing algorithm

### 6.1 Connect the mesh

1. Derive expected active and pending participant addresses from verified channel state.
2. Exclude local address and slashed participants.
3. discover transport endpoints through configured mechanisms;
4. attempt connections with bounded parallelism and backoff;
5. complete signed handshake and manifest negotiation;
6. select one active generation per peer and drain duplicates deterministically;
7. notify state manager only after authentication;
8. retry absent peers without blocking other links.

### 6.2 Receive a frame

1. Enforce outer byte limit and connection-level rate budget.
2. Parse request ID, service, method, and length without decoding application payload.
3. require authenticated role permits the method;
4. enforce per-method byte, nesting, and work budget;
5. deduplicate request ID within connection generation;
6. enqueue under priority and per-peer fairness;
7. execute with timeout and cancellation tied to connection generation;
8. send bounded response or typed error.

### 6.3 Broadcast

Create one immutable encoded payload and enqueue a reference for every active expected peer. Per-peer send failure does not stop other sends. Record which peers accepted the frame. Retries use message identity and do not extend protocol deadlines.

### 6.4 Backpressure and rate limiting

The required design has four scopes:

| Scope   | Protects                                  | Required control                               |
| ------- | ----------------------------------------- | ---------------------------------------------- |
| frame   | allocation and decode                     | hard byte and nesting cap                      |
| peer    | one identity’s CPU, bandwidth, and queues | token bucket plus concurrent-request cap       |
| channel | aggregate valid-looking gossip            | shared work and storage budget                 |
| node    | cross-channel exhaustion                  | global memory, worker, socket, and disk limits |

Critical classes are next block, missing predecessor response, finality signature, dispute auditing data, and canonical chain event. Normal classes are future block, repeated confirmation, spectate sync, and optional query. Rate limiting must reserve capacity for critical classes while preventing a peer from labeling arbitrary traffic critical.

Exact rates, burst sizes, queue limits, and penalties are unresolved. Exceeding a soft budget delays or drops low-priority work. Exceeding a hard byte or repeated abuse limit closes the peer generation. A transport disconnect is not slashable evidence.

## 7. Outputs and postconditions

An active peer has authenticated identity and bounded queues. Accepted protocol payloads enter semantic managers with source identity and first-seen time. A closed peer loses RPC authority, but its already authenticated durable messages remain valid evidence.

## 8. Invariants

- **NET-INV-1:** transport endpoint never substitutes for participant signature identity.
- **NET-INV-2:** unauthenticated connections cannot invoke channel state methods.
- **NET-INV-3:** one failed peer send does not block delivery to others.
- **NET-INV-4:** duplicates do not extend deadlines or repeat unbounded work.
- **NET-INV-5:** every allocation and queue has a configured bound.
- **NET-INV-6:** critical recovery retains reserved capacity under normal gossip flood.
- **NET-INV-7:** connection generation change cancels stale in-flight handlers and responses.
- **NET-INV-8:** network order does not decide block, evidence, or reduction winner.

## 9. Ordering, concurrency, and atomicity

Connections and sends run independently. Per-peer frames may arrive out of order. RPC response IDs match requests, while state manager applies semantic ordering. One connection generation owns a request ID namespace; late responses from older generations are ignored.

Rate counters update atomically before work starts. Queue admission and budget charge must not race in a way that admits more than the configured burst.

## 10. Trust and security assumptions

Discovery and relays may be unavailable, censor, or observe metadata. They cannot forge participant signatures. WebRTC signaling may reveal network data. Holepunch and relay systems add availability dependencies but not authority if handshake binding is correct.

A protocol-valid flood remains a threat: many future blocks, signatures, state queries, or large audit responses can consume resources without failing cryptographic checks. Size caps alone do not solve CPU and storage griefing.

## 11. Failure behavior and recovery

Handshake failure closes only that connection. Transport loss retries through configured alternatives. Missing one peer does not stop other mesh links. If required data remains unavailable, the state manager moves to chain fallback or dispute.

Overload drops redundant and far-future work first. It must never silently drop the only next block or active dispute data; if critical queues cannot accept work, the node declares degraded state and starts recovery or stops signing.

## 12. Current implementation

`P2PManager`, transport classes, RPC registry and guards, init handshake, WebRTC setup, and Holepunch helpers implement the current network. The SDK supports local, loopback, WebRTC, and Holepunch paths. Handshake completion guards RPC services. RPC uses a 16 MiB maximum frame. Queue storage caps records at 128.

There is no complete per-peer, per-channel, and global gossip rate limiter or priority scheduler. The code has timeouts and some bounded caches, but these do not form a full resource-control policy.

## 13. Difference from the intended design

| Classification     | Difference                                                       |
| ------------------ | ---------------------------------------------------------------- |
| missing            | accepted per-method size and work budgets                        |
| missing            | per-peer, channel, and global token and concurrency limits       |
| missing            | reserved critical traffic capacity and overload state            |
| decision pending   | exact rates, bursts, queue policy, and repeat-abuse consequences |
| missing            | explicit supported participant maximum enforced at open and join |
| missing            | multi-transport failover policy for one participant identity     |
| documentation debt | relay and discovery privacy metadata is not fully described      |

## 14. Dependencies and cross-layer effects

Block queue, agreement, spectate, join, dispute data exchange, worker concurrency, storage limits, and calldata fallback depend on network policy. User-visible latency and fees worsen if legitimate traffic is delayed into chain fallback.

## 15. Verification

Tests must cover full mesh at supported maximum, duplicate connection race, stale generation response, handshake replay, wrong identity and channel, each transport failure, partial partition, all-Byzantine partition limitation, block/signature/request flood, large valid payload flood, critical-priority preservation, bounded memory and CPU, overload recovery, and chain fallback under network denial.

## 16. Future work

A web-of-trust or partitioned network may support larger groups, but it changes availability and collusion assumptions. It is not a V1 optimization with unchanged security.
