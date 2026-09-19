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
after local signing but before submission. [`OQ-10-04YNC4` (Spectate/join failure-point details)](../specification/open-questions.md#oq-10-04ync4)
is partially resolved; [`DEF-5-E8TP9N`](open-findings.md#def-5-e8tp9n),
[`DEF-6-B4ZN7S`](open-findings.md#def-6-b4zn7s), and
[`DEF-10-199C7F`](open-findings.md#def-10-199c7f) have dated dispositions. Engineer review remains pending.

## 2026-09-01 — Discovery replacement and pre-submission membership protection

[`REQ-LOBBY-9-N894C0` (Bounded inactive ingress and cleanup)](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)
now requires replacement discovery for an eligible closed peer while the caller still observes the exact
topic, plus a hard stop after leave and under the existing blacklist policy. The membership invariants now
place `PENDING_PARTICIPANT` before contract invocation, preserve it when submission outcome is uncertain, and
gate force-join escalation on authoritative on-chain membership and a usable dispute window.

## 2026-09-01 — Attributable peer-fault consequences

RPC ingress, handshake, and lobby matching now use one consequence rule. A malformed or forbidden
protocol action blacklists only when an authenticated peer identity makes the fault attributable.
Transport loss, response timeout, cleanup, send failure, and an unclassified local handler error
remain disconnect-only.

## Non-terminal channel leave

[`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) and
[`REQ-TJOIN-7-NNGTAY` (Channel leave and runtime reuse)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) were
rewritten from a terminal departure to a departure followed by a return to the pre-channel state. Both keep
their IDs because the obligation is the same obligation — how a participant gives up a channel — with a
different post-condition; the settlement half of each requirement is unchanged word for word. The
requirements now state what the reset must release in neutral terms (selected channel and fork, retained
state, peer set and peer-derived reputation, scheduled work) without naming a component, and they keep
shutdown and abort as the separate terminal operations. The writer role is deliberately outside that list:
it is application-owned with a single writer, and the lifecycle requirement says so rather than letting the
runtime become a second writer of it.

Three consequential amendments came with it.
[`REQ-TJOIN-6-0HEVYH` (Single-channel runtime ownership)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh) no
longer claims that nothing can clear the selected ID: a completed leave is now its single release, and the
requirement says so precisely rather than being weakened to "usually".
[`REQ-SDK-ARCH-2-QBZAT8` (Ordered lifecycle)](../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8) gained the non-terminal
lifecycle step and its ordering obligation, so the ordering that makes the release safe is specified rather
than left to the implementation report. Initial-observer-sync failure still aborts and disposes, so
[sdk.md](../specification/runtime/sdk.md) still tells that caller to build a new runtime.

Permutations: `.P3`, `.P4`, and `.P5` of
[`REQ-LIF-10-QR8NQ9.T1`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1) and `.P1`, `.P2`,
`.P8` of [`REQ-TJOIN-7-NNGTAY.T1`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay.t1)
were reworded in place, because each still names the same behaviour with the corrected post-condition; none
was retired and no number was reused. Five new lifecycle permutations and one new targeted-join permutation
cover what the change genuinely adds — the repeat cycle, the rejected leave, reuse after a non-committed
leave, isolation from the channel that was left, and shutdown staying terminal after a reuse — and two
SDK-architecture permutations cover the reset ordering and its refusal after shutdown. The new question
[`OQ-SPEC-LEAVE-1-9Q4BV3` (Scope of peer exclusion across a channel change)](../specification/open-questions.md#oq-spec-leave-1-9q4bv3) records the one
protocol decision the change surfaces and does not answer: the scope of a peer exclusion across a channel
change.

A follow-up amendment to [`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
states two obligations the reuse depends on but the first text left implicit: work begun for a channel the
runtime has since left neither changes the runtime's state nor completes the next channel's initial
synchronization, and the fork being left stops being active as soon as the return to the pre-channel state
begins. Both are written without naming a component. They append
[`REQ-LIF-10-QR8NQ9.T1.P17`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p17) and
[`REQ-LIF-10-QR8NQ9.T1.P18`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p18) after the
highest existing number; nothing was renumbered. The lifecycle security considerations gained the matching
cross-channel hazard, including that late work is not held against the peer that answered it.
