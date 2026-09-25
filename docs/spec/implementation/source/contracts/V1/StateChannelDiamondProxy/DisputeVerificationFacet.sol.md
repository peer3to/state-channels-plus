# DisputeVerificationFacet.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`INV-ENFDIS-1-1K65DT` (Commitment-exact reduction)](../../../../../specification/enforcement/dispute-window.md#inv-enfdis-1-1k65dt)
- [`REQ-DIS-4-6J6YYG` (Reduction runs only after the kill period expires and consumes exactly the…)](../../../../../specification/disputes/disputes.md#req-dis-4-6j6yyg)
- [`INV-DIS-7-9GGZSD` (In a fork whose reduction contains any on-chain slashes, timeout removal is not…)](../../../../../specification/disputes/disputes.md#inv-dis-7-9ggzsd)
- [`INV-DIS-8-1GY6Q5` (A fork applies at most one timeout, targeting the participant at the lowest…)](../../../../../specification/disputes/disputes.md#inv-dis-8-1gy6q5)
  Contradicts: Empty-timeout struct (height 0) suppresses real timeouts. Slash-carrying case intended (slash precedence, decision 2026-08-14); slash-free case still cancels order-dependently — open per [`OQ-9-XR1MFS` (Timeout precedence edge rules)](../../../../../specification/open-questions.md#oq-9-xr1mfs).
- [`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
- [`REQ-SM-10-JD8TSF` (Slashing or removal of a participant absent from the state being transformed…)](../../../../../specification/protocol-model/state-machines.md#req-sm-10-jd8tsf)
- [`REQ-DIS-2-PKVZ7E` (Upload is limited to eligible disputers)](../../../../../specification/disputes/disputes.md#req-dis-2-pkvz7e)
- [`INV-MSG-6-1C22RD` (Balance invariant)](../../../../../specification/settlement/cross-layer-messages.md#inv-msg-6-1c22rd)
- [`REQ-MSG-1-AY3A77` (Snapshots MUST commit both stream tips + totals)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-1-ay3a77)
- [`REQ-MSG-11-VS3ZGC` (A deposited-but-unincluded joiner MUST be able to force inclusion via the…)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-11-vs3zgc)
- [`REQ-MSG-12-1RRB0W` (Anyone MUST be able to verify the balance invariant trustlessly for a claimed…)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-12-1rrb0w)
- [`REQ-DIS-3-C4KYSF` (An uploaded dispute records its commitment immediately)](../../../../../specification/disputes/disputes.md#req-dis-3-c4kysf)
- [`INV-DIS-5-J1QZ92` (The reduced result is independent of the order in which valid dispute inputs…)](../../../../../specification/disputes/disputes.md#inv-dis-5-j1qz92)
- [`REQ-DIS-6-Y92H1M` (Every initiated dispute window MUST end in a canonical successor fork, genesis…)](../../../../../specification/disputes/disputes.md#req-dis-6-y92h1m)
- [`INV-FIN-8-G6V1M1` (Valid transitions that lacked finality when a dispute began are not reverted)](../../../../../specification/protocol-model/finality.md#inv-fin-8-g6v1m1)
- [`REQ-FP-1-9PD823` (Fraud-proof enforcement is separate from the dispute game)](../../../../../specification/disputes/fraud-proofs.md#req-fp-1-9pd823)
- [`REQ-FP-5-ZXW0J5` (A dispute may list any subset of recorded slashes)](../../../../../specification/disputes/fraud-proofs.md#req-fp-5-zxw0j5)
- [`REQ-FP-7-4DD0D7` (A valid dispute fraud proof applied within the kill period kills the committed…)](../../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7)
- [`REQ-LIF-4-SW8GVY` (Every initiated dispute runs through the dispute game and produces a canonical)](../../../../../specification/settlement/lifecycle.md#req-lif-4-sw8gvy)
- [`REQ-SP-5-MTE4RV` (The final block of the proved path supplies the state commitment)](../../../../../specification/disputes/state-proofs.md#req-sp-5-mte4rv)
- [`INV-SP-6-GNW74H` (Extending the proved anchor with unfinalized blocks is safe because signing is a)](../../../../../specification/disputes/state-proofs.md#inv-sp-6-gnw74h)

## UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3

Reduction algebra

- Setup: Reduce permuted committed sets incl. kills, empty timeouts, tie-breaks, precedence cases
- Oracle: Deterministic per-field folds; precedence rules hold; divergences documented (empty-timeout, order permutation)

- [ ] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P1` — latest-block tie-break
- [ ] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P2` — slash union + filtering
- [ ] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P3` — lowest-height timeout
- [ ] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P4` — empty-timeout cancellation (slash case intended; slash-free case documents [`OQ-9-XR1MFS` (Timeout precedence edge rules)](../../../../../specification/open-questions.md#oq-9-xr1mfs))
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P5` — slashes-suppress-timeout
- [ ] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P6` — order permutations (documents [`OQ-4-JGDCNX` (Dispute-reduction order-independence)](../../../../../verification/open-questions.md#oq-4-jgdcnx))
- [ ] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P7` — idempotent finalize
- [ ] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P8` — exact-set matching
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P9` — snapshot already past the slashed signer (bounded pending set empty) still folds its on-chain slash
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P10` — test_computeDisputeOutputState_absentSlashPreservesStateAndEmitsNoExit
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P11` — test_computeDisputeOutputState_absentRemovalPreservesStateAndEmitsNoExit
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P18` — a stale-admitted departed signer receives a real chain slash record; applying that recorded slash to absent local state preserves balances and emits no exit
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P19` — a genesis reduction whose snapshot data does not hash to the disputed fork reverts naming the required fork and the hash actually computed
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P20` — a block-bearing reduction whose latest block does not link to the supplied snapshot reverts naming the claimed and computed snapshot hashes
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P21` — killing a dispute the window never committed reverts naming the channel, fork and absent commitment, leaving the committed set untouched
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P23` — `reduceAndFinalize` with one submitted dispute the window never committed reverts naming both commitment hash arrays, distinguishing the substituted dispute at equal length
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P24` — `challengeDisputeReduction` by an eligible participant submitting one extra dispute beyond the committed set reverts naming both commitment hash arrays, so the extra hash is identifiable
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P25` — an inbound message the state machine refuses during dispute output generation reverts naming its block and message index, participant, message type, and the hash of the state the walk was seeded with rather than the state reached by the preceding message
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P26` — a refused inbound message in a later block reverts naming a non-zero block index and a different non-zero message index, so the two indices cannot be swapped or confused, alongside its participant, message type and the seed state hash
- [x] `UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P27` — `challengeDisputeReduction` by an eligible participant after the reduce-challenge period ended reverts naming the computed period end and the strictly later call timestamp

## UNIT-TEST-SM-DISPUTE-VERIFICATION-1-ZAJQV6

Dispute-state restoration

- Specification: [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-2-0FTJ2T.T1`](../../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [ ] `UNIT-TEST-SM-DISPUTE-VERIFICATION-1-ZAJQV6.P1` — The supplied dispute output state is restored exactly before membership mutation
- [ ] `UNIT-TEST-SM-DISPUTE-VERIFICATION-1-ZAJQV6.P2` — malformed state rejects atomically

## UNIT-TEST-SM-DISPUTE-VERIFICATION-2-DKTKDF

Apply removals and slashes

- Specification: [`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
- Specification tests: [`REQ-SM-8-8CHSQ8.T1`](../../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8.t1)

- [x] `UNIT-TEST-SM-DISPUTE-VERIFICATION-2-DKTKDF.P1` — Zero targets return an empty canonical exit set
- [ ] `UNIT-TEST-SM-DISPUTE-VERIFICATION-2-DKTKDF.P2` — hook-false cases leave no partial result
- [x] `UNIT-TEST-SM-DISPUTE-VERIFICATION-2-DKTKDF.P3` — one existing target returns its canonical exit
- [x] `UNIT-TEST-SM-DISPUTE-VERIFICATION-2-DKTKDF.P4` — many existing targets return canonical exits in deterministic order
- [ ] `UNIT-TEST-SM-DISPUTE-VERIFICATION-2-DKTKDF.P5` — a non-member target is handled canonically
- [ ] `UNIT-TEST-SM-DISPUTE-VERIFICATION-2-DKTKDF.P6` — hook-revert cases leave no partial result
- [ ] `UNIT-TEST-SM-DISPUTE-VERIFICATION-2-DKTKDF.P7` — duplicate targets leave no partial result

## UNIT-TEST-SM-DISPUTE-VERIFICATION-3-PHT5BB

Withdrawal calculation

- Specification: [`REQ-BAL-1-Z8RH4V` (subtractBalance rejects underflow)](../../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v), [`REQ-BAL-3-P7Q83F` (addBalance and aggregations reject overflow)](../../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f)
- Specification tests: [`REQ-BAL-1-Z8RH4V.T1`](../../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v.t1), [`REQ-BAL-3-P7Q83F.T1`](../../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f.t1)

- [ ] `UNIT-TEST-SM-DISPUTE-VERIFICATION-3-PHT5BB.P1` — Returned exit balances aggregate exactly
- [ ] `UNIT-TEST-SM-DISPUTE-VERIFICATION-3-PHT5BB.P2` — underflow rejects without an accepted output
- [ ] `UNIT-TEST-SM-DISPUTE-VERIFICATION-3-PHT5BB.P3` — overflow rejects without an accepted output
- [ ] `UNIT-TEST-SM-DISPUTE-VERIFICATION-3-PHT5BB.P4` — malformed custom values reject without an accepted output

## UNIT-TEST-SM-DISPUTE-VERIFICATION-4-ES92Q5

Wrapper/facet equivalence

- Specification: [`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
- Specification tests: [`REQ-SM-8-8CHSQ8.T1`](../../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8.t1)

- [ ] `UNIT-TEST-SM-DISPUTE-VERIFICATION-4-ES92Q5.P1` — Removal and slashing return paths each record one successful exit; reduction consumes the returned exit once
