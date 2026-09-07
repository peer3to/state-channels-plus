# Guarded Channel-Term Negotiation

> **Agent status:** Maintained protocol specification.
> **Engineer verification:** Pending.
> **Status:** Maintained.
> **Scope:** Two-party terms, negotiated channel identity, signatures, deterministic submission, and
> chain-observed completion after an acknowledged lobby match.

## Contents

- [Purpose and observable contract](#purpose-and-observable-contract)
- [Committed attempt and channel identity](#committed-attempt-and-channel-identity)
- [Algorithm](#algorithm)
- [Admission and lifecycle](#admission-and-lifecycle)
- [Failure outcomes](#failure-outcomes)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable contract

Two authenticated peers that already committed to one lobby attempt agree on their opening deposits,
derive one fresh channel ID, and produce the unanimously signed opening required by enforcement. Lobby
matching selects the peer pair and fresh transcript. Negotiation owns terms, channel-ID derivation,
signatures, deterministic submission, and chain observation.

The guarantee is negotiated-terms-only signing. A node signs only the exact opening rebuilt from its own
committed attempt and local deposit intention. A peer message is never enough to declare success; the
channel must be observed open on-chain.

## Committed attempt and channel identity

The committed attempt contains the authenticated peer pair, fresh attempt nonce, and one fresh 32-byte
challenge contributed by each peer. It contains no channel ID. Negotiation canonically orders the peers
by address and derives:

`channelId = keccak256(domainTag, lowerAddress, higherAddress, lowerChallenge, higherChallenge)`

The domain tag separates channel-ID derivation from every other signature or commitment domain. Challenges
are aligned with their address owners before hashing. The derived ID must be nonzero. The same acknowledged
transcript produces the same ID on both peers; another attempt between the same pair uses fresh challenges
and therefore produces another ID.

If the derived ID is already open before proposal, the attempt fails as a protocol collision. It is not
reported as a successful opening and no new proposal is signed.

## Algorithm

1. **Arm from commitment.** Both peers record the authenticated counterparty, attempt nonce, and ordered
   challenge pair before the internal lobby match resolves. The host-owned join workflow immediately starts
   negotiation. Admission may defer a correctly authenticated early request while the other host finishes
   local matched-attempt setup.
2. **Start.** The lower canonical address sends the first correlated term request. The higher address waits
   at most two agreement windows for that request. No other peer or attempt may enter this negotiation.
3. **Exchange terms.** Each peer supplies its local deposit intention. Correlated responses bind the terms to
   the committed attempt. Duplicates with identical data are idempotent; stale, conflicting, or malformed
   terms fail the attempt.
4. **Derive identity.** Both peers derive the channel ID from the committed transcript. Neither trusts a
   remote-supplied channel ID. The ID becomes selected only after the transcript and terms pass validation.
5. **Deterministic proposal.** The lower address builds the canonical opening with ordered participants,
   aligned balances, bounded deadline, and atomic-deposit semantics, then signs it.
6. **Re-derive, never adopt.** The higher address rebuilds the expected opening from local state, requires
   field-exact equality, verifies the lower signature, signs the exact encoding, and directly submits that
   exact payload with both signatures. The correlated proposal response reports only that submission
   returned; there is no separate submission-acknowledgement operation.
7. **Confirm by chain observation.** Both peers enter the ordinary channel lifecycle only after observing the
   derived ID open on-chain. A duplicate submission race for the same signed attempt defers to that evidence.

## Admission and lifecycle

Negotiation admission is installed before an attempt is armed. An authenticated request from the expected
peer may wait in arrival order for at most two agreement windows while local committed-attempt readiness is
established. Only the committed peer, attempt, and challenge transcript pass after readiness. An unrelated
peer, ineligible request, expired request, or mismatch is rejected through the negotiation failure policy.

Discovery and channel roles do not overlap. A committed match stops lobby advertisement and selection but
keeps the caller topic connected during negotiation. Before any local opening signature exists, failure
clears the selected ID and attempt and returns the host workflow to matching on the same topic. After a local
signature exists, counterparty abandonment excludes that peer immediately, but the signed attempt remains
observed until the channel opens or the opening deadline expires. Public lobby leave is a matching-only
operation: after commitment it reports that handoff is complete and does not cancel negotiation or chain
observation. Successful chain observation leaves the caller topic before the opened-channel result is
returned to the client.

Final loss of the matched profile before signing is a neutral abort without exclusion. Timeout, malformed
or mismatched protocol input, admission violation, or abandonment after commitment excludes the peer before
recovery. A healthy transport replacement is not profile loss.

## Failure outcomes

Ordinary negotiation derives its channel ID from the authenticated transcript. An already-open derived ID
therefore represents transcript disclosure or reuse, not a harmless collision: the peer is punished, the
ID and provider listener are cleared, raw discovery and sync do not start, and only the ordinary wrapper
may rematch. Ordinary terms carry a full encoded balance and preserve both `amount` and `data`.

Targeted negotiation binds both peers to their independently selected fixed ID and never accepts an ID from
a peer message. Authoritative evidence that this ID opened at preflight, during negotiation or signing, or
after receipt failure resolves one observed-open outcome without blacklisting either matched loser. The
connect wrapper leaves the derived topic and enters its selected-channel post-open branch once. A late local
signature is discarded after an attempt-identity and handoff-state check immediately before submission.
If a targeted receipt fails while the target is still unopened, the original error remains an unexpected
failure. Targeted unsigned failure keeps the ID and provider listener and returns terminal `false`; another
attempt begins only after a fresh explicit same-ID connect.

Every received balance is canonically decoded, compared with repeated terms by exact `amount` and `data`,
and accepted only after `getZeroBalance` plus `isBalanceLesserThan(zero, received)`. Invalid or non-positive
remote terms are rejected and blacklisted. Opening deadlines are assigned internally.

| Failure                                                                          | Outcome                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request arrives before local attempt readiness from the committed peer           | Queue in arrival order for at most two agreement windows, then replay when ready.                                                                                                                                                                                                                                        |
| Wrong peer, attempt, transcript, role, or malformed input                        | Reject, exclude where the authenticated peer violated the committed protocol, clear unsigned attempt.                                                                                                                                                                                                                    |
| Lower peer does not initiate within two agreement windows                        | Exclude lower peer and release the unsigned attempt.                                                                                                                                                                                                                                                                     |
| Derived ID is zero or already open before proposal                               | Fail the attempt; do not sign and do not report success.                                                                                                                                                                                                                                                                 |
| Proposal differs from locally rebuilt terms or has an invalid signature/deadline | Exclude proposer and clear the unsigned attempt.                                                                                                                                                                                                                                                                         |
| Final profile loss before a local signature                                      | Neutral abort without exclusion; clear attempt and selected ID.                                                                                                                                                                                                                                                          |
| Counterparty abandonment after commitment but before local signature             | Exclude, clear attempt, return to discovery when still active.                                                                                                                                                                                                                                                           |
| Counterparty abandonment after local signature                                   | Exclude and observe chain until open or payload expiry.                                                                                                                                                                                                                                                                  |
| Higher-peer local submission failure                                             | Neither peer immediately excludes the lower proposer. Both signed attempts remain observed until chain open or payload expiry. If no open exists at expiry, only the lower peer excludes the higher peer for failing its submission obligation; the higher peer does not blame the lower for its own local send failure. |
| Duplicate submission of the same valid attempt                                   | Chain observation decides; at most one opening becomes authoritative.                                                                                                                                                                                                                                                    |

## Requirements and invariants

**<a id="inv-neg-1-6fw90p"></a>`INV-NEG-1-6FW90P` — Negotiated-terms-only signing.** A node signs only an opening
that equals the struct rebuilt from its committed attempt and local term intention. The counterparty is bound
to the authenticated session, and no remote-supplied channel ID or local deposit replaces local derivation.

**<a id="req-neg-1-rtkpt1"></a>`REQ-NEG-1-RTKPT1` — Deterministic proposer and submitter.** Canonical address
order selects the lower peer to initiate, construct, and first-sign the proposal and the higher peer to
validate, co-sign, and submit that exact payload. No second identity-order rule may produce a different
election.

**<a id="req-neg-2-ed48tz"></a>`REQ-NEG-2-ED48TZ` — Chain-observed completion.** Success is established only by
observing the derived channel ID open on-chain. An already-open derived ID detected before proposal is a
failed new attempt, while a submission race for the exact signed attempt defers to chain evidence.

**<a id="req-neg-4-zq0985"></a>`REQ-NEG-4-ZQ0985` — Committed-attempt admission and recovery.** Negotiation accepts
only the authenticated peer, attempt, and challenge transcript acknowledged by lobby commitment. Correct
early requests may wait up to two agreement windows. Every failure has the signed/unsigned and profile-loss
recovery outcome defined above.

## Assumptions and constraints

- Two-party openings only; multi-party negotiation is future work.
- Both peers hold the same acknowledged lobby transcript and use canonical address ordering.
- Signature and chain-observation guarantees rely on the protocol trust model and configured agreement and
  opening-deadline bounds.
- Progress expects partial synchrony inside the two-window readiness and initiation grace.
- A locally issued signature cannot be revoked. Recovery after signing is therefore chain-or-expiry based.

## Security considerations

The protected assets are opening-signature intent, channel identity, deposit terms, and one-time submission.
The primary attacks are term substitution, channel-ID injection, cross-attempt replay, early-message races,
wrong-peer admission, silent initiation, abandonment after signature, and false success from an old channel.
Transcript-derived identity, authenticated committed-attempt admission, deterministic election, field-exact
reconstruction, signature verification, bounded readiness, and chain-observed completion contain those
attacks. Residual risks are griefing for one bounded attempt, a collision in the underlying hash assumption,
chain/RPC observation delay, and the unavoidable validity of a signature until its payload expires.

## Verification and test plan

| Plan item                                             | Requirements / invariants                                     | Setup and stimulus                                                                                                                                                                              | Expected result                                                                                                                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-neg-1-6fw90p.t1"></a>`INV-NEG-1-6FW90P.T1` | [`INV-NEG-1-6FW90P`](channel-negotiation.md#inv-neg-1-6fw90p) | Deliver exact and altered proposals after a committed attempt, including remote channel-ID and amount substitution.                                                                             | Only the exact locally rebuilt opening is signed; every mismatch fails without signing.                                                                                                  | <a id="inv-neg-1-6fw90p.t1.p1"></a>`INV-NEG-1-6FW90P.T1.P1` — exact match; <a id="inv-neg-1-6fw90p.t1.p2"></a>`INV-NEG-1-6FW90P.T1.P2` — altered amount; <a id="inv-neg-1-6fw90p.t1.p3"></a>`INV-NEG-1-6FW90P.T1.P3` — cold/unsolicited proposal; <a id="inv-neg-1-6fw90p.t1.p4"></a>`INV-NEG-1-6FW90P.T1.P4` — deadline outside bounds; <a id="inv-neg-1-6fw90p.t1.p5"></a>`INV-NEG-1-6FW90P.T1.P5` — altered participants; <a id="inv-neg-1-6fw90p.t1.p6"></a>`INV-NEG-1-6FW90P.T1.P6` — altered deadline; <a id="inv-neg-1-6fw90p.t1.p7"></a>`INV-NEG-1-6FW90P.T1.P7` — altered atomicity; <a id="inv-neg-1-6fw90p.t1.p8"></a>`INV-NEG-1-6FW90P.T1.P8` — remote channel ID ignored.                                                                                                                                                                                                                                                                                                                                                                                                    |
| <a id="req-neg-1-rtkpt1.t1"></a>`REQ-NEG-1-RTKPT1.T1` | [`REQ-NEG-1-RTKPT1`](channel-negotiation.md#req-neg-1-rtkpt1) | Start from both caller sides and inject wrong-role proposals or submissions.                                                                                                                    | Lower always initiates and first-signs; higher validates, co-signs, and submits the exact payload; wrong-role traffic fails.                                                             | <a id="req-neg-1-rtkpt1.t1.p1"></a>`REQ-NEG-1-RTKPT1.T1.P1` — lower caller starts; <a id="req-neg-1-rtkpt1.t1.p2"></a>`REQ-NEG-1-RTKPT1.T1.P2` — higher caller starts; <a id="req-neg-1-rtkpt1.t1.p3"></a>`REQ-NEG-1-RTKPT1.T1.P3` — wrong proposer; <a id="req-neg-1-rtkpt1.t1.p4"></a>`REQ-NEG-1-RTKPT1.T1.P4` — higher submits exact validated payload with both signatures; <a id="req-neg-1-rtkpt1.t1.p5"></a>`REQ-NEG-1-RTKPT1.T1.P5` — proposer signature recovery; <a id="req-neg-1-rtkpt1.t1.p6"></a>`REQ-NEG-1-RTKPT1.T1.P6` — no submission-acknowledgement RPC and completion remains chain-observed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| <a id="req-neg-2-ed48tz.t1"></a>`REQ-NEG-2-ED48TZ.T1` | [`REQ-NEG-2-ED48TZ`](channel-negotiation.md#req-neg-2-ed48tz) | Derive IDs from equal and distinct attempts, open normally, race a duplicate submission, collide with an already-open ID, fail higher-side submission, and expire.                              | Equal transcripts agree, fresh attempts differ, success is chain-observed, and role-specific expiry accountability never blames the lower peer for the higher peer's local send failure. | <a id="req-neg-2-ed48tz.t1.p1"></a>`REQ-NEG-2-ED48TZ.T1.P1` — same transcript equality; <a id="req-neg-2-ed48tz.t1.p2"></a>`REQ-NEG-2-ED48TZ.T1.P2` — fresh attempt distinct ID; <a id="req-neg-2-ed48tz.t1.p3"></a>`REQ-NEG-2-ED48TZ.T1.P3` — normal completion; <a id="req-neg-2-ed48tz.t1.p4"></a>`REQ-NEG-2-ED48TZ.T1.P4` — exact-attempt race; <a id="req-neg-2-ed48tz.t1.p5"></a>`REQ-NEG-2-ED48TZ.T1.P5` — pre-open collision fails; <a id="req-neg-2-ed48tz.t1.p6"></a>`REQ-NEG-2-ED48TZ.T1.P6` — local submission failure causes no immediate exclusion; <a id="req-neg-2-ed48tz.t1.p7"></a>`REQ-NEG-2-ED48TZ.T1.P7` — deadline without open applies lower-to-higher submission accountability only.                                                                                                                                                                                                                                                                                                                                                                             |
| <a id="req-neg-4-zq0985.t1"></a>`REQ-NEG-4-ZQ0985.T1` | [`REQ-NEG-4-ZQ0985`](channel-negotiation.md#req-neg-4-zq0985) | Deliver correct early, late, wrong-peer, wrong-attempt, malformed, duplicate, silent-initiation, disconnect, abandonment, post-handoff leave, and disposal paths around commitment and signing. | Only the committed attempt enters; early valid traffic replays; each path applies its exact blacklist, neutral-abort, retry, chain-observation, disposal, or phase-boundary outcome.     | <a id="req-neg-4-zq0985.t1.p1"></a>`REQ-NEG-4-ZQ0985.T1.P1` — early request queued/replayed; <a id="req-neg-4-zq0985.t1.p2"></a>`REQ-NEG-4-ZQ0985.T1.P2` — readiness expiry; <a id="req-neg-4-zq0985.t1.p3"></a>`REQ-NEG-4-ZQ0985.T1.P3` — lower initiation deadline; <a id="req-neg-4-zq0985.t1.p4"></a>`REQ-NEG-4-ZQ0985.T1.P4` — wrong peer/attempt/transcript; <a id="req-neg-4-zq0985.t1.p5"></a>`REQ-NEG-4-ZQ0985.T1.P5` — stale/duplicate/malformed; <a id="req-neg-4-zq0985.t1.p6"></a>`REQ-NEG-4-ZQ0985.T1.P6` — final profile loss before signing; <a id="req-neg-4-zq0985.t1.p7"></a>`REQ-NEG-4-ZQ0985.T1.P7` — abandonment before signing; <a id="req-neg-4-zq0985.t1.p8"></a>`REQ-NEG-4-ZQ0985.T1.P8` — abandonment after signing; <a id="req-neg-4-zq0985.t1.p9"></a>`REQ-NEG-4-ZQ0985.T1.P9` — post-handoff leave cannot cancel; <a id="req-neg-4-zq0985.t1.p10"></a>`REQ-NEG-4-ZQ0985.T1.P10` — fresh discovery join after unsigned failure; <a id="req-neg-4-zq0985.t1.p11"></a>`REQ-NEG-4-ZQ0985.T1.P11` — runtime disposal settles a locally signed join as cancelled. |

## Future Work

_Non-normative._ Multi-party term negotiation and a formally versioned channel-ID derivation registry may
be added without changing the two-party committed-attempt boundary.
