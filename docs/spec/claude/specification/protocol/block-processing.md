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

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `INV-BLOCK-PIPE-1`      | Atomic ordered commit. A block and all of its signatures, attribution, state,        |
| `REQ-BLOCK-PIPE-1`      | Unified work item. Duplicate confirmations MUST merge signatures and source          |
| `REQ-BLOCK-PIPE-2`      | Complete pre-execution validation. Authenticity, membership, authorship, linkage,    |
| `REQ-BLOCK-PIPE-3`      | Strategy-complete deviations. Each validation context MUST classify every deviation  |
| `REQ-BLOCK-PIPE-4`      | Recovery without bypass. Missing predecessor/input data MAY trigger bounded sync and |

## Assumptions and constraints

- Blocks may arrive duplicated, out of order, partially signed, or from multiple sources.
- Validation and execution for one channel/fork require a serialized pre-state boundary.
- Synchronization may supply missing data but cannot establish trust by itself.
- Queue and retry bounds must prevent one fork or peer from starving unrelated work.

## Security considerations

Protected assets are canonical history, signer attribution, application state, and fraud evidence. Threats
include signature laundering during merge, queue poisoning, time-of-check/state races, wrong-author blocks,
invalid execution commitments, recovery bypass, and adversarial resource retention.

## Verification and test plan

### Requirement test matrix

| Plan item                                             | Requirements / invariants | Setup and stimulus                                                                              | Expected result                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-block-pipe-1-t1"></a>`INV-BLOCK-PIPE-1.T1` | `INV-BLOCK-PIPE-1`        | Process valid and failing blocks while injecting failures at each commit boundary.              | Every durable/event effect is all-or-nothing and repeated delivery is idempotent.                 | <a id="inv-block-pipe-1-t1-p1"></a>`INV-BLOCK-PIPE-1.T1.P1` — success; <a id="inv-block-pipe-1-t1-p2"></a>`INV-BLOCK-PIPE-1.T1.P2` — each stage failure; <a id="inv-block-pipe-1-t1-p3"></a>`INV-BLOCK-PIPE-1.T1.P3` — retry/duplicate; <a id="inv-block-pipe-1-t1-p4"></a>`INV-BLOCK-PIPE-1.T1.P4` — concurrent forks.            |
| <a id="req-block-pipe-1-t1"></a>`REQ-BLOCK-PIPE-1.T1` | `REQ-BLOCK-PIPE-1`        | Deliver complementary, duplicate, forged, and conflicting confirmations from several sources.   | Merge converges without losing attribution; conflicts remain attributable.                        | <a id="req-block-pipe-1-t1-p1"></a>`REQ-BLOCK-PIPE-1.T1.P1` — complementary signatures; <a id="req-block-pipe-1-t1-p2"></a>`REQ-BLOCK-PIPE-1.T1.P2` — duplicate; <a id="req-block-pipe-1-t1-p3"></a>`REQ-BLOCK-PIPE-1.T1.P3` — conflict/forgery; <a id="req-block-pipe-1-t1-p4"></a>`REQ-BLOCK-PIPE-1.T1.P4` — restore/requeue.    |
| <a id="req-block-pipe-2-t1"></a>`REQ-BLOCK-PIPE-2.T1` | `REQ-BLOCK-PIPE-2`        | Violate each validation dimension alone and in representative combinations.                     | Rejection occurs before execution with the correct offender/evidence and no partial effect.       | <a id="req-block-pipe-2-t1-p1"></a>`REQ-BLOCK-PIPE-2.T1.P1` — identity/signatures; <a id="req-block-pipe-2-t1-p2"></a>`REQ-BLOCK-PIPE-2.T1.P2` — ordering/linkage; <a id="req-block-pipe-2-t1-p3"></a>`REQ-BLOCK-PIPE-2.T1.P3` — time/messages/proof; <a id="req-block-pipe-2-t1-p4"></a>`REQ-BLOCK-PIPE-2.T1.P4` — combined/race. |
| <a id="req-block-pipe-3-t1"></a>`REQ-BLOCK-PIPE-3.T1` | `REQ-BLOCK-PIPE-3`        | Apply every deviation in live, stored, spectating, and dispute-replay contexts.                 | Classification agrees; context-specific disconnect, evidence, drop, or retry effects are correct. | <a id="req-block-pipe-3-t1-p1"></a>`REQ-BLOCK-PIPE-3.T1.P1` — every deviation; <a id="req-block-pipe-3-t1-p2"></a>`REQ-BLOCK-PIPE-3.T1.P2` — every context; <a id="req-block-pipe-3-t1-p3"></a>`REQ-BLOCK-PIPE-3.T1.P3` — impossible-context call.                                                                                 |
| <a id="req-block-pipe-4-t1"></a>`REQ-BLOCK-PIPE-4.T1` | `REQ-BLOCK-PIPE-4`        | Omit predecessor/input data, then provide valid, invalid, incomplete, or delayed recovery data. | Retry is bounded and uses the full pipeline; invalid recovery never commits.                      | <a id="req-block-pipe-4-t1-p1"></a>`REQ-BLOCK-PIPE-4.T1.P1` — valid recovery; <a id="req-block-pipe-4-t1-p2"></a>`REQ-BLOCK-PIPE-4.T1.P2` — invalid/incomplete; <a id="req-block-pipe-4-t1-p3"></a>`REQ-BLOCK-PIPE-4.T1.P3` — timeout/disconnect; <a id="req-block-pipe-4-t1-p4"></a>`REQ-BLOCK-PIPE-4.T1.P4` — repeated probe.    |

## Future Work

_Non-normative._ Define interoperable queue-pressure and recovery-budget recommendations.
