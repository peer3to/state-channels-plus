# Targeted Channel Join

> **Agent status:** Maintained protocol specification.
> **Engineer verification:** Pending.
> **Scope:** Connecting one signer to an application-selected channel ID before or after it opens.

## Contents

- [Protocol](#protocol)
- [Requirements and invariant](#requirements-and-invariant)
- [Assumptions](#assumptions)
- [Security](#security)
- [Verification](#verification)

## Protocol

`connectToChannel` owns one selected channel ID. Its independent options are `autoOpen`, `shouldJoin`,
`balance`, and `timeoutMs`. `autoOpen` permits fixed-target matching and opening. `shouldJoin` requests
membership after exact-channel synchronization. A balance supplies genesis terms when `autoOpen` is active
and later membership terms when `shouldJoin` is active. It is dormant only when neither operation is active. An
omitted join balance uses the simple default. No caller supplies a join deadline.

An unopened call without `autoOpen` returns `false` before discovery. An unopened call with `autoOpen`
matches on `keccak256("targeted-channel-join", channelId)`, never on the raw channel key. The generic
matcher returns one authenticated committed peer; the connect wrapper starts fixed-ID negotiation and
consumes its direct outcome. The matcher neither starts negotiation nor chooses lifecycle policy.
`timeoutMs` belongs only to the unmatched rendezvous. Omitted or `null` is unbounded. Match acceptance
removes its timer before negotiation. Negotiation, signing, submission, receipts, chain observation,
raw discovery, sync, joins, and top-ups keep their existing deadlines.

An authoritative fixed-target open at any pre-sync point wins. Match and negotiation ownership are
released, the derived topic is left, and the same connect operation enters its exact-channel post-open
branch once. That branch keeps the selected ID locked, refreshes only that ID, joins only its raw topic,
and uses the normal participant handshake, initial state load, and optional join. It is not a rematch,
target-selection retry, or permission to use the matched loser. If opening is observed while the local
opening signature is pending, the post-sign guard discards the late signature and submits no transaction.
A targeted receipt failure is reclassified only when an authoritative read now proves the fixed target
open. Ordinary transcript-derived failures never use this handoff.

Initial state load stays in the connection-established owner. While the runtime is uncommitted, the
first connected peer that authoritative chain state identifies as a participant receives one ordinary
sync request with a two-agreement-window timeout. One validated response supplies usable state.
Silence, disconnect, timeout, invalid state, or protocol-breaking data fails the request; the connection
owner aborts and disposes the uncommitted observer without starting another initial request. If no
participant completes a handshake within those same two agreement windows, the owner aborts the same way:
one missing or timed-out initial exchange settles the connect as `false`, and the runtime never waits for a
later, more cooperative peer. Exact block
recovery calls the same sync API with its default one-window timeout and preserves an established observer.

With no join request, `true` means exact-channel state reached `SYNCED`, or the caller reached
`PARTICIPATING` through genesis. With a join request, `true` means confirmed genesis membership or a
successful existing membership receipt reached `PENDING_PARTICIPANT` or `PARTICIPATING`. An existing
pending or participating signer with no balance sends no transaction; a supplied balance sends one
receipt-gated top-up. A first join and every top-up assign the standard deadline at execution.

When a first-join transaction is submitted, the local signer immediately enters
`PENDING_PARTICIPANT`. This is a local protective state, not a claim that the chain or other peers already
recognize membership. It prevents synced-state abort paths from disposing the runtime while a potentially
funded transaction awaits its receipt. A failed transaction returns the signer to `SYNCED`; the ordinary
uncommitted-failure path may then abort and dispose the runtime.

Before accepted participation, fatal initial sync or first-join failure returns `false`, fires `onAbort`,
and disposes the runtime. After `PENDING_PARTICIPANT` or `PARTICIPATING`, an operational failure preserves
the runtime, status, and selected channel. An unsigned targeted negotiation failure is narrower: it
returns `false`, retains the selected target and provider listener, and permits a later explicit same-ID
attempt while the runtime is live. It never starts ordinary lobby matching.

`cancelConnectToChannel(channelId)` is a distinct public operation. It reuses the matcher's unmatched
cancellation owner and returns `true` only for the active targeted attempt before match acceptance. It
then settles connect as `false`. A wrong channel or post-handoff call returns `false` without mutation.
It is not an alias for `leaveLobby`.

A live runtime owns at most one normalized nonzero channel ID. A different-ID `connectToChannel` call fails
before clearing or changing channel state, listeners, discovery, commitments, or pending work. A same-ID call
keeps its existing retry and idempotency rules. `connectToChannel` is the only public channel selector.

`leaveChannel` is terminal for the runtime. A non-participant, including a synced observer, completes without
an exit. A pending or active participant records self-removal, captures the current participant count `N`, and
offers its next eligible turn through `onLeaveTurn` instead of `onTurn`. The application may author its normal
exit transition during that hook. If no authored exit is ingested before either `N + 1` blocks or the local
leave watchdog, the runtime starts the normal self-removal dispute. The watchdog defaults to 15 seconds and is
a configurable liveness heuristic, not an on-chain timing rule. Completion waits for settled on-chain state,
local `SYNCED`, and observed removal. The outer instance then runs its normal disposal chain. Calls made after
terminal leave receive the disposed-runtime failure; another channel requires a fresh runtime.

## Requirements and invariant

**<a id="inv-tjoin-1-r3k75d"></a>`INV-TJOIN-1-R3K75D` — Exact target ownership.** One connect operation keeps
one normalized channel ID through matching, negotiation, authoritative-open handoff, raw discovery,
synchronization, and optional membership. It cannot derive, select, or retry another target.

**<a id="inv-tjoin-2-h7jsqm"></a>`INV-TJOIN-2-H7JSQM` — Local pending protection for submitted joins.** A
first-join signer enters `PENDING_PARTICIPANT` before invoking on-chain transaction submission or crossing an
asynchronous boundary that may send it. It remains protected from synced-state abort while submission or the
receipt is pending. Only a failure that proves no commitment exists restores `SYNCED`; uncertain outcomes
preserve pending protection and reconcile from authoritative chain state. Force-join escalation waits for
authoritative on-chain membership and a usable dispute window. The canonical cross-flow invariant is
[`INV-MEMBERSHIP-PENDING-1-2H1T75`](join-authorization.md#inv-membership-pending-1-2h1t75).

**<a id="req-tjoin-1-5vgr1f"></a>`REQ-TJOIN-1-5VGR1F` — Independent public options.** Opening permission,
membership intent, full balance, and unmatched timeout are independent. Balance alone has no effect, and
the Boolean success boundary follows membership intent.

**<a id="req-tjoin-2-mfwadg"></a>`REQ-TJOIN-2-MFWADG` — Separated matching and handoff.** Pre-open traffic uses
the domain-separated topic. Match acceptance disarms timeout and cancellation. Successful opening
preserves the opening participant transport; observed opening releases the matched loser and enters the
selected raw topic once.

**<a id="req-tjoin-3-dczks6"></a>`REQ-TJOIN-3-DCZKS6` — Verified synchronization and membership.** Exact-channel
state is validated before observer success or membership. The first connected authenticated participant
starts one initial load with an explicit two-window timeout; first join and top-up preserve the full balance
and use an internal deadline.

**<a id="req-tjoin-4-sdpzjw"></a>`REQ-TJOIN-4-SDPZJW` — Direct response routing.** A request handler sends its
response by authenticated peer address when the inbound transport has one and otherwise uses the inbound
transport. It keeps no profile-based route registry or response-rebinding state. A foreign peer cannot
settle a pending request.

**<a id="req-tjoin-5-q795m7"></a>`REQ-TJOIN-5-Q795M7` — Phase-specific failure.** Unsigned targeted failure
retains the live target for an explicit retry. Fatal uncommitted sync or join failure disposes with no
same-runtime retry. Accepted pending or participating state survives later operational failure.

**<a id="req-tjoin-6-0hevyh"></a>`REQ-TJOIN-6-0HEVYH` — Single-channel runtime ownership.** Once a runtime
selects a nonzero channel ID, it rejects a different target before mutation. Only `connectToChannel` selects a
public target; callers cannot clear or replace the ID through another public signer route.

**<a id="req-tjoin-7-nngtay"></a>`REQ-TJOIN-7-NNGTAY` — Terminal channel leave.** A leave from a committed
participant sets self-removal, captures `N`, substitutes one eligible `onLeaveTurn`, and falls back to the
normal self-removal dispute at the first `N + 1`-block or configured watchdog bound. Completion requires
settled observed removal before terminal disposal. A non-committed runtime disposes immediately, concurrent
channel work is rejected, and repeated leave calls share one operation.

## Assumptions

- Knowledge of the 256-bit target is a practical topic-secrecy boundary, not authorization.
- Default matching permits every authenticated eligible peer. A host-loaded custom RPC module may install
  a local `shouldMatchPeer` function; no policy function or generic allow/deny field crosses the runtime port.
- Production Hyperswarm is assumed to keep one live connection per unique peer during derived-to-raw topic
  handoff. Automated tests use `DEBUG_LOCAL_TRANSPORT`, so normal-transport deduplication remains an explicit
  evidence gap. Local tests cover transient duplicates and eventual retirement.
- Genesis state is applied before test and application setup dispatches existing-channel connection work;
  the sync service itself does not own a responder-readiness queue.

## Security

Remote opening and join balances are accepted only after canonical decoding, obtaining the state machine's
neutral zero balance, and proving `isBalanceLesserThan(zero, received)`. Invalid, zero, negative, malformed,
or conflicting terms are rejected and the authenticated sender is punished. Fixed-target negotiation never
adopts a channel ID from a peer message. Provider-backed chain state is authoritative for opening races.
The requester supplies its local sync timeout; no timing metadata crosses the wire.

## Verification

| Plan item                                                 | Requirements / invariants                                           | Setup and stimulus                                                                                                                                                                                       | Expected result                                                                                                                                                                                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-tjoin-1-r3k75d.t1"></a>`INV-TJOIN-1-R3K75D.T1` | [`INV-TJOIN-1-R3K75D`](targeted-channel-join.md#inv-tjoin-1-r3k75d) | Exercise unopened, matched-open, and observed-open paths.                                                                                                                                                | Each sequential route uses only the requested target.                                                                                                                                                                                                    | <a id="inv-tjoin-1-r3k75d.t1.p1"></a>`INV-TJOIN-1-R3K75D.T1.P1` — unopened no-op; <a id="inv-tjoin-1-r3k75d.t1.p2"></a>`INV-TJOIN-1-R3K75D.T1.P2` — matched opening; <a id="inv-tjoin-1-r3k75d.t1.p3"></a>`INV-TJOIN-1-R3K75D.T1.P3` — observed-open bounded re-entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| <a id="inv-tjoin-2-h7jsqm.t1"></a>`INV-TJOIN-2-H7JSQM.T1` | [`INV-TJOIN-2-H7JSQM`](targeted-channel-join.md#inv-tjoin-2-h7jsqm) | Hold a first join before contract invocation and at receipt; deliver a fault while pending; produce proven and uncertain failures; exercise force-join eligibility before and after on-chain membership. | Pending protection starts before invocation and survives the fault. Proven failure restores `SYNCED`; success produces on-chain pending membership and its inbound message; uncertainty remains pending; force join waits for authoritative eligibility. | <a id="inv-tjoin-2-h7jsqm.t1.p1"></a>`INV-TJOIN-2-H7JSQM.T1.P1` — pending local join observes a fault, survives without abort, then a failed transaction restores `SYNCED`; <a id="inv-tjoin-2-h7jsqm.t1.p2"></a>`INV-TJOIN-2-H7JSQM.T1.P2` — pending local join observes a fault, survives without abort, then a successful transaction produces on-chain pending membership and an inbound join message; <a id="inv-tjoin-2-h7jsqm.t1.p3"></a>`INV-TJOIN-2-H7JSQM.T1.P3` — local pending starts before transaction invocation; <a id="inv-tjoin-2-h7jsqm.t1.p4"></a>`INV-TJOIN-2-H7JSQM.T1.P4` — uncertain submission remains pending; <a id="inv-tjoin-2-h7jsqm.t1.p5"></a>`INV-TJOIN-2-H7JSQM.T1.P5` — force join defers until authoritative membership and a usable window, then submits once. |
| <a id="req-tjoin-1-5vgr1f.t1"></a>`REQ-TJOIN-1-5VGR1F.T1` | [`REQ-TJOIN-1-5VGR1F`](targeted-channel-join.md#req-tjoin-1-5vgr1f) | Call local and worker APIs with every independent option.                                                                                                                                                | Public and worker paths preserve every option and Boolean.                                                                                                                                                                                               | <a id="req-tjoin-1-5vgr1f.t1.p1"></a>`REQ-TJOIN-1-5VGR1F.T1.P1` — observer; <a id="req-tjoin-1-5vgr1f.t1.p2"></a>`REQ-TJOIN-1-5VGR1F.T1.P2` — open without join; <a id="req-tjoin-1-5vgr1f.t1.p3"></a>`REQ-TJOIN-1-5VGR1F.T1.P3` — default join; <a id="req-tjoin-1-5vgr1f.t1.p4"></a>`REQ-TJOIN-1-5VGR1F.T1.P4` — supplied full balance; <a id="req-tjoin-1-5vgr1f.t1.p5"></a>`REQ-TJOIN-1-5VGR1F.T1.P5` — dormant balance; <a id="req-tjoin-1-5vgr1f.t1.p6"></a>`REQ-TJOIN-1-5VGR1F.T1.P6` — dedicated cancellation.                                                                                                                                                                                                                                                                              |
| <a id="req-tjoin-2-mfwadg.t1"></a>`REQ-TJOIN-2-MFWADG.T1` | [`REQ-TJOIN-2-MFWADG`](targeted-channel-join.md#req-tjoin-2-mfwadg) | Exercise topic, timeout, race, handoff, and policy boundaries.                                                                                                                                           | Matching and every later owner remain separate.                                                                                                                                                                                                          | <a id="req-tjoin-2-mfwadg.t1.p1"></a>`REQ-TJOIN-2-MFWADG.T1.P1` — topic separation; <a id="req-tjoin-2-mfwadg.t1.p2"></a>`REQ-TJOIN-2-MFWADG.T1.P2` — unmatched expiry; <a id="req-tjoin-2-mfwadg.t1.p3"></a>`REQ-TJOIN-2-MFWADG.T1.P3` — accepted timer removal; <a id="req-tjoin-2-mfwadg.t1.p4"></a>`REQ-TJOIN-2-MFWADG.T1.P4` — signature race; <a id="req-tjoin-2-mfwadg.t1.p5"></a>`REQ-TJOIN-2-MFWADG.T1.P5` — receipt race; <a id="req-tjoin-2-mfwadg.t1.p6"></a>`REQ-TJOIN-2-MFWADG.T1.P6` — matched transport preservation; <a id="req-tjoin-2-mfwadg.t1.p7"></a>`REQ-TJOIN-2-MFWADG.T1.P7` — default allow-all and host-local manifest policy.                                                                                                                                           |
| <a id="req-tjoin-3-dczks6.t1"></a>`REQ-TJOIN-3-DCZKS6.T1` | [`REQ-TJOIN-3-DCZKS6`](targeted-channel-join.md#req-tjoin-3-dczks6) | Drive sync, first join, reuse, and top-up boundaries.                                                                                                                                                    | State and membership reach only the selected threshold.                                                                                                                                                                                                  | <a id="req-tjoin-3-dczks6.t1.p1"></a>`REQ-TJOIN-3-DCZKS6.T1.P1` — one-peer valid sync; <a id="req-tjoin-3-dczks6.t1.p2"></a>`REQ-TJOIN-3-DCZKS6.T1.P2` — no fallback after selected-peer failure; <a id="req-tjoin-3-dczks6.t1.p3"></a>`REQ-TJOIN-3-DCZKS6.T1.P3` — pending receipt success; <a id="req-tjoin-3-dczks6.t1.p4"></a>`REQ-TJOIN-3-DCZKS6.T1.P4` — no-balance reuse; <a id="req-tjoin-3-dczks6.t1.p5"></a>`REQ-TJOIN-3-DCZKS6.T1.P5` — one top-up; <a id="req-tjoin-3-dczks6.t1.p6"></a>`REQ-TJOIN-3-DCZKS6.T1.P6` — no cooperating participant handshake within the initial window settles connect as `false`.                                                                                                                                                                         |
| <a id="req-tjoin-4-sdpzjw.t1"></a>`REQ-TJOIN-4-SDPZJW.T1` | [`REQ-TJOIN-4-SDPZJW`](targeted-channel-join.md#req-tjoin-4-sdpzjw) | Reply on authenticated and addressless inbound transports, then attempt foreign settlement and original-transport retirement.                                                                            | Address routing or direct fallback sends once; foreign settlement fails; retirement rejects the original pending request.                                                                                                                                | <a id="req-tjoin-4-sdpzjw.t1.p1"></a>`REQ-TJOIN-4-SDPZJW.T1.P1` — authenticated address routing; <a id="req-tjoin-4-sdpzjw.t1.p2"></a>`REQ-TJOIN-4-SDPZJW.T1.P2` — addressless transport fallback; <a id="req-tjoin-4-sdpzjw.t1.p3"></a>`REQ-TJOIN-4-SDPZJW.T1.P3` — original retirement rejects; <a id="req-tjoin-4-sdpzjw.t1.p4"></a>`REQ-TJOIN-4-SDPZJW.T1.P4` — foreign response rejection.                                                                                                                                                                                                                                                                                                                                                                                                     |
| <a id="req-tjoin-5-q795m7.t1"></a>`REQ-TJOIN-5-Q795M7.T1` | [`REQ-TJOIN-5-Q795M7`](targeted-channel-join.md#req-tjoin-5-q795m7) | Fail before sync, during re-entry, and after commitment.                                                                                                                                                 | Cleanup preserves or disposes runtime state by commitment phase.                                                                                                                                                                                         | <a id="req-tjoin-5-q795m7.t1.p1"></a>`REQ-TJOIN-5-Q795M7.T1.P1` — listener retention; <a id="req-tjoin-5-q795m7.t1.p2"></a>`REQ-TJOIN-5-Q795M7.T1.P2` — explicit retry; <a id="req-tjoin-5-q795m7.t1.p3"></a>`REQ-TJOIN-5-Q795M7.T1.P3` — observed-open sync success; <a id="req-tjoin-5-q795m7.t1.p4"></a>`REQ-TJOIN-5-Q795M7.T1.P4` — fatal initial-sync disposal; <a id="req-tjoin-5-q795m7.t1.p5"></a>`REQ-TJOIN-5-Q795M7.T1.P5` — pending preservation; <a id="req-tjoin-5-q795m7.t1.p6"></a>`REQ-TJOIN-5-Q795M7.T1.P6` — participating preservation.                                                                                                                                                                                                                                          |
| <a id="req-tjoin-6-0hevyh.t1"></a>`REQ-TJOIN-6-0HEVYH.T1` | [`REQ-TJOIN-6-0HEVYH`](targeted-channel-join.md#req-tjoin-6-0hevyh) | Select channel A, then request A or B through local and worker facades at each lifecycle state.                                                                                                          | A same-target request keeps its existing behavior. B fails before any A-owned projection or work changes. No public setter bypass exists.                                                                                                                | <a id="req-tjoin-6-0hevyh.t1.p1"></a>`REQ-TJOIN-6-0HEVYH.T1.P1` — same target; <a id="req-tjoin-6-0hevyh.t1.p2"></a>`REQ-TJOIN-6-0HEVYH.T1.P2` — synced observer; <a id="req-tjoin-6-0hevyh.t1.p3"></a>`REQ-TJOIN-6-0HEVYH.T1.P3` — pending participant; <a id="req-tjoin-6-0hevyh.t1.p4"></a>`REQ-TJOIN-6-0HEVYH.T1.P4` — participant; <a id="req-tjoin-6-0hevyh.t1.p5"></a>`REQ-TJOIN-6-0HEVYH.T1.P5` — public setter and worker request absent.                                                                                                                                                                                                                                                                                                                                                  |
| <a id="req-tjoin-7-nngtay.t1"></a>`REQ-TJOIN-7-NNGTAY.T1` | [`REQ-TJOIN-7-NNGTAY`](targeted-channel-join.md#req-tjoin-7-nngtay) | Leave from non-committed, pending, and participating states; author or withhold exit; race calls and bounds.                                                                                             | Non-committed leave disposes immediately. Committed leave substitutes the hook, settles removal by snapshot or dispute, then disposes once.                                                                                                              | <a id="req-tjoin-7-nngtay.t1.p1"></a>`REQ-TJOIN-7-NNGTAY.T1.P1` — observer immediate; <a id="req-tjoin-7-nngtay.t1.p2"></a>`REQ-TJOIN-7-NNGTAY.T1.P2` — NOT_OPENED immediate; <a id="req-tjoin-7-nngtay.t1.p3"></a>`REQ-TJOIN-7-NNGTAY.T1.P3` — participating authored exit; <a id="req-tjoin-7-nngtay.t1.p4"></a>`REQ-TJOIN-7-NNGTAY.T1.P4` — pending promotion; <a id="req-tjoin-7-nngtay.t1.p5"></a>`REQ-TJOIN-7-NNGTAY.T1.P5` — fixed N plus one bound; <a id="req-tjoin-7-nngtay.t1.p6"></a>`REQ-TJOIN-7-NNGTAY.T1.P6` — watchdog with no blocks; <a id="req-tjoin-7-nngtay.t1.p7"></a>`REQ-TJOIN-7-NNGTAY.T1.P7` — concurrent work rejected and repeated leave shared; <a id="req-tjoin-7-nngtay.t1.p8"></a>`REQ-TJOIN-7-NNGTAY.T1.P8` — fresh runtime reaches another channel.               |
