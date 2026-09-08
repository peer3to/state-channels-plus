# Specification Assessment

> **Agent assessment:** In progress.
> **Engineer disposition:** Pending.

The migrated protocol documents retain the reconstructed requirements, but their neutral templates and
interoperability cases are not yet complete. The generated specification index is the current queue.

The peer-communication layer now separates the handshake contract from post-authentication
engagement. The handshake specification ends at an authenticated identity-bound session and states
the objective boundary explicitly: mutual key proof, bidirectional inclusive clock compatibility
with an independent exchange-freshness bound, objective-facts-only separation, and the current
uniform-continued-interaction baseline; a future subjective engagement policy is an open question,
not interim behavior. The local-lifecycle engagement and catch-up contract is owned by the
synchronization specification. Fallback policy now covers both the SDK ban handle and final
authenticated admission: a healthy current direct transport and explicit exclusion refuse late bootstrap
connections, while explicit policy release checks the full live set before unbanning. Authenticated-RPC guard work is
scoped to its transport and owner lifetime, and a late frame after local transport close is dropped
without peer punishment. Bounded relay retry cancellation and byte-exact
discovery topic leave semantics are unchanged. Each behavior has an
explicit black-box plan and permutation set; the newly added clock-boundary, separation, baseline,
and opened-non-participant permutations are planned but not yet covered by executable evidence;
engineer disposition remains pending.

## 2026-08-31 — Targeted pre-open channel join

The maintained specification now gives one owner to each phase: caller-topic matching, mode-bound
negotiation, exact-channel synchronization, and receipt-gated membership. RO2 keeps `timeoutMs` and targeted
cancellation inside unmatched rendezvous. RO3 authorizes a pending RPC response by authenticated peer across
a live transport upgrade. RO4 permits one bounded re-entry into the locked target after authoritative open,
never a general-lobby or target-selection retry. RO5 separates terminal full-flow tests from bounded probes.
PY1 gives initial load two independent local windows and exact recovery one. RY3 makes fixed-target open win
after local signing but before submission. [`OQ-10-04YNC4`](../specification/open-questions.md#oq-10-04ync4)
is partially resolved; [`DEF-5-E8TP9N`](open-findings.md#def-5-e8tp9n),
[`DEF-6-B4ZN7S`](open-findings.md#def-6-b4zn7s), and
[`DEF-10-199C7F`](open-findings.md#def-10-199c7f) have dated dispositions. Engineer review remains pending.

## 2026-09-01 — Discovery replacement and pre-submission membership protection

[`REQ-LOBBY-9-N894C0`](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)
now requires replacement discovery for an eligible closed peer while the caller still observes the exact
topic, plus a hard stop after leave and under the existing blacklist policy. The membership invariants now
place `PENDING_PARTICIPANT` before contract invocation, preserve it when submission outcome is uncertain, and
gate force-join escalation on authoritative on-chain membership and a usable dispute window.

## 2026-09-01 — Attributable peer-fault consequences

RPC ingress, handshake, and lobby matching now use one consequence rule. A malformed or forbidden
protocol action blacklists only when an authenticated peer identity makes the fault attributable.
Transport loss, response timeout, cleanup, send failure, and an unclassified local handler error
remain disconnect-only.

## 2026-09-08 — Refusal is not silence, and a suspension is one-sided

[`REQ-AUTH-4-JWCF71`](../specification/peer-communication/handshake.md#req-auth-4-jwcf71) now states
that silence is attributable only while the transport that owed the message is still open: a missing
acknowledgement on an already closed transport penalizes nobody, even a peer already verified. This
closes the path by which a peer's own refusal — an exclusion or a reconnect suspension it placed,
both of which close without acknowledging — was answered with an exclusion by the refused peer.
[`REQ-LOBBY-9-N894C0`](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0) now
says explicitly that a suspension binds only the node holding it, that it must not be observable to
the suspended peer, that it must not leave the pair permanently unreachable, and that the node which
placed it owns restoring reachability — because it is the only side that knows the suspension exists
and when it ends. The converse is stated with it: an observed close carries no reason, so a peer
that only observed a close must not re-establish the connection, and a deliberate departure is never
reversed by another peer. The earlier pair-level phrasing ("at least one side must remain able to
produce the replacement connection") was withdrawn: it licensed exactly that unsound reconnect, and
the permutation written for it was deleted in favour of the two behaviors above.
