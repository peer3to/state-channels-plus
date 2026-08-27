# Transport Upgrade and Signaling

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** Post-authentication signaling that migrates an authenticated peer session from its
> bootstrap transport to a direct transport, and the session-continuity rules of the migration.
> Shared communication rules: [rpc.md](./rpc.md).

## Contents

- [Purpose and observable contract](#purpose-and-observable-contract)
- [Upgrade algorithm](#upgrade-algorithm)
- [Bootstrap connectivity lifecycle](#bootstrap-connectivity-lifecycle)
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

## Upgrade algorithm

This section is explanatory; the binding rules are
[`INV-UPG-1-KW2A02`](transport-upgrade.md#inv-upg-1-kw2a02),
[`REQ-UPG-1-MFBTZ1`](transport-upgrade.md#req-upg-1-mfbtz1),
[`REQ-UPG-2-WH7BC7`](transport-upgrade.md#req-upg-2-wh7bc7), and
[`REQ-UPG-3-T1SRMS`](transport-upgrade.md#req-upg-3-t1srms) below.

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
5. **Cutover.** On the new transport's authentication, the peer's identity records rebind to it;
   the old transport is retired after a grace window. Requests pending on the retired transport
   settle per the correlation rules ([rpc.md](./rpc.md)); addressed delivery resolves to the live
   transport throughout.

## Bootstrap connectivity lifecycle

This section is explanatory; the binding rules are
[`REQ-UPG-4-M2XDBA`](transport-upgrade.md#req-upg-4-m2xdba),
[`REQ-UPG-5-YQV7MJ`](transport-upgrade.md#req-upg-5-yqv7mj), and
[`REQ-UPG-6-BC60XD`](transport-upgrade.md#req-upg-6-bc60xd) below. These behaviors are observable
at the bootstrap connectivity boundary — which fallback connections a peer will accept, which relay
endpoints it attempts and when, and which discovery topics it announces — even though no protocol
state depends on them.

- **Fallback availability.** A direct transport keeps its authenticated bootstrap transport
  unavailable for duplicate discovery. Only closing the current direct transport may release that
  fallback; a stale replaced transport cannot change the current ban state, and explicit exclusion
  always wins.
- **Relay retry.** Relay failures exclude the failed endpoint and retry with jitter. Exhausting the
  pool resets exclusions and applies bounded exponential backoff. A successful connection cancels
  the pending retry.
- **Discovery topics.** Joining records each supplied byte topic, including duplicates. Leaving
  removes the first byte-equal recorded topic before leaving discovery; an absent topic is a no-op
  and a later discovery restart does not rejoin a removed topic.

## System interactions

| System                             | Interaction                                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Handshake](./handshake.md)        | Triggers the upgrade decision at completion; re-authenticates the new transport before cutover.                                                                                   |
| [Peer communication](./rpc.md)     | Correlation and addressed delivery survive cutover by identity; retired-transport requests settle deterministically.                                                              |
| [Runtime](../runtime/execution.md) | The connectivity stack may live in another execution context; the signaling contract is context-neutral ([`INV-RUNTIME-1-AKRHAK`](../runtime/execution.md#inv-runtime-1-akrhak)). |

## Failure outcomes

| Failure                                              | Outcome                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Malformed or unparseable signaling payload           | Ignored; existing transport unaffected.                                                                 |
| Signaling for an identity with no pending connection | Ignored.                                                                                                |
| Connectivity failure (no direct path)                | Upgrade abandoned; session continues on the existing transport.                                         |
| New transport fails authentication                   | No cutover; pending connection discarded.                                                               |
| Offer flood                                          | Bounded by the one-pending-per-peer replacement rule and [`REQ-RPC-5-CV1R1Y`](rpc.md#req-rpc-5-cv1r1y). |

## Requirements and invariants

**<a id="inv-upg-1-kw2a02"></a>`INV-UPG-1-KW2A02` — Best-effort with no protocol effect.** No signaling outcome — success, failure,
garbage — changes protocol state, session authentication, or peer standing; only a fully
authenticated new transport changes anything, and then only which pipe carries the session.

**<a id="req-upg-1-mfbtz1"></a>`REQ-UPG-1-MFBTZ1` — Identity-bound signaling.** All signaling state binds to the authenticated sender
identity from the session, never to payload-claimed identities; at most one pending upgrade exists
per peer, newer attempts replacing older ones with the replaced attempt closed.

**<a id="req-upg-2-wh7bc7"></a>`REQ-UPG-2-WH7BC7` — Re-authentication before cutover.** The upgraded transport MUST complete the full
identity handshake before any protocol traffic, and cutover MUST preserve the peer's identity
records and settle or migrate pending requests per the correlation rules. During protocol-owned grace
overlap, both open transports that completed their own handshake MAY carry authenticated traffic.
Selecting a current or preferred transport MUST NOT revoke authentication from the older pipe;
the upgrade protocol owns its retirement.

**<a id="req-upg-3-t1srms"></a>`REQ-UPG-3-T1SRMS` — Single deterministic initiator.** The upgrade initiator is selected by a
deterministic identity-order rule; both-sides initiation must not produce two competing upgrades.

**<a id="req-upg-4-m2xdba"></a>`REQ-UPG-4-M2XDBA` — Fallback ban follows the current transport.** A direct transport MUST suppress its
bootstrap fallback. Only retirement of the current direct transport may release it, and explicit
identity exclusion MUST remain in force across every transport change. A late bootstrap connection
that reaches authentication MUST still be refused while the direct transport is healthy or the
identity is excluded. After current-direct retirement, a non-excluded bootstrap connection may
authenticate, become current, and carry traffic. Refusing a non-current transport MUST NOT emit a
peer-disconnection event for the still-current identity transport.

**<a id="req-upg-5-yqv7mj"></a>`REQ-UPG-5-YQV7MJ` — Relay retries converge without stale work.** Relay selection MUST avoid failed URLs
until pool exhaustion, apply bounded jittered backoff, deduplicate paired failure events, and cancel
pending retries after success.

**<a id="req-upg-6-bc60xd"></a>`REQ-UPG-6-BC60XD` — Discovery topic leave is byte-exact and durable.** Join MUST preserve each supplied
topic entry. Leave MUST remove the first byte-equal entry before the discovery leave completes;
absent topics are no-ops and removed topics MUST NOT return during a later discovery restart.

## Assumptions and constraints

- Runs only between authenticated peers (gated service); signaling payloads are still untrusted
  data handed to the connectivity stack.
- Direct connectivity may be impossible (symmetric NATs, policy); the bootstrap transport remains a
  fully supported permanent path.
- Signaling volume is bounded per peer ([`REQ-RPC-5-CV1R1Y`](rpc.md#req-rpc-5-cv1r1y)); connection attempts consume real resources
  and are bounded by the replacement rule.

## Security considerations

Because outcomes are protocol-inert ([`INV-UPG-1-KW2A02`](transport-upgrade.md#inv-upg-1-kw2a02)), the surface is resource abuse and confusion, not
state corruption: offer floods force connection-object churn (bounded by replacement + rate
limits); identity confusion is prevented by binding to the session identity; a hijacked-looking
new transport gains nothing without passing the handshake ([`REQ-UPG-2-WH7BC7`](transport-upgrade.md#req-upg-2-wh7bc7)). Silent-ignore failure
handling is appropriate here precisely because nothing depends on signaling truthfulness; the
trade-off is reduced observability of abuse, which the rate limiter must compensate for.

## Verification and test plan

### Requirement test matrix

| Plan item                                             | Requirements / invariants                                   | Setup and stimulus                                                                                                                                                      | Expected result                                                                                                                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-upg-1-kw2a02.t1"></a>`INV-UPG-1-KW2A02.T1` | [`INV-UPG-1-KW2A02`](transport-upgrade.md#inv-upg-1-kw2a02) | Run successful, failing, and garbage signaling during live protocol traffic.                                                                                            | Protocol state, authentication, and peer standing are untouched in every case; only a completed upgrade changes the carrying pipe.                                                                            | <a id="inv-upg-1-kw2a02.t1.p1"></a>`INV-UPG-1-KW2A02.T1.P1` — success inert until cutover; <a id="inv-upg-1-kw2a02.t1.p2"></a>`INV-UPG-1-KW2A02.T1.P2` — garbage ignored; <a id="inv-upg-1-kw2a02.t1.p3"></a>`INV-UPG-1-KW2A02.T1.P3` — connectivity failure leaves session intact.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| <a id="req-upg-1-mfbtz1.t1"></a>`REQ-UPG-1-MFBTZ1.T1` | [`REQ-UPG-1-MFBTZ1`](transport-upgrade.md#req-upg-1-mfbtz1) | Signal with mismatched payload identities, multiple concurrent offers, and candidates without pending connections.                                                      | Binding follows the session identity; replacement closes the older attempt; orphan candidates are ignored.                                                                                                    | <a id="req-upg-1-mfbtz1.t1.p1"></a>`REQ-UPG-1-MFBTZ1.T1.P1` — session-identity binding; <a id="req-upg-1-mfbtz1.t1.p2"></a>`REQ-UPG-1-MFBTZ1.T1.P2` — replacement closes prior; <a id="req-upg-1-mfbtz1.t1.p3"></a>`REQ-UPG-1-MFBTZ1.T1.P3` — orphan candidate ignored; <a id="req-upg-1-mfbtz1.t1.p4"></a>`REQ-UPG-1-MFBTZ1.T1.P4` — offer flood bounded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| <a id="req-upg-2-wh7bc7.t1"></a>`REQ-UPG-2-WH7BC7.T1` | [`REQ-UPG-2-WH7BC7`](transport-upgrade.md#req-upg-2-wh7bc7) | Complete upgrades with pending requests in flight; fail authentication on the new transport; send guarded traffic over the old authenticated pipe during grace overlap. | Cutover only after full re-authentication; records survive; pending requests settle per correlation rules; failed auth discards the attempt; both authenticated pipes remain valid until protocol retirement. | <a id="req-upg-2-wh7bc7.t1.p1"></a>`REQ-UPG-2-WH7BC7.T1.P1` — successful cutover continuity; <a id="req-upg-2-wh7bc7.t1.p2"></a>`REQ-UPG-2-WH7BC7.T1.P2` — failed auth, no cutover; <a id="req-upg-2-wh7bc7.t1.p3"></a>`REQ-UPG-2-WH7BC7.T1.P3` — in-flight requests across cutover; <a id="req-upg-2-wh7bc7.t1.p4"></a>`REQ-UPG-2-WH7BC7.T1.P4` — grace-window retirement; <a id="req-upg-2-wh7bc7.t1.p5"></a>`REQ-UPG-2-WH7BC7.T1.P5` — old authenticated pipe carries guarded traffic during grace overlap without punishment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| <a id="req-upg-3-t1srms.t1"></a>`REQ-UPG-3-T1SRMS.T1` | [`REQ-UPG-3-T1SRMS`](transport-upgrade.md#req-upg-3-t1srms) | Complete sessions with each preference combination and identity ordering.                                                                                               | Exactly one initiator per pair; no glare; no upgrade when neither prefers it or the session is already direct.                                                                                                | <a id="req-upg-3-t1srms.t1.p1"></a>`REQ-UPG-3-T1SRMS.T1.P1` — both peers prefer direct; <a id="req-upg-3-t1srms.t1.p2"></a>`REQ-UPG-3-T1SRMS.T1.P2` — identity-order determinism; <a id="req-upg-3-t1srms.t1.p3"></a>`REQ-UPG-3-T1SRMS.T1.P3` — already-direct no-op; <a id="req-upg-3-t1srms.t1.p4"></a>`REQ-UPG-3-T1SRMS.T1.P4` — only order-first peer prefers; <a id="req-upg-3-t1srms.t1.p5"></a>`REQ-UPG-3-T1SRMS.T1.P5` — only order-second peer prefers; <a id="req-upg-3-t1srms.t1.p6"></a>`REQ-UPG-3-T1SRMS.T1.P6` — neither prefers, no upgrade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| <a id="req-upg-4-m2xdba.t1"></a>`REQ-UPG-4-M2XDBA.T1` | [`REQ-UPG-4-M2XDBA`](transport-upgrade.md#req-upg-4-m2xdba) | Replace bootstrap and direct transports, close stale and current direct transports, retry bootstrap authentication, and explicitly exclude the identity.                | Bootstrap admission changes only with the current transport; stale close is inert; explicit exclusion never releases; fallback becomes usable only after current-direct retirement.                           | <a id="req-upg-4-m2xdba.t1.p1"></a>`REQ-UPG-4-M2XDBA.T1.P1` — bootstrap-to-direct ban; <a id="req-upg-4-m2xdba.t1.p2"></a>`REQ-UPG-4-M2XDBA.T1.P2` — stale direct close remains banned; <a id="req-upg-4-m2xdba.t1.p3"></a>`REQ-UPG-4-M2XDBA.T1.P3` — current direct close releases fallback; <a id="req-upg-4-m2xdba.t1.p4"></a>`REQ-UPG-4-M2XDBA.T1.P4` — explicit exclusion remains banned; <a id="req-upg-4-m2xdba.t1.p5"></a>`REQ-UPG-4-M2XDBA.T1.P5` — unauthenticated-profile explicit ban; <a id="req-upg-4-m2xdba.t1.p6"></a>`REQ-UPG-4-M2XDBA.T1.P6` — ordinary unauthenticated-profile close does not ban; <a id="req-upg-4-m2xdba.t1.p7"></a>`REQ-UPG-4-M2XDBA.T1.P7` — authenticated bootstrap attempt is refused while direct transport is healthy; <a id="req-upg-4-m2xdba.t1.p8"></a>`REQ-UPG-4-M2XDBA.T1.P8` — current-direct close permits an authenticated usable bootstrap fallback; <a id="req-upg-4-m2xdba.t1.p9"></a>`REQ-UPG-4-M2XDBA.T1.P9` — excluded identity's authenticated bootstrap attempt is banned and refused. |
| <a id="req-upg-5-yqv7mj.t1"></a>`REQ-UPG-5-YQV7MJ.T1` | [`REQ-UPG-5-YQV7MJ`](transport-upgrade.md#req-upg-5-yqv7mj) | Drive relay selection, paired failures, pool exhaustion, increasing backoff, and success while a retry timer is pending.                                                | Selection and delay stay bounded; one retry is pending; success cancels it before it reconnects.                                                                                                              | <a id="req-upg-5-yqv7mj.t1.p1"></a>`REQ-UPG-5-YQV7MJ.T1.P1` — empty pool; <a id="req-upg-5-yqv7mj.t1.p2"></a>`REQ-UPG-5-YQV7MJ.T1.P2` — non-excluded selection; <a id="req-upg-5-yqv7mj.t1.p3"></a>`REQ-UPG-5-YQV7MJ.T1.P3` — failover jitter bounds; <a id="req-upg-5-yqv7mj.t1.p4"></a>`REQ-UPG-5-YQV7MJ.T1.P4` — exhaustion backoff and reset; <a id="req-upg-5-yqv7mj.t1.p5"></a>`REQ-UPG-5-YQV7MJ.T1.P5` — backoff cap; <a id="req-upg-5-yqv7mj.t1.p6"></a>`REQ-UPG-5-YQV7MJ.T1.P6` — success resets state; <a id="req-upg-5-yqv7mj.t1.p7"></a>`REQ-UPG-5-YQV7MJ.T1.P7` — success cancels a pending retry; <a id="req-upg-5-yqv7mj.t1.p8"></a>`REQ-UPG-5-YQV7MJ.T1.P8` — paired failure deduplication.                                                                                                                                                                                                                                                                                                                                       |
| <a id="req-upg-6-bc60xd.t1"></a>`REQ-UPG-6-BC60XD.T1` | [`REQ-UPG-6-BC60XD`](transport-upgrade.md#req-upg-6-bc60xd) | Join, duplicate, leave with a separate byte-equal value, leave absent and pre-start topics, then restart discovery.                                                     | Join options and order are retained; first equal entry is removed; absent/pre-start leave is safe; removed topic is not re-announced.                                                                         | <a id="req-upg-6-bc60xd.t1.p1"></a>`REQ-UPG-6-BC60XD.T1.P1` — join forwards topic/options; <a id="req-upg-6-bc60xd.t1.p2"></a>`REQ-UPG-6-BC60XD.T1.P2` — separate byte-equal leave; <a id="req-upg-6-bc60xd.t1.p3"></a>`REQ-UPG-6-BC60XD.T1.P3` — duplicate first-match removal; <a id="req-upg-6-bc60xd.t1.p4"></a>`REQ-UPG-6-BC60XD.T1.P4` — absent leave; <a id="req-upg-6-bc60xd.t1.p5"></a>`REQ-UPG-6-BC60XD.T1.P5` — leave before discovery creation; <a id="req-upg-6-bc60xd.t1.p6"></a>`REQ-UPG-6-BC60XD.T1.P6` — removed topic stays absent after restart.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Future Work

_Non-normative._ Signaling under the future rate limiter with per-peer cost weighting and
connection-state observability for abuse detection.
