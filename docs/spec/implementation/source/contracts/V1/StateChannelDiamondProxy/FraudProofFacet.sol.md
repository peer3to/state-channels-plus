# FraudProofFacet.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`INV-ENFFP-1-BGVZN4` (Slash set integrity)](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4)
- [`REQ-ENFFP-1-BREACW` (Symmetric stake on submission)](../../../../../specification/enforcement/fraud-slashing.md#req-enffp-1-breacw)
- [`REQ-ENFFP-2-JXMYNB` (Proof-type completeness at the boundary)](../../../../../specification/enforcement/fraud-slashing.md#req-enffp-2-jxmynb)
- [`INV-HIST-2-27M8VA` (Hash-linking)](../../../../../specification/protocol-model/history-and-commitments.md#inv-hist-2-27m8va)
- [`REQ-BAL-3-P7Q83F` (addBalance and aggregations reject overflow)](../../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f)
  Partial: Checked amount arithmetic implemented; custom aggregation pending — No static rule or reusable suite prevents integrator `unchecked` arithmetic or invalid custom-data aggregation.
- [`REQ-SM-6-BJZVQ5` (Turn authorization enforced generically at the protocol layer)](../../../../../specification/protocol-model/state-machines.md#req-sm-6-bjzvq5)
  Partial: On-chain invalid-state-transition replay does not perform the generic leader check, so wrong-turn slashing still depends on an in-contract guard ([`OQ-26-XH59SP` (On-chain wrong-turn enforceability)](../../../../../specification/open-questions.md#oq-26-xh59sp)).
- [`INV-FIN-2-MK27J6` (Signing a block is a binding, non-equivocating vote for that block and the)](../../../../../specification/protocol-model/finality.md#inv-fin-2-mk27j6)
- [`REQ-FP-1-9PD823` (Fraud-proof enforcement is separate from the dispute game)](../../../../../specification/disputes/fraud-proofs.md#req-fp-1-9pd823)
- [`REQ-FP-2-CH4DA1` (Every block fraud-proof handler is sound)](../../../../../specification/disputes/fraud-proofs.md#req-fp-2-ch4da1)
- [`REQ-FP-6-TS1QAV` (An invalid fraud-proof submission slashes its submitter when the submitter is…)](../../../../../specification/disputes/fraud-proofs.md#req-fp-6-ts1qav)
- [`INV-FP-8-BFNRSY` (Proof application is idempotent per offender)](../../../../../specification/disputes/fraud-proofs.md#inv-fp-8-bfnrsy)
- [`INV-SP-6-GNW74H` (Extending the proved anchor with unfinalized blocks is safe because signing is a)](../../../../../specification/disputes/state-proofs.md#inv-sp-6-gnw74h)
- [`REQ-TIME-1-FM4651` (Chain time is authoritative)](../../../../../specification/protocol-model/time.md#req-time-1-fm4651)
- [`REQ-TIME-4-83V27Z` (Timeouts/fraud proofs/slashing use only objectively validated timestamps)](../../../../../specification/protocol-model/time.md#req-time-4-83v27z)
- [`REQ-DA-2-KYZ70M` (The specification of any timing-sensitive rule MUST state which of these…)](../../../../../specification/security/data-availability.md#req-da-2-kyz70m)
- [`INV-TRUST-1-6TYWDH` (Every safety-relevant disagreement MUST be resolvable by the chain from…)](../../../../../specification/security/trust-model.md#inv-trust-1-6tywdh)
- [`REQ-TRUST-1-K5PS99` (Version one uses only objective, deterministic, mathematically verifiable)](../../../../../specification/security/trust-model.md#req-trust-1-k5ps99)

## UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG

Proof application

- Setup: Apply each type valid/invalid/mismatched from eligible and ineligible submitters, incl. replay-heavy transitions
- Oracle: Valid slashes offender once; invalid/mismatch slashes eligible submitter; replay matches client-side execution

- [x] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P1` — BlockDoubleSign valid
- [ ] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P2` — BlockDoubleSign invalid→self-slash
- [ ] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P3` — offender mismatch
- [ ] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P4` — skip-if-slashed
- [ ] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P5` — replay parity with mirror
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P6` — BlockInvalidStateTransition valid
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P7` — WrongGenesis valid
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P8` — InvalidTimestamp valid
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P9` — ForgedInboundMessageBlock valid
- [ ] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P10` — BlockInvalidStateTransition invalid→self-slash
- [ ] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P11` — WrongGenesis invalid→self-slash
- [ ] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P12` — InvalidTimestamp invalid→self-slash
- [ ] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P13` — ForgedInboundMessageBlock invalid→self-slash
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P14` — WrongGenesis naming an origin fork with no dispute window reverts `RaceConditionDisputeWindowNotOpen(channelId, originForkId)` instead of a kill-period deadline
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P15` — WrongGenesis against an open dispute window whose kill period is still running reverts `RaceConditionDisputeKillPeriodNotExpired(killPeriodEnd, currentTimestamp)`, with the deadline measured from the last evidence submission and strictly ahead of the current timestamp
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P16` — WrongGenesis whose open window leaves no genesis timestamp available reverts `RaceConditionGenesisTimestampNotAvailable(channelId, originForkId, forkId)` naming the channel and both forks

## UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04

Timestamp-fraud predicate

- Setup: `hasInvalidTimestamp(InvalidTimestampProof)` through the deployed diamond, for the genesis branch (previous state snapshot) and the non-genesis branch (previous signed block), over attacker-chosen timestamps, channel/fork ids and signatures
- Oracle: A boolean verdict only: never reverts on any input, never flags an honestly-skewed block, flips exactly at each branch’s deadline, is a single contiguous valid interval, ignores channel/fork identity, and is inert for an unauthentic block; no state is written and no participant is slashed by the predicate

- [x] `UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P1` — genesis branch never reverts on arbitrary timestamps
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P2` — non-genesis branch never reverts on arbitrary timestamps
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P3` — the valid region is one contiguous interval (no valid/invalid/valid hole)
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P4` — the verdict is insensitive to channel id and fork id
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P5` — honest skew up to `evidenceTime + p2pTime` is never flagged
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P6` — first-block grace boundary and one second past it
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P7` — a later block gets no first-block grace: boundary and one second past it
- [x] `UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P8` — a forged author signature makes the proof inert at any timestamp

## UNIT-TEST-SM-FRAUD-PROOF-1-S1Q656

Challenged transition replay

- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1)

- [ ] `UNIT-TEST-SM-FRAUD-PROOF-1-S1Q656.P1` — Matching transitions reproduce the commitment
- [ ] `UNIT-TEST-SM-FRAUD-PROOF-1-S1Q656.P2` — a changed input is detected through the correct fraud-proof outcome
- [ ] `UNIT-TEST-SM-FRAUD-PROOF-1-S1Q656.P3` — a changed pre-state is detected through the correct fraud-proof outcome
- [ ] `UNIT-TEST-SM-FRAUD-PROOF-1-S1Q656.P4` — a changed result is detected through the correct fraud-proof outcome

## UNIT-TEST-SM-FRAUD-PROOF-2-2CFSPP

Outbound balance aggregation

- Specification: [`REQ-BAL-3-P7Q83F` (addBalance and aggregations reject overflow)](../../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f)
- Specification tests: [`REQ-BAL-3-P7Q83F.T1`](../../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f.t1)

- [ ] `UNIT-TEST-SM-FRAUD-PROOF-2-2CFSPP.P1` — Zero exits aggregate exactly
- [ ] `UNIT-TEST-SM-FRAUD-PROOF-2-2CFSPP.P2` — one exit aggregates exactly
- [ ] `UNIT-TEST-SM-FRAUD-PROOF-2-2CFSPP.P3` — many exits aggregate exactly
- [ ] `UNIT-TEST-SM-FRAUD-PROOF-2-2CFSPP.P4` — overflow rejection cannot partially update the proof result
- [ ] `UNIT-TEST-SM-FRAUD-PROOF-2-2CFSPP.P5` — custom-value rejection cannot partially update the proof result

## UNIT-TEST-SM-FRAUD-PROOF-3-ZK3SQ2

Author validation dependency

- Specification: [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
- Specification tests: [`REQ-SM-5-3GS7A7.T1`](../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7.t1)

- [ ] `UNIT-TEST-SM-FRAUD-PROOF-3-ZK3SQ2.P1` — A correct author is exercised explicitly
- [ ] `UNIT-TEST-SM-FRAUD-PROOF-3-ZK3SQ2.P2` — the missing generic on-chain check remains a visible failing/gap case
- [ ] `UNIT-TEST-SM-FRAUD-PROOF-3-ZK3SQ2.P3` — a wrong author is exercised explicitly
- [ ] `UNIT-TEST-SM-FRAUD-PROOF-3-ZK3SQ2.P4` — a non-member author is exercised explicitly

## UNIT-TEST-SM-FRAUD-PROOF-4-4WZT2H

Failure and retry

- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d), [`REQ-BAL-3-P7Q83F` (addBalance and aggregations reject overflow)](../../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1), [`REQ-BAL-3-P7Q83F.T1`](../../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f.t1)

- [ ] `UNIT-TEST-SM-FRAUD-PROOF-4-4WZT2H.P1` — A failed replay is deterministic and a later valid proof is not contaminated by prior work
- [ ] `UNIT-TEST-SM-FRAUD-PROOF-4-4WZT2H.P2` — a failed aggregation is deterministic and a later valid proof is not contaminated by prior work
