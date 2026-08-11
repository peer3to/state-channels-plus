# Trust Model

> **Status:** Draft, reverse-engineered baseline with recorded engineer decisions applied. Pending approval.
> **Scope:** Trust boundaries and assumptions of the whole system: what the protocol relies on, what
> it enforces, and what it explicitly does not defend against. Sibling documents:
> [data-availability.md](./data-availability.md), [open-security-review.md](./open-security-review.md).

## 1. Purpose & observable contract

This document defines the conditions under which the protocol's safety and liveness claims hold.
Every other document's guarantees are implicitly qualified by the assumptions listed here. A reader
deciding whether the system fits a deployment MUST check this document first; a reader auditing a
mechanism MUST check that it does not silently strengthen or weaken these assumptions.

The trust model deliberately separates:

- what the **chain** enforces (objective adjudication, final);
- what **participants** must do for themselves (observe the chain, stay online or delegate);
- what the protocol **cannot** provide (safety in an all-Byzantine partition, correct operation
  without any honest chain view).

## 2. The chain is arbiter and enforcer

Participants do not need to trust each other. The on-chain
[`StateChannelManagerProxy`](../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol)
is both the **arbiter** and the **enforcer** of the state-machine agreement: it adjudicates
disputes objectively (deterministic re-execution, signature verification, reduction) and enforces
the outcome (slashing, removal, successor forks, settlement).

Off-chain cooperation is the preferred path because it is cheaper and faster, but it is a
performance optimization, not a security mechanism. When peers cannot cooperate, safety and
correctness rest entirely on the chain's ability to adjudicate and enforce. See
[../protocol/disputes.md](../protocol/disputes.md) and
[../protocol/fraud-proofs.md](../protocol/fraud-proofs.md).

**INV-TRUST-1.** Every safety-relevant disagreement MUST be resolvable by the chain from objective
inputs alone, without trusting any participant's testimony.

## 3. Objective vs. subjective violations

The protocol distinguishes two categories of misbehavior:

- **Objective violations** are deterministic and mathematically provable from signed artifacts and
  chain state: invalid state transitions, double-signing, forged history, invalid timestamps,
  invalid disputes. These support fraud proofs and on-chain enforcement
  ([../protocol/fraud-proofs.md](../protocol/fraud-proofs.md)).
- **Subjective judgments** are opinions about cooperation, responsiveness, or reputation. They are
  not provable and MUST NOT be slashable evidence, dispute input, or a substitute for protocol
  correctness.

**REQ-TRUST-1.** Version one uses only objective, deterministic, mathematically verifiable
on-chain claims for enforcement — fraud proofs and every slashable behavior. Subjective reputation
MUST NEVER contribute to slashing or adjudication. (Non-authoritative reputation for choosing
counterparties is Future Work and must not change enforcement; see §9.)

## 4. Consolidated trust assumptions

The protocol's guarantees hold only under all of the following. Each is normative; violating one
voids the guarantees that depend on it.

| #   | Assumption                                                                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Live, honest, final chain.**                                               | The chain hosting the manager contract is available, censorship-resistant, and provides settlement finality. If it fails, disputes cannot be adjudicated or enforced. Depends on the resilience and decentralization of the underlying chain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A2  | **Signature and key security.**                                              | Participants keep signing keys private. Every state, economic, and on-chain-enforceable protocol commitment (blocks, transactions, joins, opens, disputes) is signed; a compromised key is a compromised participant. Not everything on the wire is signed: some operational RPC exchanges — notably dispute acknowledgments ([../sdk/rpc/is-fork-disputed.md](../sdk/rpc/is-fork-disputed.md)) — are unsigned in-memory observations that may justify a local disconnect or blacklist but can never support slashing or portable proof. Signature _domain_ separation for the signed set is a separate open issue ([OQ-29](../open-questions.md)).                                                                                                                                                                                             |
| A3  | **Deterministic state machines.**                                            | Integrator state machines are deterministically replayable off-chain and on-chain, with canonical serialization ([../concepts/state-machines.md](../concepts/state-machines.md)). Non-determinism breaks agreement and fraud verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A4  | **Bounded clock skew.**                                                      | Participants track chain time within the tolerance the timing windows imply ([../protocol/time.md](../protocol/time.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A5  | **Economic stake.**                                                          | Slashing deters only participants whose stake at risk exceeds the value of misbehaving.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A6  | **RPC observation.**                                                         | Each client has at least one available, honest RPC connection to the chain (§5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A7  | **Honest peer per partition.**                                               | At least one non-Byzantine participant exists in each relevant partition (§6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A8  | **Watchtower for offline participants.**                                     | An honest participant that may go offline has a continuously available delegate that can monitor and contest on its behalf (§7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A9  | **No on-path adversary during the handshake** _(temporary — `REQ-TRUST-6`)._ | Peer authentication currently assumes no active man-in-the-middle on the byte pipe between two honest peers. The session handshake signs only `peer3:init-handshake:v1:<challenge>` and binds neither the two EVM identities nor the transport/session, and no network transport authenticates its channel — so the handshake signature is the entire root of trust and a relayed signature can impersonate a peer ([OQ-35](../open-questions.md#oq-35--handshake-channelidentity-binding-relay-mitm), [../sdk/rpc/handshake.md](../sdk/rpc/handshake.md)). Every peer-authentication and blacklist-attribution guarantee in this document depends on A9. **This assumption is removed once a session- and identity-bound signed handshake is specified and implemented** (couples with the signature-domain and versioning work, OQ-29/OQ-34). |

**REQ-TRUST-6** _(temporary assumption A9)._ Until the handshake binds both peer identities and
the transport/session, the specification MUST state that peer authentication holds only against an
adversary with no on-path position between two honest peers. No guarantee that depends on peer
identity — blacklist attribution, per-peer penalties, spectate mutual-cooperation rules — may be
claimed unconditionally while A9 stands. Removing A9 requires the signed binding
([OQ-35](../open-questions.md#oq-35--handshake-channelidentity-binding-relay-mitm)) plus a
relay/reflection test that fails without it.

## 5. RPC observation assumption

The TypeScript client observes the chain only through an RPC endpoint: it receives events, reads
contract state, and submits transactions through it. This is a real trust dependency, not an
implementation detail.

**REQ-TRUST-2.** A client MUST have at least one available, honest RPC connection through which it
can observe chain state and events. Redundancy across independent RPC providers reduces ordinary
availability failures, but it does NOT remove the assumption: correct operation is not guaranteed
if every available endpoint is unavailable, dishonest, or malicious. A dishonest endpoint can feed
a client a false chain view, suppress events, or censor its transactions; the protocol cannot
detect this from inside the client. The assumption also inherits A1: it is only as strong as the
resilience and decentralization of the underlying chain.

**Current:** The implementation supports exactly one provider. Configuration exposes a single
`PROVIDER_URL` string ([src/utils/config.ts](../../../../src/utils/config.ts)), the event listener
subscribes through the single provider attached to the contract runner
([src/StateChannelEventListener.ts](../../../../src/StateChannelEventListener.ts)), and the runtime
chain context derives its WebSocket connection from the same URL
([src/evm/p2pRuntime/RuntimeChainContext.ts](../../../../src/evm/p2pRuntime/RuntimeChainContext.ts)).
There is no multi-provider redundancy, cross-checking, or failover — **gap**.

**Intended:** Redundancy across independent providers as an availability improvement, explicitly
documented as not removing the honesty assumption.

## 6. Honest-peer assumption

**REQ-TRUST-3.** The protocol assumes at least one non-Byzantine participant in each relevant
partition. **If every participant in a partition is Byzantine, the trust assumption provides no
safety for that partition.** Colluding participants who control the complete signature set can
finalize any state their signatures can produce; the chain cannot distinguish unanimous fraud from
unanimous agreement. This limitation is fundamental to the design and MUST be stated wherever the
P2P security model is summarized.

Consequences an integrator must accept:

- The protocol protects an honest participant against any coalition of the others; it does not
  protect an absent stake-holder against a fully colluding participant set (see also the
  channel-balance invariant for late joiners,
  [../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md)).
- Honest-majority is NOT required; one honest participant with chain access (A6) and enough time
  (A4, dispute windows) suffices to enforce its rights.

## 7. Watchtower requirement for offline participants

An honest participant enforces its own rights: it must observe on-chain actions (disputes,
calldata posts, snapshot updates) and contest invalid ones within the protocol windows. A
participant that is offline through a contest window cannot do this, and the protocol does not
pause for it.

**REQ-TRUST-4.** Version one REQUIRES a watchtower or equivalent continuously available delegate
for any honest participant that may go offline during a contest window. The delegate MUST be able
to monitor the channel, detect an invalid on-chain action, contest it within the required window,
and invoke the available enforcement or slashing mechanism.

The role carries explicit sub-assumptions, each of which MUST be specified for any concrete
watchtower design:

- **Data availability:** the delegate has (or can fetch) the channel data needed to construct
  contests — block history, signatures, state proofs, auditing data.
- **Privacy:** channel data given to a delegate discloses channel contents; the design must state
  what the delegate learns.
- **Availability:** the delegate itself is continuously online through the relevant windows; a
  delegate outage recreates the original problem.
- **Authorization:** which actions the delegate may take on the participant's behalf, and with
  which key material; a delegate that can submit contests but not steal funds is the target shape.
- **Timeouts:** the delegate must act within the same on-chain windows as the participant
  ([../protocol/disputes.md](../protocol/disputes.md), [../protocol/time.md](../protocol/time.md)).
- **Failure:** what the participant's exposure is if the delegate fails, and how failure is
  detected.

**Current:** No watchtower, delegate, or third-party monitoring implementation exists in this
repository — **gap**. The SDK assumes the participant's own client
([src/StateChannelEventListener.ts](../../../../src/StateChannelEventListener.ts),
[src/disputeManager](../../../../src/disputeManager)) is online to observe and respond. An
integrator deploying version one MUST either keep every honest participant's client online through
every contest window or operate an external delegate running the same SDK on the participant's
behalf.

**Verification (required, currently missing):** offline-participant tests (honest participant
offline while a counterparty submits an invalid dispute/timeout; delegate contests in time) and
collusion tests (remaining participants collude against the offline participant) — `none — gap`.

## 8. Topology limits

The P2P layer is a **full mesh**: every participant connects directly to every other participant
([src/P2PManager.ts](../../../../src/P2PManager.ts) broadcasts each RPC to all connections).
Messaging cost is therefore quadratic in the number of participants.

**REQ-TRUST-5.** The design targets many SMALL channel partitions, not large channels. For the
intended poker use case a partition of up to roughly ten participants — commonly six — is an
acceptable fit for the full mesh. The protocol MUST NOT be presented as suitable for very large
participant sets under the current topology. Cross-reference this constraint wherever P2P
performance is discussed ([../sdk/components.md](../sdk/components.md)).

## 9. Threat model

The dispute and fraud-proof system defends against the following without requiring participants to
trust one another. Enum sources:
[contracts/V1/types/ProofTypes.sol](../../../../contracts/V1/types/ProofTypes.sol).

| Threat                               | Defense                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invalid state transition             | Deterministic on-chain re-execution via `BlockInvalidStateTransition` fraud proof → author slashed.                                                                                                                                                                                                                      |
| Equivocation / double-signing        | `BlockDoubleSign` fraud proof over two conflicting signed blocks → slash.                                                                                                                                                                                                                                                |
| Forged history                       | `WrongGenesis`, `InvalidTimestamp`, `ForgedInboundMessageBlock` fraud proofs reject blocks chaining from bad genesis, violating timing rules, or citing non-persisted inbound messages.                                                                                                                                  |
| Unavailability / griefing by silence | Deterministic author timeouts feed the dispute game; the channel progresses without the silent participant ([../protocol/disputes.md](../protocol/disputes.md)).                                                                                                                                                         |
| Fraudulent disputes                  | The `DisputeFraudProofType` family disproves disputes claiming a non-latest state, bad output, invalid state proof, broken balance invariant, or unjustified timeout ([contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol](../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol)). |
| Spam / bogus proofs                  | Non-overwritable block-calldata commitments, the dispute-window kill period, and self-slashing of submitters of invalid proofs. Rate limiting at the P2P layer is NOT designed yet — see [open-security-review.md](./open-security-review.md).                                                                           |
| Value creation / theft               | Balance-algebra underflow rejection, settlement capped at deposits, `DisputeInvalidBalanceInvariant` on-chain.                                                                                                                                                                                                           |

**Corrections to the historical table:**

- **Fraud-proof completeness is NOT established.** This table lists implemented defenses; it is not
  evidence that every objectively provable violation is covered. The dedicated review that would
  establish (or refute) completeness is specified in
  [open-security-review.md](./open-security-review.md) and has not been performed.
- RPC compromise is no longer "out of scope silently" — it is the explicit assumption A6/REQ-TRUST-2.
- Offline honest participants are no longer implicitly assumed online — REQ-TRUST-4.

Remaining out of scope for the protocol layer: key compromise (A2), application-logic bugs in the
integrator's state machine (A3 covers determinism, not correctness), and total failure of the
underlying chain (A1).

## 10. Verification

- **Assumption-violation tests:** each assumption A1–A9 should have at least one test or documented
  argument showing what fails when it is violated (e.g. partitioned-network and
  absent-participant e2e scenarios for A7/A8). Current e2e suites cover multi-party dispute and
  recovery flows ([test/](../../../../test)); they do not cover watchtower delegation or RPC
  failure — gaps recorded in the traceability table. **A9 (REQ-TRUST-6) has no test:** a
  relay/reflection scenario — an on-path attacker forwarding a victim's handshake signature to
  impersonate it — is required and does not exist (`none — gap`,
  [OQ-35](../open-questions.md#oq-35--handshake-channelidentity-binding-relay-mitm)). It is the
  test that must fail today and pass once the handshake binds identities and session.
- **Objective-only enforcement:** contract tests must show that no slashing path consumes
  non-objective input (REQ-TRUST-1); this is currently implicit in the fraud-proof facet tests.
- **Topology:** performance evidence for the target partition sizes (≤ ~10) rather than
  extrapolation.

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
  preserve the on-chain safety fallback.
- **Non-authoritative reputation** to help peers choose cooperative counterparties. Must never
  become slashable evidence or change objective enforcement (REQ-TRUST-1).
- **Alternative network topologies**, only if target use cases require larger partitions; define
  security, liveness, privacy, and complexity trade-offs before adoption.

## Traceability

| ID          | State          | Statement                                                                                                                                                                  | Implementation                                                                                                                                                                                    | Verification evidence                                                                                                                      |
| ----------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| INV-TRUST-1 | Design pending | Safety-relevant disagreements resolvable on-chain from objective inputs alone.                                                                                             | [contracts/V1/StateChannelDiamondProxy](../../../../contracts/V1/StateChannelDiamondProxy) (dispute + fraud-proof facets)                                                                         | Contract dispute/fraud-proof suites under [test/](../../../../test)                                                                        |
| REQ-TRUST-1 | Design pending | Enforcement uses only objective on-chain claims; subjective input never slashable.                                                                                         | Fraud-proof and dispute facets consume signed artifacts and chain state only                                                                                                                      | Implicit in facet tests; no dedicated negative test — `none — gap`                                                                         |
| REQ-TRUST-2 | Design pending | At least one available, honest RPC connection required; redundancy helps availability but does not remove the assumption.                                                  | [src/utils/config.ts](../../../../src/utils/config.ts) (single `PROVIDER_URL`), [src/StateChannelEventListener.ts](../../../../src/StateChannelEventListener.ts)                                  | `none — gap` (no redundancy implementation; no RPC-failure tests)                                                                          |
| REQ-TRUST-3 | Design pending | At least one non-Byzantine participant per partition; all-Byzantine partitions have no safety.                                                                             | Protocol-wide design property                                                                                                                                                                     | Adversarial e2e scenarios in [test/](../../../../test) cover partial-Byzantine cases; all-Byzantine impossibility documented, not testable |
| REQ-TRUST-4 | Design pending | Watchtower/delegate required for offline honest participants, with stated data, privacy, availability, authorization, timeout, and failure assumptions.                    | `none — gap` (no watchtower implementation in repo)                                                                                                                                               | `none — gap` (offline-participant and collusion tests required)                                                                            |
| REQ-TRUST-5 | Design pending | Full-mesh topology; target is many small partitions (≤ ~10, commonly 6).                                                                                                   | [src/P2PManager.ts](../../../../src/P2PManager.ts)                                                                                                                                                | Multi-party e2e runs at small sizes; no explicit scaling boundary test — `none — gap`                                                      |
| REQ-TRUST-6 | Design pending | Temporary assumption A9: peer authentication assumes no on-path adversary; identity-dependent guarantees are conditional until the handshake binds identities and session. | [src/rpc/services/initHandshake](../../../../src/rpc/services/initHandshake) (domain-tagged challenge only; no identity/session binding) — see [../sdk/rpc/handshake.md](../sdk/rpc/handshake.md) | `none — gap` (relay/reflection MITM test required; [OQ-35](../open-questions.md#oq-35--handshake-channelidentity-binding-relay-mitm))      |
