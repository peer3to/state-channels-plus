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

**<a id="req-sec-1-sns1ga"></a>`REQ-SEC-1-SNS1GA`.** Before this specification is finalized, a dedicated security review of the full
protocol MUST be performed that explicitly asks:

1. Which objectively provable violations are NOT yet covered by a fraud proof?
2. Which attack paths are not prevented, detected, or recoverable under the current design?

This document is the placeholder and the method for that review. Its findings are recorded here
(§4) when the review is performed. Until then, the system is not recommended for production, and
the root [README](../README.md) says so.

## 2. Required scope

**<a id="req-sec-2-xpgsc3"></a>`REQ-SEC-2-XPGSC3`.** The review MUST cover, at minimum, every surface below. For each, it examines the
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

**<a id="req-sec-3-nppjn5"></a>`REQ-SEC-3-NPPJN5`.** The review MUST separate **objective slashable violations** (provable misbehavior)
from **non-Byzantine failures** (disconnection, data loss, crash). The former are candidates for
fraud proofs; the latter need recovery paths, never on-chain punishment. Conflating them either lets
attackers hide as "unavailable" or punishes honest failures. One local reputation rule is approved as an
exception (owner decision, 2026-09-02): once a lobby lease is accepted, a peer that loses its final
transport before the commitment completes is excluded from the excluding peer's local lobby reputation at
that side's agreement-window timing. This is a local blacklist, never a slashable violation, and a network
partition during the handoff excludes two honest peers from each other for the blacklist lifetime; see
[`OQ-AUDIT-LOBBY-1-9S3GVD`](open-questions.md#oq-audit-lobby-1-9s3gvd).

## 3. Required output per gap

**<a id="req-sec-4-vf81qd"></a>`REQ-SEC-4-VF81QD`.** For every identified gap, the review MUST classify the required response as exactly
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

Cross-module RPC-service and transport classification uses the complete public operations consumed
by dispatch instead of constructor identity. This fixes an availability failure in split production
bundles without granting peer trust: frame validation, service-method checks, guards, and payload
validation remain unchanged.

Handshake completion no longer accepts a peer-supplied membership announcement and no RPC endpoint
can promote a transport outside the local-status dispatcher. This removes an authorization-shaped
remote input from connection admission. Every transport starts with an addressless `PeerProfile`,
and its Holepunch ban handle stays on that profile while `ProfileManager` alone applies policy.
Ordinary unauthenticated close cannot ban a peer, while explicit unauthenticated blacklist can. Policy
release checks every live transport, so neither a selected WebRTC transport nor a non-preferred WebRTC
transport in upgrade grace can release the active fallback ban. Final identity attachment independently refuses a late bootstrap connection while
WebRTC is healthy and refuses every transport for an excluded identity, so an in-flight connection
cannot bypass the SDK ban handle. Authenticated-RPC queues also die with their original transport
or manager and cannot execute or punish after disposal. A late frame dispatched after local transport
close is dropped without blacklisting the identity or tearing down its healthy replacement. These changes narrow existing trust boundaries;
they do not resolve the separate open rate-limit, ICE-target, or protocol-version findings.

Runtime isolation now has one worker-error policy (plan 30, 2026-09-02). An error caught outside a
request in the sdk worker or the contract-executor worker, including the event-loop watchdog's throw,
is reported to the application as one detached runtime error and the worker keeps serving; a failure
before the worker's error funnel exists, or an exit the runtime did not request, is fatal for that
worker. A remote peer cannot make a worker die by provoking a stall: the throw is contained and
reported, so the peer's canonical EVM state survives. Whether an application disposes its runtime
on such a report stays the application's decision. The threshold policy for the test farm is
tracked in [`OQ-AUDIT-RUNTIME-1-HH601X`](open-questions.md#oq-audit-runtime-1-hh601x).

The RPC verification ledger now separates implemented boundary coverage from missing controls.
Endpoint hard stops, guard ordering and isolation, peer-bound response settlement, and cleanup after
implemented winners have executable evidence. Cancellation, aggregate admission limits, and
protocol-version negotiation remain open and carry no passing evidence.

Response delivery is fail-closed: a handler or guard response gets one send attempt, and a transport
failure disconnects without a retry or unhandled rejection. This resolves
[`DEF-8-HWJ10N`](open-findings.md#def-8-hwj10n).

Application-defined hook names are supplied by the local application root and use the existing runtime event
bridge. Preserving those names does not add a remote dispatch surface or bypass peer validation.

Per [`REQ-SEC-4-VF81QD`](security-assessment.md#req-sec-4-vf81qd) each finding carries **exactly one** current class — what the finding _is_ today.
The separate _proposed remediation_ column says what should change; a remediation may move the
finding to a different class once accepted, which is a decision, not a present state.

| Finding                                                                                                                                                                                                        | Trust boundary                                                                                                                       | Attack                                                                                                                                                                                                                                | Current protection                                                                                                                                                                                                                              | Current class ([`REQ-SEC-4-VF81QD`](security-assessment.md#req-sec-4-vf81qd))                                               | Proposed remediation                                                                                                                                            | Required test                                                          | Status                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------- |
| Handshake has no channel/identity binding ([`OQ-35-E5RRDF`](../implementation/open-questions.md#oq-35-e5rrdf))                                                                                                 | Peer authentication                                                                                                                  | On-path relay of a victim's handshake signature → impersonation                                                                                                                                                                       | None; only the `agreementTime` skew window limits it                                                                                                                                                                                            | explicit trust assumption (A9, [trust-model.md](../specification/security/trust-model.md#4-consolidated-trust-assumptions)) | Validation rule: sign a session- and identity-bound payload; removes A9                                                                                         | relay/reflection MITM e2e                                              | Open, production gate |
| No signature domain separation ([`OQ-29-EFY4NF`](../specification/open-questions.md#oq-29-efy4nf))                                                                                                             | Signed protocol artifacts: blocks, transactions, joins, opens, disputes (the handshake already carries an object/version domain tag) | Replay a signature across manager deployments / chains (`channelId` is caller-chosen)                                                                                                                                                 | None                                                                                                                                                                                                                                            | validation rule                                                                                                             | EIP-712 or domain-tagged struct binding version, chain, deployment, object type                                                                                 | cross-deployment replay                                                | Open, production gate |
| Cross-channel dispute-ack pollution ([`OQ-36-WEN9T1`](../implementation/open-questions.md#oq-36-wen9t1))                                                                                                       | `IsForkDisputedService`                                                                                                              | Throwaway disputed channel makes victims record foreign forks; free chain-read oracle                                                                                                                                                 | None; `channelId` unchecked                                                                                                                                                                                                                     | validation rule                                                                                                             | Bind `channelId` to the local channel; key ack records by channel                                                                                               | foreign-channel ack rejection                                          | Open                  |
| Reorg / event-ordering uncertainty ([`OQ-30-2G0Q5M`](../implementation/open-questions.md#oq-30-2g0q5m))                                                                                                        | SDK chain observation                                                                                                                | Same-height reorg undetected; out-of-order log application at join/dispute/withdrawal                                                                                                                                                 | Bare block-number cursor; no rollback                                                                                                                                                                                                           | recovery path                                                                                                               | Canonical `(blockNumber, blockHash, txIndex, logIndex)` cursor + rollback journal                                                                               | reorg replay at each decision site                                     | Open                  |
| Prototype-inherited RPC names reachable ([`DEF-7-PK564B`](open-findings.md#def-7-pk564b))                                                                                                                      | RPC dispatch                                                                                                                         | Call `toString`/`constructor` etc. remotely                                                                                                                                                                                           | Descriptor-based endpoint resolution stops before the RPC/language bases, never evaluates accessors, and captures the accepted function once                                                                                                    | validation rule                                                                                                             | Implemented in [`ARpcService`](../implementation/source/src/rpc/ARpcService.ts.md)                                                                              | component boundary matrix + authenticated-peer rejection/isolation E2E | Resolved 2026-08-17   |
| Honest peers blacklisted for availability / local faults ([`DEF-5-E8TP9N`](open-findings.md#def-5-e8tp9n), [`DEF-9-724SXP`](open-findings.md#def-9-724sxp), [`DEF-10-199C7F`](open-findings.md#def-10-199c7f)) | Peer classification                                                                                                                  | Griefer weaponizes unavailability, or our own chain-provider failure, into mutual blacklisting                                                                                                                                        | None; failure classes conflated                                                                                                                                                                                                                 | validation rule                                                                                                             | Separate unavailable/local-fault from Byzantine before penalizing                                                                                               | unavailability-not-blacklisted                                         | Open                  |
| Attacker-controlled ICE targets ([`DEF-11-JN8N6H`](open-findings.md#def-11-jn8n6h))                                                                                                                            | WebRTC setup                                                                                                                         | Induce STUN/connectivity traffic toward arbitrary hosts (reflection)                                                                                                                                                                  | None; candidates unfiltered                                                                                                                                                                                                                     | validation rule                                                                                                             | Filter candidate targets, or reclassify as accepted limitation under the [`OQ-6-4JPNE5`](../specification/open-questions.md#oq-6-4jpne5) limiter with rationale | ICE target filtering                                                   | Open                  |
| Unguarded harness-control root is network-reachable and ships in the package ([`OQ-37-0Y7YWS`](../implementation/open-questions.md#oq-37-0y7yws))                                                              | RPC dispatch / peer boundary                                                                                                         | Any connected peer calls `scenario.exec` (arbitrary code via `new Function` in the host realm), `handshake.signMessage` (signing oracle), or `signer` (key import) on a peer built with the test harness — 207 endpoints, zero guards | None: no harness service sets `guards`, dispatch is structural over any transport, and `dist/test/...` + `exports["./test-harness"]` publish the root. Blast radius limited only by production `p2pSetup` registering the bare `MainRpcService` | validation rule                                                                                                             | Restrict harness services to the trusted loopback transport **and** exclude them from the published artifact                                                    | network-peer cannot reach a harness service                            | Open, production gate |

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

**<a id="req-sec-5-1jpj3c"></a>`REQ-SEC-5-1JPJ3C`.** Before the P2P security model can be declared complete, a rate-limiting design MUST
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

### 5.2 RPC compatibility negotiation

**Current:** the RPC envelope and handshake carry no negotiated protocol version. Incompatible peers
discover drift through unknown services, unknown methods, or payload decode failures. All
[`REQ-RPC-8-44XECF`](../specification/peer-communication/rpc.md#req-rpc-8-44xecf) compatibility
permutations remain unassigned. The design decision belongs to
[`OQ-34-FY08V2`](../specification/open-questions.md#oq-34-fy08v2).

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

| ID                                                            | State          | Statement                                                                                                       | Implementation                                                                                          | Verification evidence                                                                                                                         |
| ------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`REQ-SEC-1-SNS1GA`](security-assessment.md#req-sec-1-sns1ga) | Design pending | Dedicated fraud-proof-completeness and attack-coverage review required before the specification is finalized.   | `none — gap` (formal review pending, §4.1)                                                              | `none — gap` (§4.1 empty; §4.2 holds targeted findings, which do not discharge [`REQ-SEC-1-SNS1GA`](security-assessment.md#req-sec-1-sns1ga)) |
| [`REQ-SEC-2-XPGSC3`](security-assessment.md#req-sec-2-xpgsc3) | Design pending | Review covers the full surface checklist in §2.                                                                 | `none — gap`                                                                                            | `none — gap`                                                                                                                                  |
| [`REQ-SEC-3-NPPJN5`](security-assessment.md#req-sec-3-nppjn5) | Design pending | Review separates objective slashable violations from non-Byzantine failures.                                    | `none — gap`                                                                                            | `none — gap`                                                                                                                                  |
| [`REQ-SEC-4-VF81QD`](security-assessment.md#req-sec-4-vf81qd) | Design pending | Every gap classified as proof / validation / dispute input / recovery / trust assumption / accepted limitation. | `none — gap`                                                                                            | `none — gap`                                                                                                                                  |
| [`REQ-SEC-5-1JPJ3C`](security-assessment.md#req-sec-5-1jpj3c) | Design pending | Gossip rate-limiting policy designed and enforced before the P2P security model is complete.                    | `none — gap` ([src/P2PManager.ts](../../../src/P2PManager.ts) has frame-size and blacklist guards only) | `none — gap` (flood tests required)                                                                                                           |

## Targeted-join security disposition — 2026-08-31

Knowledge of the 256-bit fixed target is topic secrecy, not authorization. Authenticated eligible peers are
allowed by default; a host-loaded custom RPC module may install a local `shouldMatchPeer` filter without
serializing policy. Remote balances must decode and compare greater than the state machine's neutral zero
before signing. A foreign transport cannot settle another peer's pending RPC. While the original request
transport remains live, a response with an authenticated address is routed through that peer's current
transport; retiring the original request transport rejects the pending request. Initial sync starts from the
first connected authoritative participant. Its Boolean result lets `P2PManager` abort an uncommitted observer
on failure.

The accepted residual is the unverified normal-Hyperswarm deduplication assumption. No new peer-supplied
clock, target, matching policy, or post-match cancellation authority is introduced.

LocalDiscovery replacement uses authenticated identity only after the normal handshake; untrusted registry
metadata cannot promote a connection. One canonical active dial and capped backoff prevent a tight retry loop,
and the existing blacklist prevents a rejected peer from being recreated. Pre-submission pending status closes
the disposal window around potentially funded join work. Force-join escalation requires authoritative on-chain
membership and a usable dispute window, so local-only pending state cannot trigger a premature dispute.

Authenticated protocol faults now exclude the peer address instead of allowing discovery to
reconnect it immediately. Address-based attribution also covers a retired transport after upgrade.
No identity penalty is applied for network loss, silence before identity proof, response-send
failure, cleanup, or an unclassified local handler exception.

## Dispute admission, conditional contributions, and mirror time

The signing-order defect is closed by the shared state boundary described in
[DisputeManager](../implementation/source/src/disputeManager/DisputeManager.ts.md) and
[BlockCommitService](../implementation/source/src/stateManager/block/BlockCommitService.ts.md).
Held authoring, admitted commit, and pending signer calls finish before dispute capture; removing the
boundary makes all three safety tests fail. The honest-leaver workflow includes an admitted incoming
signature. Failure rollback permits both real authoring and counter-signing again.

The signed existing-window flag is checked before submission mutates admission state. Accepted state
contributions keep their reason after opener kills, while signature, state, auditing-data and slash
eligibility checks remain active. [EventSyncService](../implementation/source/src/stateManager/eventSync/EventSyncService.ts.md)
recovers authoritative slashes with their original timestamps and deduplicates them. Empty or unchanged
observations stop; unexpected read errors reach the existing top-level error handling (direct callers reject; background attempts use the detached-error route); a changed fork or disposal prevents obsolete re-entry.
The clock repair is covered by real synchronization across an unposted reduction, not only timestamp
reader bytecode. These maintained assessments remain pending engineer review; no approval is recorded here.

### Early timeout submission recovery

[`REQ-DISPUTE-PIPE-10-BT8YAR`](../specification/disputes/dispute-processing.md#req-dispute-pipe-10-bt8yar) preserves chain admission while retrying a specific early-timestamp refusal through the existing timeout owner. Retries must revalidate current evidence, stop after fork replacement or disposal, and keep an older-window refusal ineligible. Repeated attempts may incur transaction cost while chain time lags; this does not relax the deadline or unrelated error policy.
