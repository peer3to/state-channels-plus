# Block Intake, Validation, and Commitment Pipeline

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
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

## Requirements and invariants

<a id="inv-block-pipe-1"></a>
**INV-BLOCK-PIPE-1 — Atomic ordered commit.** A block and all of its signatures, attribution, state,
messages, agreement progress, and events commit together exactly once or not at all.

<a id="req-block-pipe-1"></a>
**REQ-BLOCK-PIPE-1 — Unified work item.** Duplicate confirmations MUST merge signatures and source
attribution before processing; no path may discard attribution or validate a bare block with weaker context.

<a id="req-block-pipe-2"></a>
**REQ-BLOCK-PIPE-2 — Complete pre-execution validation.** Authenticity, membership, authorship, linkage,
fork/height, time, message inputs, and state-proof constraints MUST be evaluated against the same pre-state.

<a id="req-block-pipe-3"></a>
**REQ-BLOCK-PIPE-3 — Strategy-complete deviations.** Each validation context MUST classify every deviation
and apply only its context-appropriate side effect while preserving the common accept/reject semantics.

<a id="req-block-pipe-4"></a>
**REQ-BLOCK-PIPE-4 — Recovery without bypass.** Missing predecessor/input data MAY trigger bounded sync and
retry, but recovered work MUST re-enter the same validation and commitment pipeline.

<a id="req-block-pipe-5"></a>
**REQ-BLOCK-PIPE-5 — Pre-execution merge layer.** Intake, deduplication, and signature merging form a
pre-execution layer. Accepting an older, future, duplicate, or not-yet-eligible block, or additional
signatures for any already known block, MUST NOT require the serialization boundary that guards
state-machine execution. The merge MUST be monotone (signature sets only grow), idempotent under duplicate
delivery, independent of arrival order, and MUST retain per-signature source attribution. Pre-execution
retention MUST be bounded per entry so that work which never executes cannot exhaust memory or storage.

<a id="req-block-pipe-6"></a>
**REQ-BLOCK-PIPE-6 — Total-order application.** Blocks leave the pre-execution layer in total order by fork
identity and block height, and at most one block per channel MAY be in state-machine execution at a time.
Two blocks claiming the same fork and height MUST be resolved by the specified validation, evidence, and
drop rules; arrival or queue order MUST NOT decide which one becomes canonical.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `INV-BLOCK-PIPE-1`      | Atomic ordered commit. A block and all of its signatures, attribution, state,        |
| `REQ-BLOCK-PIPE-1`      | Unified work item. Duplicate confirmations MUST merge signatures and source          |
| `REQ-BLOCK-PIPE-2`      | Complete pre-execution validation. Authenticity, membership, authorship, linkage,    |
| `REQ-BLOCK-PIPE-3`      | Strategy-complete deviations. Each validation context MUST classify every deviation  |
| `REQ-BLOCK-PIPE-4`      | Recovery without bypass. Missing predecessor/input data MAY trigger bounded sync and |
| `REQ-BLOCK-PIPE-5`      | Pre-execution merge layer. Intake, deduplication, and signature merging form a       |
| `REQ-BLOCK-PIPE-6`      | Total-order application. Blocks leave the pre-execution layer in total order by fork |

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

| Plan item                                             | Requirements / invariants | Setup and stimulus                                                                              | Expected result                                                                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-block-pipe-1-t1"></a>`INV-BLOCK-PIPE-1.T1` | `INV-BLOCK-PIPE-1`        | Process valid and failing blocks while injecting failures at each commit boundary.              | Every durable/event effect is all-or-nothing and repeated delivery is idempotent.                                                         | <a id="inv-block-pipe-1-t1-p1"></a>`INV-BLOCK-PIPE-1.T1.P1` — success; <a id="inv-block-pipe-1-t1-p2"></a>`INV-BLOCK-PIPE-1.T1.P2` — each stage failure; <a id="inv-block-pipe-1-t1-p3"></a>`INV-BLOCK-PIPE-1.T1.P3` — retry/duplicate; <a id="inv-block-pipe-1-t1-p4"></a>`INV-BLOCK-PIPE-1.T1.P4` — concurrent forks.                                                                                                                           |
| <a id="req-block-pipe-1-t1"></a>`REQ-BLOCK-PIPE-1.T1` | `REQ-BLOCK-PIPE-1`        | Deliver complementary, duplicate, forged, and conflicting confirmations from several sources.   | Merge converges without losing attribution; conflicts remain attributable.                                                                | <a id="req-block-pipe-1-t1-p1"></a>`REQ-BLOCK-PIPE-1.T1.P1` — complementary signatures; <a id="req-block-pipe-1-t1-p2"></a>`REQ-BLOCK-PIPE-1.T1.P2` — duplicate; <a id="req-block-pipe-1-t1-p3"></a>`REQ-BLOCK-PIPE-1.T1.P3` — conflict/forgery; <a id="req-block-pipe-1-t1-p4"></a>`REQ-BLOCK-PIPE-1.T1.P4` — restore/requeue.                                                                                                                   |
| <a id="req-block-pipe-2-t1"></a>`REQ-BLOCK-PIPE-2.T1` | `REQ-BLOCK-PIPE-2`        | Violate each validation dimension alone and in representative combinations.                     | Rejection occurs before execution with the correct offender/evidence and no partial effect.                                               | <a id="req-block-pipe-2-t1-p1"></a>`REQ-BLOCK-PIPE-2.T1.P1` — identity/signatures; <a id="req-block-pipe-2-t1-p2"></a>`REQ-BLOCK-PIPE-2.T1.P2` — ordering/linkage; <a id="req-block-pipe-2-t1-p3"></a>`REQ-BLOCK-PIPE-2.T1.P3` — time/messages/proof; <a id="req-block-pipe-2-t1-p4"></a>`REQ-BLOCK-PIPE-2.T1.P4` — combined/race.                                                                                                                |
| <a id="req-block-pipe-3-t1"></a>`REQ-BLOCK-PIPE-3.T1` | `REQ-BLOCK-PIPE-3`        | Apply every deviation in live, stored, spectating, and dispute-replay contexts.                 | Classification agrees; context-specific disconnect, evidence, drop, or retry effects are correct.                                         | <a id="req-block-pipe-3-t1-p1"></a>`REQ-BLOCK-PIPE-3.T1.P1` — every deviation; <a id="req-block-pipe-3-t1-p2"></a>`REQ-BLOCK-PIPE-3.T1.P2` — every context; <a id="req-block-pipe-3-t1-p3"></a>`REQ-BLOCK-PIPE-3.T1.P3` — impossible-context call.                                                                                                                                                                                                |
| <a id="req-block-pipe-4-t1"></a>`REQ-BLOCK-PIPE-4.T1` | `REQ-BLOCK-PIPE-4`        | Omit predecessor/input data, then provide valid, invalid, incomplete, or delayed recovery data. | Retry is bounded and uses the full pipeline; invalid recovery never commits.                                                              | <a id="req-block-pipe-4-t1-p1"></a>`REQ-BLOCK-PIPE-4.T1.P1` — valid recovery; <a id="req-block-pipe-4-t1-p2"></a>`REQ-BLOCK-PIPE-4.T1.P2` — invalid/incomplete; <a id="req-block-pipe-4-t1-p3"></a>`REQ-BLOCK-PIPE-4.T1.P3` — timeout/disconnect; <a id="req-block-pipe-4-t1-p4"></a>`REQ-BLOCK-PIPE-4.T1.P4` — repeated probe.                                                                                                                   |
| <a id="req-block-pipe-5-t1"></a>`REQ-BLOCK-PIPE-5.T1` | `REQ-BLOCK-PIPE-5`        | Deliver ineligible blocks and late signatures while a transition holds the execution boundary.  | Intake and merge settle without waiting for execution; the merged set is identical for every delivery order and keeps attribution.        | <a id="req-block-pipe-5-t1-p1"></a>`REQ-BLOCK-PIPE-5.T1.P1` — older/future/duplicate block; <a id="req-block-pipe-5-t1-p2"></a>`REQ-BLOCK-PIPE-5.T1.P2` — late signatures for queued and already stored blocks; <a id="req-block-pipe-5-t1-p3"></a>`REQ-BLOCK-PIPE-5.T1.P3` — delivery-order permutations converge; <a id="req-block-pipe-5-t1-p4"></a>`REQ-BLOCK-PIPE-5.T1.P4` — per-entry bound reached and never-eligible entry.               |
| <a id="req-block-pipe-6-t1"></a>`REQ-BLOCK-PIPE-6.T1` | `REQ-BLOCK-PIPE-6`        | Make several blocks eligible at once, including two distinct blocks at one fork and height.     | Application is totally ordered by fork and height, one at a time; same-coordinate conflict resolves by evidence rules, not arrival order. | <a id="req-block-pipe-6-t1-p1"></a>`REQ-BLOCK-PIPE-6.T1.P1` — in-order and out-of-order eligibility; <a id="req-block-pipe-6-t1-p2"></a>`REQ-BLOCK-PIPE-6.T1.P2` — concurrent submission of the next block; <a id="req-block-pipe-6-t1-p3"></a>`REQ-BLOCK-PIPE-6.T1.P3` — same fork/height conflict with both arrival orders; <a id="req-block-pipe-6-t1-p4"></a>`REQ-BLOCK-PIPE-6.T1.P4` — fork transition with a non-empty pre-execution layer. |

## Future Work

_Non-normative._ Define interoperable queue-pressure and recovery-budget recommendations, including a
portable eligibility/eviction policy for the pre-execution layer.
