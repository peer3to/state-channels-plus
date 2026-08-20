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
  of the encoded dispute; a per-fork own-dispute guard recording whether this node itself disputed
  the fork. Whether a fork is disputed at all is chain state and is answered by a chain read
  through the local mirror.
- **Fraud-proof store.** Fraud proofs keyed by the hash of the encoded proof, with a secondary index
  from offending participant to their proofs.
- **Dispute-fraud-proof store.** Dispute fraud proofs keyed by the hash of the _disputed_ dispute's
  encoding — at most one retained per dispute.

## Requirements and invariants

**<a id="req-dstore-1-5aqyjx"></a>`REQ-DSTORE-1-5AQYJX` — Dispute confirmation merge.** Storing a dispute already known merges co-signatures
as a set (monotone, idempotent, order-independent) and never alters the signed dispute itself.
Storing a signed dispute without confirmations creates an entry with an empty co-signature set.

**<a id="req-dstore-2-h1dagx"></a>`REQ-DSTORE-2-H1DAGX` — Own-dispute guard.** The store keeps one per-fork guard: whether this node
itself disputed the fork. It is independent of the dispute entries, and an unset guard reads as
not-disputed rather than unknown. The guard is a submission gate with rollback semantics — set
before the dispute upload is awaited and rolled back on a failed upload so a retry stays possible —
and MUST reflect exactly the pipeline's recorded outcome, including that rollback. Whether a fork
is disputed is not stored here: it is chain state, read through the local mirror on demand, so it
can never go stale.

**<a id="req-dstore-3-znxstm"></a>`REQ-DSTORE-3-ZNXSTM` — Content-addressed proofs with stable indexes.** Fraud proofs and dispute fraud
proofs are stored under their defined content hashes; re-storing an existing proof is a no-op
(first write wins), and the participant index always reflects exactly the stored proof set.

## Assumptions and constraints

- Evidence validity is established by the disputes system; the stores keep evidence available for
  the windows that need it (retention per [durability.md](./durability.md) [`REQ-STOR-4-MF6FT6`](durability.md#req-stor-4-mf6ft6) — evidence
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

| Plan item                                                   | Requirements / invariants                                        | Setup and stimulus                                                                           | Expected result                                                                       | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-dstore-1-5aqyjx.t1"></a>`REQ-DSTORE-1-5AQYJX.T1` | [`REQ-DSTORE-1-5AQYJX`](dispute-evidence.md#req-dstore-1-5aqyjx) | Store signed disputes and confirmations with overlapping co-signature sets in varied orders. | Sets merge monotonically; the signed dispute never changes; empty-set creation works. | <a id="req-dstore-1-5aqyjx.t1.p1"></a>`REQ-DSTORE-1-5AQYJX.T1.P1` — create from signed dispute; <a id="req-dstore-1-5aqyjx.t1.p2"></a>`REQ-DSTORE-1-5AQYJX.T1.P2` — merge order permutations; <a id="req-dstore-1-5aqyjx.t1.p3"></a>`REQ-DSTORE-1-5AQYJX.T1.P3` — duplicate confirmation no-op.                                                                                                                                                                                                                                                                                                                                                     |
| <a id="req-dstore-2-h1dagx.t1"></a>`REQ-DSTORE-2-H1DAGX.T1` | [`REQ-DSTORE-2-H1DAGX`](dispute-evidence.md#req-dstore-2-h1dagx) | Set, roll back, and read the own-dispute guard across forks; query fork-disputed through the mirror read. | The guard is per fork; unset reads not-disputed; rollback re-enables submission; fork-disputed comes from the chain read, never a local flag. | <a id="req-dstore-2-h1dagx.t1.p1"></a>`REQ-DSTORE-2-H1DAGX.T1.P1` — set/read own-dispute guard; <a id="req-dstore-2-h1dagx.t1.p2"></a>`REQ-DSTORE-2-H1DAGX.T1.P2` — per-fork isolation; <a id="req-dstore-2-h1dagx.t1.p3"></a>`REQ-DSTORE-2-H1DAGX.T1.P3` — unset default; <a id="req-dstore-2-h1dagx.t1.p4"></a>`REQ-DSTORE-2-H1DAGX.T1.P4` — rollback after failed upload re-enables submission; <a id="req-dstore-2-h1dagx.t1.p5"></a>`REQ-DSTORE-2-H1DAGX.T1.P5` — fork-disputed answered by the mirror chain read.                                                                                                                                                                                                                                                                               |
| <a id="req-dstore-3-znxstm.t1"></a>`REQ-DSTORE-3-ZNXSTM.T1` | [`REQ-DSTORE-3-ZNXSTM`](dispute-evidence.md#req-dstore-3-znxstm) | Store proofs, re-store variants under the same key, and query the participant index.         | First write wins; index matches stored set exactly; per-dispute proof unique.         | <a id="req-dstore-3-znxstm.t1.p1"></a>`REQ-DSTORE-3-ZNXSTM.T1.P1` — fraud proof store/read by content hash; <a id="req-dstore-3-znxstm.t1.p2"></a>`REQ-DSTORE-3-ZNXSTM.T1.P2` — fraud proof re-store no-op; <a id="req-dstore-3-znxstm.t1.p3"></a>`REQ-DSTORE-3-ZNXSTM.T1.P3` — participant index consistency; <a id="req-dstore-3-znxstm.t1.p4"></a>`REQ-DSTORE-3-ZNXSTM.T1.P4` — one dispute fraud proof per dispute; <a id="req-dstore-3-znxstm.t1.p5"></a>`REQ-DSTORE-3-ZNXSTM.T1.P5` — dispute fraud proof store/read by content hash; <a id="req-dstore-3-znxstm.t1.p6"></a>`REQ-DSTORE-3-ZNXSTM.T1.P6` — dispute fraud proof re-store no-op. |

## Future Work

_Non-normative._ Evidence export/import for delegated watchtowers once that delegation contract is
specified.
