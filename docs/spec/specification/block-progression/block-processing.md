# Block Intake, Validation, and Commitment Pipeline

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Pipeline algorithm](#pipeline-algorithm)
- [Validation contexts and consequence classes](#validation-contexts-and-consequence-classes)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

Every received or locally produced block passes through one ordered pipeline: authenticate and bind its
source, merge duplicate knowledge, order it against committed history, validate every protocol rule against
one pre-state, execute exactly once, compare commitments, then atomically persist and publish effects.

The pipeline has two distinct concurrency regimes. Intake and merge accept unordered, non-state-mutating
knowledge — older, future, duplicate, or not-yet-eligible blocks and late signatures for anything already
known — and may run concurrently. Application of a state transition is serialized and totally ordered. The
boundary between them is normative, not an optimization detail: it is what lets asynchronous signature
collection proceed while a transition executes, without letting arrival order decide canonical history.

## Pipeline algorithm

The stages below are the normative behavior; how an implementation schedules them is its own concern
so long as the ordering, decisions, and actions are preserved. Four input paths converge on one
pipeline: peer gossip ([block-gossip.md](../peer-communication/block-gossip.md)), observed on-chain
calldata ([`REQ-IX-7-A004VZ`](../interactions.md#req-ix-7-a004vz)), local authoring (which enters at execution —
the author validated by constructing), and proof replay from the dispute and synchronization paths
(sourceless: there is no supplier to penalize).

### Stage 1 — Intake (concurrent, non-state-mutating)

For each arriving confirmation:

1. **Authenticate** ([`REQ-BLOCK-PIPE-2-PCXNT6`](block-processing.md#req-block-pipe-2-pcxnt6)) with the canonical predicate ([`INV-MIRROR-1-VAF778`](../enforcement/local-mirror.md#inv-mirror-1-vaf778)):
   the encoded block must decode and the author signature must recover to the declared author.
   Failure ([`REQ-BLOCK-PIPE-3-WW2SB7`](block-processing.md#req-block-pipe-3-ww2sb7)): peer-supplied → terminate the supplier; observed calldata → an objective fault by the
   poster (the required proof type is the open question [`OQ-22-99DDSZ`](../../implementation/open-questions.md#oq-22-99ddsz)).
2. **Deduplicate** ([`REQ-BLOCK-PIPE-1-SS24D1`](block-processing.md#req-block-pipe-1-ss24d1)). A block already committed locally routes to the merge stage (Stage 2).
3. **Channel gate** ([`REQ-BLOCK-PIPE-2-PCXNT6`](block-processing.md#req-block-pipe-2-pcxnt6)). A wrong-channel block is ignored; an attributable sender is penalized.
4. **Dead-fork gate** ([`REQ-BLOCK-PIPE-9-QA66GT`](block-processing.md#req-block-pipe-9-qa66gt)). A block on a fork with an observed dispute is ignored and that fork's queued
   work purged — dead-fork state is recovered through the dispute path, never gossip. If the node's
   _own_ current fork is disputed, fork recovery is scheduled (bounded: repeated junk must cost
   O(1) chain reads per window).
5. **Queue** ([`REQ-BLOCK-PIPE-5-WJ31RG`](block-processing.md#req-block-pipe-5-wj31rg), [queue store](../storage/queue.md)). Queue the block into the
   pre-execution layer with copy-scoped source attribution, and arm the entry's **fixed lifetime**:
   one agreement window from first sight, never extended by duplicates or restores.

### Stage 2 — Merge (stored duplicates and late signatures)

Compute the incoming copy's new signatures (incoming − known); none → duplicate, no effect
([`REQ-BLOCK-PIPE-1-SS24D1`](block-processing.md#req-block-pipe-1-ss24d1)). Recover
each new signer and require membership in the block's participant union (previous ∪ resulting
participants) — or, for a counter-signature, recovery to the frozen selected tower of a union
member ([`REQ-BLOCK-PIPE-11-DCHAJ2`](block-processing.md#req-block-pipe-11-dchaj2)): a valid
selected-tower confirmation is admitted and retained as a distinct persistent artifact, never
stripped or parked, with participant credit derived and deduplicated only at threshold
calculation ([`REQ-WT-4-PNMYMP`](../runtime/watchtowers.md#req-wt-4-pnmymp)). Stray signatures penalize exactly the suppliers that carried them (attribution) and
are stripped; valid ones merge monotonically ([`REQ-BLOCK-PIPE-5-WJ31RG`](block-processing.md#req-block-pipe-5-wj31rg)). Threshold coverage fires the finality outcome
([`REQ-FIN-7-RTZWQZ`](../protocol-model/finality.md#req-fin-7-rtzwqz), [finality.md](../protocol-model/finality.md)); signature growth re-publishes the confirmation
([`REQ-GOSSIP-3-HQZNQX`](../peer-communication/block-gossip.md#req-gossip-3-hqznqx)).

### Stage 3 — Entry-lifetime expiry (the only synchronization probe)

When a queued entry's lifetime ends without execution, decide in order: fork now disputed → drop and
purge ([`REQ-BLOCK-PIPE-9-QA66GT`](block-processing.md#req-block-pipe-9-qa66gt)); block became committed meanwhile → merge ([`REQ-BLOCK-PIPE-1-SS24D1`](block-processing.md#req-block-pipe-1-ss24d1)); **known-stale fork** (disputed, or the node holds
its lineage — meaning the node is ahead) → drop silently ([`REQ-BLOCK-PIPE-9-QA66GT`](block-processing.md#req-block-pipe-9-qa66gt)), because probing would penalize honest
stragglers; **unknown fork** → request verifiable synchronization once from each attributed source
and the author ([`REQ-BLOCK-PIPE-4-CF52J6`](block-processing.md#req-block-pipe-4-cf52j6), [synchronization.md](../peer-communication/synchronization.md)) — this is the only
place the pipeline may initiate a sync probe; eligible height → schedule execution ([`REQ-BLOCK-PIPE-6-XQ0RTT`](block-processing.md#req-block-pipe-6-xq0rtt)); still in the
future → discard ([`REQ-BLOCK-PIPE-5-WJ31RG`](block-processing.md#req-block-pipe-5-wj31rg): a block that matters is recoverable from chain data; junk must not accumulate).

### Stage 4 — Ordering

Execution is scheduled for the lowest queued height not exceeding the next expected height on the
current fork, one block at a time ([`REQ-BLOCK-PIPE-6-XQ0RTT`](block-processing.md#req-block-pipe-6-xq0rtt)). Competing bodies at one coordinate coexist
in the queue; the first body to pass validation wins locally while the conflict feeds **evidence
classification**, not an automatic equivocation verdict: the scheduled participant's normal block
and their frozen tower's valid restricted AFK block from the same slot are two legal coexisting
candidates ([`REQ-WT-3-DT0GDX`](../runtime/watchtowers.md#req-wt-3-dt0gdx)). An uncommitted peer
may accept and sign either valid candidate under the timing rules; a peer already committed to
one history does not apply, sign, or build on the other
([`INV-FIN-2-MK27J6`](../protocol-model/finality.md#inv-fin-2-mk27j6)); a normal-history signer
may submit the valid AFK block as timeout evidence while preserving its normal commitment; and
observing malformed or unproved alternative bytes grants no timeout exemption. A qualifying
explicit same-key signature pair stays provable regardless, and checkpoint-preserving finality,
settlement, or dispute resolution selects the canonical candidate.

### Stage 5 — Serialized validation

Inside the execution boundary, after re-checking the fork is still current ([`REQ-BLOCK-PIPE-6-XQ0RTT`](block-processing.md#req-block-pipe-6-xq0rtt); a fork transition may
have won the race; non-replay contexts drop known-stale forks and restore unknown-fork entries for
the Stage-3 probe), the ordered predicate chain runs ([`REQ-BLOCK-PIPE-2-PCXNT6`](block-processing.md#req-block-pipe-2-pcxnt6)) — each failure routing to the current
context's consequence ([`REQ-BLOCK-PIPE-3-WW2SB7`](block-processing.md#req-block-pipe-3-ww2sb7)):

1. **Correct channel**;
2. **channel open** (genesis applied);
3. **author is authorized**: a participant of the pre-state (or of the block's declared resulting
   snapshot, bound to its coordinates), falling back to the on-chain participant union when no
   local anchor exists — or, for the restricted AFK block only, the frozen selected tower of the
   scheduled participant with the exact canonical removal body and restricted-window timestamp
   ([`REQ-SM-5-3GS7A7`](../protocol-model/state-machines.md#req-sm-5-3gs7a7)); every other
   non-member author is rejected;
4. **conflict detection** against committed history at the same coordinates ([`REQ-BLOCK-PIPE-6-XQ0RTT`](block-processing.md#req-block-pipe-6-xq0rtt) evidence rules): two explicit signatures
   recovering to the same participant key over the two different blocks, in any author or
   confirmation role → **double-sign evidence**; the represented participant's normal block against
   their tower's valid AFK block → a **legal alternative history**, stored as evidence with the
   committed branch preserved, never participant fraud; incoming block linked to the committed
   predecessor → **invalid state transition by the author** (extending an agreed history
   differently); height-zero conflict → **wrong genesis**; conflicting but unlinked →
   unattributable junk;
5. **live-fork gate** and 6. **not-in-the-future gate** (live contexts only — replay audits a fixed
   proof out of live order by design);
6. **linkage**: the block's predecessor hash must equal the committed predecessor (or the fork's
   genesis snapshot at height zero);
7. **author is the scheduled leader**: `getNextToWrite` of the pre-state
   ([`REQ-SM-5-3GS7A7`](../protocol-model/state-machines.md#req-sm-5-3gs7a7)), with the pre-state positioned explicitly in
   replay contexts;
8. **time rules** ([time.md](../protocol-model/time.md)): the objective timestamp predicate is
   evaluated by the canonical enforcement logic over the exact proof structure the chain would
   verify; when it fails against incomplete predecessor timing data, the pipeline first attempts to
   recover the predecessor's on-chain posting timestamp and re-evaluates — an on-chain post can
   retroactively legitimize a timestamp. A block posted on-chain too late is an objective fault; an
   on-time post grants the block its window. The **subjective** agreement-window judgment (live
   context only) parks the block and MUST NOT produce evidence — only canonically checkable
   violations escalate ([`REQ-BLOCK-PIPE-8-N529VH`](block-processing.md#req-block-pipe-8-n529vh)).
   A valid confirmation from the node's own frozen selected tower switches off only this
   arrival-window park for that exact block (the selected-tower exception of
   [time.md §5.1](../protocol-model/time.md#51-subjective-checks-local-gates-never-slashable));
   every other check of this stage still applies.

### Stage 6 — Execution and commitment

Still serialized; any failure from here restores the pre-transition application state before the
boundary releases ([`INV-BLOCK-PIPE-1-1AB2ME`](block-processing.md#inv-block-pipe-1-1ab2me)):

1. The block's carried inbound message blocks must chain from the pre-state's inbound tip
   ([`REQ-BLOCK-PIPE-2-PCXNT6`](block-processing.md#req-block-pipe-2-pcxnt6) message inputs), and each
   must exist locally or on-chain — a fabricated inbound block is dedicated fraud evidence
   ([`REQ-BLOCK-PIPE-8-N529VH`](block-processing.md#req-block-pipe-8-n529vh), [cross-layer-messages.md](../settlement/cross-layer-messages.md)).
2. Execute the transition through the protocol model ([`REQ-IX-2-2PY2EF`](../interactions.md#req-ix-2-2py2ef));
   a failed transition is an invalid-transition fault by the author.
3. Apply carried inbound messages; advance stream tips and totals.
4. Construct the resulting snapshot per the commitment hierarchy
   ([`INV-HIST-1-5N44K9`](../protocol-model/history-and-commitments.md#inv-hist-1-5n44k9), [history-and-commitments.md](../protocol-model/history-and-commitments.md)) and require its
   hash to equal the block's claimed commitment — a mismatch means the author lied about the
   result: invalid-transition evidence.
5. Require every recovered signer (author and confirmations) in the participant union — or the
   valid restricted-AFK tower author, or, for a confirmation, recovery to a union member's frozen
   selected tower ([`REQ-BLOCK-PIPE-11-DCHAJ2`](block-processing.md#req-block-pipe-11-dchaj2));
   any other stray _author_ is junk from a non-member (nobody to slash); stray confirmations
   penalize their suppliers and are stripped, and a malformed AFK block is invalid evidence, never
   proof that the represented participant committed fraud.

### Stage 7 — Commit actions

On success, in order: update the node's own membership status (a join that landed promotes the
joiner; an ignored join arms the forced-inclusion trigger after participant-count + 1 further
blocks — [`REQ-IX-3-H8WCVY`](../interactions.md#req-ix-3-h8wcvy)); persist the snapshot and state, then decide
**counter-signing** ([`REQ-BLOCK-PIPE-10-PHAKE2`](block-processing.md#req-block-pipe-10-phake2)): sign iff the node participates, is in the block's participant union, does not
have the author excluded, and NOT (the block was posted on-chain AND the node is the next author) —
signing then would forfeit the extra time the post granted ([time.md](../protocol-model/time.md)) —
a node whose frozen selected tower validly confirmed the block reaches this decision with its
subjective arrival gate already satisfied and, when the conditions hold, signs: an additive
confirmation, never a prerequisite for the tower credit
([`REQ-WT-4-PNMYMP`](../runtime/watchtowers.md#req-wt-4-pnmymp)) — a tower-credited node follows the three calldata
branches of [`REQ-WT-4-PNMYMP`](../runtime/watchtowers.md#req-wt-4-pnmymp): sign before calldata
under the normal conditions; after calldata the next author emits no redundant signature (the
refusal stands) while a non-next-author adds its additive confirmation;
persist the block (the commit point — from here the restore is disarmed and post-commit side-effect
failures must not rewind committed state); record a participant-set change point when membership
changed ([participant-changes store](../storage/participant-changes.md)); **publish only after
persisting** so echoed copies merge as duplicates ([`REQ-BLOCK-PIPE-7-FYE9VJ`](block-processing.md#req-block-pipe-7-fye9vj)); run the exit path when the
node itself left the set; the **author** schedules data-availability publication after the
agreement window if the signature set is still incomplete
([`REQ-DA-1-NVV85Z`](../security/data-availability.md#req-da-1-nvv85z), [data-availability.md](../security/data-availability.md)); and schedule the next author's timeout
check ([dispute-processing.md](../disputes/dispute-processing.md)). Timeout cancellation after a
normal acknowledgement is **mode-specific**: the named disputer's direct acknowledgement, its
frozen selected tower's availability acknowledgement, or valid descendant-carried availability
evidence cancels the target's pending **ordinary** timeout — finality votes play no part in this
cancellation — while a valid AFK-evidence timeout survives every acknowledgement — a peer that sees both valid competing blocks should submit its latest valid
proved history with the AFK artifact for that slot, even if it acknowledged the target or signed
later normal blocks, and must not wait for an AFK-branch peer to open; evidence submission
neither signs nor adopts the AFK history, existing eligibility, submission limits, and fork
suspension are preserved, and a fully absent tower supplies no artifact and leaves the ordinary
fallback intact ([disputes.md §6.4](../disputes/disputes.md#64-delegated-watchtower-evidence)).

## Validation contexts and consequence classes

Deviation verdicts are shared by every context; only the consequence applied to a verdict depends
on the context ([`REQ-BLOCK-PIPE-3-WW2SB7`](block-processing.md#req-block-pipe-3-ww2sb7)). The deviation classes and per-context algorithms below are
the normative definition of "context-appropriate": a concrete set of context strategies is correct
exactly when it realizes these mappings, and every deviation the pipeline can produce must land in
one of the classes. A deviation that is impossible in a given context MUST surface as an internal
error if it ever occurs there — never be silently accepted or given an ad-hoc consequence.

### Deviation classes

Classification is context-independent; a failure's class is fixed by which fact the failing
predicate establishes, never by who is processing it:

- **Provable participant fault.** A canonically checkable violation pinned to a specific
  participant by that participant's own signature: double-signing (two explicit signatures
  recovering to the same participant key over two different blocks at one fork/height, in any
  author or confirmation role — the represented participant's normal block beside their separately
  keyed tower's valid AFK block carries no such pair and is a legal alternative history, never
  this class); an invalid state transition by the author (failed execution,
  commitment mismatch, extending the committed predecessor differently, or authoring out of turn);
  a wrong genesis, when the node holds the fork's genesis to prove it; a fabricated inbound
  message block; an objective timestamp violation; and — for on-chain postings — an unauthentic
  posted block, a fault of the poster. Evidence against the offender is constructible entirely
  from data the node already holds ([`REQ-BLOCK-PIPE-8-N529VH`](block-processing.md#req-block-pipe-8-n529vh)).
- **Junk.** Invalid data that proves no participant fault: an author outside the participant
  union, a conflicting-but-unlinked block, an unlinked non-first block, undecodable or
  authentication-failing data, a wrong-channel block, or a genesis conflict the node holds no
  genesis to disprove. The only offenders are the suppliers that carried it (transport
  attribution, never a channel signature). Special case: stray non-member signatures on an
  otherwise valid block are junk signatures, not a junk block — they are stripped, exactly their
  suppliers are penalized, and the block continues ([`REQ-BLOCK-PIPE-11-DCHAJ2`](block-processing.md#req-block-pipe-11-dchaj2)).
- **Not-yet-ready.** No misbehavior is demonstrated; the node lacks the context to judge: channel
  not yet open, a block beyond the next expected height, or a disputed fork whose supplier may be
  an honest straggler. The entry is restored to the queue unchanged; its fixed lifetime is not
  extended ([`REQ-BLOCK-PIPE-5-WJ31RG`](block-processing.md#req-block-pipe-5-wj31rg)).
- **No new knowledge.** Duplicates and already-known signatures: no effect; new valid signatures
  merge per Stage 2 ([`REQ-BLOCK-PIPE-1-SS24D1`](block-processing.md#req-block-pipe-1-ss24d1)).
- **Subjective lateness.** The agreement-window judgment. It is observer-relative by definition,
  so in every context it parks the block and MUST NOT produce evidence, penalties, or escalation
  ([`REQ-BLOCK-PIPE-8-N529VH`](block-processing.md#req-block-pipe-8-n529vh)).
- **Legal alternative history.** A valid competing candidate that proves no fault — the
  represented participant's normal block beside their tower's valid restricted AFK block. Every
  context gives it an explicit result: a live peer preserves its signed branch and stores the
  alternative as evidence; a spectator does not treat the lawful split as participant fraud;
  replay can audit either branch against its own proved pre-state; calldata paths validate their
  posted bytes; an invalid restricted author, body, or time is rejected as junk; any explicit
  pair of signatures over the two distinct same-coordinate blocks recovering to the same
  participant key — in any author or confirmation role — is the supported double-sign fault class
  above ([`REQ-FP-2-CH4DA1`](../disputes/fraud-proofs.md#req-fp-2-ch4da1)); only indirect or
  descendant-inferred conflicts without such a qualifying pair are stored as unpaired evidence
  under the open residual [`OQ-49-2Z3FAS`](../open-questions.md#oq-49-2z3fas), with local
  no-switching still required; and a tower contradiction routes to the external bond path,
  keeping offender and effect separate from any participant proof. No penalty follows
  subjective non-receipt alone.

### Context algorithms

**Live participant** — active when the node participates in the channel. All live gates on
(live-fork, not-in-the-future, subjective agreement window). Provable participant fault → store
the fraud evidence for the offender, then escalate to the dispute pipeline
([`REQ-BLOCK-PIPE-8-N529VH`](block-processing.md#req-block-pipe-8-n529vh)); the block is rejected. Junk → reject and terminate/exclude the
suppliers that carried it. Not-yet-ready → restore to the queue. Subjective lateness → park. On
acceptance the node proceeds to the Stage-7 commit actions, including the counter-signing
decision ([`REQ-BLOCK-PIPE-10-PHAKE2`](block-processing.md#req-block-pipe-10-phake2)).

**Spectator / pending joiner** — active when the node does not (yet) participate. Same gates as
live, but a spectator can neither dispute nor counter-sign, so consequences split by who
misbehaved — spectating is the early cooperation check
([cross-layer-messages.md](../settlement/cross-layer-messages.md) §3). Misbehavior attributable
to a participant (any provable participant fault) → abort the spectate and stop following
(fail-closed: the participant set has demonstrated non-cooperation before any funds were
committed, and the prospective joiner goes to interact with someone else). Junk, attributable to
no participant → drop and blacklist the sender, keep spectating — a non-participant must never be
able to force an abort. Not-yet-ready → restore; subjective lateness → park. Note the
classification consequence of the genesis rule above: a genesis conflict the spectator cannot
prove is junk, not participant fault — the sender is dropped and spectating continues.

**Calldata-committed** — active when the block entered from an on-chain posting. As live
participant, with two differences: the confirmation carries only the author's signature, so
signature-merge deviations are impossible in this context (impossible → internal error, per the
rule above); and an authenticity failure of the posted block is an objective fault by the poster
(the required proof type is the open question [`OQ-22-99DDSZ`](../../implementation/open-questions.md#oq-22-99ddsz)).

**Dispute replay** — active while auditing a dispute's proof suffix. Live-fork and ordering gates
off — the proof is a fixed, out-of-live-order sequence on a disputed fork — and the pre-state for
each replayed block is positioned explicitly. Any deviation in the replayed proof → a dispute
fraud proof that defeats the dispute ([dispute-processing.md](../disputes/dispute-processing.md)). Two refinements: a double-sign
discovered during replay stores ordinary fraud evidence against the signer but does not abort the
replay, because the dispute itself may still be honest; and a verdict reflecting only the
auditor's missing local baseline continues as valid. Replay never counter-signs and never
publishes.

## Requirements and invariants

**<a id="inv-block-pipe-1-1ab2me"></a>`INV-BLOCK-PIPE-1-1AB2ME` — Atomic ordered commit.** A block and all of its signatures, attribution, state,
messages, agreement progress, and events commit together exactly once or not at all.
"Exactly once" scopes the block's execution: one pass through the pipeline and one application
to state, committing atomically with whatever signatures and attribution the work item carries at
that moment. It does not freeze the signature set — signatures for the block may keep arriving
afterward and are collected asynchronously, in parallel with other work, merging onto the
already-committed block through the pre-execution merge layer (Stage 2,
[`REQ-BLOCK-PIPE-1-SS24D1`](block-processing.md#req-block-pipe-1-ss24d1), [`REQ-BLOCK-PIPE-5-WJ31RG`](block-processing.md#req-block-pipe-5-wj31rg)) without the block ever
re-executing. When one local writer constructs several submissions for the same fork and height,
exactly one may commit. A later submission that reaches the serialized boundary after that same
writer's block committed at its claimed coordinate is an expected losing race and produces no
second block. A current-height submission by a non-writer remains an out-of-turn violation.

**<a id="req-block-pipe-1-ss24d1"></a>`REQ-BLOCK-PIPE-1-SS24D1` — Unified work item.** Duplicate confirmations MUST merge signatures and source
attribution before processing; no path may discard attribution or validate a bare block with weaker context.

**<a id="req-block-pipe-2-pcxnt6"></a>`REQ-BLOCK-PIPE-2-PCXNT6` — Complete pre-execution validation.** Authenticity, channel binding, membership,
authorship, linkage, fork/height, time, message inputs, and state-proof constraints MUST be evaluated against the same pre-state.
Authorship has exactly two cases: the scheduled participant's ordinary block, or the frozen
selected tower's restricted AFK block with the exact canonical removal body and restricted-window
timestamp ([`REQ-SM-5-3GS7A7`](../protocol-model/state-machines.md#req-sm-5-3gs7a7)); the same
complete predicate applies before execution in live intake, local production, calldata recovery,
dispute replay, synchronization, and on-chain validation, with author authentication kept
distinct from confirmation-credit derivation.

**<a id="req-block-pipe-3-ww2sb7"></a>`REQ-BLOCK-PIPE-3-WW2SB7` — Strategy-complete deviations.** Each validation context MUST classify every deviation
into the deviation classes above and apply exactly its context algorithm's consequence and side
effects while preserving the common accept/reject semantics; a deviation impossible in a context
MUST surface as an internal error rather than be silently accepted.

**<a id="req-block-pipe-4-cf52j6"></a>`REQ-BLOCK-PIPE-4-CF52J6` — Recovery without bypass.** Missing predecessor/input data MAY trigger bounded sync and
retry — a sync probe is initiated only at entry-lifetime expiry, once per attributed source and the
author — but recovered work MUST re-enter the same validation and commitment pipeline.

**<a id="req-block-pipe-5-wj31rg"></a>`REQ-BLOCK-PIPE-5-WJ31RG` — Pre-execution merge layer.** Intake, deduplication, and signature merging form a
pre-execution layer. Accepting an older, future, duplicate, or not-yet-eligible block, or additional
signatures for any already known block, MUST NOT require the serialization boundary that guards
state-machine execution. The merge MUST be monotone (signature sets only grow), idempotent under duplicate
delivery, independent of arrival order, and MUST retain per-signature source attribution. Pre-execution
retention MUST be bounded per entry so that work which never executes cannot exhaust memory or storage;
an entry's lifetime is fixed at first sight and MUST NOT be extended by duplicates or restores.

**<a id="req-block-pipe-6-xq0rtt"></a>`REQ-BLOCK-PIPE-6-XQ0RTT` — Total-order application.** Blocks leave the pre-execution layer in total order by fork
identity and block height, and at most one block per channel MAY be in state-machine execution at a time.
Two blocks claiming the same fork and height MUST be resolved by the specified validation, evidence, and
drop rules; arrival or queue order MUST NOT decide which one becomes canonical.

**<a id="req-block-pipe-7-fye9vj"></a>`REQ-BLOCK-PIPE-7-FYE9VJ` — Commit before publish.** A confirmation is persisted locally before it is
published to peers, so echoed copies merge as duplicates instead of re-entering validation, and a
publication can never advertise state the node has not committed.

**<a id="req-block-pipe-8-n529vh"></a>`REQ-BLOCK-PIPE-8-N529VH` — Evidence precedes escalation.** Every escalation of an objective fault stores
the fraud evidence for the offender before initiating the dispute, so the dispute can carry it; only
canonically checkable violations may escalate, and subjective judgments (agreement-window lateness)
MUST NOT produce evidence, penalties, or escalation.

**<a id="req-block-pipe-9-qa66gt"></a>`REQ-BLOCK-PIPE-9-QA66GT` — Dead-fork containment.** A block on a fork with an observed dispute MUST be
ignored and that fork's queued work purged; dead-fork state is recovered only through the dispute
path, never through gossip or a sync probe. A known-stale fork (disputed, or one whose lineage the
node already holds) is dropped silently — probing it would penalize honest stragglers. When the
node's _own_ current fork is disputed, fork recovery MUST be scheduled and bounded: repeated junk on
a disputed fork costs O(1) chain reads per agreement window.

**<a id="req-block-pipe-10-phake2"></a>`REQ-BLOCK-PIPE-10-PHAKE2` — Counter-signing policy.** After commit, a node signs the block iff it
participates in the channel, is in the block's participant union, and does not have the author
excluded. `For this protocol version:` the node also refuses to sign an on-chain-posted block when it is
itself the next author, preserving the extra time the post granted ([time.md](../protocol-model/time.md));
whether that refusal is intended protocol behavior is an open engineer decision
([`OQ-24-A4XRTB`](../../implementation/open-questions.md#oq-24-a4xrtb)). A node whose frozen
selected tower validly confirmed the block treats its subjective arrival-window gate as satisfied
([time.md §5.1](../protocol-model/time.md#51-subjective-checks-local-gates-never-slashable));
its own direct signature is an additive confirmation, never a prerequisite for the tower credit,
and splits on calldata order ([`REQ-WT-4-PNMYMP`](../runtime/watchtowers.md#req-wt-4-pnmymp)):
before calldata the node signs under the normal conditions above; after calldata a tower-credited
node that is the next author emits no redundant signature — the ordinary next-author refusal
stands, and the accepted tower confirmation has already supplied its credit and forfeited its
extra chain-fallback time — while a tower-credited node that is not the next author adds its
direct confirmation, which does not affect the next author's extra time and helps ordinary
finality by reducing reliance on virtual voting; both artifacts are stored and deduplicate to
one participant availability credit — the node's direct signature is also its finality vote,
which no tower-derived credit supplies for an assigned peer (a recovered signer that is itself a
participant keeps its own vote — central key policy)
([`REQ-FIN-7-RTZWQZ`](../protocol-model/finality.md#req-fin-7-rtzwqz)).

**<a id="req-block-pipe-11-dchaj2"></a>`REQ-BLOCK-PIPE-11-DCHAJ2` — Signature admission by participant union.** Every signature on a
confirmation — the author's or a counter-signature, at intake, merge, or execution — MUST recover to
a member of the block's participant union (previous ∪ resulting participants), to the valid
restricted-AFK tower author for that block, or, for a counter-signature, to the frozen selected
tower of a member of that union. A valid selected-tower confirmation signature is admitted and
retained as a distinct persistent artifact alongside direct participant signatures — never
stripped or parked because the tower is not a participant — and derives an **availability
credit** for every eligible assigned union participant only at credit calculation, where a
participant's direct acknowledgement and its tower's confirmation deduplicate to one availability
credit ([`REQ-WT-4-PNMYMP`](../runtime/watchtowers.md#req-wt-4-pnmymp)). Author authentication
stays distinct from credit derivation: the restricted tower author signature authenticates the
AFK block and may supply only its target's special finality credit
([`REQ-FIN-7-RTZWQZ`](../protocol-model/finality.md#req-fin-7-rtzwqz)); ordinary tower receipts
supply availability only for assigned peers (a recovered signer that is itself a participant
keeps its own vote — overlap rule of the central key policy), and neither a restricted
authorship nor a receipt infers a full threshold or credits another represented peer. Any other non-member signature is stripped without
invalidating the block and penalizes exactly the suppliers that carried it; any other non-member
author makes the block unattributable junk (there is no one to penalize), and a valid restricted
tower author is never classified as a non-participant attack.

## Assumptions and constraints

- Blocks may arrive duplicated, out of order, partially signed, or from multiple sources.
- Validation and execution for one channel/fork require a serialized pre-state boundary.
- Non-state-mutating intake and merge may proceed concurrently with an in-flight transition; only
  application of a transition is serialized, so pre-execution work must not read or mutate live state.
- Synchronization may supply missing data but cannot establish trust by itself.
- Queue and retry bounds must prevent one fork or peer from starving unrelated work.
- Pre-execution retention is finite: an entry that never becomes eligible must age out or cap without
  affecting the outcome of blocks that do execute.

## Security considerations

Protected assets are canonical history, signer attribution, application state, and fraud evidence. Threats
include signature laundering during merge, queue poisoning, time-of-check/state races, wrong-author blocks,
invalid execution commitments, recovery bypass, and adversarial resource retention. A peer that floods
never-eligible blocks or signatures must not delay the serialized execution path or displace the entries
required for canonical progress, and same-coordinate equivocation must be settled by evidence rules rather
than by whichever copy the queue happened to hold first.

## Verification and test plan

### Requirement test matrix

| Plan item                                                             | Requirements / invariants                                                  | Setup and stimulus                                                                                                                                                          | Expected result                                                                                                                                                                                                                                                                                                                                                                                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-block-pipe-1-1ab2me.t1"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1`   | [`INV-BLOCK-PIPE-1-1AB2ME`](block-processing.md#inv-block-pipe-1-1ab2me)   | Process valid and failing blocks while injecting failures and concurrent local submissions at each commit boundary.                                                         | Every durable/event effect is all-or-nothing; repeated delivery is idempotent; concurrent same-writer submissions for one coordinate commit exactly one block.                                                                                                                                                                                                                                      | <a id="inv-block-pipe-1-1ab2me.t1.p1"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P1` — success; <a id="inv-block-pipe-1-1ab2me.t1.p2"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P2` — validation-stage failure; <a id="inv-block-pipe-1-1ab2me.t1.p3"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P3` — retry after failure; <a id="inv-block-pipe-1-1ab2me.t1.p4"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P4` — concurrent forks; <a id="inv-block-pipe-1-1ab2me.t1.p5"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P5` — execution-stage failure; <a id="inv-block-pipe-1-1ab2me.t1.p6"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P6` — persist/commit failure; <a id="inv-block-pipe-1-1ab2me.t1.p7"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P7` — post-commit side-effect failure; <a id="inv-block-pipe-1-1ab2me.t1.p8"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P8` — duplicate delivery idempotent; <a id="inv-block-pipe-1-1ab2me.t1.p9"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P9` — two same-writer submissions constructed for one coordinate commit one block and the loser has no state effect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| <a id="req-block-pipe-1-ss24d1.t1"></a>`REQ-BLOCK-PIPE-1-SS24D1.T1`   | [`REQ-BLOCK-PIPE-1-SS24D1`](block-processing.md#req-block-pipe-1-ss24d1)   | Deliver complementary, duplicate, forged, and conflicting confirmations from several sources.                                                                               | Merge converges without losing attribution; conflicts remain attributable.                                                                                                                                                                                                                                                                                                                          | <a id="req-block-pipe-1-ss24d1.t1.p1"></a>`REQ-BLOCK-PIPE-1-SS24D1.T1.P1` — complementary signatures; <a id="req-block-pipe-1-ss24d1.t1.p2"></a>`REQ-BLOCK-PIPE-1-SS24D1.T1.P2` — duplicate; <a id="req-block-pipe-1-ss24d1.t1.p3"></a>`REQ-BLOCK-PIPE-1-SS24D1.T1.P3` — conflicting confirmation; <a id="req-block-pipe-1-ss24d1.t1.p4"></a>`REQ-BLOCK-PIPE-1-SS24D1.T1.P4` — restore/requeue; <a id="req-block-pipe-1-ss24d1.t1.p5"></a>`REQ-BLOCK-PIPE-1-SS24D1.T1.P5` — forged confirmation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| <a id="req-block-pipe-2-pcxnt6.t1"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1`   | [`REQ-BLOCK-PIPE-2-PCXNT6`](block-processing.md#req-block-pipe-2-pcxnt6)   | Violate each validation dimension alone and in representative combinations.                                                                                                 | Rejection occurs before execution with the correct offender/evidence and no partial effect.                                                                                                                                                                                                                                                                                                         | <a id="req-block-pipe-2-pcxnt6.t1.p1"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P1` — identity violation; <a id="req-block-pipe-2-pcxnt6.t1.p2"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P2` — ordering violation; <a id="req-block-pipe-2-pcxnt6.t1.p3"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P3` — time violation; <a id="req-block-pipe-2-pcxnt6.t1.p4"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P4` — combined violations; <a id="req-block-pipe-2-pcxnt6.t1.p5"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P5` — signature violation; <a id="req-block-pipe-2-pcxnt6.t1.p6"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P6` — linkage violation; <a id="req-block-pipe-2-pcxnt6.t1.p7"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P7` — message-input violation; <a id="req-block-pipe-2-pcxnt6.t1.p8"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P8` — state-proof violation; <a id="req-block-pipe-2-pcxnt6.t1.p9"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P9` — check-to-execution race; <a id="req-block-pipe-2-pcxnt6.t1.p10"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P10` — channel-binding violation.<br><a id="req-block-pipe-2-pcxnt6.t1.p11"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P11` — two-case authorship: the scheduled participant's ordinary block and their frozen tower's exact restricted AFK block both pass; unassigned or foreign towers, wrong targets, targets absent from the artifact pre-state, wrong turns, stale pre-states, arbitrary bodies, forged signers, and future or missing predecessors are each rejected with the same verdict in every context                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| <a id="req-block-pipe-3-ww2sb7.t1"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1`   | [`REQ-BLOCK-PIPE-3-WW2SB7`](block-processing.md#req-block-pipe-3-ww2sb7)   | Apply every deviation in live, stored, spectating, and dispute-replay contexts.                                                                                             | Classification agrees; context-specific disconnect, evidence, drop, or retry effects are correct.                                                                                                                                                                                                                                                                                                   | <a id="req-block-pipe-3-ww2sb7.t1.p1"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P1` — objective-fault deviation; <a id="req-block-pipe-3-ww2sb7.t1.p2"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P2` — live-participant context; <a id="req-block-pipe-3-ww2sb7.t1.p3"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P3` — impossible-context call; <a id="req-block-pipe-3-ww2sb7.t1.p4"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P4` — unattributable junk; <a id="req-block-pipe-3-ww2sb7.t1.p5"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P5` — not-yet-ready deviation; <a id="req-block-pipe-3-ww2sb7.t1.p6"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P6` — subjective lateness; <a id="req-block-pipe-3-ww2sb7.t1.p7"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P7` — spectator/pending-joiner context; <a id="req-block-pipe-3-ww2sb7.t1.p8"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P8` — calldata-committed context; <a id="req-block-pipe-3-ww2sb7.t1.p9"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P9` — dispute-replay context; <a id="req-block-pipe-3-ww2sb7.t1.p10"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P10` — genesis conflict without a local genesis classifies as junk, not participant fault.<br><a id="req-block-pipe-3-ww2sb7.t1.p11"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P11` — legal-alternative class per context: live peers preserve their signed branch and store the alternative, spectators record no participant fraud from the split alone, replay audits either branch, calldata paths validate their posted bytes, an explicit same-key signature pair over the two blocks (any role) yields the supported double-sign verdict, and unpaired indirect conflicts are stored as open-residual evidence without a proof verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| <a id="req-block-pipe-4-cf52j6.t1"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1`   | [`REQ-BLOCK-PIPE-4-CF52J6`](block-processing.md#req-block-pipe-4-cf52j6)   | Omit predecessor/input data, then provide valid, invalid, incomplete, or delayed recovery data.                                                                             | Retry is bounded and uses the full pipeline; invalid recovery never commits.                                                                                                                                                                                                                                                                                                                        | <a id="req-block-pipe-4-cf52j6.t1.p1"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1.P1` — valid recovery; <a id="req-block-pipe-4-cf52j6.t1.p2"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1.P2` — invalid recovery data; <a id="req-block-pipe-4-cf52j6.t1.p3"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1.P3` — timeout/disconnect; <a id="req-block-pipe-4-cf52j6.t1.p4"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1.P4` — repeated probe; <a id="req-block-pipe-4-cf52j6.t1.p5"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1.P5` — incomplete recovery data; <a id="req-block-pipe-4-cf52j6.t1.p6"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1.P6` — no probe outside entry-lifetime expiry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| <a id="req-block-pipe-5-wj31rg.t1"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1`   | [`REQ-BLOCK-PIPE-5-WJ31RG`](block-processing.md#req-block-pipe-5-wj31rg)   | Deliver ineligible blocks and late signatures while a transition holds the execution boundary.                                                                              | Intake and merge settle without waiting for execution; the merged set is identical for every delivery order and keeps attribution.                                                                                                                                                                                                                                                                  | <a id="req-block-pipe-5-wj31rg.t1.p1"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P1` — older block; <a id="req-block-pipe-5-wj31rg.t1.p2"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P2` — late signatures for a queued block; <a id="req-block-pipe-5-wj31rg.t1.p3"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P3` — delivery-order permutations converge; <a id="req-block-pipe-5-wj31rg.t1.p4"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P4` — per-entry bound reached; <a id="req-block-pipe-5-wj31rg.t1.p5"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P5` — future block; <a id="req-block-pipe-5-wj31rg.t1.p6"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P6` — duplicate block; <a id="req-block-pipe-5-wj31rg.t1.p7"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P7` — late signatures for an already stored block; <a id="req-block-pipe-5-wj31rg.t1.p8"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P8` — never-eligible entry ages out; <a id="req-block-pipe-5-wj31rg.t1.p9"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P9` — lifetime not extended by duplicate or restore.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| <a id="req-block-pipe-6-xq0rtt.t1"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1`   | [`REQ-BLOCK-PIPE-6-XQ0RTT`](block-processing.md#req-block-pipe-6-xq0rtt)   | Make several blocks eligible at once, including two distinct blocks at one fork and height.                                                                                 | Application is totally ordered by fork and height, one at a time; same-coordinate conflict resolves by evidence rules, not arrival order.                                                                                                                                                                                                                                                           | <a id="req-block-pipe-6-xq0rtt.t1.p1"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P1` — in-order eligibility; <a id="req-block-pipe-6-xq0rtt.t1.p2"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P2` — concurrent submission of the next block; <a id="req-block-pipe-6-xq0rtt.t1.p3"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P3` — same fork/height conflict, first arrival order; <a id="req-block-pipe-6-xq0rtt.t1.p4"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P4` — fork transition with a non-empty pre-execution layer; <a id="req-block-pipe-6-xq0rtt.t1.p5"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P5` — out-of-order eligibility; <a id="req-block-pipe-6-xq0rtt.t1.p6"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P6` — same fork/height conflict, reversed arrival order.<br><a id="req-block-pipe-6-xq0rtt.t1.p7"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P7` — normal/AFK coexistence: the participant's normal block and their tower's valid AFK block coexist in the queue in both arrival orders and concurrently; an uncommitted peer may accept either, a committed peer keeps its branch, and a normal-history signer submits the AFK artifact as timeout evidence without signing it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| <a id="req-block-pipe-7-fye9vj.t1"></a>`REQ-BLOCK-PIPE-7-FYE9VJ.T1`   | [`REQ-BLOCK-PIPE-7-FYE9VJ`](block-processing.md#req-block-pipe-7-fye9vj)   | Commit blocks while observing publication order; echo published confirmations back to the node.                                                                             | Persistence strictly precedes publication; echoes merge as duplicates without re-validation.                                                                                                                                                                                                                                                                                                        | <a id="req-block-pipe-7-fye9vj.t1.p1"></a>`REQ-BLOCK-PIPE-7-FYE9VJ.T1.P1` — persist-then-publish order; <a id="req-block-pipe-7-fye9vj.t1.p2"></a>`REQ-BLOCK-PIPE-7-FYE9VJ.T1.P2` — echoed copy is a duplicate merge; <a id="req-block-pipe-7-fye9vj.t1.p3"></a>`REQ-BLOCK-PIPE-7-FYE9VJ.T1.P3` — publication failure leaves committed state intact.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| <a id="req-block-pipe-8-n529vh.t1"></a>`REQ-BLOCK-PIPE-8-N529VH.T1`   | [`REQ-BLOCK-PIPE-8-N529VH`](block-processing.md#req-block-pipe-8-n529vh)   | Drive each objective-fault class and each subjective judgment through the live context.                                                                                     | Every escalation carries pre-stored evidence for the offender; subjective lateness parks with no evidence, penalty, or escalation.                                                                                                                                                                                                                                                                  | <a id="req-block-pipe-8-n529vh.t1.p1"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P1` — double-sign stores evidence before disputing; <a id="req-block-pipe-8-n529vh.t1.p2"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P2` — subjective lateness never escalates; <a id="req-block-pipe-8-n529vh.t1.p3"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P3` — escalation with missing evidence is an internal error, not a silent dispute; <a id="req-block-pipe-8-n529vh.t1.p4"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P4` — invalid transition stores evidence before disputing; <a id="req-block-pipe-8-n529vh.t1.p5"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P5` — wrong genesis stores evidence before disputing; <a id="req-block-pipe-8-n529vh.t1.p6"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P6` — objective timestamp fault stores evidence before disputing; <a id="req-block-pipe-8-n529vh.t1.p7"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P7` — fabricated inbound block stores evidence before disputing.; <a id="req-block-pipe-8-n529vh.t1.p8"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P8` — broken inbound linkage stores evidence before disputing; <a id="req-block-pipe-8-n529vh.t1.p9"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P9` — transaction execution failure stores evidence before disputing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| <a id="req-block-pipe-9-qa66gt.t1"></a>`REQ-BLOCK-PIPE-9-QA66GT.T1`   | [`REQ-BLOCK-PIPE-9-QA66GT`](block-processing.md#req-block-pipe-9-qa66gt)   | Queue work across forks, observe a dispute on one fork, then deliver blocks for disputed, known-stale, and unknown forks; dispute the node's own fork and flood junk on it. | Disputed-fork blocks are ignored and their queued work purged; recovery happens only through the dispute path; known-stale forks drop silently without probes; own-fork recovery is scheduled with bounded chain reads.                                                                                                                                                                             | <a id="req-block-pipe-9-qa66gt.t1.p1"></a>`REQ-BLOCK-PIPE-9-QA66GT.T1.P1` — disputed-fork block ignored; <a id="req-block-pipe-9-qa66gt.t1.p2"></a>`REQ-BLOCK-PIPE-9-QA66GT.T1.P2` — queued work purged on dispute observation; <a id="req-block-pipe-9-qa66gt.t1.p3"></a>`REQ-BLOCK-PIPE-9-QA66GT.T1.P3` — no dead-fork recovery via gossip; <a id="req-block-pipe-9-qa66gt.t1.p4"></a>`REQ-BLOCK-PIPE-9-QA66GT.T1.P4` — known-stale fork drops silently, no probe; <a id="req-block-pipe-9-qa66gt.t1.p5"></a>`REQ-BLOCK-PIPE-9-QA66GT.T1.P5` — own-fork dispute schedules recovery; <a id="req-block-pipe-9-qa66gt.t1.p6"></a>`REQ-BLOCK-PIPE-9-QA66GT.T1.P6` — repeated junk costs O(1) chain reads per window.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| <a id="req-block-pipe-10-phake2.t1"></a>`REQ-BLOCK-PIPE-10-PHAKE2.T1` | [`REQ-BLOCK-PIPE-10-PHAKE2`](block-processing.md#req-block-pipe-10-phake2) | Commit blocks under each counter-signing condition, including the posted-on-chain next-author case and the three tower-confirmed calldata branches.                         | The node signs exactly when every condition holds, and each failing condition independently suppresses the signature; a tower-confirmed node signs before calldata under those same conditions, while after calldata a tower-credited next author emits no redundant signature and a tower-credited non-next-author adds its additive confirmation — both artifacts stored, one participant credit. | <a id="req-block-pipe-10-phake2.t1.p1"></a>`REQ-BLOCK-PIPE-10-PHAKE2.T1.P1` — all conditions hold, node signs; <a id="req-block-pipe-10-phake2.t1.p2"></a>`REQ-BLOCK-PIPE-10-PHAKE2.T1.P2` — non-participating node does not sign; <a id="req-block-pipe-10-phake2.t1.p3"></a>`REQ-BLOCK-PIPE-10-PHAKE2.T1.P3` — node outside participant union does not sign; <a id="req-block-pipe-10-phake2.t1.p4"></a>`REQ-BLOCK-PIPE-10-PHAKE2.T1.P4` — excluded author not counter-signed; <a id="req-block-pipe-10-phake2.t1.p5"></a>`REQ-BLOCK-PIPE-10-PHAKE2.T1.P5` — posted on-chain and node is next author (documents the open decision); <a id="req-block-pipe-10-phake2.t1.p6"></a>`REQ-BLOCK-PIPE-10-PHAKE2.T1.P6` — tower confirmation before calldata: the node's frozen selected tower validly confirmed the block, the node's subjective arrival gate is bypassed, and an otherwise eligible node adds its additive ordinary signature; <a id="req-block-pipe-10-phake2.t1.p7"></a>`REQ-BLOCK-PIPE-10-PHAKE2.T1.P7` — tower confirmation accepted after calldata, node not next author: the credit applies with the per-credit forfeiture of the node's extra chain-fallback time, and the credited node adds its direct confirmation — an additive signature that does not affect the next author's extra time, helps ordinary finality by reducing reliance on virtual voting, and is stored beside the tower's signature with both deduplicated to one credit; <a id="req-block-pipe-10-phake2.t1.p8"></a>`REQ-BLOCK-PIPE-10-PHAKE2.T1.P8` — tower confirmation accepted after calldata, credited node is next author: the ordinary refusal stands, the tower credit already supplies the node's availability credit and forfeits its extra time, and the node's direct signature is unnecessary, must not be required, and adds no second threshold credit — the expected result is reduced time and no redundant counter-signature (the ordinary uncredited next-author case stays separately under [`REQ-BLOCK-PIPE-10-PHAKE2.T1.P5`](block-processing.md#req-block-pipe-10-phake2.t1.p5)).                                                                                     |
| <a id="req-block-pipe-11-dchaj2.t1"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1` | [`REQ-BLOCK-PIPE-11-DCHAJ2`](block-processing.md#req-block-pipe-11-dchaj2) | Deliver confirmations carrying member and non-member signatures through the intake, merge, and execution paths.                                                             | Non-member signatures are stripped and penalize exactly their suppliers; the block's validity is unaffected; a non-member author is treated as unattributable junk.                                                                                                                                                                                                                                 | <a id="req-block-pipe-11-dchaj2.t1.p1"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1.P1` — member signatures merge; <a id="req-block-pipe-11-dchaj2.t1.p2"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1.P2` — non-member counter-signature stripped; <a id="req-block-pipe-11-dchaj2.t1.p3"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1.P3` — exactly the stray's suppliers penalized; <a id="req-block-pipe-11-dchaj2.t1.p4"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1.P4` — non-member author is junk; <a id="req-block-pipe-11-dchaj2.t1.p5"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1.P5` — union boundary: signer only in previous set; <a id="req-block-pipe-11-dchaj2.t1.p6"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1.P6` — union boundary: signer only in resulting set; <a id="req-block-pipe-11-dchaj2.t1.p7"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1.P7` — stripped stray leaves the block valid; <a id="req-block-pipe-11-dchaj2.t1.p8"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1.P8` — frozen selected-tower confirmation admitted: retained as a distinct artifact, not stripped, no supplier penalty; <a id="req-block-pipe-11-dchaj2.t1.p9"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1.P9` — direct and tower signatures for the same participant: both stored, deduplicated to one availability credit only at credit calculation; <a id="req-block-pipe-11-dchaj2.t1.p10"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1.P10` — signature from a tower not frozen-selected by any union member: stripped as a stray and its suppliers penalized.<br><a id="req-block-pipe-11-dchaj2.t1.p11"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1.P11` — availability-only credits: with a recovered tower signer that is not itself a channel participant, a shared tower receipt credits Alice, Bob, and Carol's availability with direct-credit dedup while supplying zero finality votes, and all availability credits together may skip calldata with finality still false<br><a id="req-block-pipe-11-dchaj2.t1.p12"></a>`REQ-BLOCK-PIPE-11-DCHAJ2.T1.P12` — restricted tower author admitted: the valid AFK author signature authenticates the block without being classified as a non-participant attack, and a malformed AFK block is invalid evidence, never proof of participant fraud |

## Future Work

_Non-normative._ Define interoperable queue-pressure and recovery-budget recommendations, including a
portable eligibility/eviction policy for the pre-execution layer.
