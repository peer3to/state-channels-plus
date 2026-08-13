# Transport Upgrade and Signaling

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** Post-authentication signaling that migrates an authenticated peer session from its
> bootstrap transport to a direct transport, and the session-continuity rules of the migration.
> Shared communication rules: [rpc.md](./rpc.md).

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

The transport that bootstraps a session may be relayed or hub-mediated. Once peers are mutually
authenticated, they may negotiate a direct connection and migrate the session onto it. The upgrade
is best-effort infrastructure: signaling failure leaves the existing transport in use, costs
nothing, and proves nothing. Identity continuity is the hard requirement — the peer's authenticated
identity, records, and pending requests survive the migration; the new transport re-proves identity
before carrying protocol traffic.

## Algorithm

1. **Initiation tie-break.** At session completion, when at least one side prefers the direct
   transport and the session is not already direct, exactly one side initiates — chosen by a
   deterministic identity-order rule, eliminating offer glare.
2. **Offer/answer exchange.** The initiator creates a connection offer and sends it one-way over
   the authenticated session. The receiver builds its answer, associates the pending connection
   with the _authenticated sender identity_ (never a payload-claimed identity), and returns the
   answer as its own one-way message. Connectivity candidates trickle in both directions the same
   way and apply only to the pending connection for that identity; candidates without a pending
   connection are ignored.
3. **At most one pending upgrade per peer.** A new offer for an identity with a pending connection
   replaces it (the old attempt is closed); pending state is bounded per peer.
4. **New transport, fresh proof.** A successfully established direct connection is wrapped as a
   normal transport and runs the full [handshake](./handshake.md) — signaling produced
   connectivity, not authentication.
5. **Cutover.** On the new transport's authentication, the peer's profile switches to it; the old
   transport is retired after a grace window. Requests pending on the retired transport settle per
   the correlation rules ([rpc.md](./rpc.md)); addressed delivery resolves to the live transport
   throughout.

## System interactions

| System                             | Interaction                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [Handshake](./handshake.md)        | Triggers the upgrade decision at completion; re-authenticates the new transport before cutover.                            |
| [Peer communication](./rpc.md)     | Correlation and addressed delivery survive cutover by identity; retired-transport requests settle deterministically.       |
| [Runtime](../runtime/execution.md) | The connectivity stack may live in another execution context; the signaling contract is context-neutral (`INV-RUNTIME-1`). |

## Failure outcomes

| Failure                                              | Outcome                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Malformed or unparseable signaling payload           | Ignored; existing transport unaffected.                               |
| Signaling for an identity with no pending connection | Ignored.                                                              |
| Connectivity failure (no direct path)                | Upgrade abandoned; session continues on the existing transport.       |
| New transport fails authentication                   | No cutover; pending connection discarded.                             |
| Offer flood                                          | Bounded by the one-pending-per-peer replacement rule and `REQ-RPC-5`. |

## Requirements and invariants

<a id="inv-upg-1"></a>
**INV-UPG-1 — Best-effort with no protocol effect.** No signaling outcome — success, failure,
garbage — changes protocol state, session authentication, or peer standing; only a fully
authenticated new transport changes anything, and then only which pipe carries the session.

<a id="req-upg-1"></a>
**REQ-UPG-1 — Identity-bound signaling.** All signaling state binds to the authenticated sender
identity from the session, never to payload-claimed identities; at most one pending upgrade exists
per peer, newer attempts replacing older ones with the replaced attempt closed.

<a id="req-upg-2"></a>
**REQ-UPG-2 — Re-authentication before cutover.** The upgraded transport MUST complete the full
identity handshake before any protocol traffic, and cutover MUST preserve the peer's identity
records and settle or migrate pending requests per the correlation rules.

<a id="req-upg-3"></a>
**REQ-UPG-3 — Single deterministic initiator.** The upgrade initiator is selected by a
deterministic identity-order rule; both-sides initiation must not produce two competing upgrades.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                    |
| ----------------------- | ------------------------------------------------------------ |
| `INV-UPG-1`             | Signaling is best-effort and protocol-inert.                 |
| `REQ-UPG-1`             | Identity-bound, one-pending-per-peer signaling state.        |
| `REQ-UPG-2`             | Full re-authentication before cutover; continuity preserved. |
| `REQ-UPG-3`             | Deterministic single initiator.                              |

## Assumptions and constraints

- Runs only between authenticated peers (gated service); signaling payloads are still untrusted
  data handed to the connectivity stack.
- Direct connectivity may be impossible (symmetric NATs, policy); the bootstrap transport remains a
  fully supported permanent path.
- Signaling volume is bounded per peer (`REQ-RPC-5`); connection attempts consume real resources
  and are bounded by the replacement rule.

## Security considerations

Because outcomes are protocol-inert (`INV-UPG-1`), the surface is resource abuse and confusion, not
state corruption: offer floods force connection-object churn (bounded by replacement + rate
limits); identity confusion is prevented by binding to the session identity; a hijacked-looking
new transport gains nothing without passing the handshake (`REQ-UPG-2`). Silent-ignore failure
handling is appropriate here precisely because nothing depends on signaling truthfulness; the
trade-off is reduced observability of abuse, which the rate limiter must compensate for.

## Verification and test plan

### Requirement test matrix

| Plan item                               | Requirements / invariants | Setup and stimulus                                                                                                 | Expected result                                                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-upg-1-t1"></a>`INV-UPG-1.T1` | `INV-UPG-1`               | Run successful, failing, and garbage signaling during live protocol traffic.                                       | Protocol state, authentication, and peer standing are untouched in every case; only a completed upgrade changes the carrying pipe.           | <a id="inv-upg-1-t1-p1"></a>`INV-UPG-1.T1.P1` — success inert until cutover; <a id="inv-upg-1-t1-p2"></a>`INV-UPG-1.T1.P2` — garbage ignored; <a id="inv-upg-1-t1-p3"></a>`INV-UPG-1.T1.P3` — connectivity failure leaves session intact.                                                                                                                                                                                                                               |
| <a id="req-upg-1-t1"></a>`REQ-UPG-1.T1` | `REQ-UPG-1`               | Signal with mismatched payload identities, multiple concurrent offers, and candidates without pending connections. | Binding follows the session identity; replacement closes the older attempt; orphan candidates are ignored.                                   | <a id="req-upg-1-t1-p1"></a>`REQ-UPG-1.T1.P1` — session-identity binding; <a id="req-upg-1-t1-p2"></a>`REQ-UPG-1.T1.P2` — replacement closes prior; <a id="req-upg-1-t1-p3"></a>`REQ-UPG-1.T1.P3` — orphan candidate ignored; <a id="req-upg-1-t1-p4"></a>`REQ-UPG-1.T1.P4` — offer flood bounded.                                                                                                                                                                      |
| <a id="req-upg-2-t1"></a>`REQ-UPG-2.T1` | `REQ-UPG-2`               | Complete upgrades with pending requests in flight; fail authentication on the new transport.                       | Cutover only after full re-authentication; records survive; pending requests settle per correlation rules; failed auth discards the attempt. | <a id="req-upg-2-t1-p1"></a>`REQ-UPG-2.T1.P1` — successful cutover continuity; <a id="req-upg-2-t1-p2"></a>`REQ-UPG-2.T1.P2` — failed auth, no cutover; <a id="req-upg-2-t1-p3"></a>`REQ-UPG-2.T1.P3` — in-flight requests across cutover; <a id="req-upg-2-t1-p4"></a>`REQ-UPG-2.T1.P4` — grace-window retirement.                                                                                                                                                     |
| <a id="req-upg-3-t1"></a>`REQ-UPG-3.T1` | `REQ-UPG-3`               | Complete sessions with each preference combination and identity ordering.                                          | Exactly one initiator per pair; no glare; no upgrade when neither prefers it or the session is already direct.                               | <a id="req-upg-3-t1-p1"></a>`REQ-UPG-3.T1.P1` — both peers prefer direct; <a id="req-upg-3-t1-p2"></a>`REQ-UPG-3.T1.P2` — identity-order determinism; <a id="req-upg-3-t1-p3"></a>`REQ-UPG-3.T1.P3` — already-direct no-op; <a id="req-upg-3-t1-p4"></a>`REQ-UPG-3.T1.P4` — only order-first peer prefers; <a id="req-upg-3-t1-p5"></a>`REQ-UPG-3.T1.P5` — only order-second peer prefers; <a id="req-upg-3-t1-p6"></a>`REQ-UPG-3.T1.P6` — neither prefers, no upgrade. |

## Future Work

_Non-normative._ Signaling under the future rate limiter with per-peer cost weighting; upgrade
retry/backoff policy; connection-state observability for abuse detection.
