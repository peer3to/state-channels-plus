# Dispute Acknowledgment Round

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The one-round acknowledgment protocol run when a dispute window opens on a fork, and
> how recorded acknowledgments convert later dead-fork activity into attributable misbehavior.
> Shared communication rules: [rpc.md](./rpc.md). Dispute-window semantics:
> [disputes.md](../disputes/disputes.md).

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

When a dispute is committed on-chain against fork `F`, honest nodes stop treating `F` as live. The
remaining ambiguity is _peer knowledge_: a peer later gossiping a block on `F` might be an honest
straggler that has not observed the dispute — or a Byzantine actor knowingly extending a dead fork.
The acknowledgment round removes that ambiguity per peer: each node asks every connected peer, once
per disputed fork, to acknowledge the objectively verifiable on-chain fact. A recorded acknowledger
that later supplies blocks on `F` has forfeited straggler tolerance; an unrecorded supplier keeps
it.

## Algorithm

1. **Trigger.** On observing the dispute-window event for fork `F`, purge `F`'s queued blocks and —
   when the dispute is _relevant_ (it is the node's current fork, or a final dispute with pending
   local recovery work) — start one acknowledgment round.
2. **One round per fork.** Mark `F` locally so the round runs at most once per fork; peers
   connecting later are covered by their own observation duty, not by repeated rounds.
3. **Ask every connected peer** by request/response, bounded by twice the agreement window: "do you
   acknowledge that (channel, `F`) is disputed?"
4. **Responder.** A duplicate request for a fork already answered to this peer is a protocol
   violation. Otherwise the responder checks its local dispute knowledge, falling back to reading
   the chain; it acknowledges when the dispute exists and records that it acknowledged `F` to this
   peer (its own defense against later false tolerance claims).
5. **Record results.** An acknowledging peer is recorded as knowing `F` is dead. A peer that
   rejects, errors, or stays silent through the window is terminated and excluded — refusing to
   acknowledge a chain-verifiable fact is treated as misbehavior (see
   [Security considerations](#security-considerations) for the safety analysis of that rule).
6. **Consequence wiring.** Block validation consults the record: blocks on `F` from a recorded
   acknowledger are knowing dead-fork extension (attributable misbehavior); from an unrecorded
   peer they keep the honest-straggler outcome (held/dropped without penalty).

## System interactions

| System                                                        | Interaction                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Disputes](../disputes/disputes.md)                           | The window event triggers the round; the successor fork is where execution resumes.                    |
| [Block progression](../block-progression/block-processing.md) | Queue purge on the dead fork; validation consumes the acknowledgment record for consequence selection. |
| [Enforcement](../enforcement/contracts.md)                    | The chain's dispute-window state is the fact being acknowledged; responders may verify against it.     |
| [Storage](../storage/dispute-evidence.md)                     | Disputed-fork flags persist; acknowledgment records key by peer identity.                              |

## Failure outcomes

| Failure                                                  | Outcome                                                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate acknowledgment request (same fork, same peers) | Protocol violation: terminate and exclude the requester.                                                                                           |
| Responder rejects, errors, or times out                  | Terminate and exclude the responder (chain-verifiable-fact rule).                                                                                  |
| Request to a peer that has not yet observed the dispute  | The responder's chain fallback resolves it; a peer whose chain view genuinely lags is exposed to the exclusion rule — see the open decision below. |

## Requirements and invariants

<a id="req-dack-1"></a>
**REQ-DACK-1 — One round per fork per peer pair.** Acknowledgment requests run at most once per
disputed fork toward each peer, and a peer answers each fork at most once; duplicates in either
direction are protocol violations.

<a id="req-dack-2"></a>
**REQ-DACK-2 — Bilateral records.** Both sides record the acknowledgment: the requester records
that the peer knows, the responder records that it acknowledged. Records key by peer identity and
survive transport churn.

<a id="req-dack-3"></a>
**REQ-DACK-3 — Knowledge-gated consequences.** Dead-fork blocks from a recorded acknowledger MUST
lose straggler tolerance and be treated as attributable misbehavior; from an unrecorded peer they
MUST keep the tolerant outcome.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                      |
| ----------------------- | -------------------------------------------------------------- |
| `REQ-DACK-1`            | One round per fork per pair; duplicates are violations.        |
| `REQ-DACK-2`            | Bilateral identity-keyed records surviving transport churn.    |
| `REQ-DACK-3`            | Consequences for dead-fork blocks gated on recorded knowledge. |

## Assumptions and constraints

- The acknowledged fact is chain-verifiable; both sides can check it independently
  ([`REQ-IX-7`](../interactions.md#req-ix-7)).
- The round is relevance-gated to avoid acknowledging forks the node has no stake in tracking.
- Timing bound: two agreement windows per request, tolerating one chain-read round trip on the
  responder.

## Security considerations

The round converts "cannot know who knew" into signed, recorded knowledge — the evidentiary
foundation for punishing dead-fork extension without punishing honest stragglers. The aggressive
rule — silence or refusal is exclusion — assumes every honest connected peer can verify the fact
within the window; a peer with a lagging or failing chain view is excluded despite honesty. That
conflation of unavailability with misbehavior is the same open fault-taxonomy decision as the sync
service's DEF-5 family and needs the same resolution. A malicious requester probing with rounds for
undisputed forks is bounded by the responder's chain fallback (the claim is checkable) and the
duplicate rule.

## Verification and test plan

### Requirement test matrix

| Plan item                                 | Requirements / invariants | Setup and stimulus                                                                                 | Expected result                                                                                        | Required permutations                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="req-dack-1-t1"></a>`REQ-DACK-1.T1` | `REQ-DACK-1`              | Run rounds normally, repeat requests for the same fork, and answer a fork twice.                   | Single round per fork per pair; duplicates in either direction are violations with their consequences. | <a id="req-dack-1-t1-p1"></a>`REQ-DACK-1.T1.P1` — normal round; <a id="req-dack-1-t1-p2"></a>`REQ-DACK-1.T1.P2` — duplicate request violation; <a id="req-dack-1-t1-p3"></a>`REQ-DACK-1.T1.P3` — duplicate answer violation; <a id="req-dack-1-t1-p4"></a>`REQ-DACK-1.T1.P4` — distinct forks are distinct rounds. |
| <a id="req-dack-2-t1"></a>`REQ-DACK-2.T1` | `REQ-DACK-2`              | Complete rounds, then replace transports and reconnect.                                            | Records persist by identity across churn on both sides.                                                | <a id="req-dack-2-t1-p1"></a>`REQ-DACK-2.T1.P1` — bilateral recording; <a id="req-dack-2-t1-p2"></a>`REQ-DACK-2.T1.P2` — record survives transport upgrade; <a id="req-dack-2-t1-p3"></a>`REQ-DACK-2.T1.P3` — record survives reconnect.                                                                           |
| <a id="req-dack-3-t1"></a>`REQ-DACK-3.T1` | `REQ-DACK-3`              | Deliver dead-fork blocks from recorded and unrecorded peers before and after their acknowledgment. | Tolerance before recording; attributable-misbehavior consequences after.                               | <a id="req-dack-3-t1-p1"></a>`REQ-DACK-3.T1.P1` — unrecorded straggler tolerated; <a id="req-dack-3-t1-p2"></a>`REQ-DACK-3.T1.P2` — recorded acknowledger cut; <a id="req-dack-3-t1-p3"></a>`REQ-DACK-3.T1.P3` — block racing the acknowledgment boundary.                                                         |

## Future Work

_Non-normative._ Split honest-unavailable from refusing responders (retry/grace before exclusion —
the DEF-5 fault taxonomy); consider carrying compact dispute references in the request so a lagging
responder can verify without its own chain round trip.
