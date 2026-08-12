# Peer Communication and RPC Services

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Service model](#service-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

Peer communication exposes typed protocol services over an authenticated transport. The communication layer
correlates requests and responses, gates methods by session state, validates and decodes untrusted payloads,
applies bounded scheduling, and reports transport and application failures without changing their meaning.

## Service model

The required service families are: mutual identity handshake; channel-term negotiation; unanimous join
authorization; block-confirmation ingress; dispute acknowledgement; verifiable state synchronization; and
post-authentication transport upgrade/signaling. Implementations may combine or split services, but must
preserve their state machines, authorization, ordering, and failure outcomes.

## Requirements and invariants

<a id="inv-rpc-1"></a>
**INV-RPC-1 — Identity-bound dispatch.** Every accepted call MUST be attributable to the authenticated peer
and dispatched only to a method permitted in the current session state.

<a id="req-rpc-1"></a>
**REQ-RPC-1 — Typed wire contract.** Envelopes MUST identify method, delivery mode, correlation identity, and
encoded payload; malformed, unknown, duplicate, or incompatible messages MUST fail deterministically.

<a id="req-rpc-2"></a>
**REQ-RPC-2 — Request lifecycle.** Each request MUST settle at most once through response, declared remote
error, timeout, cancellation, or disconnect; pending work MUST be released on transport replacement/disposal.

<a id="req-rpc-3"></a>
**REQ-RPC-3 — Service authorization.** Handshake precedes protected services. Join, block, dispute, sync, and
transport-upgrade calls MUST validate their channel/fork/session binding and required participant role.

<a id="req-rpc-4"></a>
**REQ-RPC-4 — Replay and concurrency.** Duplicate or reordered delivery MUST be idempotent, rejected, or
merged according to the owning protocol operation; it MUST NOT duplicate signatures, membership, blocks,
effects, or resource ownership.

<a id="req-rpc-5"></a>
**REQ-RPC-5 — Resource bounds.** Payload size, outstanding requests, expensive proof/signaling work, and
per-peer rate MUST be bounded, with overload isolated from unrelated peers and services.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `INV-RPC-1`             | Identity-bound dispatch. Every accepted call MUST be attributable to the authenticated peer   |
| `REQ-RPC-1`             | Typed wire contract. Envelopes MUST identify method, delivery mode, correlation identity, and |
| `REQ-RPC-2`             | Request lifecycle. Each request MUST settle at most once through response, declared remote    |
| `REQ-RPC-3`             | Service authorization. Handshake precedes protected services. Join, block, dispute, sync, and |
| `REQ-RPC-4`             | Replay and concurrency. Duplicate or reordered delivery MUST be idempotent, rejected, or      |
| `REQ-RPC-5`             | Resource bounds. Payload size, outstanding requests, expensive proof/signaling work, and      |

## Assumptions and constraints

- Transport confidentiality is optional unless explicitly required; authentication and payload validation are not.
- Typed local APIs do not make remote data trustworthy.
- Peers may disconnect, withhold, duplicate, reorder, or send malformed messages at any point.
- Protocol compatibility and encoding versions are established before protected calls are accepted.
- The topology is a full mesh: every participant holds a session with every other participant, so
  connection and broadcast cost grows quadratically with the participant count. This layer is therefore
  scoped to small partitions — see [`REQ-TRUST-5`](../security/trust-model.md#8-topology-limits) for the
  normative limit (up to roughly ten participants, commonly six) and the alternative-topology future work.
  Resource bounds under `REQ-RPC-5` are sized against that partition size, not against arbitrary fan-out.

## Security considerations

Threats include identity spoofing, pre-auth method access, forged channel/fork context, replay, response
confusion, malformed encoding, silent-ignore ambiguity, request flooding, proof-serving amplification,
signaling abuse, and disconnect races. A peer-controlled failure must not corrupt another session or leave
privileged pending state alive.

## Verification and test plan

### Requirement test matrix

| Plan item                               | Requirements / invariants | Setup and stimulus                                                                                              | Expected result                                                                | Required permutations                                                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-rpc-1-t1"></a>`INV-RPC-1.T1` | `INV-RPC-1`               | Attempt every service before, during, and after mutual authentication using correct and substituted identities. | Only the bound peer in the correct session state is dispatched.                | <a id="inv-rpc-1-t1-p1"></a>`INV-RPC-1.T1.P1` — mutual success; <a id="inv-rpc-1-t1-p2"></a>`INV-RPC-1.T1.P2` — forged/stale identity; <a id="inv-rpc-1-t1-p3"></a>`INV-RPC-1.T1.P3` — pre-auth/half-auth; <a id="inv-rpc-1-t1-p4"></a>`INV-RPC-1.T1.P4` — reconnect.             |
| <a id="req-rpc-1-t1"></a>`REQ-RPC-1.T1` | `REQ-RPC-1`               | Encode/decode and dispatch every delivery mode and service payload, including invalid envelopes.                | Valid messages preserve meaning; invalid messages cannot reach service logic.  | <a id="req-rpc-1-t1-p1"></a>`REQ-RPC-1.T1.P1` — request/response; <a id="req-rpc-1-t1-p2"></a>`REQ-RPC-1.T1.P2` — one-way; <a id="req-rpc-1-t1-p3"></a>`REQ-RPC-1.T1.P3` — malformed/unknown/version mismatch; <a id="req-rpc-1-t1-p4"></a>`REQ-RPC-1.T1.P4` — boundary payloads. |
| <a id="req-rpc-2-t1"></a>`REQ-RPC-2.T1` | `REQ-RPC-2`               | Race response, remote error, timeout, cancellation, disconnect, and disposal for pending calls.                 | Exactly one outcome wins and all pending resources are released.               | <a id="req-rpc-2-t1-p1"></a>`REQ-RPC-2.T1.P1` — each terminal outcome; <a id="req-rpc-2-t1-p2"></a>`REQ-RPC-2.T1.P2` — pairwise races; <a id="req-rpc-2-t1-p3"></a>`REQ-RPC-2.T1.P3` — late reply; <a id="req-rpc-2-t1-p4"></a>`REQ-RPC-2.T1.P4` — reconnect/disposal.            |
| <a id="req-rpc-3-t1"></a>`REQ-RPC-3.T1` | `REQ-RPC-3`               | Exercise every service with valid/invalid role, channel, fork, phase, and signature.                            | Only authorized, correctly bound calls affect protocol state.                  | <a id="req-rpc-3-t1-p1"></a>`REQ-RPC-3.T1.P1` — negotiation/join; <a id="req-rpc-3-t1-p2"></a>`REQ-RPC-3.T1.P2` — block/dispute; <a id="req-rpc-3-t1-p3"></a>`REQ-RPC-3.T1.P3` — sync; <a id="req-rpc-3-t1-p4"></a>`REQ-RPC-3.T1.P4` — transport upgrade.                         |
| <a id="req-rpc-4-t1"></a>`REQ-RPC-4.T1` | `REQ-RPC-4`               | Duplicate, reorder, replay, and concurrently deliver each state-changing call.                                  | The owning operation's idempotence/merge rule holds without duplicate effects. | <a id="req-rpc-4-t1-p1"></a>`REQ-RPC-4.T1.P1` — duplicate; <a id="req-rpc-4-t1-p2"></a>`REQ-RPC-4.T1.P2` — reorder; <a id="req-rpc-4-t1-p3"></a>`REQ-RPC-4.T1.P3` — concurrent conflicting calls; <a id="req-rpc-4-t1-p4"></a>`REQ-RPC-4.T1.P4` — retry after failure.            |
| <a id="req-rpc-5-t1"></a>`REQ-RPC-5.T1` | `REQ-RPC-5`               | Saturate payload, pending-call, proof/signaling, and rate boundaries from one and many peers.                   | Work is bounded, overload is explicit, and healthy peers/services continue.    | <a id="req-rpc-5-t1-p1"></a>`REQ-RPC-5.T1.P1` — at/beyond each bound; <a id="req-rpc-5-t1-p2"></a>`REQ-RPC-5.T1.P2` — one abusive peer; <a id="req-rpc-5-t1-p3"></a>`REQ-RPC-5.T1.P3` — distributed load; <a id="req-rpc-5-t1-p4"></a>`REQ-RPC-5.T1.P4` — recovery.               |

## Future Work

_Non-normative._ Standardize a language-independent wire schema and compatibility negotiation suite.
