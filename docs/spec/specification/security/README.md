# System 8 — Security, Limits, and Verification

> **Agent status:** Maintained system contract (non-normative navigation; normative authority lives in
> the owned documents below).
> **Engineer verification:** Pending.

This system owns the threat model, trust assumptions, adversary actions, resource limits, accepted
version-one limitations, the fraud-proof-completeness review obligation, and the system-wide
verification strategy. It points back to the owning system for every mechanism; it never duplicates
algorithms.

## System contract

- **Owned state.** None — this system owns claims about the others: which assets are protected, under
  which assumptions, against which adversaries, with which residual exposure.
- **Public inputs.** Every other system's stated assumptions, security considerations, and
  verification plans.
- **Public outputs.** The authoritative trust model (`REQ-TRUST-*`), the data-availability cost and
  griefing model (`REQ-DA-*`, `INV-DA-*`), topology and channel-size limits, watchtower
  requirements, and the accepted-limitation register that downstream audit evaluates.
- **Calls / called by.** Cross-references only. Mechanism documents refine these constraints without
  weakening them ([../README.md](../README.md), system assumptions).
- **Trust and availability assumptions.** These documents *define* them: live final chain, at least
  one threshold-required peer per channel whose full chosen authority path is honest, honest RPC
  observation, unforgeable signatures, deterministic replay, chain-backed data availability.
- **Ordering and concurrency.** Not applicable; timing-window adequacy is constrained here and
  computed in [../protocol-model/time.md](../protocol-model/time.md).
- **Invariants (owned).** `REQ-TRUST-*` ([trust-model.md](./trust-model.md)); `REQ-DA-*`, `INV-DA-*`
  ([data-availability.md](./data-availability.md)).
- **Failure and recovery outcomes.** Outside the stated assumptions the protocol promises safety
  degradation paths, not liveness; each accepted limitation states what is *not* promised (all-Byzantine
  channels, all-dishonest RPC, calldata griefing cost).
- **Resource bounds.** Channel size (full mesh, ≤ ~10 participants), calldata cost, and the
  griefing exposure quantified in [data-availability.md](./data-availability.md).
- **Verification evidence.** The completeness review is a standing obligation tracked by the audit
  layer ([`REQ-SEC-1-SNS1GA`](../../audit/security-assessment.md#req-sec-1-sns1ga)); adversarial families in every owned matrix; system-level strategy in
  [../README.md](../README.md).

## Owned documents

| Document | Defines |
| --- | --- |
| [trust-model.md](./trust-model.md) | System-wide trust assumptions, honest-peer and watchtower requirements, RPC observation, topology limits, reputation non-goals. |
| [data-availability.md](./data-availability.md) | Chain-backed data availability, calldata publication costs, and the version-one griefing exposure. |

## Interaction contracts

This system constrains every edge in [../interactions.md](../interactions.md) rather than owning one:
each interaction contract names its trust boundary against the model defined here.
