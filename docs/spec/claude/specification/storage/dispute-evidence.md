# Dispute-Evidence Stores

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The modules holding dispute confirmations, fraud proofs, and dispute fraud proofs —
> the node's local evidence set for the disputes system. Shared storage rules:
> [durability.md](./durability.md).

## Contents

- [Purpose and data model](#purpose-and-data-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and data model

Three evidence stores:

- **Dispute store.** Dispute confirmations (a signed dispute plus co-signatures) keyed by the hash
  of the encoded dispute; per-fork flags recording that a fork is disputed and whether this node
  itself disputed it.
- **Fraud-proof store.** Fraud proofs keyed by the hash of the encoded proof, with a secondary index
  from offending participant to their proofs.
- **Dispute-fraud-proof store.** Dispute fraud proofs keyed by the hash of the _disputed_ dispute's
  encoding — at most one retained per dispute.

## Requirements and invariants

<a id="req-dstore-1"></a>
**REQ-DSTORE-1 — Dispute confirmation merge.** Storing a dispute already known merges co-signatures
as a set (monotone, idempotent, order-independent) and never alters the signed dispute itself.
Storing a signed dispute without confirmations creates an entry with an empty co-signature set.

<a id="req-dstore-2"></a>
**REQ-DSTORE-2 — Fork dispute flags.** The disputed flag and the own-dispute flag are per fork,
explicit, and independent of the dispute entries; an unset flag reads as not-disputed rather than
unknown. These flags feed dispute relevance and throttle decisions and MUST reflect exactly what the
producing pipeline recorded.

<a id="req-dstore-3"></a>
**REQ-DSTORE-3 — Content-addressed proofs with stable indexes.** Fraud proofs and dispute fraud
proofs are stored under their defined content hashes; re-storing an existing proof is a no-op
(first write wins), and the participant index always reflects exactly the stored proof set.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                 |
| ----------------------- | ------------------------------------------------------------------------- |
| `REQ-DSTORE-1`          | Signature-set merge for dispute confirmations; signed dispute immutable.  |
| `REQ-DSTORE-2`          | Explicit per-fork disputed and own-dispute flags.                         |
| `REQ-DSTORE-3`          | Content-addressed proofs, first-write-wins, consistent participant index. |

## Assumptions and constraints

- Evidence validity is established by the disputes system; the stores keep evidence available for
  the windows that need it (retention per [durability.md](./durability.md) `REQ-STOR-4` — evidence
  needed to contest an open window is unprunable).
- Loss of stored evidence converts an enforceable claim into an unenforceable one; that consequence,
  not confidentiality, drives the durability requirement.

## Security considerations

The evidence set is what lets the node act as its own (or a delegator's) watchtower. Merge rules
prevent a replayed confirmation from erasing co-signatures; first-write-wins prevents a later,
attacker-supplied variant from displacing stored proof content; explicit flags prevent an absent
record from being read as an affirmative "not disputed" _decision_ — consumers treat it as local
knowledge, not chain truth.

## Verification and test plan

### Requirement test matrix

| Plan item                                     | Requirements / invariants | Setup and stimulus                                                                           | Expected result                                                                       | Required permutations                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-dstore-1-t1"></a>`REQ-DSTORE-1.T1` | `REQ-DSTORE-1`            | Store signed disputes and confirmations with overlapping co-signature sets in varied orders. | Sets merge monotonically; the signed dispute never changes; empty-set creation works. | <a id="req-dstore-1-t1-p1"></a>`REQ-DSTORE-1.T1.P1` — create from signed dispute; <a id="req-dstore-1-t1-p2"></a>`REQ-DSTORE-1.T1.P2` — merge order permutations; <a id="req-dstore-1-t1-p3"></a>`REQ-DSTORE-1.T1.P3` — duplicate confirmation no-op.                                                                                   |
| <a id="req-dstore-2-t1"></a>`REQ-DSTORE-2.T1` | `REQ-DSTORE-2`            | Set and read both flags across forks.                                                        | Flags are per fork and independent; unset reads not-disputed.                         | <a id="req-dstore-2-t1-p1"></a>`REQ-DSTORE-2.T1.P1` — set/read each flag; <a id="req-dstore-2-t1-p2"></a>`REQ-DSTORE-2.T1.P2` — per-fork isolation; <a id="req-dstore-2-t1-p3"></a>`REQ-DSTORE-2.T1.P3` — unset default.                                                                                                                |
| <a id="req-dstore-3-t1"></a>`REQ-DSTORE-3.T1` | `REQ-DSTORE-3`            | Store proofs, re-store variants under the same key, and query the participant index.         | First write wins; index matches stored set exactly; per-dispute proof unique.         | <a id="req-dstore-3-t1-p1"></a>`REQ-DSTORE-3.T1.P1` — store/read by content hash; <a id="req-dstore-3-t1-p2"></a>`REQ-DSTORE-3.T1.P2` — re-store no-op; <a id="req-dstore-3-t1-p3"></a>`REQ-DSTORE-3.T1.P3` — participant index consistency; <a id="req-dstore-3-t1-p4"></a>`REQ-DSTORE-3.T1.P4` — one dispute fraud proof per dispute. |

## Future Work

_Non-normative._ Evidence export/import for delegated watchtowers once that delegation contract is
specified.
