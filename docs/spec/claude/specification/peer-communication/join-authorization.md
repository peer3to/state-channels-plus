# Join-Authorization Collection

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The service collecting the unanimous countersignatures a join requires before its
> on-chain submission. Shared communication rules: [rpc.md](./rpc.md). Admission-flow semantics:
> [cross-layer-messages.md](../settlement/cross-layer-messages.md).

## Contents

- [Purpose and observable contract](#purpose-and-observable-contract)
- [Collector algorithm](#collector-algorithm)
- [Responder algorithm](#responder-algorithm)
- [System interactions](#system-interactions)
- [Failure outcomes](#failure-outcomes)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable contract

Admission expands the on-chain participant set and requires unanimous authorization: the joiner
signs the join, and every member of the current threshold set (snapshot participants plus pending
joiners) must countersign before the joiner submits on-chain with its deposit. This service is
exactly the collect-signatures hop: the joiner fans out one request per threshold member and
assembles the confirmation, or the collection fails as a whole. Deciding _whether_ to admit is not
part of this service's current contract — a structurally and contextually valid request is signed —
and the admission-policy filter is an open decision ([OQ-10](../open-questions.md)).

## Collector algorithm

Run by the joiner, locally:

1. **Self-scope.** Collect only for the local identity's own join; collecting for a third party is
   refused.
2. **Pin the chain state.** Read the current on-chain snapshot; record its hash and fork id. The
   collection is valid only against this exact state — the same values enforcement re-checks at
   submission, so a stale collection fails on-chain rather than admitting against a moved state.
3. **Derive the threshold set** from the pinned state: snapshot participants ∪ pending joiners.
4. **Self-sign** the join and produce its canonical encoding — the exact bytes every counterparty
   signs.
5. **Preflight reachability.** Every remote threshold member must be reachable before any request
   is sent; a missing member fails the collection immediately (unanimity cannot be reached).
6. **Bound each request** by the smaller of the agreement window and the time remaining until the
   join's deadline — never wait past the deadline.
7. **Fan out in parallel**; verify every returned signature recovers, over the exact encoded join,
   to the addressed member. Any timeout, error, or wrong-signer response fails the whole
   collection.
8. **Assemble** the confirmation: the signed join plus one verified countersignature per threshold
   member, with the pinned snapshot hash and fork id for submission.

## Responder algorithm

Run by each threshold member on request; the adversarial ingress side:

1. **Authenticated sender required** ([rpc.md](./rpc.md)).
2. **Decode** the signed join through the canonical encoding; decode failure is a request error.
3. **Bind three identities.** The signature over the encoded join must recover to the join's
   declared participant, and that participant must equal the authenticated sender. No relaying or
   collecting on behalf of others.
4. **Context checks.** The join's channel must be this node's channel; the deadline must not have
   passed in protocol time; the current on-chain snapshot's fork and hash must equal the request's
   pinned values — the countersigner authorizes only against the chain state it currently observes.
5. **Authority check.** The local identity must itself be in the current threshold set; a
   non-member has no authority to countersign.
6. **Countersign** the exact encoded join and return the signature. Every validation failure is a
   penalty-free declared error — refusing is a normal outcome, not misbehavior.

## System interactions

| System                                              | Interaction                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [Settlement](../settlement/cross-layer-messages.md) | Owns the admission flow this hop serves: on-chain submission, deposit, inbound inclusion, forced inclusion on stalling.                    |
| [Enforcement](../enforcement/contracts.md)          | Re-verifies unanimity, snapshot/fork pins, and deadline at submission; this service's pins exist to fail early, not to replace that check. |
| [Synchronization](./synchronization.md)             | Spectate-before-join precedes collection so the joiner signs against verified state.                                                       |
| [Protocol model](../protocol-model/data-types.md)   | Canonical join encoding — the byte-exact signing target.                                                                                   |

## Failure outcomes

| Failure                                                                                                       | Outcome                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Collector: unreachable member, timeout, error, wrong-signer response                                          | Whole collection fails (unanimity is all-or-nothing); no penalty assigned by this service. |
| Responder: any validation failure (decode, identity binding, channel, deadline, fork/snapshot pin, authority) | Penalty-free declared request error; session kept.                                         |
| Stale pins at submission                                                                                      | Enforcement rejects; the joiner re-collects against fresh state.                           |

## Requirements and invariants

<a id="inv-joinsig-1"></a>
**INV-JOINSIG-1 — Identity triple-binding.** A countersignature is produced only when the join's
embedded signature, its declared participant, and the authenticated requesting peer all bind to the
same identity.

<a id="req-joinsig-1"></a>
**REQ-JOINSIG-1 — Pinned-state authorization.** Both sides bind the authorization to an exact
on-chain snapshot and fork; a countersigner MUST refuse when its own current view differs from the
pin, and the collection's pins MUST be carried to submission.

<a id="req-joinsig-2"></a>
**REQ-JOINSIG-2 — All-or-nothing unanimity.** The collection succeeds only with a verified
countersignature from every threshold member over the exact encoded join; any member's failure
fails the collection.

<a id="req-joinsig-3"></a>
**REQ-JOINSIG-3 — Refusal is penalty-free.** A responder's validation failure is a declared error
without session or identity consequences; countersigning is voluntary cooperation, not an
obligation whose refusal is slashable.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                     |
| ----------------------- | ------------------------------------------------------------- |
| `INV-JOINSIG-1`         | Signer = declared participant = authenticated sender.         |
| `REQ-JOINSIG-1`         | Authorization pinned to an exact snapshot/fork on both sides. |
| `REQ-JOINSIG-2`         | Unanimous verified countersignatures or the collection fails. |
| `REQ-JOINSIG-3`         | Responder refusal is a penalty-free declared error.           |

## Assumptions and constraints

- Requires authenticated sessions and a current chain view on both sides; a lagging countersigner
  refuses honestly (pin mismatch) rather than authorizing blind.
- Deadline arithmetic uses protocol time ([time.md](../protocol-model/time.md)).
- The service is stateless across calls: every decision derives from the request plus live reads,
  so replay of a still-valid request yields another signature over the same bytes — idempotent by
  content.
- Admission policy (who _should_ be admitted, beyond structural validity) is deliberately outside
  this contract and open ([OQ-10](../open-questions.md)).

## Security considerations

The unanimity rule makes this service safety-relevant: a signature harvested here becomes part of a
membership change. Defenses: triple identity binding stops relayed or third-party collection;
byte-exact signing over the canonical encoding stops substitution between what was validated and
what was signed; state pinning stops authorization against a moved or forked state; threshold
membership stops non-members from manufacturing authority. Residual: unconditional signing of valid
requests means membership control is purely structural until the admission filter is decided
(OQ-10); a malicious joiner can burn responder attention (rate bounds per `REQ-RPC-5`).

## Verification and test plan

### Requirement test matrix

| Plan item                                       | Requirements / invariants | Setup and stimulus                                                                                                                               | Expected result                                                                                                  | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-joinsig-1-t1"></a>`INV-JOINSIG-1.T1` | `INV-JOINSIG-1`           | Request countersignatures with each identity of the triple mismatched, and all matched.                                                          | Only the fully bound request is signed.                                                                          | <a id="inv-joinsig-1-t1-p1"></a>`INV-JOINSIG-1.T1.P1` — bound request signed; <a id="inv-joinsig-1-t1-p2"></a>`INV-JOINSIG-1.T1.P2` — wrong embedded signer; <a id="inv-joinsig-1-t1-p3"></a>`INV-JOINSIG-1.T1.P3` — relayed join (sender ≠ participant); <a id="inv-joinsig-1-t1-p4"></a>`INV-JOINSIG-1.T1.P4` — forged signature rejected at decode/recovery.                                                                                                                                                                                                                                                                 |
| <a id="req-joinsig-1-t1"></a>`REQ-JOINSIG-1.T1` | `REQ-JOINSIG-1`           | Collect and respond across snapshot advances, fork changes, and matching pins.                                                                   | Mismatched pins refuse on the responder and fail at submission; matching pins succeed end-to-end.                | <a id="req-joinsig-1-t1-p1"></a>`REQ-JOINSIG-1.T1.P1` — matching pins; <a id="req-joinsig-1-t1-p2"></a>`REQ-JOINSIG-1.T1.P2` — snapshot moved between pin and request; <a id="req-joinsig-1-t1-p3"></a>`REQ-JOINSIG-1.T1.P3` — fork changed; <a id="req-joinsig-1-t1-p4"></a>`REQ-JOINSIG-1.T1.P4` — stale collection rejected at submission.                                                                                                                                                                                                                                                                                   |
| <a id="req-joinsig-2-t1"></a>`REQ-JOINSIG-2.T1` | `REQ-JOINSIG-2`           | Run collections with all members responsive, one silent, one erroring, one returning a wrong-signer signature, and one unreachable at preflight. | Only the fully unanimous collection assembles; every other case fails whole with no partial confirmation usable. | <a id="req-joinsig-2-t1-p1"></a>`REQ-JOINSIG-2.T1.P1` — unanimous success; <a id="req-joinsig-2-t1-p2"></a>`REQ-JOINSIG-2.T1.P2` — silent member times out; <a id="req-joinsig-2-t1-p3"></a>`REQ-JOINSIG-2.T1.P3` — preflight unreachable fails before any request; <a id="req-joinsig-2-t1-p4"></a>`REQ-JOINSIG-2.T1.P4` — deadline-bounded timeout; <a id="req-joinsig-2-t1-p5"></a>`REQ-JOINSIG-2.T1.P5` — erroring member; <a id="req-joinsig-2-t1-p6"></a>`REQ-JOINSIG-2.T1.P6` — wrong-signer response.                                                                                                                   |
| <a id="req-joinsig-3-t1"></a>`REQ-JOINSIG-3.T1` | `REQ-JOINSIG-3`           | Trigger every responder validation failure repeatedly.                                                                                           | Declared errors only; session and identity standing unchanged; expired deadline refuses.                         | <a id="req-joinsig-3-t1-p1"></a>`REQ-JOINSIG-3.T1.P1` — decode failure penalty-free; <a id="req-joinsig-3-t1-p2"></a>`REQ-JOINSIG-3.T1.P2` — deadline at boundary; <a id="req-joinsig-3-t1-p3"></a>`REQ-JOINSIG-3.T1.P3` — non-member responder refuses; <a id="req-joinsig-3-t1-p4"></a>`REQ-JOINSIG-3.T1.P4` — identity-binding failure penalty-free; <a id="req-joinsig-3-t1-p5"></a>`REQ-JOINSIG-3.T1.P5` — wrong-channel failure penalty-free; <a id="req-joinsig-3-t1-p6"></a>`REQ-JOINSIG-3.T1.P6` — pin-mismatch failure penalty-free; <a id="req-joinsig-3-t1-p7"></a>`REQ-JOINSIG-3.T1.P7` — deadline after boundary. |

## Future Work

_Non-normative._ The configurable admission filter, including snapshot-scoped consent
([OQ-10](../open-questions.md)); collection retry strategy against churn between pin and
submission.
