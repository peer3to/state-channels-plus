# Peer Communication and RPC Services

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Service model](#service-model)
- [Ingress dispatch algorithm](#ingress-dispatch-algorithm)
- [Guards: caller admission](#guards-caller-admission)
- [Request lifecycle and correlation](#request-lifecycle-and-correlation)
- [Replay classification](#replay-classification)
- [Trusted loopback vs untrusted peers](#trusted-loopback-vs-untrusted-peers)
- [Compatibility and versioning](#compatibility-and-versioning)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

Peer communication exposes typed protocol services over an authenticated transport. The communication layer
correlates requests and responses, gates methods by session state, validates and decodes untrusted payloads,
applies bounded scheduling, and reports transport and application failures without changing their meaning.

Two complementary properties are deliberately kept distinct and both required:

- **Type safety protects local callers.** A typed calling surface prevents locally compiled code from
  constructing a malformed call. It constrains nothing a remote peer can send.
- **Byzantine safety protects the receiver.** Wire data is untrusted regardless of how the sender was
  built. Every public method is an adversarial ingress point and must validate as if the transport
  proved nothing beyond the authenticated peer identity.

## Service model

The required service families are: mutual identity handshake; channel-term negotiation; unanimous join
authorization; block-confirmation ingress; dispute acknowledgement; verifiable state synchronization; and
post-authentication transport upgrade/signaling. Implementations may combine or split services, but must
preserve their state machines, authorization, ordering, and failure outcomes. **Each family has its own
specification** defining its algorithm, system interactions, failure outcomes, and test plan; this document
owns only the shared communication model they all run on.

| Family                      | Specification                                            | Session precondition          | Delivery shape              |
| --------------------------- | -------------------------------------------------------- | ----------------------------- | --------------------------- |
| Identity handshake          | [handshake.md](./handshake.md)                           | None — it _is_ authentication | Challenge/response exchange |
| Channel-term negotiation    | [channel-negotiation.md](./channel-negotiation.md)       | Authenticated                 | One-way signaling rounds    |
| Join authorization          | [join-authorization.md](./join-authorization.md)         | Authenticated                 | Request/response            |
| Block-confirmation ingress  | [block-gossip.md](./block-gossip.md)                     | Authenticated                 | One-way gossip              |
| Dispute acknowledgement     | [dispute-acknowledgment.md](./dispute-acknowledgment.md) | Authenticated                 | Request/response            |
| State synchronization       | [synchronization.md](./synchronization.md)               | Authenticated                 | Request/response            |
| Transport upgrade/signaling | [transport-upgrade.md](./transport-upgrade.md)           | Authenticated                 | One-way signaling           |

## Ingress dispatch algorithm

Every inbound frame passes through one fixed verification order; each stage has a defined failure
consequence, and no later stage can compensate for an earlier one:

1. **Bound the frame** against the maximum frame size _before_ any parsing; an oversized frame
   terminates the session without parse work.
2. **Classify responses first.** A frame matching the response shape is routed to correlation
   handling and can never reach service dispatch.
3. **Verify the envelope**: the frame must identify a service, a method, an argument list, and — for
   request-style calls — a correlation identity. Undecodable frames terminate the session.
4. **Resolve the service.** An unknown service is a protocol violation.
5. **Run the service's guards** (next section) — before revealing whether the named method exists, so
   an unauthenticated peer probing a gated service learns nothing about its method names.
6. **Resolve the method.** An unknown method on a resolved service is a protocol violation.
7. **Invoke the endpoint.** The endpoint then owns payload decoding, semantic validation,
   authorization, and resource bounding ([`REQ-RPC-1-FF89Z0`](rpc.md#req-rpc-1-ff89z0), [`REQ-RPC-3-ZM9WR5`](rpc.md#req-rpc-3-zm9wr5)). On the request path, a handler
   failure is reported to the caller as a declared error without terminating the session; on the
   one-way path, a handler failure is a session-terminating fault.
8. **Backstop.** Any failure escaping the stages above terminates the session rather than leaving it
   in an undefined state.

## Guards: caller admission

Guards gate a service's entire public surface on objective preconditions about the _caller_ before
any method logic runs. They are the admission layer, distinct from per-endpoint payload validation:

- A guard's check is a pure predicate; all consequences (terminate, penalize, defer/retry, refuse)
  live in its failure handler.
- Guards evaluate in declaration order and short-circuit on the first failure; ordering is part of
  the service contract (structural checks precede expensive ones).
- Guard failure consumes the call. A request-style call must still settle deterministically at the
  caller (a declared rejection), never by timeout ambiguity.
- The authentication service itself is deliberately unguarded — it must accept pre-session traffic.
- New caller-scoped preconditions (role, admission state, channel phase) MUST be expressed as guards,
  not ad-hoc checks duplicated across endpoints. A guard admits the caller; it never validates the
  payload.

Unresolved guard-interaction decisions (deferred-retry semantics for request-style calls, penalty
persistence) are tracked in [`OQ-34-FY08V2`](../open-questions.md#oq-34-fy08v2).

## Request lifecycle and correlation

- Correlation identity binds one request to at most one settlement: response, declared remote error,
  timeout, cancellation, or disconnect ([`REQ-RPC-2-SZDTTM`](rpc.md#req-rpc-2-szdttm)).
- **Addressed-peer rule.** Only the authenticated peer a request was addressed to may settle it —
  matched by peer identity, not by transport object, so a transport upgrade does not orphan pending
  requests. A settlement attempt by any other peer is a protocol violation.
- A response with no matching pending request (late, duplicate, or never issued) is ignored without
  penalty; it must also be bounded like any frame.
- Session termination settles every pending request bound to that peer with a defined failure; their
  timers are released. Retirement of a replaced transport settles requests issued on it; callers
  retry against the peer identity.
- Remote error text is attacker-controlled data. Callers MUST NOT branch protocol decisions on error
  strings; only the declared success/failure shape is meaningful.

## Replay classification

The communication layer itself provides no replay protection; idempotence is an endpoint obligation.
Every endpoint MUST be explicitly classified as exactly one of:

1. **Idempotent-by-merge** — re-delivery converges (e.g. block confirmations merge signature sets;
   duplicates are no-ops).
2. **Replay-rejecting** — a duplicate is a protocol violation with a defined consequence (e.g. a
   second handshake completion or a second dispute-acknowledgement round).
3. **Concurrency-limited** — duplicates are serialized or refused by an explicit in-flight rule
   (e.g. one sync per peer pair).

An endpoint whose replay silently double-applies a state effect is a defect. The classification is
part of the service contract and is verified per endpoint ([`REQ-RPC-4-9VX0B9`](rpc.md#req-rpc-4-9vx0b9)).

## Trusted loopback vs untrusted peers

A node may deliver calls to itself over a loopback path that bypasses guards. That exemption is
strictly for self-delivery: the loopback caller is the node's own trusted runtime, and its calls
carry local authority. No network transport may ever be trusted, and no remote peer may reach the
loopback authority. The application-facing calling surface distinguishes explicitly between invoking
the local node and relaying the same typed call to an addressed remote peer; neither path exposes
internal service objects or bypasses the public method contract.

## Compatibility and versioning

Protocol compatibility and encoding versions MUST be established before protected calls are accepted,
and an incompatible peer MUST be refused cleanly (a declared refusal, not an escalating penalty).
Compatibility identity should be bound into the signed handshake domain so a session cannot be
established across incompatible deployments. The concrete negotiation scheme is unresolved —
[`OQ-34-FY08V2`](../open-questions.md#oq-34-fy08v2), coupled to the signature-domain decision
[`OQ-29-EFY4NF`](../open-questions.md#oq-29-efy4nf).

## Requirements and invariants

**<a id="inv-rpc-1-sjs2t6"></a>`INV-RPC-1-SJS2T6` — Identity-bound dispatch.** Every accepted call MUST be attributable to the authenticated peer
and dispatched only to a method permitted in the current session state.

**<a id="req-rpc-1-ff89z0"></a>`REQ-RPC-1-FF89Z0` — Typed wire contract.** Envelopes MUST identify method, delivery mode, correlation identity, and
encoded payload; malformed, unknown, duplicate, or incompatible messages MUST fail deterministically.
Payloads carrying protocol structs (including any large-integer values) MUST cross the boundary in the
protocol's canonical encoding and be decoded and semantically validated inside the receiving endpoint;
decode failure is a handled protocol failure, never an escaping exception.

**<a id="req-rpc-2-szdttm"></a>`REQ-RPC-2-SZDTTM` — Request lifecycle.** Each request MUST settle at most once through response, declared remote
error, timeout, cancellation, or disconnect; pending work MUST be released on transport replacement/disposal.
Only the addressed authenticated peer may settle a request; unknown or late responses are ignored.

**<a id="req-rpc-3-zm9wr5"></a>`REQ-RPC-3-ZM9WR5` — Service authorization.** Handshake precedes protected services. Join, block, dispute, sync, and
transport-upgrade calls MUST validate their channel/fork/session binding and required participant role.

**<a id="req-rpc-4-9vx0b9"></a>`REQ-RPC-4-9VX0B9` — Replay and concurrency.** Duplicate or reordered delivery MUST be idempotent, rejected, or
merged according to the owning protocol operation; it MUST NOT duplicate signatures, membership, blocks,
effects, or resource ownership. Every endpoint declares its replay class
([Replay classification](#replay-classification)).

**<a id="req-rpc-5-cv1r1y"></a>`REQ-RPC-5-CV1R1Y` — Resource bounds.** Payload size, outstanding requests, expensive proof/signaling work, and
per-peer rate MUST be bounded, with overload isolated from unrelated peers and services.

**<a id="req-rpc-6-e60s4j"></a>`REQ-RPC-6-E60S4J` — Ordered ingress verification.** Inbound frames MUST pass the fixed dispatch order of
[Ingress dispatch algorithm](#ingress-dispatch-algorithm): size bound before parsing, response
classification before dispatch, envelope verification, service resolution, guards before
method-existence disclosure, then invocation. Each stage failure MUST have its defined consequence,
and a probe against a gated service MUST NOT reveal whether a method exists.

**<a id="req-rpc-7-9cbshk"></a>`REQ-RPC-7-9CBSHK` — Guard semantics.** Guards MUST be pure predicates evaluated in declaration order with
all consequences in their failure handlers; guard failure MUST settle a request-style call
deterministically at the caller; the guard-bypass exemption applies only to the node's own loopback
self-delivery, never to a network transport.

**<a id="req-rpc-8-44xecf"></a>`REQ-RPC-8-44XECF` — Compatibility before protected calls.** Session compatibility (protocol and encoding
versions) MUST be established no later than authentication, an incompatible peer MUST be refused
cleanly without penalty escalation, and compatibility identity SHOULD be bound into the signed
handshake domain. (Scheme unresolved: [`OQ-34-FY08V2`](../open-questions.md#oq-34-fy08v2).)

## Assumptions and constraints

- Transport confidentiality is optional unless explicitly required; authentication and payload validation are not.
- Typed local APIs do not make remote data trustworthy.
- Peers may disconnect, withhold, duplicate, reorder, or send malformed messages at any point.
- Protocol compatibility and encoding versions are established before protected calls are accepted.
- The topology is a full mesh: every participant holds a session with every other participant, so
  connection and broadcast cost grows quadratically with the participant count. This layer is therefore
  scoped to small partitions — see [`REQ-TRUST-5-NDVRW8`](../security/trust-model.md#req-trust-5-ndvrw8) for the
  normative limit (up to roughly ten participants, commonly six) and the alternative-topology future work.
  Resource bounds under [`REQ-RPC-5-CV1R1Y`](rpc.md#req-rpc-5-cv1r1y) are sized against that partition size, not against arbitrary fan-out.
- RPC handlers run outside the block-progression execution boundary: an endpoint never assumes
  exclusive access to live protocol state and hands validated input to the owning system
  ([`REQ-BLOCK-PIPE-5-WJ31RG`](../block-progression/block-processing.md#req-block-pipe-5-wj31rg)).

## Security considerations

Threats include identity spoofing, pre-auth method access, forged channel/fork context, replay, response
confusion, malformed encoding, silent-ignore ambiguity, request flooding, proof-serving amplification,
signaling abuse, and disconnect races. A peer-controlled failure must not corrupt another session or leave
privileged pending state alive. Two boundary-specific hazards deserve emphasis: transport authentication
mistaken for payload validity (the endpoint must validate as if the transport proved nothing beyond
identity), and method-existence disclosure to unauthenticated probes (guards run first). Unsolicited
response frames are penalty-free by design and therefore must be cheap to ignore and counted against
frame-level bounds.

## Verification and test plan

### Requirement test matrix

| Plan item                                             | Requirements / invariants                     | Setup and stimulus                                                                                              | Expected result                                                                                                  | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-rpc-1-sjs2t6.t1"></a>`INV-RPC-1-SJS2T6.T1` | [`INV-RPC-1-SJS2T6`](rpc.md#inv-rpc-1-sjs2t6) | Attempt every service before, during, and after mutual authentication using correct and substituted identities. | Only the bound peer in the correct session state is dispatched.                                                  | <a id="inv-rpc-1-sjs2t6.t1.p1"></a>`INV-RPC-1-SJS2T6.T1.P1` — mutual success; <a id="inv-rpc-1-sjs2t6.t1.p2"></a>`INV-RPC-1-SJS2T6.T1.P2` — forged identity; <a id="inv-rpc-1-sjs2t6.t1.p3"></a>`INV-RPC-1-SJS2T6.T1.P3` — pre-auth; <a id="inv-rpc-1-sjs2t6.t1.p4"></a>`INV-RPC-1-SJS2T6.T1.P4` — reconnect; <a id="inv-rpc-1-sjs2t6.t1.p5"></a>`INV-RPC-1-SJS2T6.T1.P5` — stale identity; <a id="inv-rpc-1-sjs2t6.t1.p6"></a>`INV-RPC-1-SJS2T6.T1.P6` — half-auth.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| <a id="req-rpc-1-ff89z0.t1"></a>`REQ-RPC-1-FF89Z0.T1` | [`REQ-RPC-1-FF89Z0`](rpc.md#req-rpc-1-ff89z0) | Encode/decode and dispatch every delivery mode and service payload, including invalid envelopes.                | Valid messages preserve meaning; invalid messages cannot reach service logic.                                    | <a id="req-rpc-1-ff89z0.t1.p1"></a>`REQ-RPC-1-FF89Z0.T1.P1` — request/response; <a id="req-rpc-1-ff89z0.t1.p2"></a>`REQ-RPC-1-FF89Z0.T1.P2` — one-way; <a id="req-rpc-1-ff89z0.t1.p3"></a>`REQ-RPC-1-FF89Z0.T1.P3` — malformed message; <a id="req-rpc-1-ff89z0.t1.p4"></a>`REQ-RPC-1-FF89Z0.T1.P4` — boundary payloads; <a id="req-rpc-1-ff89z0.t1.p5"></a>`REQ-RPC-1-FF89Z0.T1.P5` — unknown message; <a id="req-rpc-1-ff89z0.t1.p6"></a>`REQ-RPC-1-FF89Z0.T1.P6` — version mismatch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| <a id="req-rpc-2-szdttm.t1"></a>`REQ-RPC-2-SZDTTM.T1` | [`REQ-RPC-2-SZDTTM`](rpc.md#req-rpc-2-szdttm) | Race response, remote error, timeout, cancellation, disconnect, and disposal for pending calls.                 | Exactly one outcome wins and all pending resources are released.                                                 | <a id="req-rpc-2-szdttm.t1.p1"></a>`REQ-RPC-2-SZDTTM.T1.P1` — response settles; <a id="req-rpc-2-szdttm.t1.p2"></a>`REQ-RPC-2-SZDTTM.T1.P2` — response vs remote-error race; <a id="req-rpc-2-szdttm.t1.p3"></a>`REQ-RPC-2-SZDTTM.T1.P3` — late reply; <a id="req-rpc-2-szdttm.t1.p4"></a>`REQ-RPC-2-SZDTTM.T1.P4` — reconnect; <a id="req-rpc-2-szdttm.t1.p5"></a>`REQ-RPC-2-SZDTTM.T1.P5` — settlement attempt by a non-addressed peer; <a id="req-rpc-2-szdttm.t1.p6"></a>`REQ-RPC-2-SZDTTM.T1.P6` — remote-error settles; <a id="req-rpc-2-szdttm.t1.p7"></a>`REQ-RPC-2-SZDTTM.T1.P7` — timeout settles; <a id="req-rpc-2-szdttm.t1.p8"></a>`REQ-RPC-2-SZDTTM.T1.P8` — cancellation settles; <a id="req-rpc-2-szdttm.t1.p9"></a>`REQ-RPC-2-SZDTTM.T1.P9` — disconnect settles; <a id="req-rpc-2-szdttm.t1.p10"></a>`REQ-RPC-2-SZDTTM.T1.P10` — response vs timeout race; <a id="req-rpc-2-szdttm.t1.p11"></a>`REQ-RPC-2-SZDTTM.T1.P11` — response vs cancellation race; <a id="req-rpc-2-szdttm.t1.p12"></a>`REQ-RPC-2-SZDTTM.T1.P12` — response vs disconnect race; <a id="req-rpc-2-szdttm.t1.p13"></a>`REQ-RPC-2-SZDTTM.T1.P13` — remote-error vs timeout race; <a id="req-rpc-2-szdttm.t1.p14"></a>`REQ-RPC-2-SZDTTM.T1.P14` — remote-error vs cancellation race; <a id="req-rpc-2-szdttm.t1.p15"></a>`REQ-RPC-2-SZDTTM.T1.P15` — remote-error vs disconnect race; <a id="req-rpc-2-szdttm.t1.p16"></a>`REQ-RPC-2-SZDTTM.T1.P16` — timeout vs cancellation race; <a id="req-rpc-2-szdttm.t1.p17"></a>`REQ-RPC-2-SZDTTM.T1.P17` — timeout vs disconnect race; <a id="req-rpc-2-szdttm.t1.p18"></a>`REQ-RPC-2-SZDTTM.T1.P18` — cancellation vs disconnect race; <a id="req-rpc-2-szdttm.t1.p19"></a>`REQ-RPC-2-SZDTTM.T1.P19` — disposal. |
| <a id="req-rpc-3-zm9wr5.t1"></a>`REQ-RPC-3-ZM9WR5.T1` | [`REQ-RPC-3-ZM9WR5`](rpc.md#req-rpc-3-zm9wr5) | Exercise every service with valid/invalid role, channel, fork, phase, and signature.                            | Only authorized, correctly bound calls affect protocol state.                                                    | <a id="req-rpc-3-zm9wr5.t1.p1"></a>`REQ-RPC-3-ZM9WR5.T1.P1` — negotiation; <a id="req-rpc-3-zm9wr5.t1.p2"></a>`REQ-RPC-3-ZM9WR5.T1.P2` — block; <a id="req-rpc-3-zm9wr5.t1.p3"></a>`REQ-RPC-3-ZM9WR5.T1.P3` — sync; <a id="req-rpc-3-zm9wr5.t1.p4"></a>`REQ-RPC-3-ZM9WR5.T1.P4` — transport upgrade; <a id="req-rpc-3-zm9wr5.t1.p5"></a>`REQ-RPC-3-ZM9WR5.T1.P5` — join; <a id="req-rpc-3-zm9wr5.t1.p6"></a>`REQ-RPC-3-ZM9WR5.T1.P6` — dispute.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| <a id="req-rpc-4-9vx0b9.t1"></a>`REQ-RPC-4-9VX0B9.T1` | [`REQ-RPC-4-9VX0B9`](rpc.md#req-rpc-4-9vx0b9) | Duplicate, reorder, replay, and concurrently deliver each state-changing call.                                  | The owning operation's idempotence/merge rule holds without duplicate effects.                                   | <a id="req-rpc-4-9vx0b9.t1.p1"></a>`REQ-RPC-4-9VX0B9.T1.P1` — duplicate; <a id="req-rpc-4-9vx0b9.t1.p2"></a>`REQ-RPC-4-9VX0B9.T1.P2` — reorder; <a id="req-rpc-4-9vx0b9.t1.p3"></a>`REQ-RPC-4-9VX0B9.T1.P3` — concurrent conflicting calls; <a id="req-rpc-4-9vx0b9.t1.p4"></a>`REQ-RPC-4-9VX0B9.T1.P4` — retry after failure; <a id="req-rpc-4-9vx0b9.t1.p5"></a>`REQ-RPC-4-9VX0B9.T1.P5` — block-confirmation idempotent-by-merge class; <a id="req-rpc-4-9vx0b9.t1.p6"></a>`REQ-RPC-4-9VX0B9.T1.P6` — handshake-completion replay-rejecting class; <a id="req-rpc-4-9vx0b9.t1.p7"></a>`REQ-RPC-4-9VX0B9.T1.P7` — dispute-acknowledgment replay-rejecting class; <a id="req-rpc-4-9vx0b9.t1.p8"></a>`REQ-RPC-4-9VX0B9.T1.P8` — sync concurrency-limited class.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| <a id="req-rpc-5-cv1r1y.t1"></a>`REQ-RPC-5-CV1R1Y.T1` | [`REQ-RPC-5-CV1R1Y`](rpc.md#req-rpc-5-cv1r1y) | Saturate payload, pending-call, proof/signaling, and rate boundaries from one and many peers.                   | Work is bounded, overload is explicit, and healthy peers/services continue.                                      | <a id="req-rpc-5-cv1r1y.t1.p1"></a>`REQ-RPC-5-CV1R1Y.T1.P1` — payload size at bound; <a id="req-rpc-5-cv1r1y.t1.p2"></a>`REQ-RPC-5-CV1R1Y.T1.P2` — one abusive peer; <a id="req-rpc-5-cv1r1y.t1.p3"></a>`REQ-RPC-5-CV1R1Y.T1.P3` — distributed load; <a id="req-rpc-5-cv1r1y.t1.p4"></a>`REQ-RPC-5-CV1R1Y.T1.P4` — recovery; <a id="req-rpc-5-cv1r1y.t1.p5"></a>`REQ-RPC-5-CV1R1Y.T1.P5` — payload size beyond bound; <a id="req-rpc-5-cv1r1y.t1.p6"></a>`REQ-RPC-5-CV1R1Y.T1.P6` — pending-call count at bound; <a id="req-rpc-5-cv1r1y.t1.p7"></a>`REQ-RPC-5-CV1R1Y.T1.P7` — pending-call count beyond bound; <a id="req-rpc-5-cv1r1y.t1.p8"></a>`REQ-RPC-5-CV1R1Y.T1.P8` — proof/signaling work at bound; <a id="req-rpc-5-cv1r1y.t1.p9"></a>`REQ-RPC-5-CV1R1Y.T1.P9` — proof/signaling work beyond bound; <a id="req-rpc-5-cv1r1y.t1.p10"></a>`REQ-RPC-5-CV1R1Y.T1.P10` — per-peer rate at bound; <a id="req-rpc-5-cv1r1y.t1.p11"></a>`REQ-RPC-5-CV1R1Y.T1.P11` — per-peer rate beyond bound.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| <a id="req-rpc-6-e60s4j.t1"></a>`REQ-RPC-6-E60S4J.T1` | [`REQ-RPC-6-E60S4J`](rpc.md#req-rpc-6-e60s4j) | Deliver frames failing at each dispatch stage, including oversized, response-shaped, and probe frames.          | Each stage fails with its defined consequence; no stage is skippable; probes learn nothing about gated methods.  | <a id="req-rpc-6-e60s4j.t1.p1"></a>`REQ-RPC-6-E60S4J.T1.P1` — oversized before parse; <a id="req-rpc-6-e60s4j.t1.p2"></a>`REQ-RPC-6-E60S4J.T1.P2` — response-shaped frame never dispatched; <a id="req-rpc-6-e60s4j.t1.p3"></a>`REQ-RPC-6-E60S4J.T1.P3` — unknown service; <a id="req-rpc-6-e60s4j.t1.p4"></a>`REQ-RPC-6-E60S4J.T1.P4` — gated-service probe (existent vs nonexistent method indistinguishable); <a id="req-rpc-6-e60s4j.t1.p5"></a>`REQ-RPC-6-E60S4J.T1.P5` — unknown method.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| <a id="req-rpc-7-9cbshk.t1"></a>`REQ-RPC-7-9CBSHK.T1` | [`REQ-RPC-7-9CBSHK`](rpc.md#req-rpc-7-9cbshk) | Fail each guard in each declared position over network and loopback transports, for one-way and request calls.  | Order and short-circuit respected; request calls settle deterministically; only loopback self-delivery bypasses. | <a id="req-rpc-7-9cbshk.t1.p1"></a>`REQ-RPC-7-9CBSHK.T1.P1` — order/short-circuit; <a id="req-rpc-7-9cbshk.t1.p2"></a>`REQ-RPC-7-9CBSHK.T1.P2` — request settles on guard failure; <a id="req-rpc-7-9cbshk.t1.p3"></a>`REQ-RPC-7-9CBSHK.T1.P3` — loopback self-delivery bypass; <a id="req-rpc-7-9cbshk.t1.p4"></a>`REQ-RPC-7-9CBSHK.T1.P4` — guard consequence isolation (other sessions unaffected); <a id="req-rpc-7-9cbshk.t1.p5"></a>`REQ-RPC-7-9CBSHK.T1.P5` — network transport non-bypass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| <a id="req-rpc-8-44xecf.t1"></a>`REQ-RPC-8-44XECF.T1` | [`REQ-RPC-8-44XECF`](rpc.md#req-rpc-8-44xecf) | Connect peers with matching and mismatched protocol/encoding versions.                                          | Compatible sessions proceed; incompatible peers are refused cleanly before any protected call.                   | <a id="req-rpc-8-44xecf.t1.p1"></a>`REQ-RPC-8-44XECF.T1.P1` — compatible; <a id="req-rpc-8-44xecf.t1.p2"></a>`REQ-RPC-8-44XECF.T1.P2` — incompatible refused without penalty; <a id="req-rpc-8-44xecf.t1.p3"></a>`REQ-RPC-8-44XECF.T1.P3` — protected call attempted before compatibility established.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Future Work

_Non-normative._ Standardize a language-independent wire schema and compatibility negotiation suite.
Extend the loopback control path into the same typed service abstraction used for peer RPC, with a
minimal trusted transport and router, preserving the trusted/untrusted distinction. General per-peer
and per-service gossip rate limiting remains open ([`OQ-6-4JPNE5`](../open-questions.md#oq-6-4jpne5)).
