# Audit Open Questions

> **Status:** Maintained current register.
> **Scope:** Unresolved assessment completeness, residual risk, classification, and readiness requiring engineer decisions.

Every question has one primary layer. Cross-layer effects remain links rather than duplicate entries.
Existing `OQ-*` IDs are preserved; new questions use the layer-scoped namespace documented in governance.

## Index

| ID                                                                         | Question                                                     | Source                          | Affected documents                                                                                                                  | Status                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| [`OQ-5-4Q38M5`](open-questions.md#oq-5-4q38m5)                             | Fraud-proof completeness security review                     | Specification analysis          | [security/open-security-review.md](./security-assessment.md), [protocol/fraud-proofs.md](../specification/disputes/fraud-proofs.md) | Open                  |
| [`OQ-AUDIT-LOBBY-1-9S3GVD`](open-questions.md#oq-audit-lobby-1-9s3gvd)     | Lobby accepted-lease exclusion versus the no-punishment rule | Gate flake root-cause plan 30   | [security-assessment.md](./security-assessment.md), [lobby-matching.md](../specification/peer-communication/lobby-matching.md)      | Resolved (2026-09-02) |
| [`OQ-AUDIT-RUNTIME-1-HH601X`](open-questions.md#oq-audit-runtime-1-hh601x) | Watchdog threshold under gate load                           | Gate flake root-cause plan 30   | [security-assessment.md](./security-assessment.md), [configuration.md](../implementation/views/operations/configuration.md)         | Open                  |
| [`OQ-AUDIT-DISPUTE-1-ER4Y3D`](open-questions.md#oq-audit-dispute-1-er4y3d) | State contributions without another reason                   | Plan 30 decision 9              | [`REQ-DISPUTE-PIPE-9-TDWQPV`](../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv)                            | Resolved (2026-09-05) |
| [`OQ-AUDIT-DISPUTE-2-TPMNQX`](open-questions.md#oq-audit-dispute-2-tpmnqx) | Recheck a timeout refused for early chain time               | Plan 30 review 8 owner decision | [`REQ-DISPUTE-PIPE-10-BT8YAR`](../specification/disputes/dispute-processing.md#req-dispute-pipe-10-bt8yar)                          | Resolved (2026-09-05) |

<a id="oq-5-4q38m5"></a>

## OQ-5-4Q38M5 — Fraud-proof completeness security review

The current fraud-proof list must not be treated as complete. A dedicated security review must ask
which objectively provable violations lack a fraud proof and which attack paths are not prevented,
detected, or recoverable — across block production, signatures/equivocation, virtual voting, state
proofs and milestone hops, membership changes, message streams, snapshot updates, proof
submission, slash-set handling, reduction, timing, data availability, RPC trust, leader election,
and cross-layer interactions. Tracked in detail by
[security/open-security-review.md](./security-assessment.md).

<a id="oq-audit-lobby-1-9s3gvd"></a>

## OQ-AUDIT-LOBBY-1-9S3GVD — Lobby accepted-lease exclusion versus the no-punishment rule

[`REQ-SEC-3-NPPJN5`](security-assessment.md#req-sec-3-nppjn5) says non-Byzantine failures are never punished.
The lobby handoff bounds both sides with one agreement window, and before this decision the first side to
close a transport cancelled the other side's punishment, so a silent or disconnected counterparty was excluded
only when both bounds fired first. The question was whether a peer that loses its final transport after an
accepted lease may be excluded locally.

**Resolution (owner, 2026-09-02).** Yes. After an accepted lease the loss is an agreement-window liability:
the advertiser excludes at its reservation bound and the selector excludes when its in-flight commitment is
rejected. The exclusion is a local lobby reputation entry, not on-chain punishment, so [`REQ-SEC-3-NPPJN5`](security-assessment.md#req-sec-3-nppjn5) now
states the objective on-chain rule and this local exception separately. Accepted consequence: a partition
during the handoff excludes two honest peers from each other for the blacklist lifetime. The broader
availability and local-fault blacklist finding ([`DEF-5-E8TP9N`](open-findings.md#def-5-e8tp9n),
[`DEF-9-724SXP`](open-findings.md#def-9-724sxp), [`DEF-10-199C7F`](open-findings.md#def-10-199c7f)) stays open
for every other path.

<a id="oq-audit-runtime-1-hh601x"></a>

## OQ-AUDIT-RUNTIME-1-HH601X — Watchdog threshold under gate load

The test configuration keeps a one-second `EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS`. After plan 30
a trip inside a worker is a reported detached error with the runner's one starvation retry, not a
dead peer, so the threshold no longer costs a runtime its EVM state. Whether the farm's
six-tests-per-server load and that threshold are compatible is a separate policy question: 41 of
701 gate runs tripped it, 29 of them in the contract-executor worker. Raising the threshold to pass
is not an option (the threshold is the load bound); the open decision is the farm's load per server
or the classification of trips that recur only under that load.

<a id="oq-audit-dispute-1-er4y3d"></a>

## OQ-AUDIT-DISPUTE-1-ER4Y3D — State contributions without another reason

**Resolution (owner, 2026-09-05).** How can an honest peer contribute newer valid state to an open
window without self-removal or an invented reason? The signed `requireExistingDisputeWindow`
boolean supplies the reason only after admission verifies the existing window. Later kills do not
invalidate that accepted reason. A pre-submission window refusal recovers on-chain slashes through
the existing owner and re-enters normal construction when the observed set changed. This closes
the reason-less contribution path; it does not grant exceptions to any other validity check.
See [`REQ-DISPUTE-PIPE-9-TDWQPV`](../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv).

<a id="oq-audit-dispute-2-tpmnqx"></a>

## OQ-AUDIT-DISPUTE-2-TPMNQX — Recheck a timeout refused for early chain time

**Resolution (owner, 2026-09-05).** A specific early-chain-timestamp refusal re-arms the existing
participant-timeout check after marker rollback and mutex release. The delay uses the contract's
minimum and current timestamps with a one-second floor. Revalidate current evidence and fork relevance;
never blindly resend a signed dispute. An older dispute window remains ineligible and unrelated
errors retain their existing handling. See [`REQ-DISPUTE-PIPE-10-BT8YAR`](../specification/disputes/dispute-processing.md#req-dispute-pipe-10-bt8yar).
