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
counterparties is [Future Work](trust-model.md#future-work) and must not change enforcement.)

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
any tower to receive independent trust. Ordinary block finality now requires actual participant votes, with the single exception of the
AFK target's own tower-supplied credit on the exact restricted AFK block: an honest non-target
participant required on both certificates refuses conflicting votes and can block the competing
certificate. That protection does not extend to the case where the AFK target is the only honest
participant and their tower misses their block — colluding other peers plus the target-only exception
can permit competing certificates before settlement, protected only by first-settled checkpoint
order and the publication duty
([`REQ-WT-10-GNG79P`](../runtime/watchtowers.md#req-wt-10-gng79p),
[`REQ-LIF-2-Z3Z9Y3`](../settlement/lifecycle.md#req-lif-2-z3z9y3)). **If no threshold-required
peer has an honest full authority path, the trust assumption provides no safety for that
channel**: colluding authorities who control a complete vote set can finalize any state their
signatures can produce, and the chain cannot distinguish unanimous fraud from unanimous
agreement ([`INV-WT-1-ST9SHX`](../runtime/watchtowers.md#inv-wt-1-st9shx)). This limitation is fundamental
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
[../runtime/watchtowers.md](../runtime/watchtowers.md): a participant may select one bonded tower
in its accepted channel join, frozen per membership interval
([`REQ-WT-1-TXW328`](../runtime/watchtowers.md#req-wt-1-txw328)). The tower's
per-participant authority covers the restricted AFK removal block, audited dispute approvals, and
delegated dispute submission for its own participant
([`REQ-WT-9-GKFQXZ`](../runtime/watchtowers.md#req-wt-9-gkfqxz)); its block acknowledgements are
validated as ordinary block-confirmation signatures carrying **availability credits** — one
shared-tower signature counts once for every eligible assigned participant in the availability
calculation and may satisfy that threshold alone — while ordinary block and milestone finality
count actual participant votes, with the single AFK target-only exception
([`REQ-WT-3-DT0GDX`](../runtime/watchtowers.md#req-wt-3-dt0gdx),
[`REQ-FIN-7-RTZWQZ`](../protocol-model/finality.md#req-fin-7-rtzwqz)). Everything else a
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
  endpoint; third parties cannot reach the tower from the selection record alone
  ([`REQ-WT-5-T5ZFTZ`](../runtime/watchtowers.md#req-wt-5-t5zftz)).
- **Availability:** selection is a real availability trust choice. A participant may self-host the
  tower as redundant infrastructure under its own control or select an external provider; the
  binding is frozen per channel membership interval by the accepted join, and a different tower
  may be selected only by a later join (another channel, or a new membership interval after
  leaving). A tower slashed mid-interval keeps its
  authority and duties for that interval's full lifetime. A fully unavailable tower cannot sign any
  delegated artifact and only degrades the service to the ordinary fallback path.
- **Authorization:** selected-tower signatures carry the defined availability acknowledgements,
  the restricted AFK removal block, and exact-timeout-dispute approvals
  ([`REQ-WT-3-DT0GDX`](../runtime/watchtowers.md#req-wt-3-dt0gdx)), and the tower is additionally
  its participant's authorized dispute representative: a valid delegated submission is the
  participant's own dispute or counter-dispute, first-ordered transaction winning the one slot
  ([`REQ-WT-9-GKFQXZ`](../runtime/watchtowers.md#req-wt-9-gkfqxz)). The tower has no general
  transaction or block-authoring power: its only authoring authority is the one canonical
  restricted AFK removal of its own scheduled represented participant, whose valid signature acts
  as that block's author signature inside the restricted window
  ([`REQ-WT-2-HNZA3Y`](../runtime/watchtowers.md#req-wt-2-hnza3y)). Delegation never grants
  exclusive fraud-kill authority and never carries participant-owned voluntary effects; the
  participant's funds-controlling key stays with the participant. The authorization question is
  resolved for this version ([`OQ-43-HWRTNF`](../open-questions.md#oq-43-hwrtnf), resolved;
  [`OQ-46-ZXR2V3`](../open-questions.md#oq-46-zxr2v3), resolved;
  [`OQ-45-23GGV6`](../open-questions.md#oq-45-23ggv6), resolved).
- **Timeouts:** the tower acts within the same on-chain windows as the participant
  ([../disputes/disputes.md](../disputes/disputes.md), [../protocol-model/time.md](../protocol-model/time.md));
  the agreement window is additionally the delegated-delivery reliability boundary
  ([`REQ-WT-4-PNMYMP`](../runtime/watchtowers.md#req-wt-4-pnmymp)).
- **Failure:** the exposures are stated per power. A tower receipt supplies availability credit
  only — it never supplies an assigned peer's participant finality vote (a recovered signer that
  is itself a participant keeps its own vote — central key policy,
  [identity.md](../protocol-model/identity.md#identity)), so tower authority alone can never
  finalize a block; a frozen tower receipt establishes availability toward the represented side even when
  relay fails, and that peer bears the existing ordinary-timeout defense and penalty exposure —
  the protocol neither calls that penalty small, nor bounds it, nor turns a subjective selection
  or partition failure into objective tower fraud. A valid tower approval is the selected
  participant's final delegated audit for that dispute: it finalizes the complete dispute output
  with no later kill-period challenge, even against colluding remaining peers and a malicious
  selected tower ([`REQ-DIS-14-032T4M`](../disputes/disputes.md#req-dis-14-032t4m)). A valid
  restricted AFK block is delegated authority to remove the represented scheduled author when
  author-to-tower delivery failed, and the AFK-mode timeout it backs waives that participant's
  acknowledgement and calldata defenses in either posting order — the protocol cannot objectively
  order off-chain tower non-receipt against calldata. The exposure requires a tower that can
  author: a malicious tower, or one partitioned from its author but connected to the other peers,
  can produce a valid AFK block for an otherwise compliant participant; the removal is
  non-punitive, and a fully unavailable tower cannot author anything and only degrades to the
  ordinary fallback. An accepted delegated dispute submission carries the participant's full
  dispute-game exposure, so tower misuse of that authority is likewise a service failure inside
  the selection boundary with no protocol compensation. The participant's remedy is its prior
  tower choice, the disconnection-publication duty
  ([`REQ-WT-10-GNG79P`](../runtime/watchtowers.md#req-wt-10-gng79p)), any later objective
  contradiction evidence
  ([`INV-WT-1-ST9SHX`](../runtime/watchtowers.md#inv-wt-1-st9shx)), and replacement after it
  leaves active channels.

**Shared-tower trust concentration is a deliberate deployment choice, not a protocol defect.** A
selected tower holds real delegated authority for its participant: it may submit that
participant's dispute and provide the participant-side approval that can complete threshold
finalization of that exact dispute. When every participant in one channel selects the same tower,
every participant has deliberately placed that channel partition inside the same operator's trust
boundary for the tower's delegated dispute and removal powers. Tower selection stays optional and
permissionless — a participant may remain towerless, select another provider, or run its own
tower — and the concentration is scoped: compromise or failure of a shared tower affects only the
channels and membership intervals whose accepted joins selected it, and grants no authority over
unrelated channels and no global protocol authority.

A participant may also join **without** a selected tower and remain on the existing protocol path
unchanged: no delegated receipt, restricted AFK block, or signature substitution exists for it, no
other actor may remove its threshold role or author a removal on its behalf, it has no
tower-disconnection trigger or publication duty, and it must stay available to defend itself
through the full fallback windows
([`REQ-WT-7-EF48M3`](../runtime/watchtowers.md#req-wt-7-ef48m3)). Counterparties may independently
decline future channels with participants that provide no tower-backed liveness guarantee; that is
subjective policy with no objective protocol effect.

Tower misconduct is punishable only when objectively contradictory: a valid contradiction proof
over the tower's **own** signed operations — a participant's signature or conduct is never fraud
evidence against its tower — submitted by any observer through a punishment entry point separate
from the channel protocol, destroys the tower identity's permanent registration bond and bars it
from future selection, without touching any existing membership interval's binding, disputes, or settlement
([`REQ-WT-8-W3YP4R`](../runtime/watchtowers.md#req-wt-8-w3yp4r)). Every failure that produces no
accepted delegated artifact — silence, refusal, late delivery — is subjective non-cooperation with
no protocol penalty, no bond effect, no threshold effect, and no current-channel outcome effect; an
_accepted_ valid receipt, restricted AFK block, or approval keeps exactly the channel effect the
dispute rules define, even when issuing it was itself a service failure. The receipt arrival
cutoff is such a duty: a `BlockConfirmationReceipt` carries no arrival time and cannot prove when
the block first reached the tower, so a validly bound receipt over an in-range block signed after
a late first arrival keeps every availability, forfeiture, and ordinary-kill effect, and
consumers must not reject it on believed lateness — the violation stays subjective unless the
signature also forms an objective contradiction pair; the tower's AFK issuance duty is likewise
subjective, since an in-range AFK timestamp proves nothing about receipt or signing time. The bond is a one-time,
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

| Threat                                | Defense                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid state transition              | Deterministic on-chain re-execution via `BlockInvalidStateTransition` fraud proof → author slashed.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Equivocation / double-signing         | `BlockDoubleSign` fraud proof over two distinct same-height blocks with two explicit signatures recovering to the same participant key (any author or confirmation role) → full-stake slash; the **separately keyed** legal normal/AFK split carries no qualifying pair (a manually reused key falls under the ordinary same-key rule — central key policy, [identity.md](../protocol-model/identity.md#identity)), and unpaired conflicting commitments are the bounded residual of [`OQ-49-2Z3FAS`](../open-questions.md#oq-49-2z3fas). |
| Forged history                        | `WrongGenesis`, `InvalidTimestamp`, `ForgedInboundMessageBlock` fraud proofs reject blocks chaining from bad genesis, violating timing rules, or citing non-persisted inbound messages.                                                                                                                                                                                                                                                                                                                                                   |
| Unavailability / griefing by silence  | Deterministic author timeouts feed the dispute game; the channel progresses without the silent participant ([../protocol/disputes.md](../disputes/disputes.md)).                                                                                                                                                                                                                                                                                                                                                                          |
| Fraudulent disputes                   | Fraud-proof claims disprove disputes claiming a non-latest state, bad output, invalid state proof, broken balance invariant, or unjustified timeout.                                                                                                                                                                                                                                                                                                                                                                                      |
| Spam / bogus proofs                   | Non-overwritable block-calldata commitments, the dispute-window kill period, and self-slashing of submitters of invalid proofs. Rate limiting at the P2P layer is NOT designed yet — see [security-assessment](../../audit/security-assessment.md).                                                                                                                                                                                                                                                                                       |
| Value creation / theft                | Balance-algebra underflow rejection, settlement capped at deposits, `DisputeInvalidBalanceInvariant` on-chain.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Shared-watchtower trust concentration | Accepted deployment choice, not a defect: participants whose accepted joins select one shared tower jointly trust that operator for its delegated dispute and removal powers in that channel (§7). Alternatives are no tower, another provider, or a self-run tower; compromise or failure is scoped to the channels and membership intervals that selected the tower, never global authority. Objective tower equivocation still burns the bond ([`INV-WT-1-ST9SHX`](../runtime/watchtowers.md#inv-wt-1-st9shx)).                        |

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

| Plan item                                                 | Requirements / invariants                                 | Setup and stimulus                                                                                                                                                                                                                                                       | Expected result                                                                                                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="inv-trust-1-6tywdh.t1"></a>`INV-TRUST-1-6TYWDH.T1` | [`INV-TRUST-1-6TYWDH`](trust-model.md#inv-trust-1-6tywdh) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.                                                                                                                    | Safety-relevant disagreements resolvable on-chain from objective inputs alone.                                                                                             | <a id="inv-trust-1-6tywdh.t1.p1"></a>`INV-TRUST-1-6TYWDH.T1.P1` — valid case<br><a id="inv-trust-1-6tywdh.t1.p3"></a>`INV-TRUST-1-6TYWDH.T1.P3` — direct invalid/opposite case<br><a id="inv-trust-1-6tywdh.t1.p2"></a>`INV-TRUST-1-6TYWDH.T1.P2` — zero/empty/no-op case<br><a id="inv-trust-1-6tywdh.t1.p4"></a>`INV-TRUST-1-6TYWDH.T1.P4` — exact boundary<br><a id="inv-trust-1-6tywdh.t1.p5"></a>`INV-TRUST-1-6TYWDH.T1.P5` — failure and recovery<br><a id="inv-trust-1-6tywdh.t1.p6"></a>`INV-TRUST-1-6TYWDH.T1.P6` — relevant race                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| <a id="req-trust-1-k5ps99.t1"></a>`REQ-TRUST-1-K5PS99.T1` | [`REQ-TRUST-1-K5PS99`](trust-model.md#req-trust-1-k5ps99) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.                                                                                                                    | Enforcement uses only objective on-chain claims; subjective input never slashable.                                                                                         | <a id="req-trust-1-k5ps99.t1.p1"></a>`REQ-TRUST-1-K5PS99.T1.P1` — valid case<br><a id="req-trust-1-k5ps99.t1.p3"></a>`REQ-TRUST-1-K5PS99.T1.P3` — direct invalid/opposite case<br><a id="req-trust-1-k5ps99.t1.p2"></a>`REQ-TRUST-1-K5PS99.T1.P2` — new participant<br><a id="req-trust-1-k5ps99.t1.p4"></a>`REQ-TRUST-1-K5PS99.T1.P4` — existing participant<br><a id="req-trust-1-k5ps99.t1.p5"></a>`REQ-TRUST-1-K5PS99.T1.P5` — removed participant<br><a id="req-trust-1-k5ps99.t1.p6"></a>`REQ-TRUST-1-K5PS99.T1.P6` — slashed participant<br><a id="req-trust-1-k5ps99.t1.p7"></a>`REQ-TRUST-1-K5PS99.T1.P7` — concurrent membership change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| <a id="req-trust-2-x8gcz7.t1"></a>`REQ-TRUST-2-X8GCZ7.T1` | [`REQ-TRUST-2-X8GCZ7`](trust-model.md#req-trust-2-x8gcz7) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.                                                                                                                    | At least one available, honest RPC connection required; redundancy helps availability but does not remove the assumption.                                                  | <a id="req-trust-2-x8gcz7.t1.p1"></a>`REQ-TRUST-2-X8GCZ7.T1.P1` — valid case<br><a id="req-trust-2-x8gcz7.t1.p3"></a>`REQ-TRUST-2-X8GCZ7.T1.P3` — direct invalid/opposite case<br><a id="req-trust-2-x8gcz7.t1.p2"></a>`REQ-TRUST-2-X8GCZ7.T1.P2` — new participant<br><a id="req-trust-2-x8gcz7.t1.p4"></a>`REQ-TRUST-2-X8GCZ7.T1.P4` — existing participant<br><a id="req-trust-2-x8gcz7.t1.p5"></a>`REQ-TRUST-2-X8GCZ7.T1.P5` — removed participant<br><a id="req-trust-2-x8gcz7.t1.p6"></a>`REQ-TRUST-2-X8GCZ7.T1.P6` — slashed participant<br><a id="req-trust-2-x8gcz7.t1.p7"></a>`REQ-TRUST-2-X8GCZ7.T1.P7` — concurrent membership change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| <a id="req-trust-3-3ywezr.t1"></a>`REQ-TRUST-3-3YWEZR.T1` | [`REQ-TRUST-3-3YWEZR`](trust-model.md#req-trust-3-3ywezr) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals — the setup distinguishes a peer's full chosen authority path (towerless peer, or peer plus frozen selected tower). | At least one threshold-required peer with an honest full chosen authority path suffices for safety; a channel with no such peer has none.                                  | <a id="req-trust-3-3ywezr.t1.p1"></a>`REQ-TRUST-3-3YWEZR.T1.P1` — valid case<br><a id="req-trust-3-3ywezr.t1.p4"></a>`REQ-TRUST-3-3YWEZR.T1.P4` — direct invalid/opposite case<br><a id="req-trust-3-3ywezr.t1.p2"></a>`REQ-TRUST-3-3YWEZR.T1.P2` — correct identity/signature<br><a id="req-trust-3-3ywezr.t1.p5"></a>`REQ-TRUST-3-3YWEZR.T1.P5` — wrong identity/signature<br><a id="req-trust-3-3ywezr.t1.p6"></a>`REQ-TRUST-3-3YWEZR.T1.P6` — missing identity/signature<br><a id="req-trust-3-3ywezr.t1.p7"></a>`REQ-TRUST-3-3YWEZR.T1.P7` — duplicate identity/signature<br><a id="req-trust-3-3ywezr.t1.p8"></a>`REQ-TRUST-3-3YWEZR.T1.P8` — forged identity/signature<br><a id="req-trust-3-3ywezr.t1.p9"></a>`REQ-TRUST-3-3YWEZR.T1.P9` — membership boundary<br><a id="req-trust-3-3ywezr.t1.p3"></a>`REQ-TRUST-3-3YWEZR.T1.P3` — malformed input<br><a id="req-trust-3-3ywezr.t1.p10"></a>`REQ-TRUST-3-3YWEZR.T1.P10` — adversarial input<br><a id="req-trust-3-3ywezr.t1.p11"></a>`REQ-TRUST-3-3YWEZR.T1.P11` — partial failure<br><a id="req-trust-3-3ywezr.t1.p12"></a>`REQ-TRUST-3-3YWEZR.T1.P12` — retry and recovery<br><a id="req-trust-3-3ywezr.t1.p13"></a>`REQ-TRUST-3-3YWEZR.T1.P13` — honest towerless peer: one threshold-required towerless peer is honest and a second conflicting same-fork history cannot reach threshold<br><a id="req-trust-3-3ywezr.t1.p14"></a>`REQ-TRUST-3-3YWEZR.T1.P14` — honest peer with honest selected tower: the peer's full authority path is honest and a second conflicting same-fork history cannot reach threshold<br><a id="req-trust-3-3ywezr.t1.p15"></a>`REQ-TRUST-3-3YWEZR.T1.P15` — towers alone cannot finalize: with recovered tower signers that are not themselves channel participants, all towers together supply zero participant finality votes on a normal block and cannot fill another peer's AFK credit<br><a id="req-trust-3-3ywezr.t1.p16"></a>`REQ-TRUST-3-3YWEZR.T1.P16` — accepted pre-publication race: the AFK target is the only honest participant, colluding required peers support both histories, and their partitioned tower supplies their target-only AFK credit — run both settlement orders; the first settled exact checkpoint wins, no automatic target slash, no general tower finality, no later conflicting replacement, and no probability or one-round bound is claimed |
| <a id="req-trust-4-kw24nf.t1"></a>`REQ-TRUST-4-KW24NF.T1` | [`REQ-TRUST-4-KW24NF`](trust-model.md#req-trust-4-kw24nf) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.                                                                                                                    | Watchtower/delegate required for offline honest participants, with stated data, privacy, availability, authorization, timeout, and failure assumptions.                    | <a id="req-trust-4-kw24nf.t1.p1"></a>`REQ-TRUST-4-KW24NF.T1.P1` — valid case<br><a id="req-trust-4-kw24nf.t1.p6"></a>`REQ-TRUST-4-KW24NF.T1.P6` — direct invalid/opposite case<br><a id="req-trust-4-kw24nf.t1.p2"></a>`REQ-TRUST-4-KW24NF.T1.P2` — correct identity/signature<br><a id="req-trust-4-kw24nf.t1.p7"></a>`REQ-TRUST-4-KW24NF.T1.P7` — wrong identity/signature<br><a id="req-trust-4-kw24nf.t1.p8"></a>`REQ-TRUST-4-KW24NF.T1.P8` — missing identity/signature<br><a id="req-trust-4-kw24nf.t1.p9"></a>`REQ-TRUST-4-KW24NF.T1.P9` — duplicate identity/signature<br><a id="req-trust-4-kw24nf.t1.p10"></a>`REQ-TRUST-4-KW24NF.T1.P10` — forged identity/signature<br><a id="req-trust-4-kw24nf.t1.p11"></a>`REQ-TRUST-4-KW24NF.T1.P11` — membership boundary<br><a id="req-trust-4-kw24nf.t1.p3"></a>`REQ-TRUST-4-KW24NF.T1.P3` — before deadline<br><a id="req-trust-4-kw24nf.t1.p12"></a>`REQ-TRUST-4-KW24NF.T1.P12` — at deadline<br><a id="req-trust-4-kw24nf.t1.p13"></a>`REQ-TRUST-4-KW24NF.T1.P13` — after deadline<br><a id="req-trust-4-kw24nf.t1.p14"></a>`REQ-TRUST-4-KW24NF.T1.P14` — maximum honest skew<br><a id="req-trust-4-kw24nf.t1.p4"></a>`REQ-TRUST-4-KW24NF.T1.P4` — malformed input<br><a id="req-trust-4-kw24nf.t1.p15"></a>`REQ-TRUST-4-KW24NF.T1.P15` — adversarial input<br><a id="req-trust-4-kw24nf.t1.p16"></a>`REQ-TRUST-4-KW24NF.T1.P16` — partial failure<br><a id="req-trust-4-kw24nf.t1.p17"></a>`REQ-TRUST-4-KW24NF.T1.P17` — retry and recovery<br><a id="req-trust-4-kw24nf.t1.p5"></a>`REQ-TRUST-4-KW24NF.T1.P5` — static review of named alternatives<br><a id="req-trust-4-kw24nf.t1.p18"></a>`REQ-TRUST-4-KW24NF.T1.P18` — omitted category<br><a id="req-trust-4-kw24nf.t1.p19"></a>`REQ-TRUST-4-KW24NF.T1.P19` — changed assumption                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| <a id="req-trust-5-ndvrw8.t1"></a>`REQ-TRUST-5-NDVRW8.T1` | [`REQ-TRUST-5-NDVRW8`](trust-model.md#req-trust-5-ndvrw8) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.                                                                                                                    | Full-mesh topology; target is many small channels (≤ ~10, commonly 6).                                                                                                     | <a id="req-trust-5-ndvrw8.t1.p1"></a>`REQ-TRUST-5-NDVRW8.T1.P1` — valid case<br><a id="req-trust-5-ndvrw8.t1.p3"></a>`REQ-TRUST-5-NDVRW8.T1.P3` — direct invalid/opposite case<br><a id="req-trust-5-ndvrw8.t1.p2"></a>`REQ-TRUST-5-NDVRW8.T1.P2` — zero/empty/no-op case<br><a id="req-trust-5-ndvrw8.t1.p4"></a>`REQ-TRUST-5-NDVRW8.T1.P4` — exact boundary<br><a id="req-trust-5-ndvrw8.t1.p5"></a>`REQ-TRUST-5-NDVRW8.T1.P5` — failure and recovery<br><a id="req-trust-5-ndvrw8.t1.p6"></a>`REQ-TRUST-5-NDVRW8.T1.P6` — relevant race                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| <a id="req-trust-6-z586t0.t1"></a>`REQ-TRUST-6-Z586T0.T1` | [`REQ-TRUST-6-Z586T0`](trust-model.md#req-trust-6-z586t0) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.                                                                                                                    | Temporary assumption A9: peer authentication assumes no on-path adversary; identity-dependent guarantees are conditional until the handshake binds identities and session. | <a id="req-trust-6-z586t0.t1.p1"></a>`REQ-TRUST-6-Z586T0.T1.P1` — valid case<br><a id="req-trust-6-z586t0.t1.p3"></a>`REQ-TRUST-6-Z586T0.T1.P3` — direct invalid/opposite case<br><a id="req-trust-6-z586t0.t1.p2"></a>`REQ-TRUST-6-Z586T0.T1.P2` — correct identity/signature<br><a id="req-trust-6-z586t0.t1.p4"></a>`REQ-TRUST-6-Z586T0.T1.P4` — wrong identity/signature<br><a id="req-trust-6-z586t0.t1.p5"></a>`REQ-TRUST-6-Z586T0.T1.P5` — missing identity/signature<br><a id="req-trust-6-z586t0.t1.p6"></a>`REQ-TRUST-6-Z586T0.T1.P6` — duplicate identity/signature<br><a id="req-trust-6-z586t0.t1.p7"></a>`REQ-TRUST-6-Z586T0.T1.P7` — forged identity/signature<br><a id="req-trust-6-z586t0.t1.p8"></a>`REQ-TRUST-6-Z586T0.T1.P8` — membership boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

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
  it is not the authorization path for delegated receipts, restricted AFK blocks, or approvals, which
  require the participant's fixed selected tower. Its remaining value is classical monitoring with
  attacker uncertainty: peers protect each other, and an attacker cannot tell whether an extra
  watchtower exists. Any proposal must quantify its security assumptions, protect user privacy,
  and preserve the on-chain safety fallback.
- **Non-authoritative reputation** to help peers choose cooperative counterparties. Must never
  become slashable evidence or change objective enforcement ([`REQ-TRUST-1-K5PS99`](trust-model.md#req-trust-1-k5ps99)).
- **Alternative network topologies**, only if target use cases require larger channels; define
  security, liveness, privacy, and complexity trade-offs before adoption.
