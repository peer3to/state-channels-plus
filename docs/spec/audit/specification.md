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
SDK-architecture permutations cover the reset ordering and its refusal after shutdown. The question
[`OQ-SPEC-LEAVE-1-9Q4BV3` (Scope of peer exclusion across a channel change)](../specification/open-questions.md#oq-spec-leave-1-9q4bv3) recorded the one
protocol decision the change surfaced and did not answer: the scope of a peer exclusion across a channel
change. It is now resolved (engineer decision, 2026-09-19, PR #494) in favour of **identity scope for the
runtime's lifetime**. The register keeps the question with its resolution, and the normative statement is in
[`REQ-AUTH-4-JWCF71` (Penalty requires proof)](../specification/peer-communication/handshake.md#req-auth-4-jwcf71),
which now says an exclusion is scoped to the excluded identity rather than to the channel whose traffic proved
the fault, with the rejected channel-scoped alternative and its consequences recorded beside it. The
[`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
sentence that used to release "peer-derived reputation" wholesale is corrected to match, and
[`REQ-AUTH-4-JWCF71.T1.P7`](../specification/peer-communication/handshake.md#req-auth-4-jwcf71.t1.p7) is
appended as its black-box obligation. Two things stay open by design and are named in the decision rather
than silently absorbed: durability across a restart
([`OQ-34-FY08V2` (RPC boundary decisions)](../specification/open-questions.md#oq-34-fy08v2)) and any reevaluation rule
([`OQ-45-ACZCDE` (Subjective post-authentication engagement policy)](../specification/open-questions.md#oq-45-aczcde)). The engineer approval register is
untouched; recording the resolution is a maintained-layer edit, and the changed fingerprints make the
affected approvals stale on their own.

A follow-up amendment to [`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
states two obligations the reuse depends on but the first text left implicit: work begun for a channel the
runtime has since left neither changes the runtime's state nor completes the next channel's initial
synchronization, and the fork being left stops being active as soon as the return to the pre-channel state
begins. Both are written without naming a component. They append
[`REQ-LIF-10-QR8NQ9.T1.P17`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p17) and
[`REQ-LIF-10-QR8NQ9.T1.P18`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p18) after the
highest existing number; nothing was renumbered. The lifecycle security considerations gained the matching
cross-channel hazard, including that late work is not held against the peer that answered it.

A second amendment from the same review round makes three further obligations normative, again without
naming a component. First, work begun for a channel the runtime has since left is not held against the peer
that served it — previously stated only in the lifecycle security considerations, now in the requirement
itself, appended as
[`REQ-LIF-10-QR8NQ9.T1.P20`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p20). Second, a
return to the pre-channel state that cannot complete retires the runtime and rejects the leave; this is the
opposite case to a rejected _departure_, which keeps the operation and the binding, and the requirement now
states both so they cannot be confused. It is appended as
[`REQ-LIF-10-QR8NQ9.T1.P19`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p19) and mirrored
at the runtime boundary in
[`REQ-SDK-ARCH-2-QBZAT8` (Ordered lifecycle)](../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8) as
[`REQ-SDK-ARCH-2-QBZAT8.T1.P8`](../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8.t1.p8). Third, releasing
the channel's scheduled work settles every operation whose only remaining completion was that work, so such
an operation fails rather than waiting forever
([`REQ-SDK-ARCH-2-QBZAT8.T1.P9`](../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8.t1.p9)); the same
requirement records that an owner cancelling its own work has already settled its waiter and must not be
settled twice, which is a boundary the implementation obligations carry rather than a black-box one. Every
new permutation was appended after the highest existing number in its plan; nothing was renumbered and no
permutation was retired.

A third amendment, from the second blind review round, closes the same class rather than a new one. The first
two amendments described the fence as if "does not change the runtime's state" and "costs its responder
nothing" were the whole of it; the review found three further ways for work begun for a channel the runtime
had left to reach the next one, and the requirement now states each without naming a component.
[`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
now says that such work performs **none** of its writes — including one it would make before its own result is
verified, which is where "changes the runtime's state" was silently read as "installs a verified payload" —
that it does not re-establish the departed runtime's membership, since an authorization assembled while the
channel was still held remains perfectly valid and submitting it would put the departed signer back on chain,
and that the no-penalty rule covers a peer's answer, its refusal, and the failure of the request alike. It
also states, for the first time, that **while the return is in progress the runtime records no exclusion at
all**: every peer of the channel being given up is departing with it, so a verdict earned there is about no
channel, and since the engineer's 2026-09-19 decision made exclusions identity-scoped it would follow that
identity into the next channel. That last sentence is a direct consequence of the identity-scope decision, so
[`REQ-AUTH-4-JWCF71` (Penalty requires proof)](../specification/peer-communication/handshake.md#req-auth-4-jwcf71)
carries it too, as a cross-reference rather than a second obligation — the release owns the rule, the
exclusion requirement records that it follows from its own scope. Four permutations are appended after the
highest existing number:
[`REQ-LIF-10-QR8NQ9.T1.P21`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p21) (no write,
first write included),
[`REQ-LIF-10-QR8NQ9.T1.P22`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p22) (no
membership),
[`REQ-LIF-10-QR8NQ9.T1.P23`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p23) (no exclusion
during the return), and
[`REQ-LIF-10-QR8NQ9.T1.P24`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p24) (no penalty
from a request round that outlived its channel). Nothing was renumbered, no permutation was retired, and the
lifecycle security considerations gained the chain-side and registry-side halves of the hazard that the
earlier text had confined to local state.

A fourth amendment, from the third blind review round, is again the same class and again not a new one. The
third amendment had generalised the fence to "performs none of its writes" and "costs its responder
nothing"; the round found that three things the earlier text did not name are neither writes of a payload
nor penalties. First, the identity of a channel is not the identity of a membership: a runtime that leaves
and then selects the **same** channel identifier restores every identifier-shaped check the old work would
have to pass, so the requirement now says that each membership is a distinct occupancy and a matching
identifier alone never makes earlier work current. Second, attachment is as dangerous as writing: work that
joins the discovery of the channel left both places the returned runtime in a rendezvous it has no part in
and displaces the record its next return has to release, and the requirement now forbids it in its own
sentence rather than leaving it to "changes the runtime's state". Third, the rule was written as if the
runtime were always the party that began the work; it now covers an operation a peer asked the runtime to
perform, which once the channel is gone is answered with a failure rather than an answer, records nothing,
and judges the asker not at all. Two smaller obligations were made explicit beside them: a timer already
armed for the fork being left submits nothing on its behalf when it fires (previously only "can start
nothing new for that fork"), and **every** release step that waits for work already in flight has to report
whether it finished, so the existing "a return that cannot complete retires the runtime" cannot be satisfied
by one step reporting while another logs and continues. Six permutations are appended after the highest
existing number —
[`REQ-LIF-10-QR8NQ9.T1.P25`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p25) (a chain
read that outlived its channel),
[`REQ-LIF-10-QR8NQ9.T1.P26`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p26) (no
discovery attachment),
[`REQ-LIF-10-QR8NQ9.T1.P27`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p27) (the same
identifier selected again),
[`REQ-LIF-10-QR8NQ9.T1.P28`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p28) (no answer
to a request about a channel already left),
[`REQ-LIF-10-QR8NQ9.T1.P29`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p29) (no
submission from a timer armed for the fork left), and
[`REQ-LIF-10-QR8NQ9.T1.P30`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p30) (the
scheduled-work release step fails the return too) — with the runtime-boundary mirror of the last one as
[`REQ-SDK-ARCH-2-QBZAT8.T1.P10`](../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8.t1.p10). Nothing was
renumbered, no permutation was retired, and the lifecycle security considerations gained the three
consequences above as a paragraph of their own.
