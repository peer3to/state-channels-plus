# Open Security Review

> **Status:** Draft — the **formal completeness review is pending** (§4.1). The document defines
> the required method, records known unanalyzed surfaces, and already holds the code-backed
> findings that targeted analysis produced while specifying other subsystems (§4.2).
> **Scope:** The standing requirement for a dedicated fraud-proof-completeness and attack-coverage
> review, plus open security design items that gate the P2P security model. Sibling documents:
> [trust-model.md](../specification/security/trust-model.md), [data-availability.md](../specification/security/data-availability.md).

## 1. Purpose

The implemented fraud-proof list
([contracts/V1/types/ProofTypes.sol](../../../contracts/V1/types/ProofTypes.sol),
[../protocol/fraud-proofs.md](../specification/disputes/fraud-proofs.md)) MUST NOT be treated as complete. It
enumerates what the code proves today; nothing yet establishes that every objectively provable
violation is covered or that every attack path is prevented, detected, or recoverable. The threat
table in [trust-model.md](../specification/security/trust-model.md) carries the same caveat.

**[`REQ-SEC-1-SNS1GA`](security-assessment.md#req-sec-1-sns1ga).** Before this specification is finalized, a dedicated security review of the full
protocol MUST be performed that explicitly asks:

1. Which objectively provable violations are NOT yet covered by a fraud proof?
2. Which attack paths are not prevented, detected, or recoverable under the current design?

This document is the placeholder and the method for that review. Its findings are recorded here
(§4) when the review is performed. Until then, the system is not recommended for production, and
the root [README](../README.md) says so.

## 2. Required scope

**[`REQ-SEC-2-XPGSC3`](security-assessment.md#req-sec-2-xpgsc3).** The review MUST cover, at minimum, every surface below. For each, it examines the
objective claims the protocol makes, the proofs and validations that police them, and the failure
and recovery behavior.

| Surface                                        | Primary references                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Block production                               | [../protocol/finality.md](../specification/protocol-model/finality.md), [../sdk/block-confirmation-pipeline.md](../implementation/views/architecture/sdk/block-confirmation-pipeline.md)               |
| Signatures and equivocation                    | [../protocol/fraud-proofs.md](../specification/disputes/fraud-proofs.md)                                                                                                                               |
| Virtual voting                                 | [../protocol/finality.md](../specification/protocol-model/finality.md)                                                                                                                                 |
| State proofs and milestone hops                | [../protocol/state-proofs.md](../specification/disputes/state-proofs.md)                                                                                                                               |
| Membership changes (join, removal, thresholds) | [../protocol/cross-layer-messages.md](../specification/settlement/cross-layer-messages.md), [../protocol/state-proofs.md](../specification/disputes/state-proofs.md)                                   |
| Inbound and outbound streams                   | [../protocol/cross-layer-messages.md](../specification/settlement/cross-layer-messages.md)                                                                                                             |
| Snapshot updates                               | [../protocol/lifecycle.md](../specification/settlement/lifecycle.md)                                                                                                                                   |
| Fraud-proof and dispute-proof submission       | [../protocol/fraud-proofs.md](../specification/disputes/fraud-proofs.md), [../sdk/dispute-pipeline.md](../implementation/views/architecture/sdk/dispute-pipeline.md)                                   |
| Slash-set handling                             | [../protocol/fraud-proofs.md](../specification/disputes/fraud-proofs.md)                                                                                                                               |
| Reduction                                      | [../protocol/disputes.md](../specification/disputes/disputes.md)                                                                                                                                       |
| Timing                                         | [../protocol/time.md](../specification/protocol-model/time.md)                                                                                                                                         |
| Data availability                              | [data-availability.md](../specification/security/data-availability.md)                                                                                                                                 |
| RPC trust                                      | [trust-model.md](../specification/security/trust-model.md) §5                                                                                                                                          |
| Leader election                                | [../protocol/finality.md](../specification/protocol-model/finality.md)                                                                                                                                 |
| Cross-layer interactions                       | [../protocol/cross-layer-messages.md](../specification/settlement/cross-layer-messages.md), [../contracts/manager-and-facets.md](../implementation/views/architecture/contracts/manager-and-facets.md) |

**[`REQ-SEC-3-NPPJN5`](security-assessment.md#req-sec-3-nppjn5).** The review MUST separate **objective slashable violations** (provable misbehavior)
from **non-Byzantine failures** (disconnection, data loss, crash). The former are candidates for
fraud proofs; the latter need recovery paths, never punishment. Conflating them either lets
attackers hide as "unavailable" or punishes honest failures.

## 3. Required output per gap

**[`REQ-SEC-4-VF81QD`](security-assessment.md#req-sec-4-vf81qd).** For every identified gap, the review MUST classify the required response as exactly
one of:

- a **new fraud proof** (the violation is objectively provable and worth proving on-chain);
- a **validation rule** (the input should be rejected before it matters);
- a **dispute input** (the condition belongs in the dispute game's valid-input set);
- a **recovery path** (a non-Byzantine failure needing a way back to normal operation);
- an **explicit trust assumption** (record it in [trust-model.md](../specification/security/trust-model.md));
- an **accepted limitation** (record it plainly, with its exposure, in the relevant document).

Each finding gets a traceability ID, the affected surface, the classification, and — once
addressed — the implementing code and verifying tests.

## 4. Findings

Two distinct things live here. §4.1 is the destination for the formal review required by
[`REQ-SEC-1-SNS1GA`](security-assessment.md#req-sec-1-sns1ga), which has **not** been performed. §4.2 records findings that targeted analysis already
produced while specifying other subsystems — real, code-backed, and not a substitute for §4.1.

### 4.1 Formal completeness review — pending

**Not performed.** The systematic walk of §2's scope (block production, signatures and
equivocation, virtual voting, state proofs and milestone hops, membership changes, inbound and
outbound streams, snapshot updates, proof submission, slash-set handling, reduction, timing, data
availability, RPC trust, leader election, cross-layer interactions) has not happened. Its output
belongs in this subsection, structured per [`REQ-SEC-3-NPPJN5`](security-assessment.md#req-sec-3-nppjn5) and [`REQ-SEC-4-VF81QD`](security-assessment.md#req-sec-4-vf81qd). Until it exists, no
completeness claim may be made anywhere in this tree.

### 4.2 Known findings from targeted analysis

Produced while specifying the SDK pipelines and the RPC subtree, not by a systematic sweep. Each
is tracked in full in its owning document and the [open-questions register](../specification/open-questions.md).

Per [`REQ-SEC-4-VF81QD`](security-assessment.md#req-sec-4-vf81qd) each finding carries **exactly one** current class — what the finding _is_ today.
The separate _proposed remediation_ column says what should change; a remediation may move the
finding to a different class once accepted, which is a decision, not a present state.

| Finding                                                                                                                                                                                                        | Trust boundary                                                                                                                       | Attack                                                                                                                                                                                                                                | Current protection                                                                                                                                                                                                                              | Current class ([`REQ-SEC-4-VF81QD`](security-assessment.md#req-sec-4-vf81qd))                                               | Proposed remediation                                                                                                                                            | Required test                               | Status                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------- |
| Handshake has no channel/identity binding ([`OQ-35-E5RRDF`](../implementation/open-questions.md#oq-35-e5rrdf))                                                                                                 | Peer authentication                                                                                                                  | On-path relay of a victim's handshake signature → impersonation                                                                                                                                                                       | None; only the `agreementTime` skew window limits it                                                                                                                                                                                            | explicit trust assumption (A9, [trust-model.md](../specification/security/trust-model.md#4-consolidated-trust-assumptions)) | Validation rule: sign a session- and identity-bound payload; removes A9                                                                                         | relay/reflection MITM e2e                   | Open, production gate |
| No signature domain separation ([`OQ-29-EFY4NF`](../specification/open-questions.md#oq-29-efy4nf))                                                                                                             | Signed protocol artifacts: blocks, transactions, joins, opens, disputes (the handshake already carries an object/version domain tag) | Replay a signature across manager deployments / chains (`channelId` is caller-chosen)                                                                                                                                                 | None                                                                                                                                                                                                                                            | validation rule                                                                                                             | EIP-712 or domain-tagged struct binding version, chain, deployment, object type                                                                                 | cross-deployment replay                     | Open, production gate |
| Cross-channel dispute-ack pollution ([`OQ-36-WEN9T1`](../implementation/open-questions.md#oq-36-wen9t1))                                                                                                       | `IsForkDisputedService`                                                                                                              | Throwaway disputed channel makes victims record foreign forks; free chain-read oracle                                                                                                                                                 | None; `channelId` unchecked                                                                                                                                                                                                                     | validation rule                                                                                                             | Bind `channelId` to the local channel; key ack records by channel                                                                                               | foreign-channel ack rejection               | Open                  |
| Reorg / event-ordering uncertainty ([`OQ-30-2G0Q5M`](../implementation/open-questions.md#oq-30-2g0q5m))                                                                                                        | SDK chain observation                                                                                                                | Same-height reorg undetected; out-of-order log application at join/dispute/withdrawal                                                                                                                                                 | Bare block-number cursor; no rollback                                                                                                                                                                                                           | recovery path                                                                                                               | Canonical `(blockNumber, blockHash, txIndex, logIndex)` cursor + rollback journal                                                                               | reorg replay at each decision site          | Open                  |
| Prototype-inherited RPC names reachable ([`DEF-7-PK564B`](open-findings.md#def-7-pk564b))                                                                                                                      | RPC dispatch                                                                                                                         | Call `toString`/`constructor` etc. remotely (`in` check)                                                                                                                                                                              | None                                                                                                                                                                                                                                            | validation rule                                                                                                             | Own-property + function check on the `RpcMethods` instance                                                                                                      | prototype-method rejection                  | Open                  |
| Honest peers blacklisted for availability / local faults ([`DEF-5-E8TP9N`](open-findings.md#def-5-e8tp9n), [`DEF-9-724SXP`](open-findings.md#def-9-724sxp), [`DEF-10-199C7F`](open-findings.md#def-10-199c7f)) | Peer classification                                                                                                                  | Griefer weaponizes unavailability, or our own chain-provider failure, into mutual blacklisting                                                                                                                                        | None; failure classes conflated                                                                                                                                                                                                                 | validation rule                                                                                                             | Separate unavailable/local-fault from Byzantine before penalizing                                                                                               | unavailability-not-blacklisted              | Open                  |
| Attacker-controlled ICE targets ([`DEF-11-JN8N6H`](open-findings.md#def-11-jn8n6h))                                                                                                                            | WebRTC setup                                                                                                                         | Induce STUN/connectivity traffic toward arbitrary hosts (reflection)                                                                                                                                                                  | None; candidates unfiltered                                                                                                                                                                                                                     | validation rule                                                                                                             | Filter candidate targets, or reclassify as accepted limitation under the [`OQ-6-4JPNE5`](../specification/open-questions.md#oq-6-4jpne5) limiter with rationale | ICE target filtering                        | Open                  |
| Unguarded harness-control root is network-reachable and ships in the package ([`OQ-37-0Y7YWS`](../implementation/open-questions.md#oq-37-0y7yws))                                                              | RPC dispatch / peer boundary                                                                                                         | Any connected peer calls `scenario.exec` (arbitrary code via `new Function` in the host realm), `handshake.signMessage` (signing oracle), or `signer` (key import) on a peer built with the test harness — 207 endpoints, zero guards | None: no harness service sets `guards`, dispatch is structural over any transport, and `dist/test/...` + `exports["./test-harness"]` publish the root. Blast radius limited only by production `p2pSetup` registering the bare `MainRpcService` | validation rule                                                                                                             | Restrict harness services to the trusted loopback transport **and** exclude them from the published artifact                                                    | network-peer cannot reach a harness service | Open, production gate |

New findings from either source append to the appropriate subsection.

## 5. Known open design items

Items already known to be missing, ahead of the full review.

### 5.1 P2P gossip rate limiting

**Open question:** the P2P layer has no gossip rate-limiting policy. It is not yet designed, and
it is required for availability, resource control, and griefing resistance.

**Current:** [src/P2PManager.ts](../../../src/P2PManager.ts) broadcasts RPCs to all connected
peers (full mesh), disconnects a peer that sends an oversized RPC frame, and supports
disconnect-and-blacklist of misbehaving peers. There is no rate limiting, throttling, queueing
policy, or backpressure — **gap**.

**[`REQ-SEC-5-1JPJ3C`](security-assessment.md#req-sec-5-1jpj3c).** Before the P2P security model can be declared complete, a rate-limiting design MUST
define:

- the **unit of limiting** (messages, bytes, RPC type, validation cost);
- the **identity scope** (per peer connection, per EVM identity, per channel);
- **burst behavior** (allowances for legitimate bursts such as catch-up sync);
- **queue and backpressure rules** (what is buffered, what is dropped, in what order);
- **prioritization of protocol-critical messages** — block confirmations, signatures, and
  dispute-relevant messages must not starve behind bulk traffic;
- **consequences for exceeding limits** (drop, delay, disconnect, blacklist) and their
  interaction with honest peers under packet loss;
- **interaction with retries, offline peers, and transport differences**
  ([src/transport](../../../src/transport), [src/Holepunch.ts](../../../src/Holepunch.ts)).

The analysis MUST cover flood attacks that stay protocol-valid — floods of well-formed blocks,
signatures, sync requests, or other gossip — since validity checks alone do not bound resource
use. The policy MUST protect CPU, memory, bandwidth, storage, and user experience without
preventing honest recovery, block confirmation, or dispute escalation. Exact thresholds and the
enforcement mechanism are unresolved engineering work; they are required before the P2P security
model is complete, but no specific values are normative yet.

## 6. Verification

- The review itself is the verification instrument for [`REQ-SEC-1-SNS1GA`](security-assessment.md#req-sec-1-sns1ga)–4; its evidence is §4.1 plus the
  per-finding tests it mandates.
- For [`REQ-SEC-5-1JPJ3C`](security-assessment.md#req-sec-5-1jpj3c), verification is adversarial: flood tests (protocol-valid message floods across
  each message class) demonstrating bounded resource use and preserved liveness for confirmation
  and dispute escalation. None exist — `none — gap`.
- Until §4.1 is populated, every "defended against" claim elsewhere in this tree is qualified as
  "implemented defense, completeness unestablished." The §4.2 findings are already-known
  exceptions to those claims, not a measure of coverage.
- Every §4.2 finding's "required test" cell is currently unwritten — `none — gap` across the
  table; each becomes evidence when its test lands.

## Future Work

_Non-normative._

- Repeat the review at every protocol-changing release; a completed review dates quickly.
- Fuzzing and formal analysis of dispute reduction and the fraud-proof facets as review inputs.
- A machine-checkable inventory: enumerate protocol claims (signed artifacts, timing rules,
  stream commitments) and map each to its policing proof or validation, so coverage gaps surface
  mechanically instead of by inspection.
- Reputation-independent peer scoring for rate-limit tuning (must stay outside enforcement per
  [trust-model.md](../specification/security/trust-model.md) [`REQ-TRUST-1-K5PS99`](../specification/security/trust-model.md#req-trust-1-k5ps99)).

## Traceability

| ID                                              | State          | Statement                                                                                                       | Implementation                                                                                          | Verification evidence                                                                                                                         |
| ----------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-sec-1-sns1ga"></a>`REQ-SEC-1-SNS1GA` | Design pending | Dedicated fraud-proof-completeness and attack-coverage review required before the specification is finalized.   | `none — gap` (formal review pending, §4.1)                                                              | `none — gap` (§4.1 empty; §4.2 holds targeted findings, which do not discharge [`REQ-SEC-1-SNS1GA`](security-assessment.md#req-sec-1-sns1ga)) |
| <a id="req-sec-2-xpgsc3"></a>`REQ-SEC-2-XPGSC3` | Design pending | Review covers the full surface checklist in §2.                                                                 | `none — gap`                                                                                            | `none — gap`                                                                                                                                  |
| <a id="req-sec-3-nppjn5"></a>`REQ-SEC-3-NPPJN5` | Design pending | Review separates objective slashable violations from non-Byzantine failures.                                    | `none — gap`                                                                                            | `none — gap`                                                                                                                                  |
| <a id="req-sec-4-vf81qd"></a>`REQ-SEC-4-VF81QD` | Design pending | Every gap classified as proof / validation / dispute input / recovery / trust assumption / accepted limitation. | `none — gap`                                                                                            | `none — gap`                                                                                                                                  |
| <a id="req-sec-5-1jpj3c"></a>`REQ-SEC-5-1JPJ3C` | Design pending | Gossip rate-limiting policy designed and enforced before the P2P security model is complete.                    | `none — gap` ([src/P2PManager.ts](../../../src/P2PManager.ts) has frame-size and blacklist guards only) | `none — gap` (flood tests required)                                                                                                           |
