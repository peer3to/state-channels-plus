# Mutual Identity Handshake

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The authentication service: how a raw transport becomes a session bound to a proven
> protocol identity. Shared communication rules: [rpc.md](./rpc.md).

## Contents

- [Purpose and observable contract](#purpose-and-observable-contract)
- [Algorithm](#algorithm)
- [System interactions](#system-interactions)
- [Failure outcomes](#failure-outcomes)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable contract

A fresh transport is a byte pipe to an unknown counterparty — discovery metadata may _claim_ an
identity but proves nothing. The handshake proves, per direction, that the counterparty controls
the private key of its claimed protocol identity. Completion produces the authenticated session
every gated service requires ([`INV-RPC-1`](./rpc.md)), binds the identity to the transport for
addressed delivery and response correlation, and survives transport replacement (identity outlives
the connection). This is the only service that accepts pre-session traffic.

## Algorithm

Both peers run the same exchange in both directions over one transport; the session completes when
each side has proven the other.

**Challenge/response (one direction):**

1. **Challenge.** The initiator generates a single-use unpredictable challenge (fresh randomness,
   never reused, held only for this exchange) and sends it with its current protocol-time reading,
   expecting a response within the agreement window.
2. **Responder validation before signing.** The responder verifies the challenge's exact shape and
   that the claimed time is a finite value within the agreement window of its own clock — _before_
   producing any signature. Signing is an action taken for an unauthenticated caller; nothing
   malformed or out-of-window may reach the signer.
3. **Domain-tagged signature.** The responder signs the challenge under a dedicated, versioned
   handshake domain tag — never the bare challenge bytes. The domain separation makes a handshake
   signature structurally incapable of colliding with any other protocol signature (in particular,
   a challenge chosen to equal a block commitment must not yield a usable block signature). The
   responder returns the signature, its own time reading, and its transport preference, and now
   expects the initiator's acknowledgement.
4. **Initiator verification.** The initiator bounds the round-trip time and the responder's clock
   skew to the agreement window, recovers the signer identity from the domain-tagged message,
   rejects identities it has excluded, records the proven identity against the transport, and sends
   an acknowledgement.
5. **Acknowledgement.** The ack tells the responder its counterparty verified it. A duplicate ack
   on one transport is a protocol violation. The ack proves receipt, not identity — the responder
   has _not_ authenticated the initiator through this direction's exchange.

**Completion (both directions).** A session is authenticated only when this node has verified the
peer (its initiator role) _and_ received the peer's acknowledgement (its responder role) — the
symmetric exchange gives the peer the same pair. Completion is idempotent, records the identity in
the churn-surviving peer profile, opens the gated services, and may trigger follow-on work
(transport upgrade by deterministic tie-break, post-authentication sync). An exchange that stalls
past the agreement window times out: a peer already verified but never acknowledging is excluded by
identity; an unverified peer is merely dropped — there is no proven identity to penalize.

## System interactions

| System                                      | Interaction                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Peer communication](./rpc.md)              | Produces the authenticated session every guard checks; releases calls deferred during negotiation. |
| [Protocol model](../protocol-model/time.md) | Agreement-window arithmetic for freshness/skew bounds; signature scheme and identity model.        |
| [Transport upgrade](./transport-upgrade.md) | Triggered at completion under a deterministic single-initiator tie-break.                          |
| [Synchronization](./synchronization.md)     | Post-authentication catch-up may start at completion.                                              |
| [Security](../security/trust-model.md)      | Exclusion (blacklist) policy; identity-vs-transport trust boundary.                                |

## Failure outcomes

| Failure                                                                                          | Outcome                                                    |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Malformed challenge or non-finite/out-of-window time at the responder                            | Session terminated before signing; no signature produced.  |
| Response timeout, round-trip or skew bound exceeded, signature verifying to an excluded identity | Session dropped without identity penalty (nothing proven). |
| Duplicate acknowledgement                                                                        | Protocol violation: terminate and exclude.                 |
| Verified peer never acknowledges within the window                                               | Exclude by proven identity.                                |
| Unverified peer stalls                                                                           | Drop the transport only.                                   |

## Requirements and invariants

<a id="inv-auth-1"></a>
**INV-AUTH-1 — Signature is the only proof.** The sole authentication evidence is a valid signature
over this node's own fresh challenge under the handshake domain. Discovery metadata,
acknowledgements, and transport properties prove nothing.

<a id="inv-auth-2"></a>
**INV-AUTH-2 — Domain separation.** Handshake signatures are made only over the domain-tagged,
versioned message form; a handshake exchange can never produce a signature usable in any other
protocol context, regardless of the challenge value chosen by the counterparty.

<a id="req-auth-1"></a>
**REQ-AUTH-1 — Validate before signing.** A responder MUST fully validate challenge shape and time
bounds before creating any signature for an unauthenticated caller.

<a id="req-auth-2"></a>
**REQ-AUTH-2 — Fresh single-use challenges.** Challenges MUST be unpredictable, single-use, and
scoped to one exchange; verification MUST bind the response to exactly the issued challenge.

<a id="req-auth-3"></a>
**REQ-AUTH-3 — Completion requires both roles.** A session authenticates only when local
verification _and_ the peer's acknowledgement are both present; completion is idempotent and
recorded against the identity, not the transport.

<a id="req-auth-4"></a>
**REQ-AUTH-4 — Penalty requires proof.** Exclusion consequences apply only to proven identities;
an unauthenticated failure never penalizes an identity.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                  |
| ----------------------- | -------------------------------------------------------------------------- |
| `INV-AUTH-1`            | Only a domain-tagged signature over a fresh own challenge proves identity. |
| `INV-AUTH-2`            | Handshake signatures cannot collide with any other protocol signature.     |
| `REQ-AUTH-1`            | Full validation precedes signing for unauthenticated callers.              |
| `REQ-AUTH-2`            | Challenges are unpredictable, single-use, exchange-scoped.                 |
| `REQ-AUTH-3`            | Completion = local verification + peer acknowledgement; idempotent.        |
| `REQ-AUTH-4`            | No identity penalty without proven identity.                               |

## Assumptions and constraints

- Runs against wholly untrusted input on every network transport; only the node's own loopback is
  exempt ([rpc.md](./rpc.md)).
- Timing bounds derive from the protocol's agreement window
  ([time.md](../protocol-model/time.md)); honest peers within stated skew must complete.
- Protocol-version compatibility should bind into this exchange (`REQ-RPC-8`); the scheme is open
  ([OQ-34](../open-questions.md)).
- The handshake authenticates _identity_, not authorization: whether the identity may join, sync,
  or dispute is each service's own check.

## Security considerations

This service is the trust boundary's gatekeeper and its own biggest target. Threats and defenses:
identity spoofing (defeated by challenge-response over the domain tag); signing-oracle abuse — the
counterparty choosing challenges to harvest signatures (defeated by domain separation, `INV-AUTH-2`);
replayed or stale exchanges (freshness windows plus single-use challenges); acknowledgement forgery
(the ack carries no authority, `INV-AUTH-1`); and penalty misdirection — tricking a node into
excluding an identity that never proved itself (`REQ-AUTH-4`). Residual: the responder in a single
direction signs for an unauthenticated caller by design; the cost is bounded by validation-before-
signing and the domain tag. Exclusion durability and its interaction with deferred-call queues are
open ([OQ-34](../open-questions.md)).

## Verification and test plan

### Requirement test matrix

| Plan item                                 | Requirements / invariants | Setup and stimulus                                                                                                          | Expected result                                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-auth-1-t1"></a>`INV-AUTH-1.T1` | `INV-AUTH-1`              | Attempt authentication with forged metadata, replayed signatures, wrong-challenge signatures, and a correct fresh exchange. | Only the correct signature over this node's own fresh challenge authenticates.                                               | <a id="inv-auth-1-t1-p1"></a>`INV-AUTH-1.T1.P1` — correct exchange; <a id="inv-auth-1-t1-p2"></a>`INV-AUTH-1.T1.P2` — replayed/wrong-challenge signature; <a id="inv-auth-1-t1-p3"></a>`INV-AUTH-1.T1.P3` — metadata-only claim rejected.                                                                                                 |
| <a id="req-auth-2-t1"></a>`REQ-AUTH-2.T1` | `REQ-AUTH-2`              | Observe challenge generation across many exchanges; attempt cross-exchange and repeated use of one challenge.               | Challenges are unpredictable and never reused; a response to a different exchange's challenge fails verification.            | <a id="req-auth-2-t1-p1"></a>`REQ-AUTH-2.T1.P1` — uniqueness/unpredictability across exchanges; <a id="req-auth-2-t1-p2"></a>`REQ-AUTH-2.T1.P2` — cross-exchange challenge reuse rejected; <a id="req-auth-2-t1-p3"></a>`REQ-AUTH-2.T1.P3` — response bound to exactly the issued challenge.                                              |
| <a id="inv-auth-2-t1"></a>`INV-AUTH-2.T1` | `INV-AUTH-2`              | Present challenges crafted to equal other protocol commitments (block hashes, dispute encodings).                           | The returned signature verifies only under the handshake domain and is unusable in any other protocol context.               | <a id="inv-auth-2-t1-p1"></a>`INV-AUTH-2.T1.P1` — block-commitment challenge; <a id="inv-auth-2-t1-p2"></a>`INV-AUTH-2.T1.P2` — each other signed-object class; <a id="inv-auth-2-t1-p3"></a>`INV-AUTH-2.T1.P3` — domain-tag version mismatch fails verification.                                                                         |
| <a id="req-auth-1-t1"></a>`REQ-AUTH-1.T1` | `REQ-AUTH-1`              | Send malformed shapes, non-finite times, and boundary-window times.                                                         | Invalid input terminates before any signature exists; boundary values behave per the window definition.                      | <a id="req-auth-1-t1-p1"></a>`REQ-AUTH-1.T1.P1` — each malformed shape; <a id="req-auth-1-t1-p2"></a>`REQ-AUTH-1.T1.P2` — non-finite time; <a id="req-auth-1-t1-p3"></a>`REQ-AUTH-1.T1.P3` — at/just-beyond window.                                                                                                                       |
| <a id="req-auth-3-t1"></a>`REQ-AUTH-3.T1` | `REQ-AUTH-3`              | Drive exchanges to every partial-completion state, including duplicates, races, and transport replacement mid-exchange.     | Sessions authenticate only with both roles complete; completion is idempotent; identity survives transport churn.            | <a id="req-auth-3-t1-p1"></a>`REQ-AUTH-3.T1.P1` — verified-only and acked-only stall; <a id="req-auth-3-t1-p2"></a>`REQ-AUTH-3.T1.P2` — duplicate ack violation; <a id="req-auth-3-t1-p3"></a>`REQ-AUTH-3.T1.P3` — concurrent bidirectional completion; <a id="req-auth-3-t1-p4"></a>`REQ-AUTH-3.T1.P4` — repeated completion idempotent. |
| <a id="req-auth-4-t1"></a>`REQ-AUTH-4.T1` | `REQ-AUTH-4`              | Fail exchanges before and after identity proof.                                                                             | Pre-proof failures drop the transport with no identity penalty; post-proof non-acknowledgement excludes the proven identity. | <a id="req-auth-4-t1-p1"></a>`REQ-AUTH-4.T1.P1` — timeout before proof; <a id="req-auth-4-t1-p2"></a>`REQ-AUTH-4.T1.P2` — verified-but-silent peer excluded; <a id="req-auth-4-t1-p3"></a>`REQ-AUTH-4.T1.P3` — excluded identity refused at verification.                                                                                 |

## Future Work

_Non-normative._ Bind protocol-version negotiation into the signed handshake (`REQ-RPC-8`,
[OQ-34](../open-questions.md)); align with the signature-domain decision for all protocol objects
([OQ-29](../open-questions.md)); define exclusion persistence and appeal semantics.
