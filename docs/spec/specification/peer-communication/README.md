# System 3 — Peer Communication and Node Services

> **Agent status:** Maintained system contract (non-normative navigation; normative authority lives in
> the owned documents below).
> **Engineer verification:** Pending.

This system is the client-node protocol boundary: transport lifecycle, mutual identity handshake, the
service registry and its public method contracts, guards, wire framing and serialization, request
lifecycle, gossip, verifiable synchronization, rate limits, and the hard distinction between untrusted
peer ingress and trusted loopback control. Every byte a remote peer can deliver to a node enters
through this system.

## System contract

- **Owned state.** Peer sessions: transport bindings, authenticated peer identities and their
  profiles/blacklist state, pending request correlation, per-service session state (handshake
  progress, in-flight sync, dispute-acknowledgement rounds).
- **Public inputs.** Wire frames from any connected transport — untrusted by definition; local typed
  calls from the node's own services and application (trusted loopback).
- **Public outputs.** Dispatched, validated calls into the owning systems (block ingress, join
  signature collection, sync payloads, dispute acknowledgements, transport-upgrade signaling);
  responses, declared errors, and disconnect/blacklist consequences back to peers.
- **Calls.** Block progression (validated confirmation intake); settlement (join authorization
  collection, spectate/sync serving); disputes (dispute acknowledgements); protocol model (canonical
  encoding for every protocol struct on the wire).
- **Called by.** Every system that must reach another participant; the runtime host as the trusted
  loopback caller.
- **Trust and availability assumptions.** Transport confidentiality is optional; authentication and
  payload validation are not. Peers may disconnect, withhold, duplicate, reorder, or send malformed
  frames at any point. Typed local APIs never make remote data trustworthy.
- **Ordering and concurrency.** Frame dispatch follows a fixed verification order
  ([rpc.md](./rpc.md) [`REQ-RPC-6-E60S4J`](rpc.md#req-rpc-6-e60s4j)); handlers run outside the execution serialization boundary of
  block progression and hand validated input to the owning system, which enforces its own ordering.
- **Invariants (owned).** [`INV-RPC-1-SJS2T6`](rpc.md#inv-rpc-1-sjs2t6), [`REQ-RPC-1-FF89Z0`](rpc.md#req-rpc-1-ff89z0)–[`REQ-RPC-8-44XECF`](rpc.md#req-rpc-8-44xecf) ([rpc.md](./rpc.md)), plus the
  per-service requirements: `INV-AUTH-*`/`REQ-AUTH-*`, `REQ-GOSSIP-*`, `INV-JOINSIG-*`/`REQ-JOINSIG-*`,
  `REQ-DACK-*`, `INV-SYNC-*`/`REQ-SYNC-*`, `INV-LOBBY-*`/`REQ-LOBBY-*`,
  `INV-NEG-*`/`REQ-NEG-*`, `INV-TJOIN-*`/`REQ-TJOIN-*`, `INV-UPG-*`/`REQ-UPG-*`.
- **Failure and recovery outcomes.** Every endpoint failure has a defined consequence class —
  disconnect, blacklist, request error, silent ignore, or escalation — and a peer-controlled failure
  never corrupts another session ([`REQ-RPC-5-CV1R1Y`](rpc.md#req-rpc-5-cv1r1y), [`REQ-RPC-6-E60S4J`](rpc.md#req-rpc-6-e60s4j)).
- **Resource bounds.** Frame size, outstanding requests, expensive proof/signaling work, and per-peer
  rate are bounded ([`REQ-RPC-5-CV1R1Y`](rpc.md#req-rpc-5-cv1r1y)); bounds are sized for the full-mesh small-partition topology
  ([../security/trust-model.md](../security/trust-model.md) [`REQ-TRUST-5-NDVRW8`](../security/trust-model.md#req-trust-5-ndvrw8)).
- **Verification evidence.** The requirement matrix in [rpc.md](./rpc.md); the ingress edge into
  block progression is proven under [`REQ-IX-1-WTJ0D1`](../interactions.md#req-ix-1-wtj0d1).

## Owned documents

The shared communication model is stated once; each service family then has its own specification
with its algorithm, system interactions, failure outcomes, and test plan.

| Document | Defines |
| --- | --- |
| [rpc.md](./rpc.md) | The shared model: wire contract, dispatch algorithm, guards, correlation, replay classification, resource bounds, versioning obligations. |
| [handshake.md](./handshake.md) | Mutual identity authentication: challenge/response under a versioned domain tag, completion, timeout/penalty rules. |
| [block-gossip.md](./block-gossip.md) | Block-confirmation gossip: thin attributed ingress into block progression, verdict-mapped consequences, re-broadcast on growth. |
| [join-authorization.md](./join-authorization.md) | Unanimous join-signature collection: pinned-state authorization, identity triple-binding, all-or-nothing assembly. |
| [dispute-acknowledgment.md](./dispute-acknowledgment.md) | One-round dispute acknowledgment: bilateral records that gate dead-fork consequences on proven knowledge. |
| [synchronization.md](./synchronization.md) | Verifiable state sync (spectate): exact-target proving and the requester's full verification chain before any effect. |
| [lobby-matching.md](./lobby-matching.md) | Caller-topic discovery: authenticated availability, convergent roles, exclusive pair selection, and mutual commitment. |
| [channel-negotiation.md](./channel-negotiation.md) | Guarded two-party opening: transcript-derived channel identity, negotiated-terms-only signing, deterministic submission, and chain-observed completion. |
| [targeted-channel-join.md](./targeted-channel-join.md) | Fixed-ID pre-open matching, authoritative-open handoff, exact-channel synchronization, optional membership, and phase-specific failure. |
| [transport-upgrade.md](./transport-upgrade.md) | Direct-transport upgrade signaling: protocol-inert best-effort, identity-bound state, re-authentication before cutover. |

## Interaction contracts

Producer of authenticated, envelope-validated ingress for block progression
([`REQ-IX-1-WTJ0D1`](../interactions.md#req-ix-1-wtj0d1)); carrier for the join-authorization and synchronization
flows of settlement ([`REQ-IX-3-H8WCVY`](../interactions.md#req-ix-3-h8wcvy)). Gossip rate limiting is open —
[`OQ-6-4JPNE5`](../open-questions.md#oq-6-4jpne5).
