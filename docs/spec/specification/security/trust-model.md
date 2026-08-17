# Trust Model

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft; pending engineer verification.
> **Scope:** Defines the implementation-neutral trust model behavior, assumptions, constraints, security properties, and black-box test plan.

## Contents

- [Purpose & observable contract](#1-purpose--observable-contract)
- [The chain is arbiter and enforcer](#2-the-chain-is-arbiter-and-enforcer)
- [Objective vs. subjective violations](#3-objective-vs-subjective-violations)
- [Consolidated trust assumptions](#4-consolidated-trust-assumptions)
- [RPC observation assumption](#5-rpc-observation-assumption)
- [Honest-peer assumption](#6-honest-peer-assumption)
- [Watchtower requirement for offline participants](#7-watchtower-requirement-for-offline-participants)
- [Topology limits](#8-topology-limits)
- [Threat model](#9-threat-model)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Requirements and invariants](#requirements-and-invariants)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## 1. Purpose & observable contract

This document defines the conditions under which the protocol's safety and liveness claims hold.
Every other document's guarantees are implicitly qualified by the assumptions listed here. A reader
deciding whether the system fits a deployment MUST check this document first; a reader auditing a
mechanism MUST check that it does not silently strengthen or weaken these assumptions.

The trust model deliberately separates:

- what the **chain** enforces (objective adjudication, final);
- what **participants** must do for themselves (observe the chain, stay online or delegate);
- what the protocol **cannot** provide (safety in an all-Byzantine channel, correct operation
  without any honest chain view).

## 2. The chain is arbiter and enforcer

Participants do not need to trust each other. The on-chain
`StateChannelManagerProxy`
is both the **arbiter** and the **enforcer** of the state-machine agreement: it adjudicates
disputes objectively (deterministic re-execution, signature verification, reduction) and enforces
the outcome (slashing, removal, successor forks, settlement).

Off-chain cooperation is the preferred path because it is cheaper and faster, but it is a
performance optimization, not a security mechanism. When peers cannot cooperate, safety and
correctness rest entirely on the chain's ability to adjudicate and enforce. See
[../protocol/disputes.md](../disputes/disputes.md) and
[../protocol/fraud-proofs.md](../disputes/fraud-proofs.md).

**<a id="inv-trust-1-6tywdh"></a>`INV-TRUST-1-6TYWDH`.** Every safety-relevant disagreement MUST be resolvable by the chain from objective
inputs alone, without trusting any participant's testimony.

## 3. Objective vs. subjective violations

The protocol distinguishes two categories of misbehavior:

- **Objective violations** are deterministic and mathematically provable from signed artifacts and
  chain state: invalid state transitions, double-signing, forged history, invalid timestamps,
  invalid disputes. These support fraud proofs and on-chain enforcement
  ([../protocol/fraud-proofs.md](../disputes/fraud-proofs.md)).
- **Subjective judgments** are opinions about cooperation, responsiveness, or reputation. They are
  not provable and MUST NOT be slashable evidence, dispute input, or a substitute for protocol
  correctness.

**<a id="req-trust-1-k5ps99"></a>`REQ-TRUST-1-K5PS99`.** Version one uses only objective, deterministic, mathematically verifiable
on-chain claims for enforcement — fraud proofs and every slashable behavior. Subjective reputation
MUST NEVER contribute to slashing or adjudication. (Non-authoritative reputation for choosing
counterparties is Future Work and must not change enforcement; see §9.)

## 4. Consolidated trust assumptions

The protocol's guarantees hold only under all of the following. Each is normative; violating one
voids the guarantees that depend on it.

| #   | Assumption                                                                                                                | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Live, honest, final chain.**                                                                                            | The chain hosting the manager contract is available, censorship-resistant, and provides settlement finality. If it fails, disputes cannot be adjudicated or enforced. Depends on the resilience and decentralization of the underlying chain.                                                                                                                                                                                                                                                                                                        |
| A2  | **Signature and key security.**                                                                                           | Participants keep signing keys private. Every state, economic, and on-chain-enforceable protocol commitment is signed; a compromised key is a compromised participant. Unsigned operational observations may justify a local disconnect or reputation decision, but MUST NOT support slashing or portable proof. The identity and signing machinery itself is defined in [../protocol-model/identity.md](../protocol-model/identity.md); signature domain separation is a separate open issue ([`OQ-29-EFY4NF`](../open-questions.md#oq-29-efy4nf)). |
| A3  | **Deterministic state machines.**                                                                                         | Integrator state machines are deterministically replayable off-chain and on-chain, with canonical serialization ([../concepts/state-machines.md](../protocol-model/state-machines.md)). Non-determinism breaks agreement and fraud verification.                                                                                                                                                                                                                                                                                                     |
| A4  | **Bounded clock skew.**                                                                                                   | Participants track chain time within the tolerance the timing windows imply ([../protocol/time.md](../protocol-model/time.md)).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A5  | **Economic stake.**                                                                                                       | Slashing deters only participants whose stake at risk exceeds the value of misbehaving.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A6  | **RPC observation.**                                                                                                      | Each client has at least one available, honest RPC connection to the chain (§5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A7  | **Honest peer per channel.**                                                                                            | At least one non-Byzantine participant exists in each channel (§6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A8  | **Continuous availability for offline participants.**                                                                     | An offline participant loses contest rights unless a node holding its key stays online on its behalf; a keyless third party can only submit dispute fraud proofs (§7). No watchtower/delegate mechanism exists in version one.                                                                                                                                                                                                                                                                                                                        |
| A9  | **No on-path adversary during authentication** _(temporary — [`REQ-TRUST-6-Z586T0`](trust-model.md#req-trust-6-z586t0))._ | Until peer authentication binds both identities and the transport session, its guarantees assume no active on-path adversary between two honest peers. A relayed identity proof must not establish identity in a different session ([`OQ-35-E5RRDF`](../../implementation/open-questions.md#oq-35-e5rrdf)). Every peer-authentication and blacklist-attribution guarantee depends on A9.                                                                                                                                                             |

**[`REQ-TRUST-6-Z586T0`](trust-model.md#req-trust-6-z586t0)** _(temporary assumption A9)._ Until the handshake binds both peer identities and
the transport/session, the specification MUST state that peer authentication holds only against an
adversary with no on-path position between two honest peers. No guarantee that depends on peer
identity — blacklist attribution, per-peer penalties, spectate mutual-cooperation rules — may be
claimed unconditionally while A9 stands. Removing A9 requires the signed binding
([`OQ-35-E5RRDF`](../../implementation/open-questions.md#oq-35-e5rrdf)) plus a
relay/reflection test that fails without it.

## 5. RPC observation assumption

The off-chain runtime client observes the chain only through an RPC endpoint: it receives events, reads
contract state, and submits transactions through it. This is a real trust dependency, not an
implementation detail.

**<a id="req-trust-2-x8gcz7"></a>`REQ-TRUST-2-X8GCZ7`.** A client MUST have at least one available, honest RPC connection through which it
can observe chain state and events. Redundancy across independent RPC providers reduces ordinary
availability failures, but it does NOT remove the assumption: correct operation is not guaranteed
if every available endpoint is unavailable, dishonest, or malicious. A dishonest endpoint can feed
a client a false chain view, suppress events, or censor its transactions; the protocol cannot
detect this from inside the client. The assumption also inherits A1: it is only as strong as the
resilience and decentralization of the underlying chain.

**Intended:** Redundancy across independent providers as an availability improvement, explicitly
documented as not removing the honesty assumption.

## 6. Honest-peer assumption

**<a id="req-trust-3-3ywezr"></a>`REQ-TRUST-3-3YWEZR`.** The protocol assumes at least one non-Byzantine participant in each
channel. **If every participant in a channel is Byzantine, the trust assumption provides no
safety for that channel.** Colluding participants who control the complete signature set can
finalize any state their signatures can produce; the chain cannot distinguish unanimous fraud from
unanimous agreement. This limitation is fundamental to the design and MUST be stated wherever the
P2P security model is summarized.

Consequences an integrator must accept:

- The protocol protects an honest participant against any coalition of the others; it does not
  protect an absent stake-holder against a fully colluding participant set (see also the
  channel-balance invariant for late joiners,
  [../protocol/cross-layer-messages.md](../settlement/cross-layer-messages.md)).
- Honest-majority is NOT required; one honest participant with chain access (A6) and enough time
  (A4, dispute windows) suffices to enforce its rights.

## 7. Watchtower requirement for offline participants

An honest participant enforces its own rights: it must observe on-chain actions (disputes,
calldata posts, snapshot updates) and contest invalid ones within the protocol windows. A
participant that is offline through a contest window cannot do this, and the protocol does not
pause for it.

**<a id="req-trust-4-kw24nf"></a>`REQ-TRUST-4-KW24NF`.** Version one ships no watchtower. An honest participant that may go
offline during a contest window MUST keep a node running continuously on its behalf — today that
means its own replica holding its own key. A keyless third party can only submit dispute fraud
proofs (`applyDisputeFraudProofs` is permissionless for valid proofs); it cannot open a dispute or
contest a timeout, which require the participant's own key (`msg.sender == disputer` plus dispute
eligibility). A delegate that can contest without holding funds-controlling keys does not exist
and would require protocol changes — tracked as an open question in the register.

**Required verification:** offline-participant tests (honest participant offline while a
counterparty submits an invalid dispute/timeout; a standby node holding the participant's key
contests in time; a keyless third party kills an invalid dispute) and collusion tests (remaining
participants collude against the offline participant) — required downstream coverage.

## 8. Topology limits

**<a id="req-trust-5-ndvrw8"></a>`REQ-TRUST-5-NDVRW8`.** The design targets many SMALL channels, not large ones. For the
intended poker use case a channel of up to roughly ten participants — commonly six — is an
acceptable fit for the full mesh. The protocol MUST NOT be presented as suitable for very large
participant sets under this full-mesh topology.

## 9. Threat model

| Threat                               | Defense                                                                                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid state transition             | Deterministic on-chain re-execution via `BlockInvalidStateTransition` fraud proof → author slashed.                                                                                                               |
| Equivocation / double-signing        | `BlockDoubleSign` fraud proof over two conflicting signed blocks → slash.                                                                                                                                         |
| Forged history                       | `WrongGenesis`, `InvalidTimestamp`, `ForgedInboundMessageBlock` fraud proofs reject blocks chaining from bad genesis, violating timing rules, or citing non-persisted inbound messages.                           |
| Unavailability / griefing by silence | Deterministic author timeouts feed the dispute game; the channel progresses without the silent participant ([../protocol/disputes.md](../disputes/disputes.md)).                                                  |
| Fraudulent disputes                  | Fraud-proof claims disprove disputes claiming a non-latest state, bad output, invalid state proof, broken balance invariant, or unjustified timeout.                                                              |
| Spam / bogus proofs                  | Non-overwritable block-calldata commitments, the dispute-window kill period, and self-slashing of submitters of invalid proofs. Rate limiting at the P2P layer is NOT designed yet — see [security-assessment](../../audit/security-assessment.md). |
| Value creation / theft               | Balance-algebra underflow rejection, settlement capped at deposits, `DisputeInvalidBalanceInvariant` on-chain.                                                                                                    |

The table defines required defense categories; it does not by itself prove that every objectively
provable violation is covered. Fraud-proof completeness therefore remains an explicit audit claim.

Remaining out of scope for the protocol layer: key compromise (A2), application-logic bugs in the
integrator's state machine (A3 covers determinism, not correctness), and total failure of the
underlying chain (A1).

## Assumptions and constraints

Sections 4 through 8 are the normative system assumptions. They are constraints on every safety, liveness,
availability, and recovery claim in the specification: a live final chain, an honest chain view, protected
keys, at least one responsive honest participant or delegated watchtower where required, deterministic replay,
and deployment sizes/timing within supported bounds. Mechanism documents may narrow these conditions but may
not silently strengthen them. Unsupported all-Byzantine, permanently partitioned, or no-chain-view operation
must fail explicitly rather than be described as safe.

## Security considerations

This document is the security-assumption owner. Reviews must distinguish enforced properties from operational
trust, subjective observations from slashable facts, and safety from liveness. The threat model covers
Byzantine peers, dishonest RPCs, unavailable participants, topology control, censorship/delay, compromised
keys, invalid integrator logic, resource exhaustion, and chain failure. For each threat, the owning mechanism
must identify prevention, detection, recovery, and residual exposure; an unowned threat is an audit gap.

## Requirements and invariants

**[`INV-TRUST-1-6TYWDH`](trust-model.md#inv-trust-1-6tywdh).** Safety-relevant disagreements resolvable on-chain from objective inputs alone.

**[`REQ-TRUST-1-K5PS99`](trust-model.md#req-trust-1-k5ps99).** Enforcement uses only objective on-chain claims; subjective input never slashable.

**[`REQ-TRUST-2-X8GCZ7`](trust-model.md#req-trust-2-x8gcz7).** At least one available, honest RPC connection required; redundancy helps availability but does not remove the assumption.

**[`REQ-TRUST-3-3YWEZR`](trust-model.md#req-trust-3-3ywezr).** At least one non-Byzantine participant per channel; all-Byzantine channels have no safety.

**[`REQ-TRUST-4-KW24NF`](trust-model.md#req-trust-4-kw24nf).** Continuous availability required for offline honest participants: a node holding the participant's key stays online; keyless third parties are limited to fraud-proof kills; no delegate mechanism exists in version one.

**[`REQ-TRUST-5-NDVRW8`](trust-model.md#req-trust-5-ndvrw8).** Full-mesh topology; target is many small channels (≤ ~10, commonly 6).

**<a id="req-trust-6-z586t0"></a>`REQ-TRUST-6-Z586T0`.** Temporary assumption A9: peer authentication assumes no on-path adversary; identity-dependent guarantees are conditional until the handshake binds identities and session.

## Verification and test plan

- **Assumption-violation tests:** each assumption A1–A9 requires at least one test or documented
  argument showing what fails when it is violated, including partitioned-network,
  absent-participant, RPC-failure, delegated-monitor, and relay/reflection scenarios.
- **Objective-only enforcement:** black-box adjudication tests must show that no slashing path
  consumes non-objective input ([`REQ-TRUST-1-K5PS99`](trust-model.md#req-trust-1-k5ps99)).
- **Topology:** performance evidence for the target channel sizes (≤ ~10) rather than
  extrapolation.

### Requirement test matrix

Each row is a planned black-box test obligation, not an additional specification requirement. The requirement remains the authority. Execute the row through public protocol inputs from every applicable pre-state defined by this document. Every required permutation has a stable `P1`…`PN` suffix under its plan item. The list is exhaustive unless it explicitly says that boundary or pairwise representatives are sufficient; an omitted permutation needs an engineer-approved rationale.

| Plan item                                                 | Requirements / invariants                                 | Setup and stimulus                                                                                                                                    | Expected result                                                                                                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-trust-1-6tywdh.t1"></a>`INV-TRUST-1-6TYWDH.T1` | [`INV-TRUST-1-6TYWDH`](trust-model.md#inv-trust-1-6tywdh) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Safety-relevant disagreements resolvable on-chain from objective inputs alone.                                                                                             | <a id="inv-trust-1-6tywdh.t1.p1"></a>`INV-TRUST-1-6TYWDH.T1.P1` — valid case<br><a id="inv-trust-1-6tywdh.t1.p3"></a>`INV-TRUST-1-6TYWDH.T1.P3` — direct invalid/opposite case<br><a id="inv-trust-1-6tywdh.t1.p2"></a>`INV-TRUST-1-6TYWDH.T1.P2` — zero/empty/no-op case<br><a id="inv-trust-1-6tywdh.t1.p4"></a>`INV-TRUST-1-6TYWDH.T1.P4` — exact boundary<br><a id="inv-trust-1-6tywdh.t1.p5"></a>`INV-TRUST-1-6TYWDH.T1.P5` — failure and recovery<br><a id="inv-trust-1-6tywdh.t1.p6"></a>`INV-TRUST-1-6TYWDH.T1.P6` — relevant race                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| <a id="req-trust-1-k5ps99.t1"></a>`REQ-TRUST-1-K5PS99.T1` | [`REQ-TRUST-1-K5PS99`](trust-model.md#req-trust-1-k5ps99) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Enforcement uses only objective on-chain claims; subjective input never slashable.                                                                                         | <a id="req-trust-1-k5ps99.t1.p1"></a>`REQ-TRUST-1-K5PS99.T1.P1` — valid case<br><a id="req-trust-1-k5ps99.t1.p3"></a>`REQ-TRUST-1-K5PS99.T1.P3` — direct invalid/opposite case<br><a id="req-trust-1-k5ps99.t1.p2"></a>`REQ-TRUST-1-K5PS99.T1.P2` — new participant<br><a id="req-trust-1-k5ps99.t1.p4"></a>`REQ-TRUST-1-K5PS99.T1.P4` — existing participant<br><a id="req-trust-1-k5ps99.t1.p5"></a>`REQ-TRUST-1-K5PS99.T1.P5` — removed participant<br><a id="req-trust-1-k5ps99.t1.p6"></a>`REQ-TRUST-1-K5PS99.T1.P6` — slashed participant<br><a id="req-trust-1-k5ps99.t1.p7"></a>`REQ-TRUST-1-K5PS99.T1.P7` — concurrent membership change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| <a id="req-trust-2-x8gcz7.t1"></a>`REQ-TRUST-2-X8GCZ7.T1` | [`REQ-TRUST-2-X8GCZ7`](trust-model.md#req-trust-2-x8gcz7) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | At least one available, honest RPC connection required; redundancy helps availability but does not remove the assumption.                                                  | <a id="req-trust-2-x8gcz7.t1.p1"></a>`REQ-TRUST-2-X8GCZ7.T1.P1` — valid case<br><a id="req-trust-2-x8gcz7.t1.p3"></a>`REQ-TRUST-2-X8GCZ7.T1.P3` — direct invalid/opposite case<br><a id="req-trust-2-x8gcz7.t1.p2"></a>`REQ-TRUST-2-X8GCZ7.T1.P2` — new participant<br><a id="req-trust-2-x8gcz7.t1.p4"></a>`REQ-TRUST-2-X8GCZ7.T1.P4` — existing participant<br><a id="req-trust-2-x8gcz7.t1.p5"></a>`REQ-TRUST-2-X8GCZ7.T1.P5` — removed participant<br><a id="req-trust-2-x8gcz7.t1.p6"></a>`REQ-TRUST-2-X8GCZ7.T1.P6` — slashed participant<br><a id="req-trust-2-x8gcz7.t1.p7"></a>`REQ-TRUST-2-X8GCZ7.T1.P7` — concurrent membership change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| <a id="req-trust-3-3ywezr.t1"></a>`REQ-TRUST-3-3YWEZR.T1` | [`REQ-TRUST-3-3YWEZR`](trust-model.md#req-trust-3-3ywezr) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | At least one non-Byzantine participant per channel; all-Byzantine channels have no safety.                                                                             | <a id="req-trust-3-3ywezr.t1.p1"></a>`REQ-TRUST-3-3YWEZR.T1.P1` — valid case<br><a id="req-trust-3-3ywezr.t1.p4"></a>`REQ-TRUST-3-3YWEZR.T1.P4` — direct invalid/opposite case<br><a id="req-trust-3-3ywezr.t1.p2"></a>`REQ-TRUST-3-3YWEZR.T1.P2` — correct identity/signature<br><a id="req-trust-3-3ywezr.t1.p5"></a>`REQ-TRUST-3-3YWEZR.T1.P5` — wrong identity/signature<br><a id="req-trust-3-3ywezr.t1.p6"></a>`REQ-TRUST-3-3YWEZR.T1.P6` — missing identity/signature<br><a id="req-trust-3-3ywezr.t1.p7"></a>`REQ-TRUST-3-3YWEZR.T1.P7` — duplicate identity/signature<br><a id="req-trust-3-3ywezr.t1.p8"></a>`REQ-TRUST-3-3YWEZR.T1.P8` — forged identity/signature<br><a id="req-trust-3-3ywezr.t1.p9"></a>`REQ-TRUST-3-3YWEZR.T1.P9` — membership boundary<br><a id="req-trust-3-3ywezr.t1.p3"></a>`REQ-TRUST-3-3YWEZR.T1.P3` — malformed input<br><a id="req-trust-3-3ywezr.t1.p10"></a>`REQ-TRUST-3-3YWEZR.T1.P10` — adversarial input<br><a id="req-trust-3-3ywezr.t1.p11"></a>`REQ-TRUST-3-3YWEZR.T1.P11` — partial failure<br><a id="req-trust-3-3ywezr.t1.p12"></a>`REQ-TRUST-3-3YWEZR.T1.P12` — retry and recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| <a id="req-trust-4-kw24nf.t1"></a>`REQ-TRUST-4-KW24NF.T1` | [`REQ-TRUST-4-KW24NF`](trust-model.md#req-trust-4-kw24nf) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Watchtower/delegate required for offline honest participants, with stated data, privacy, availability, authorization, timeout, and failure assumptions.                    | <a id="req-trust-4-kw24nf.t1.p1"></a>`REQ-TRUST-4-KW24NF.T1.P1` — valid case<br><a id="req-trust-4-kw24nf.t1.p6"></a>`REQ-TRUST-4-KW24NF.T1.P6` — direct invalid/opposite case<br><a id="req-trust-4-kw24nf.t1.p2"></a>`REQ-TRUST-4-KW24NF.T1.P2` — correct identity/signature<br><a id="req-trust-4-kw24nf.t1.p7"></a>`REQ-TRUST-4-KW24NF.T1.P7` — wrong identity/signature<br><a id="req-trust-4-kw24nf.t1.p8"></a>`REQ-TRUST-4-KW24NF.T1.P8` — missing identity/signature<br><a id="req-trust-4-kw24nf.t1.p9"></a>`REQ-TRUST-4-KW24NF.T1.P9` — duplicate identity/signature<br><a id="req-trust-4-kw24nf.t1.p10"></a>`REQ-TRUST-4-KW24NF.T1.P10` — forged identity/signature<br><a id="req-trust-4-kw24nf.t1.p11"></a>`REQ-TRUST-4-KW24NF.T1.P11` — membership boundary<br><a id="req-trust-4-kw24nf.t1.p3"></a>`REQ-TRUST-4-KW24NF.T1.P3` — before deadline<br><a id="req-trust-4-kw24nf.t1.p12"></a>`REQ-TRUST-4-KW24NF.T1.P12` — at deadline<br><a id="req-trust-4-kw24nf.t1.p13"></a>`REQ-TRUST-4-KW24NF.T1.P13` — after deadline<br><a id="req-trust-4-kw24nf.t1.p14"></a>`REQ-TRUST-4-KW24NF.T1.P14` — maximum honest skew<br><a id="req-trust-4-kw24nf.t1.p4"></a>`REQ-TRUST-4-KW24NF.T1.P4` — malformed input<br><a id="req-trust-4-kw24nf.t1.p15"></a>`REQ-TRUST-4-KW24NF.T1.P15` — adversarial input<br><a id="req-trust-4-kw24nf.t1.p16"></a>`REQ-TRUST-4-KW24NF.T1.P16` — partial failure<br><a id="req-trust-4-kw24nf.t1.p17"></a>`REQ-TRUST-4-KW24NF.T1.P17` — retry and recovery<br><a id="req-trust-4-kw24nf.t1.p5"></a>`REQ-TRUST-4-KW24NF.T1.P5` — static review of named alternatives<br><a id="req-trust-4-kw24nf.t1.p18"></a>`REQ-TRUST-4-KW24NF.T1.P18` — omitted category<br><a id="req-trust-4-kw24nf.t1.p19"></a>`REQ-TRUST-4-KW24NF.T1.P19` — changed assumption |
| <a id="req-trust-5-ndvrw8.t1"></a>`REQ-TRUST-5-NDVRW8.T1` | [`REQ-TRUST-5-NDVRW8`](trust-model.md#req-trust-5-ndvrw8) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Full-mesh topology; target is many small channels (≤ ~10, commonly 6).                                                                                                   | <a id="req-trust-5-ndvrw8.t1.p1"></a>`REQ-TRUST-5-NDVRW8.T1.P1` — valid case<br><a id="req-trust-5-ndvrw8.t1.p3"></a>`REQ-TRUST-5-NDVRW8.T1.P3` — direct invalid/opposite case<br><a id="req-trust-5-ndvrw8.t1.p2"></a>`REQ-TRUST-5-NDVRW8.T1.P2` — zero/empty/no-op case<br><a id="req-trust-5-ndvrw8.t1.p4"></a>`REQ-TRUST-5-NDVRW8.T1.P4` — exact boundary<br><a id="req-trust-5-ndvrw8.t1.p5"></a>`REQ-TRUST-5-NDVRW8.T1.P5` — failure and recovery<br><a id="req-trust-5-ndvrw8.t1.p6"></a>`REQ-TRUST-5-NDVRW8.T1.P6` — relevant race                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| <a id="req-trust-6-z586t0.t1"></a>`REQ-TRUST-6-Z586T0.T1` | [`REQ-TRUST-6-Z586T0`](trust-model.md#req-trust-6-z586t0) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Temporary assumption A9: peer authentication assumes no on-path adversary; identity-dependent guarantees are conditional until the handshake binds identities and session. | <a id="req-trust-6-z586t0.t1.p1"></a>`REQ-TRUST-6-Z586T0.T1.P1` — valid case<br><a id="req-trust-6-z586t0.t1.p3"></a>`REQ-TRUST-6-Z586T0.T1.P3` — direct invalid/opposite case<br><a id="req-trust-6-z586t0.t1.p2"></a>`REQ-TRUST-6-Z586T0.T1.P2` — correct identity/signature<br><a id="req-trust-6-z586t0.t1.p4"></a>`REQ-TRUST-6-Z586T0.T1.P4` — wrong identity/signature<br><a id="req-trust-6-z586t0.t1.p5"></a>`REQ-TRUST-6-Z586T0.T1.P5` — missing identity/signature<br><a id="req-trust-6-z586t0.t1.p6"></a>`REQ-TRUST-6-Z586T0.T1.P6` — duplicate identity/signature<br><a id="req-trust-6-z586t0.t1.p7"></a>`REQ-TRUST-6-Z586T0.T1.P7` — forged identity/signature<br><a id="req-trust-6-z586t0.t1.p8"></a>`REQ-TRUST-6-Z586T0.T1.P8` — membership boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Future Work

_Non-normative._

- **Light-client / self-verifying chain access.** Reduce reliance on third-party RPC providers by
  verifying chain data client-side. Any such design must still define how the client obtains
  trustworthy consensus or validator-set information; it moves the trust assumption, it does not
  delete it.
- **Multi-provider RPC redundancy** with cross-checking and failover as an availability
  improvement below the light-client bar.
- **Private, anonymous, randomly sampled watchtowers** among a participant's trusted peers. The
  intended deterrent is attacker uncertainty about whether an offline participant is being
  monitored. Any proposal must quantify its security assumptions, protect user privacy, and
  preserve the on-chain safety fallback. Design constraints any concrete watchtower must specify:
  **data availability** (the delegate has or can fetch the channel data needed to construct
  contests — block history, signatures, state proofs, auditing data); **privacy** (what the
  delegate learns of channel contents); **availability** (the delegate stays online through the
  windows; a delegate outage recreates the original problem); **authorization** (which actions
  with which key material — contest-capable but not funds-controlling is the target shape, and
  requires the delegated-contest protocol change tracked in the open-questions register);
  **timeouts** (the delegate acts within the same on-chain windows,
  [../protocol/disputes.md](../disputes/disputes.md), [../protocol/time.md](../protocol-model/time.md));
  **failure** (the participant's exposure if the delegate fails, and how failure is detected).
- **Non-authoritative reputation** to help peers choose cooperative counterparties. Must never
  become slashable evidence or change objective enforcement ([`REQ-TRUST-1-K5PS99`](trust-model.md#req-trust-1-k5ps99)).
- **Alternative network topologies**, only if target use cases require larger channels; define
  security, liveness, privacy, and complexity trade-offs before adoption.
