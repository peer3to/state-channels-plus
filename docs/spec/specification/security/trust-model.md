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
| A7  | **Honest authority path per channel.**                                                                                    | At least one threshold-required peer in each channel has an honest full chosen authority path: the peer alone when towerless, or the peer and its frozen selected tower when it delegates (§6).                                                                                                                                                                                                                                                                                                                                                      |
| A8  | **Watchtower for offline participants.**                                                                                  | An honest participant that may go offline has a continuously available delegate that can monitor and contest on its behalf (§7).                                                                                                                                                                                                                                                                                                                                                                                                                     |
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

**<a id="req-trust-3-3ywezr"></a>`REQ-TRUST-3-3YWEZR`.** The protocol assumes, in each channel, at least one threshold-required
peer whose **full chosen authority path** is honest: the peer alone when it is towerless, or the
peer **and** its frozen selected tower when it delegates — selection is the peer's voluntary
trust decision, the tower joins the peer's trusted signing authority for delegated credit rather
than being a separate protocol-level honesty assumption, and a self-run tower carries the same
peer trust assumption. This does not require every participant-and-tower pair to be honest or
any tower to receive independent trust. **If no threshold-required peer has an honest full
authority path — every participant Byzantine, or every honest participant's chosen tower able
and willing to supply its credit fraudulently — the trust assumption provides no safety for that
channel**: colluding authorities who control a complete effective-credit set can finalize any
state their signatures can produce, the chain cannot distinguish unanimous fraud from unanimous
agreement, and conflicting same-fork settlements follow ordinary settlement order
([`INV-WT-1-ST9SHX`](../runtime/watchtowers.md#inv-wt-1-st9shx)). This limitation is fundamental
to the design and MUST be stated wherever the P2P security model is summarized.

Consequences an integrator must accept:

- The protocol protects a peer whose full chosen authority path is honest — the peer alone when
  towerless, the peer and its frozen selected tower when it delegates — against any coalition of
  the other authorities; it does not protect an absent stake-holder against a fully colluding
  authority set (see also the channel-balance invariant for late joiners,
  [../protocol/cross-layer-messages.md](../settlement/cross-layer-messages.md)).
- Honest-majority is NOT required; one peer with an honest full authority path, chain access
  (A6), and enough time (A4, dispute windows) suffices to enforce its rights.

## 7. Watchtower requirement for offline participants

An honest participant enforces its own rights: it must observe on-chain actions (disputes,
calldata posts, snapshot updates) and contest invalid ones within the protocol windows. A
participant that is offline through a contest window cannot do this, and the protocol does not
pause for it.

**<a id="req-trust-4-kw24nf"></a>`REQ-TRUST-4-KW24NF`.** Version one REQUIRES a watchtower or equivalent continuously available delegate
for any honest participant that may go offline during a contest window. The delegate MUST be able
to monitor the channel, detect an invalid on-chain action, contest it within the required window,
and invoke the available enforcement or slashing mechanism.

The concrete version-one design is the **selected watchtower** of
[../runtime/watchtowers.md](../runtime/watchtowers.md): a participant may bind one bonded tower
on-chain ([`REQ-WT-1-TXW328`](../runtime/watchtowers.md#req-wt-1-txw328)). The tower's
per-participant authority covers `AfkAttestation` non-receipt statements, audited dispute approvals, and delegated
dispute submission for its own participant
([`REQ-WT-9-GKFQXZ`](../runtime/watchtowers.md#req-wt-9-gkfqxz)); its block acknowledgements are
validated as ordinary block-confirmation signatures, where one shared-tower signature counts once
for **every** eligible assigned participant in the threshold calculation and may satisfy the
threshold alone ([`REQ-WT-3-DT0GDX`](../runtime/watchtowers.md#req-wt-3-dt0gdx)). Everything else a
watchtower does — observing disputes and killing invalid ones — stays permissionless and needs no
selection ([`REQ-WT-2-HNZA3Y`](../runtime/watchtowers.md#req-wt-2-hnza3y)). The role's sub-assumptions, each
of which MUST be specified for any concrete watchtower design, are answered by that model:

- **Data availability:** the tower obtains its participant's available history while the
  participant is online and maintains its own dial-out spectator connections into the channel
  mesh, so observation does not depend on the participant's availability; peers that refuse
  off-chain delivery route the data through the dispute game's on-chain path
  ([`REQ-WT-2-HNZA3Y`](../runtime/watchtowers.md#req-wt-2-hnza3y)).
- **Privacy:** a selected tower learns the channel content it spectates — the same view as a
  spectator. The on-chain binding reveals which key serves a participant but exposes no dialable
  endpoint; third parties cannot reach the tower from the assignment alone
  ([`REQ-WT-5-T5ZFTZ`](../runtime/watchtowers.md#req-wt-5-t5zftz)).
- **Availability:** selection is a real availability trust choice. A participant may self-host the
  tower as redundant infrastructure under its own control or select an external provider, and may
  replace it only while participating in no channel; a tower slashed mid-channel keeps its
  authority and duties for that channel's full lifetime. A fully unavailable tower cannot sign any
  delegated artifact and only degrades the service to the ordinary fallback path.
- **Authorization:** selected-tower signatures carry the defined availability acknowledgements,
  absence attestations, and exact-timeout-dispute approvals
  ([`REQ-WT-3-DT0GDX`](../runtime/watchtowers.md#req-wt-3-dt0gdx)), and the tower is additionally
  its participant's authorized dispute representative: a valid delegated submission is the
  participant's own dispute or counter-dispute, first-ordered transaction winning the one slot
  ([`REQ-WT-9-GKFQXZ`](../runtime/watchtowers.md#req-wt-9-gkfqxz)). Delegation never grants
  exclusive fraud-kill authority, never lets the tower author ordinary channel blocks or
  originate state transitions — though a valid tower confirmation of another author's exact block
  supplies the assigned participant's ordinary block vote
  ([`REQ-WT-4-PNMYMP`](../runtime/watchtowers.md#req-wt-4-pnmymp)) — and never carries
  participant-owned voluntary effects; the participant's funds-controlling key stays with the
  participant. The authorization question is resolved for this version
  ([`OQ-43-HWRTNF`](../open-questions.md#oq-43-hwrtnf), resolved;
  [`OQ-46-ZXR2V3`](../open-questions.md#oq-46-zxr2v3), resolved).
- **Timeouts:** the tower acts within the same on-chain windows as the participant
  ([../disputes/disputes.md](../disputes/disputes.md), [../protocol-model/time.md](../protocol-model/time.md));
  the agreement window is additionally the delegated-delivery reliability boundary
  ([`REQ-WT-4-PNMYMP`](../runtime/watchtowers.md#req-wt-4-pnmymp)).
- **Failure:** the exposures are stated per power. A valid tower confirmation supplies the
  assigned participant's ordinary block vote after every non-subjective validation — normal
  validation still rejects an invalid block — may complete ordinary block finality (under the
  shared-tower rule one tower signature may complete the whole threshold), and — before calldata,
  or after calldata when the participant is not the next author — leads an available assigned
  participant to add its own additive confirmation after validation, while a tower-credited next
  author emits no redundant signature after calldata. The vote carries the same non-equivocation
  premise as a participant signature: a tower confirming two distinct blocks at the same channel,
  fork, and height commits objective equivocation and loses its permanent bond
  ([`INV-WT-1-ST9SHX`](../runtime/watchtowers.md#inv-wt-1-st9shx)). The participant accepts this
  delegated finality exposure through its frozen tower choice. A valid tower approval is the selected
  participant's final delegated audit for that dispute: it finalizes the complete dispute output
  with no later kill-period challenge, even against colluding remaining peers and a malicious
  selected tower ([`REQ-DIS-14-032T4M`](../disputes/disputes.md#req-dis-14-032t4m)). A valid
  selected-tower AFK attestation is delegated authority to treat the author's block as unavailable
  to its tower by the deadline and waive that participant's calldata fallback for its slot,
  including calldata already posted by the time of timeout upload — the protocol cannot objectively
  order off-chain tower evidence against calldata. The exposure requires a tower that can attest: a
  malicious tower, or one partitioned from its author but reachable by the disputing side, can
  cause an otherwise compliant participant to be timed out; a fully unavailable tower cannot sign
  an attestation and only degrades to the ordinary fallback. An accepted delegated dispute
  submission carries the participant's full dispute-game exposure, so tower misuse of that
  authority is likewise a service failure inside the selection boundary with no protocol
  compensation. The participant's remedy is its prior
  tower choice, any later objective equivocation evidence
  ([`INV-WT-1-ST9SHX`](../runtime/watchtowers.md#inv-wt-1-st9shx)), and replacement after it
  leaves active channels.

A participant may also join **without** a selected tower and remain on the existing protocol path
unchanged: no delegated receipt, AFK attestation, or signature substitution exists for it, no other
actor may remove its threshold role or attest absence on its behalf, and it must stay available to
defend itself through the full fallback windows
([`REQ-WT-7-EF48M3`](../runtime/watchtowers.md#req-wt-7-ef48m3)). Counterparties may independently
decline future channels with participants that provide no tower-backed liveness guarantee; that is
subjective policy with no objective protocol effect.

Tower misconduct is punishable only when objectively contradictory: a valid contradiction proof
over the tower's **own** signed operations — a participant's signature or conduct is never fraud
evidence against its tower — submitted by any observer through a punishment entry point separate
from the channel protocol, destroys the tower identity's permanent registration bond and bars it
from future selection, without touching any existing channel's assignment, disputes, or settlement
([`REQ-WT-8-W3YP4R`](../runtime/watchtowers.md#req-wt-8-w3yp4r)). Every failure that produces no
accepted delegated artifact — silence, refusal, late delivery — is subjective non-cooperation with
no protocol penalty, no bond effect, no threshold effect, and no current-channel outcome effect; an
_accepted_ valid receipt, attestation, or approval keeps exactly the channel effect the dispute
rules define, even when issuing it was itself a service failure. The receipt arrival cutoff is
such a duty: a `BlockConfirmationReceipt` carries no arrival time and cannot prove when the block
first reached the tower, so a validly bound receipt over an in-range block signed after a late
first arrival keeps every credit, threshold, forfeiture, and timeout-kill effect, and consumers
must not reject it on believed lateness — the violation stays subjective unless the signature
also forms an objective contradiction pair. The bond is a one-time,
permanently non-withdrawable Sybil cost, resolved at [`OQ-47-QMYM54`](../open-questions.md#oq-47-qmym54);
the shape decision that this selected-tower model resolves is recorded at
[`OQ-44-3Y5MD7`](../open-questions.md#oq-44-3y5md7).

**Required verification:** offline-participant tests (honest participant
offline while a counterparty submits an invalid dispute/timeout; delegate contests in time) and
collusion tests (remaining participants collude against the offline participant) — required downstream coverage, now
planned as the watchtower and delegated-evidence matrices
([../runtime/watchtowers.md](../runtime/watchtowers.md),
[../disputes/disputes.md](../disputes/disputes.md)).

## 8. Topology limits

**<a id="req-trust-5-ndvrw8"></a>`REQ-TRUST-5-NDVRW8`.** The design targets many SMALL channels, not large ones. For the
intended poker use case a channel of up to roughly ten participants — commonly six — is an
acceptable fit for the full mesh. The protocol MUST NOT be presented as suitable for very large
participant sets under this full-mesh topology.

## 9. Threat model

| Threat                               | Defense                                                                                                                                                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid state transition             | Deterministic on-chain re-execution via `BlockInvalidStateTransition` fraud proof → author slashed.                                                                                                                                                 |
| Equivocation / double-signing        | `BlockDoubleSign` fraud proof over two conflicting signed blocks → slash.                                                                                                                                                                           |
| Forged history                       | `WrongGenesis`, `InvalidTimestamp`, `ForgedInboundMessageBlock` fraud proofs reject blocks chaining from bad genesis, violating timing rules, or citing non-persisted inbound messages.                                                             |
| Unavailability / griefing by silence | Deterministic author timeouts feed the dispute game; the channel progresses without the silent participant ([../protocol/disputes.md](../disputes/disputes.md)).                                                                                    |
| Fraudulent disputes                  | Fraud-proof claims disprove disputes claiming a non-latest state, bad output, invalid state proof, broken balance invariant, or unjustified timeout.                                                                                                |
| Spam / bogus proofs                  | Non-overwritable block-calldata commitments, the dispute-window kill period, and self-slashing of submitters of invalid proofs. Rate limiting at the P2P layer is NOT designed yet — see [security-assessment](../../audit/security-assessment.md). |
| Value creation / theft               | Balance-algebra underflow rejection, settlement capped at deposits, `DisputeInvalidBalanceInvariant` on-chain.                                                                                                                                      |

The table defines required defense categories; it does not by itself prove that every objectively
provable violation is covered. Fraud-proof completeness therefore remains an explicit audit claim.

Remaining out of scope for the protocol layer: key compromise (A2), application-logic bugs in the
integrator's state machine (A3 covers determinism, not correctness), and total failure of the
underlying chain (A1).

## Assumptions and constraints

Sections 4 through 8 are the normative system assumptions. They are constraints on every safety, liveness,
availability, and recovery claim in the specification: a live final chain, an honest chain view, protected
keys, at least one responsive threshold-required peer whose full chosen authority path is honest
(the peer alone when towerless, the peer and its selected watchtower when it delegates), deterministic replay,
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

**[`REQ-TRUST-3-3YWEZR`](trust-model.md#req-trust-3-3ywezr).** At least one threshold-required peer with an honest full chosen authority path (peer alone when towerless; peer plus selected tower when delegating); channels without one have no safety.

**[`REQ-TRUST-4-KW24NF`](trust-model.md#req-trust-4-kw24nf).** Watchtower/delegate required for offline honest participants, with stated data, privacy, availability, authorization, timeout, and failure assumptions.

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

| Plan item                                                 | Requirements / invariants                                 | Setup and stimulus                                                                                                                                                                                                                                                       | Expected result                                                                                                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-trust-1-6tywdh.t1"></a>`INV-TRUST-1-6TYWDH.T1` | [`INV-TRUST-1-6TYWDH`](trust-model.md#inv-trust-1-6tywdh) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.                                                                                                                    | Safety-relevant disagreements resolvable on-chain from objective inputs alone.                                                                                             | <a id="inv-trust-1-6tywdh.t1.p1"></a>`INV-TRUST-1-6TYWDH.T1.P1` — valid case<br><a id="inv-trust-1-6tywdh.t1.p3"></a>`INV-TRUST-1-6TYWDH.T1.P3` — direct invalid/opposite case<br><a id="inv-trust-1-6tywdh.t1.p2"></a>`INV-TRUST-1-6TYWDH.T1.P2` — zero/empty/no-op case<br><a id="inv-trust-1-6tywdh.t1.p4"></a>`INV-TRUST-1-6TYWDH.T1.P4` — exact boundary<br><a id="inv-trust-1-6tywdh.t1.p5"></a>`INV-TRUST-1-6TYWDH.T1.P5` — failure and recovery<br><a id="inv-trust-1-6tywdh.t1.p6"></a>`INV-TRUST-1-6TYWDH.T1.P6` — relevant race                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| <a id="req-trust-1-k5ps99.t1"></a>`REQ-TRUST-1-K5PS99.T1` | [`REQ-TRUST-1-K5PS99`](trust-model.md#req-trust-1-k5ps99) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.                                                                                                                    | Enforcement uses only objective on-chain claims; subjective input never slashable.                                                                                         | <a id="req-trust-1-k5ps99.t1.p1"></a>`REQ-TRUST-1-K5PS99.T1.P1` — valid case<br><a id="req-trust-1-k5ps99.t1.p3"></a>`REQ-TRUST-1-K5PS99.T1.P3` — direct invalid/opposite case<br><a id="req-trust-1-k5ps99.t1.p2"></a>`REQ-TRUST-1-K5PS99.T1.P2` — new participant<br><a id="req-trust-1-k5ps99.t1.p4"></a>`REQ-TRUST-1-K5PS99.T1.P4` — existing participant<br><a id="req-trust-1-k5ps99.t1.p5"></a>`REQ-TRUST-1-K5PS99.T1.P5` — removed participant<br><a id="req-trust-1-k5ps99.t1.p6"></a>`REQ-TRUST-1-K5PS99.T1.P6` — slashed participant<br><a id="req-trust-1-k5ps99.t1.p7"></a>`REQ-TRUST-1-K5PS99.T1.P7` — concurrent membership change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| <a id="req-trust-2-x8gcz7.t1"></a>`REQ-TRUST-2-X8GCZ7.T1` | [`REQ-TRUST-2-X8GCZ7`](trust-model.md#req-trust-2-x8gcz7) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.                                                                                                                    | At least one available, honest RPC connection required; redundancy helps availability but does not remove the assumption.                                                  | <a id="req-trust-2-x8gcz7.t1.p1"></a>`REQ-TRUST-2-X8GCZ7.T1.P1` — valid case<br><a id="req-trust-2-x8gcz7.t1.p3"></a>`REQ-TRUST-2-X8GCZ7.T1.P3` — direct invalid/opposite case<br><a id="req-trust-2-x8gcz7.t1.p2"></a>`REQ-TRUST-2-X8GCZ7.T1.P2` — new participant<br><a id="req-trust-2-x8gcz7.t1.p4"></a>`REQ-TRUST-2-X8GCZ7.T1.P4` — existing participant<br><a id="req-trust-2-x8gcz7.t1.p5"></a>`REQ-TRUST-2-X8GCZ7.T1.P5` — removed participant<br><a id="req-trust-2-x8gcz7.t1.p6"></a>`REQ-TRUST-2-X8GCZ7.T1.P6` — slashed participant<br><a id="req-trust-2-x8gcz7.t1.p7"></a>`REQ-TRUST-2-X8GCZ7.T1.P7` — concurrent membership change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| <a id="req-trust-3-3ywezr.t1"></a>`REQ-TRUST-3-3YWEZR.T1` | [`REQ-TRUST-3-3YWEZR`](trust-model.md#req-trust-3-3ywezr) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals — the setup distinguishes a peer's full chosen authority path (towerless peer, or peer plus frozen selected tower). | At least one threshold-required peer with an honest full chosen authority path suffices for safety; a channel with no such peer has none.                                  | <a id="req-trust-3-3ywezr.t1.p1"></a>`REQ-TRUST-3-3YWEZR.T1.P1` — valid case<br><a id="req-trust-3-3ywezr.t1.p4"></a>`REQ-TRUST-3-3YWEZR.T1.P4` — direct invalid/opposite case<br><a id="req-trust-3-3ywezr.t1.p2"></a>`REQ-TRUST-3-3YWEZR.T1.P2` — correct identity/signature<br><a id="req-trust-3-3ywezr.t1.p5"></a>`REQ-TRUST-3-3YWEZR.T1.P5` — wrong identity/signature<br><a id="req-trust-3-3ywezr.t1.p6"></a>`REQ-TRUST-3-3YWEZR.T1.P6` — missing identity/signature<br><a id="req-trust-3-3ywezr.t1.p7"></a>`REQ-TRUST-3-3YWEZR.T1.P7` — duplicate identity/signature<br><a id="req-trust-3-3ywezr.t1.p8"></a>`REQ-TRUST-3-3YWEZR.T1.P8` — forged identity/signature<br><a id="req-trust-3-3ywezr.t1.p9"></a>`REQ-TRUST-3-3YWEZR.T1.P9` — membership boundary<br><a id="req-trust-3-3ywezr.t1.p3"></a>`REQ-TRUST-3-3YWEZR.T1.P3` — malformed input<br><a id="req-trust-3-3ywezr.t1.p10"></a>`REQ-TRUST-3-3YWEZR.T1.P10` — adversarial input<br><a id="req-trust-3-3ywezr.t1.p11"></a>`REQ-TRUST-3-3YWEZR.T1.P11` — partial failure<br><a id="req-trust-3-3ywezr.t1.p12"></a>`REQ-TRUST-3-3YWEZR.T1.P12` — retry and recovery<br><a id="req-trust-3-3ywezr.t1.p13"></a>`REQ-TRUST-3-3YWEZR.T1.P13` — honest towerless peer: one threshold-required towerless peer is honest and a second conflicting same-fork history cannot reach threshold<br><a id="req-trust-3-3ywezr.t1.p14"></a>`REQ-TRUST-3-3YWEZR.T1.P14` — honest peer with honest selected tower: the peer's full authority path is honest and a second conflicting same-fork history cannot reach threshold                                                                                                                                                                                                               |
| <a id="req-trust-4-kw24nf.t1"></a>`REQ-TRUST-4-KW24NF.T1` | [`REQ-TRUST-4-KW24NF`](trust-model.md#req-trust-4-kw24nf) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.                                                                                                                    | Watchtower/delegate required for offline honest participants, with stated data, privacy, availability, authorization, timeout, and failure assumptions.                    | <a id="req-trust-4-kw24nf.t1.p1"></a>`REQ-TRUST-4-KW24NF.T1.P1` — valid case<br><a id="req-trust-4-kw24nf.t1.p6"></a>`REQ-TRUST-4-KW24NF.T1.P6` — direct invalid/opposite case<br><a id="req-trust-4-kw24nf.t1.p2"></a>`REQ-TRUST-4-KW24NF.T1.P2` — correct identity/signature<br><a id="req-trust-4-kw24nf.t1.p7"></a>`REQ-TRUST-4-KW24NF.T1.P7` — wrong identity/signature<br><a id="req-trust-4-kw24nf.t1.p8"></a>`REQ-TRUST-4-KW24NF.T1.P8` — missing identity/signature<br><a id="req-trust-4-kw24nf.t1.p9"></a>`REQ-TRUST-4-KW24NF.T1.P9` — duplicate identity/signature<br><a id="req-trust-4-kw24nf.t1.p10"></a>`REQ-TRUST-4-KW24NF.T1.P10` — forged identity/signature<br><a id="req-trust-4-kw24nf.t1.p11"></a>`REQ-TRUST-4-KW24NF.T1.P11` — membership boundary<br><a id="req-trust-4-kw24nf.t1.p3"></a>`REQ-TRUST-4-KW24NF.T1.P3` — before deadline<br><a id="req-trust-4-kw24nf.t1.p12"></a>`REQ-TRUST-4-KW24NF.T1.P12` — at deadline<br><a id="req-trust-4-kw24nf.t1.p13"></a>`REQ-TRUST-4-KW24NF.T1.P13` — after deadline<br><a id="req-trust-4-kw24nf.t1.p14"></a>`REQ-TRUST-4-KW24NF.T1.P14` — maximum honest skew<br><a id="req-trust-4-kw24nf.t1.p4"></a>`REQ-TRUST-4-KW24NF.T1.P4` — malformed input<br><a id="req-trust-4-kw24nf.t1.p15"></a>`REQ-TRUST-4-KW24NF.T1.P15` — adversarial input<br><a id="req-trust-4-kw24nf.t1.p16"></a>`REQ-TRUST-4-KW24NF.T1.P16` — partial failure<br><a id="req-trust-4-kw24nf.t1.p17"></a>`REQ-TRUST-4-KW24NF.T1.P17` — retry and recovery<br><a id="req-trust-4-kw24nf.t1.p5"></a>`REQ-TRUST-4-KW24NF.T1.P5` — static review of named alternatives<br><a id="req-trust-4-kw24nf.t1.p18"></a>`REQ-TRUST-4-KW24NF.T1.P18` — omitted category<br><a id="req-trust-4-kw24nf.t1.p19"></a>`REQ-TRUST-4-KW24NF.T1.P19` — changed assumption |
| <a id="req-trust-5-ndvrw8.t1"></a>`REQ-TRUST-5-NDVRW8.T1` | [`REQ-TRUST-5-NDVRW8`](trust-model.md#req-trust-5-ndvrw8) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.                                                                                                                    | Full-mesh topology; target is many small channels (≤ ~10, commonly 6).                                                                                                     | <a id="req-trust-5-ndvrw8.t1.p1"></a>`REQ-TRUST-5-NDVRW8.T1.P1` — valid case<br><a id="req-trust-5-ndvrw8.t1.p3"></a>`REQ-TRUST-5-NDVRW8.T1.P3` — direct invalid/opposite case<br><a id="req-trust-5-ndvrw8.t1.p2"></a>`REQ-TRUST-5-NDVRW8.T1.P2` — zero/empty/no-op case<br><a id="req-trust-5-ndvrw8.t1.p4"></a>`REQ-TRUST-5-NDVRW8.T1.P4` — exact boundary<br><a id="req-trust-5-ndvrw8.t1.p5"></a>`REQ-TRUST-5-NDVRW8.T1.P5` — failure and recovery<br><a id="req-trust-5-ndvrw8.t1.p6"></a>`REQ-TRUST-5-NDVRW8.T1.P6` — relevant race                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| <a id="req-trust-6-z586t0.t1"></a>`REQ-TRUST-6-Z586T0.T1` | [`REQ-TRUST-6-Z586T0`](trust-model.md#req-trust-6-z586t0) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.                                                                                                                    | Temporary assumption A9: peer authentication assumes no on-path adversary; identity-dependent guarantees are conditional until the handshake binds identities and session. | <a id="req-trust-6-z586t0.t1.p1"></a>`REQ-TRUST-6-Z586T0.T1.P1` — valid case<br><a id="req-trust-6-z586t0.t1.p3"></a>`REQ-TRUST-6-Z586T0.T1.P3` — direct invalid/opposite case<br><a id="req-trust-6-z586t0.t1.p2"></a>`REQ-TRUST-6-Z586T0.T1.P2` — correct identity/signature<br><a id="req-trust-6-z586t0.t1.p4"></a>`REQ-TRUST-6-Z586T0.T1.P4` — wrong identity/signature<br><a id="req-trust-6-z586t0.t1.p5"></a>`REQ-TRUST-6-Z586T0.T1.P5` — missing identity/signature<br><a id="req-trust-6-z586t0.t1.p6"></a>`REQ-TRUST-6-Z586T0.T1.P6` — duplicate identity/signature<br><a id="req-trust-6-z586t0.t1.p7"></a>`REQ-TRUST-6-Z586T0.T1.P7` — forged identity/signature<br><a id="req-trust-6-z586t0.t1.p8"></a>`REQ-TRUST-6-Z586T0.T1.P8` — membership boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Future Work

_Non-normative._

- **Light-client / self-verifying chain access.** Reduce reliance on third-party RPC providers by
  verifying chain data client-side. Any such design must still define how the client obtains
  trustworthy consensus or validator-set information; it moves the trust assumption, it does not
  delete it.
- **Multi-provider RPC redundancy** with cross-checking and failover as an availability
  improvement below the light-client bar.
- **Private, anonymous, randomly sampled watchtowers** among a participant's trusted peers, as a
  complement to the normative selected-tower model (§7). Anonymous observation is unnecessary for
  permissionless fraud enforcement — any observer may already kill invalid on-chain actions — and
  it is not the authorization path for delegated receipts, attestations, or approvals, which
  require the participant's fixed selected tower. Its remaining value is classical monitoring with
  attacker uncertainty: peers protect each other, and an attacker cannot tell whether an extra
  watchtower exists. Any proposal must quantify its security assumptions, protect user privacy,
  and preserve the on-chain safety fallback.
- **Non-authoritative reputation** to help peers choose cooperative counterparties. Must never
  become slashable evidence or change objective enforcement ([`REQ-TRUST-1-K5PS99`](trust-model.md#req-trust-1-k5ps99)).
- **Alternative network topologies**, only if target use cases require larger channels; define
  security, liveness, privacy, and complexity trade-offs before adoption.
