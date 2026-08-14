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
calldata ([`REQ-IX-7-A004VZ`](../runtime/README.md#req-ix-7-a004vz)), local authoring (which enters at execution —
the author validated by constructing), and proof replay from the dispute and synchronization paths
(sourceless: there is no supplier to penalize).

### Stage 1 — Intake (concurrent, non-state-mutating)

For each arriving confirmation:

1. **Authenticate** with the canonical predicate ([`INV-MIRROR-1-VAF778`](../enforcement/local-mirror.md#inv-mirror-1-vaf778)):
   the encoded block must decode and the author signature must recover to the declared author.
   Failure: peer-supplied → terminate the supplier; observed calldata → an objective fault by the
   poster (the required proof type is an open question).
2. **Deduplicate.** A block already committed locally routes to the merge stage (Stage 2).
3. **Channel gate.** A wrong-channel block is ignored; an attributable sender is penalized.
4. **Dead-fork gate.** A block on a fork with an observed dispute is ignored and that fork's queued
   work purged — dead-fork state is recovered through the dispute path, never gossip. If the node's
   _own_ current fork is disputed, fork recovery is scheduled (bounded: repeated junk must cost
   O(1) chain reads per window).
5. **Queue** the block into the pre-execution layer with copy-scoped source attribution
   ([`REQ-BLOCK-PIPE-5-WJ31RG`](block-processing.md#req-block-pipe-5-wj31rg), [queue store](../storage/queue.md)), and arm the entry's **fixed lifetime**:
   one agreement window from first sight, never extended by duplicates or restores.

### Stage 2 — Merge (stored duplicates and late signatures)

Compute the incoming copy's new signatures (incoming − known); none → duplicate, no effect. Recover
each new signer and require membership in the block's participant union (previous ∪ resulting
participants). Stray signatures penalize exactly the suppliers that carried them (attribution) and
are stripped; valid ones merge monotonically. Threshold coverage fires the finality outcome
([finality.md](../protocol-model/finality.md)); signature growth re-publishes the confirmation
([`REQ-GOSSIP-3-HQZNQX`](../peer-communication/block-gossip.md#req-gossip-3-hqznqx)).

### Stage 3 — Entry-lifetime expiry (the only synchronization probe)

When a queued entry's lifetime ends without execution, decide in order: fork now disputed → drop and
purge; block became committed meanwhile → merge; **known-stale fork** (disputed, or the node holds
its lineage — meaning the node is ahead) → drop silently, because probing would penalize honest
stragglers; **unknown fork** → request verifiable synchronization once from each attributed source
and the author ([synchronization.md](../peer-communication/synchronization.md)) — this is the only
place the pipeline may initiate a sync probe; eligible height → schedule execution; still in the
future → discard (a block that matters is recoverable from chain data; junk must not accumulate).

### Stage 4 — Ordering

Execution is scheduled for the lowest queued height not exceeding the next expected height on the
current fork, one block at a time ([`REQ-BLOCK-PIPE-6-XQ0RTT`](block-processing.md#req-block-pipe-6-xq0rtt)). Competing bodies at one coordinate coexist
in the queue; the first body to pass validation wins locally while the conflict feeds the evidence
rules — equivocation is provable regardless, and finality or dispute resolution selects the
canonical candidate.

### Stage 5 — Serialized validation

Inside the execution boundary, after re-checking the fork is still current (a fork transition may
have won the race; non-replay contexts drop known-stale forks and restore unknown-fork entries for
the Stage-3 probe), the ordered predicate chain runs — each failure routing to the current
context's consequence ([`REQ-BLOCK-PIPE-3-WW2SB7`](block-processing.md#req-block-pipe-3-ww2sb7)):

1. **Correct channel**; 2. **channel open** (genesis applied);
2. **author is a participant** of the pre-state (or of the block's declared resulting snapshot,
   bound to its coordinates), falling back to the on-chain participant union when no local anchor
   exists;
3. **conflict detection** against committed history at the same coordinates: same author, different
   block → **double-sign evidence**; incoming block linked to the committed predecessor → **invalid
   state transition by the author** (extending an agreed history differently); height-zero conflict
   → **wrong genesis**; conflicting but unlinked → unattributable junk;
4. **live-fork gate** and 6. **not-in-the-future gate** (live contexts only — replay audits a fixed
   proof out of live order by design);
5. **linkage**: the block's predecessor hash must equal the committed predecessor (or the fork's
   genesis snapshot at height zero);
6. **author is the scheduled leader**: `getNextToWrite` of the pre-state
   ([`REQ-SM-5-3GS7A7`](../protocol-model/state-machines.md#req-sm-5-3gs7a7)), with the pre-state positioned explicitly in
   replay contexts;
7. **time rules** ([time.md](../protocol-model/time.md)): the objective timestamp predicate is
   evaluated by the canonical enforcement logic over the exact proof structure the chain would
   verify; when it fails against incomplete predecessor timing data, the pipeline first attempts to
   recover the predecessor's on-chain posting timestamp and re-evaluates — an on-chain post can
   retroactively legitimize a timestamp. A block posted on-chain too late is an objective fault; an
   on-time post grants the block its window. The **subjective** agreement-window judgment (live
   context only) parks the block and MUST NOT produce evidence — only canonically checkable
   violations escalate.

### Stage 6 — Execution and commitment

Still serialized; any failure from here restores the pre-transition application state before the
boundary releases ([`INV-BLOCK-PIPE-1-1AB2ME`](block-processing.md#inv-block-pipe-1-1ab2me)):

1. The block's carried inbound message blocks must chain from the pre-state's inbound tip, and each
   must exist locally or on-chain — a fabricated inbound block is dedicated fraud evidence
   ([cross-layer-messages.md](../settlement/cross-layer-messages.md)).
2. Execute the transition through the protocol model ([`REQ-IX-2-2PY2EF`](../interactions.md#req-ix-2-2py2ef));
   a failed transition is an invalid-transition fault by the author.
3. Apply carried inbound messages; advance stream tips and totals.
4. Construct the resulting snapshot per the commitment hierarchy
   ([history-and-commitments.md](../protocol-model/history-and-commitments.md)) and require its
   hash to equal the block's claimed commitment — a mismatch means the author lied about the
   result: invalid-transition evidence.
5. Require every recovered signer (author and confirmations) in the participant union; a stray
   _author_ is junk from a non-member (nobody to slash); stray confirmations penalize their
   suppliers and are stripped.

### Stage 7 — Commit actions

On success, in order: update the node's own membership status (a join that landed promotes the
joiner; an ignored join arms the forced-inclusion trigger after participant-count + 1 further
blocks — [`REQ-IX-3-H8WCVY`](../interactions.md#req-ix-3-h8wcvy)); persist the snapshot and state, then decide
**counter-signing**: sign iff the node participates, is in the block's participant union, does not
have the author excluded, and NOT (the block was posted on-chain AND the node is the next author) —
signing then would forfeit the extra time the post granted ([time.md](../protocol-model/time.md));
persist the block (the commit point — from here the restore is disarmed and post-commit side-effect
failures must not rewind committed state); record a participant-set change point when membership
changed ([participant-changes store](../storage/participant-changes.md)); **publish only after
persisting** so echoed copies merge as duplicates ([`REQ-BLOCK-PIPE-7-FYE9VJ`](block-processing.md#req-block-pipe-7-fye9vj)); run the exit path when the
node itself left the set; the **author** schedules data-availability publication after the
agreement window if the signature set is still incomplete
([data-availability.md](../security/data-availability.md)); and schedule the next author's timeout
check ([dispute-processing.md](../disputes/dispute-processing.md)).

## Validation contexts and consequence classes

Verdicts are shared; consequences depend on the context ([`REQ-BLOCK-PIPE-3-WW2SB7`](block-processing.md#req-block-pipe-3-ww2sb7)):

| Context                    | Active when                            | Consequence profile                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live participant           | Node participates                      | Objective faults → store fraud evidence, then escalate to the dispute pipeline ([`REQ-BLOCK-PIPE-8-N529VH`](block-processing.md#req-block-pipe-8-n529vh)). Unattributable junk → terminate/exclude suppliers. Not-yet-ready (channel not open, future block, possibly-honest supplier on a disputed fork) → restore to the queue. Subjective lateness → park, never evidence. |
| Spectator / pending joiner | Node not (yet) participating           | Same verdicts; a spectator cannot dispute: provable participant fraud → abort and stop following (fail-closed); junk with nobody to slash → drop the sender and keep spectating — junk must never force an abort.                                                                                                                                                             |
| Calldata-committed         | Block entered from an on-chain posting | As live, except authenticity failure is an objective fault by the poster (open question: proof type). The confirmation carries only the author's signature.                                                                                                                                                                                                                   |
| Dispute replay             | Auditing a dispute's proof suffix      | Live-fork and ordering gates off; deviations become dispute fraud proofs that kill the dispute ([dispute-processing.md](../disputes/dispute-processing.md)); a double-sign discovered during replay stores ordinary fraud evidence but does not abort the replay (the dispute may still be honest); observations reflecting only missing local baselines continue as valid.   |

## Requirements and invariants

**<a id="inv-block-pipe-1-1ab2me"></a>`INV-BLOCK-PIPE-1-1AB2ME` — Atomic ordered commit.** A block and all of its signatures, attribution, state,
messages, agreement progress, and events commit together exactly once or not at all.

**<a id="req-block-pipe-1-ss24d1"></a>`REQ-BLOCK-PIPE-1-SS24D1` — Unified work item.** Duplicate confirmations MUST merge signatures and source
attribution before processing; no path may discard attribution or validate a bare block with weaker context.

**<a id="req-block-pipe-2-pcxnt6"></a>`REQ-BLOCK-PIPE-2-PCXNT6` — Complete pre-execution validation.** Authenticity, membership, authorship, linkage,
fork/height, time, message inputs, and state-proof constraints MUST be evaluated against the same pre-state.

**<a id="req-block-pipe-3-ww2sb7"></a>`REQ-BLOCK-PIPE-3-WW2SB7` — Strategy-complete deviations.** Each validation context MUST classify every deviation
and apply only its context-appropriate side effect while preserving the common accept/reject semantics.

**<a id="req-block-pipe-4-cf52j6"></a>`REQ-BLOCK-PIPE-4-CF52J6` — Recovery without bypass.** Missing predecessor/input data MAY trigger bounded sync and
retry, but recovered work MUST re-enter the same validation and commitment pipeline.

**<a id="req-block-pipe-5-wj31rg"></a>`REQ-BLOCK-PIPE-5-WJ31RG` — Pre-execution merge layer.** Intake, deduplication, and signature merging form a
pre-execution layer. Accepting an older, future, duplicate, or not-yet-eligible block, or additional
signatures for any already known block, MUST NOT require the serialization boundary that guards
state-machine execution. The merge MUST be monotone (signature sets only grow), idempotent under duplicate
delivery, independent of arrival order, and MUST retain per-signature source attribution. Pre-execution
retention MUST be bounded per entry so that work which never executes cannot exhaust memory or storage.

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

| Plan item                                                           | Requirements / invariants                                                | Setup and stimulus                                                                              | Expected result                                                                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-block-pipe-1-1ab2me.t1"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1` | [`INV-BLOCK-PIPE-1-1AB2ME`](block-processing.md#inv-block-pipe-1-1ab2me) | Process valid and failing blocks while injecting failures at each commit boundary.              | Every durable/event effect is all-or-nothing and repeated delivery is idempotent.                                                         | <a id="inv-block-pipe-1-1ab2me.t1.p1"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P1` — success; <a id="inv-block-pipe-1-1ab2me.t1.p2"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P2` — validation-stage failure; <a id="inv-block-pipe-1-1ab2me.t1.p3"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P3` — retry after failure; <a id="inv-block-pipe-1-1ab2me.t1.p4"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P4` — concurrent forks; <a id="inv-block-pipe-1-1ab2me.t1.p5"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P5` — execution-stage failure; <a id="inv-block-pipe-1-1ab2me.t1.p6"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P6` — persist/commit failure; <a id="inv-block-pipe-1-1ab2me.t1.p7"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P7` — post-commit side-effect failure; <a id="inv-block-pipe-1-1ab2me.t1.p8"></a>`INV-BLOCK-PIPE-1-1AB2ME.T1.P8` — duplicate delivery idempotent.                                                                                                                         |
| <a id="req-block-pipe-1-ss24d1.t1"></a>`REQ-BLOCK-PIPE-1-SS24D1.T1` | [`REQ-BLOCK-PIPE-1-SS24D1`](block-processing.md#req-block-pipe-1-ss24d1) | Deliver complementary, duplicate, forged, and conflicting confirmations from several sources.   | Merge converges without losing attribution; conflicts remain attributable.                                                                | <a id="req-block-pipe-1-ss24d1.t1.p1"></a>`REQ-BLOCK-PIPE-1-SS24D1.T1.P1` — complementary signatures; <a id="req-block-pipe-1-ss24d1.t1.p2"></a>`REQ-BLOCK-PIPE-1-SS24D1.T1.P2` — duplicate; <a id="req-block-pipe-1-ss24d1.t1.p3"></a>`REQ-BLOCK-PIPE-1-SS24D1.T1.P3` — conflicting confirmation; <a id="req-block-pipe-1-ss24d1.t1.p4"></a>`REQ-BLOCK-PIPE-1-SS24D1.T1.P4` — restore/requeue; <a id="req-block-pipe-1-ss24d1.t1.p5"></a>`REQ-BLOCK-PIPE-1-SS24D1.T1.P5` — forged confirmation.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| <a id="req-block-pipe-2-pcxnt6.t1"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1` | [`REQ-BLOCK-PIPE-2-PCXNT6`](block-processing.md#req-block-pipe-2-pcxnt6) | Violate each validation dimension alone and in representative combinations.                     | Rejection occurs before execution with the correct offender/evidence and no partial effect.                                               | <a id="req-block-pipe-2-pcxnt6.t1.p1"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P1` — identity violation; <a id="req-block-pipe-2-pcxnt6.t1.p2"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P2` — ordering violation; <a id="req-block-pipe-2-pcxnt6.t1.p3"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P3` — time violation; <a id="req-block-pipe-2-pcxnt6.t1.p4"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P4` — combined violations; <a id="req-block-pipe-2-pcxnt6.t1.p5"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P5` — signature violation; <a id="req-block-pipe-2-pcxnt6.t1.p6"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P6` — linkage violation; <a id="req-block-pipe-2-pcxnt6.t1.p7"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P7` — message-input violation; <a id="req-block-pipe-2-pcxnt6.t1.p8"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P8` — state-proof violation; <a id="req-block-pipe-2-pcxnt6.t1.p9"></a>`REQ-BLOCK-PIPE-2-PCXNT6.T1.P9` — check-to-execution race.                                          |
| <a id="req-block-pipe-3-ww2sb7.t1"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1` | [`REQ-BLOCK-PIPE-3-WW2SB7`](block-processing.md#req-block-pipe-3-ww2sb7) | Apply every deviation in live, stored, spectating, and dispute-replay contexts.                 | Classification agrees; context-specific disconnect, evidence, drop, or retry effects are correct.                                         | <a id="req-block-pipe-3-ww2sb7.t1.p1"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P1` — objective-fault deviation; <a id="req-block-pipe-3-ww2sb7.t1.p2"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P2` — live-participant context; <a id="req-block-pipe-3-ww2sb7.t1.p3"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P3` — impossible-context call; <a id="req-block-pipe-3-ww2sb7.t1.p4"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P4` — unattributable junk; <a id="req-block-pipe-3-ww2sb7.t1.p5"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P5` — not-yet-ready deviation; <a id="req-block-pipe-3-ww2sb7.t1.p6"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P6` — subjective lateness; <a id="req-block-pipe-3-ww2sb7.t1.p7"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P7` — spectator/pending-joiner context; <a id="req-block-pipe-3-ww2sb7.t1.p8"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P8` — calldata-committed context; <a id="req-block-pipe-3-ww2sb7.t1.p9"></a>`REQ-BLOCK-PIPE-3-WW2SB7.T1.P9` — dispute-replay context. |
| <a id="req-block-pipe-4-cf52j6.t1"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1` | [`REQ-BLOCK-PIPE-4-CF52J6`](block-processing.md#req-block-pipe-4-cf52j6) | Omit predecessor/input data, then provide valid, invalid, incomplete, or delayed recovery data. | Retry is bounded and uses the full pipeline; invalid recovery never commits.                                                              | <a id="req-block-pipe-4-cf52j6.t1.p1"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1.P1` — valid recovery; <a id="req-block-pipe-4-cf52j6.t1.p2"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1.P2` — invalid recovery data; <a id="req-block-pipe-4-cf52j6.t1.p3"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1.P3` — timeout/disconnect; <a id="req-block-pipe-4-cf52j6.t1.p4"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1.P4` — repeated probe; <a id="req-block-pipe-4-cf52j6.t1.p5"></a>`REQ-BLOCK-PIPE-4-CF52J6.T1.P5` — incomplete recovery data.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| <a id="req-block-pipe-5-wj31rg.t1"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1` | [`REQ-BLOCK-PIPE-5-WJ31RG`](block-processing.md#req-block-pipe-5-wj31rg) | Deliver ineligible blocks and late signatures while a transition holds the execution boundary.  | Intake and merge settle without waiting for execution; the merged set is identical for every delivery order and keeps attribution.        | <a id="req-block-pipe-5-wj31rg.t1.p1"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P1` — older block; <a id="req-block-pipe-5-wj31rg.t1.p2"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P2` — late signatures for a queued block; <a id="req-block-pipe-5-wj31rg.t1.p3"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P3` — delivery-order permutations converge; <a id="req-block-pipe-5-wj31rg.t1.p4"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P4` — per-entry bound reached; <a id="req-block-pipe-5-wj31rg.t1.p5"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P5` — future block; <a id="req-block-pipe-5-wj31rg.t1.p6"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P6` — duplicate block; <a id="req-block-pipe-5-wj31rg.t1.p7"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P7` — late signatures for an already stored block; <a id="req-block-pipe-5-wj31rg.t1.p8"></a>`REQ-BLOCK-PIPE-5-WJ31RG.T1.P8` — never-eligible entry ages out.                                                                                         |
| <a id="req-block-pipe-6-xq0rtt.t1"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1` | [`REQ-BLOCK-PIPE-6-XQ0RTT`](block-processing.md#req-block-pipe-6-xq0rtt) | Make several blocks eligible at once, including two distinct blocks at one fork and height.     | Application is totally ordered by fork and height, one at a time; same-coordinate conflict resolves by evidence rules, not arrival order. | <a id="req-block-pipe-6-xq0rtt.t1.p1"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P1` — in-order eligibility; <a id="req-block-pipe-6-xq0rtt.t1.p2"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P2` — concurrent submission of the next block; <a id="req-block-pipe-6-xq0rtt.t1.p3"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P3` — same fork/height conflict, first arrival order; <a id="req-block-pipe-6-xq0rtt.t1.p4"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P4` — fork transition with a non-empty pre-execution layer; <a id="req-block-pipe-6-xq0rtt.t1.p5"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P5` — out-of-order eligibility; <a id="req-block-pipe-6-xq0rtt.t1.p6"></a>`REQ-BLOCK-PIPE-6-XQ0RTT.T1.P6` — same fork/height conflict, reversed arrival order.                                                                                                                                                                                                                          |
| <a id="req-block-pipe-7-fye9vj.t1"></a>`REQ-BLOCK-PIPE-7-FYE9VJ.T1` | [`REQ-BLOCK-PIPE-7-FYE9VJ`](block-processing.md#req-block-pipe-7-fye9vj) | Commit blocks while observing publication order; echo published confirmations back to the node. | Persistence strictly precedes publication; echoes merge as duplicates without re-validation.                                              | <a id="req-block-pipe-7-fye9vj.t1.p1"></a>`REQ-BLOCK-PIPE-7-FYE9VJ.T1.P1` — persist-then-publish order; <a id="req-block-pipe-7-fye9vj.t1.p2"></a>`REQ-BLOCK-PIPE-7-FYE9VJ.T1.P2` — echoed copy is a duplicate merge; <a id="req-block-pipe-7-fye9vj.t1.p3"></a>`REQ-BLOCK-PIPE-7-FYE9VJ.T1.P3` — publication failure leaves committed state intact.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| <a id="req-block-pipe-8-n529vh.t1"></a>`REQ-BLOCK-PIPE-8-N529VH.T1` | [`REQ-BLOCK-PIPE-8-N529VH`](block-processing.md#req-block-pipe-8-n529vh) | Drive each objective-fault class and each subjective judgment through the live context.         | Every escalation carries pre-stored evidence for the offender; subjective lateness parks with no evidence, penalty, or escalation.        | <a id="req-block-pipe-8-n529vh.t1.p1"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P1` — double-sign stores evidence before disputing; <a id="req-block-pipe-8-n529vh.t1.p2"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P2` — subjective lateness never escalates; <a id="req-block-pipe-8-n529vh.t1.p3"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P3` — escalation with missing evidence is an internal error, not a silent dispute; <a id="req-block-pipe-8-n529vh.t1.p4"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P4` — invalid transition stores evidence before disputing; <a id="req-block-pipe-8-n529vh.t1.p5"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P5` — wrong genesis stores evidence before disputing; <a id="req-block-pipe-8-n529vh.t1.p6"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P6` — objective timestamp fault stores evidence before disputing; <a id="req-block-pipe-8-n529vh.t1.p7"></a>`REQ-BLOCK-PIPE-8-N529VH.T1.P7` — fabricated inbound block stores evidence before disputing.    |

## Future Work

_Non-normative._ Define interoperable queue-pressure and recovery-budget recommendations, including a
portable eligibility/eviction policy for the pre-execution layer.
