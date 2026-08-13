# Current Specification Audit

> **Status:** Agent assessment in progress; engineer approval pending.

The audit layer answers whether the neutral specification is complete, this repository conforms to
it, the required unit and system evidence is sufficient, and residual security risk is accepted. It
stores current assessment only; Git and pull requests retain history.

## Three kinds of evidence

1. Generated reports prove structural facts: IDs, mirrors, mappings, links, questions, and stale state.
2. Agents inspect behavior and author the current semantic assessment and findings.
3. Engineers shape and approve protocol meaning, implementation tradeoffs, test oracles, security risk,
   and final readiness.

Generated success is never semantic approval. The current top-level view is
[generated/audit-summary.md](../generated/audit-summary.md).

## Maintained audit views

- [Specification assessment](./specification.md)
- [Implementation assessment](./implementation.md)
- [Verification assessment](./verification.md)
- [Security assessment](./security-assessment.md)
- [Open findings](./open-findings.md)
- [Open audit questions](./open-questions.md)
- [Engineer approvals](./approvals.md)

## Engineer-owned approvals

`approvals.md` is the only approval source. Agents must not edit it and must not invoke the approval
command. An engineer reviews the current node and runs:

```bash
SPEC_APPROVER="Name" node docs/spec/tools/approve.js <ID>
```

The command records the current normalized fingerprint, reviewer, and date. Any semantic dependency,
source, mapped test, or oracle change alters the fingerprint and makes that approval and dependent audit
paths stale. This is a workflow guard, not an authorization boundary: repository write access can still
modify the register, so code review must reject unexplained edits.

Requirement approval and security-risk acceptance are separate actions. Approve the requirement or planned-test ID
for semantic acceptance, and approve `security:<REQ-or-INV-ID>` only after reviewing the current security
assessment and accepting its residual risk. A final path cannot become ready while either fingerprint is
missing or stale.
