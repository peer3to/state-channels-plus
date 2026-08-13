# Audit Open Questions

> **Status:** Maintained current register.
> **Scope:** Unresolved assessment completeness, residual risk, classification, and readiness requiring engineer decisions.

Every question has one primary layer. Cross-layer effects remain links rather than duplicate entries.
Existing `OQ-*` IDs are preserved; new questions use the layer-scoped namespace documented in governance.

## Index

| ID                                             | Question                                 | Source                 | Affected documents                                                                                                                  | Status |
| ---------------------------------------------- | ---------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`OQ-5-4Q38M5`](open-questions.md#oq-5-4q38m5) | Fraud-proof completeness security review | Specification analysis | [security/open-security-review.md](./security-assessment.md), [protocol/fraud-proofs.md](../specification/disputes/fraud-proofs.md) | Open   |

<a id="oq-5-4q38m5"></a>

## OQ-5-4Q38M5 — Fraud-proof completeness security review

The current fraud-proof list must not be treated as complete. A dedicated security review must ask
which objectively provable violations lack a fraud proof and which attack paths are not prevented,
detected, or recoverable — across block production, signatures/equivocation, virtual voting, state
proofs and milestone hops, membership changes, message streams, snapshot updates, proof
submission, slash-set handling, reduction, timing, data availability, RPC trust, leader election,
and cross-layer interactions. Tracked in detail by
[security/open-security-review.md](./security-assessment.md).
