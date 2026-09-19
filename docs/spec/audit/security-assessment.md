# Open Security Review

> **Status:** Draft — the **formal completeness review is pending** (§4.1). The document defines
> the required method, records known unanalyzed surfaces, and already holds the code-backed
> findings that targeted analysis produced while specifying other subsystems (§4.2).
> **Scope:** The standing requirement for a dedicated fraud-proof-completeness and attack-coverage
> review, plus open security design items that gate the P2P security model. Sibling documents:
> [trust-model.md](../specification/security/trust-model.md), [data-availability.md](../specification/security/data-availability.md).

Root lifecycle changes retain internal endpoint composition and exact transport response matching. No internal logger, signer, lifecycle or bridge service is registered on the network root. Parent/child registration constrains error and lifecycle control messages. Port possession remains an internal capability; forwarding a bridge port does not add a peer-wire endpoint. Disposal before broker attachment closes that capability and rejects waiting negotiation. This assessment does not approve the standing protocol-security queues below.

The shared frame decoder keeps the size gate before parsing and response-first classification for dual-shaped input. Lobby policy callbacks run after the same malformed-input and reservation checks. Negotiation preserves raw nonce/challenge comparison and malformed-address failure. No authorization, punishment, timeout or signed-attempt release policy changes; implementation-only coercion helpers do not broaden trust. The review follow-up changes the bytes32 type assertion and import order without adding a trust-boundary branch.

## Awaited RPC dispatch

Router ingress awaits service.runRPC. Guards retain their existing response suppression and replay behavior. Shared RpcDispatch handles endpoint execution and response construction, with service-local policies and no exception wrapper or extra service-shape requirements. Error response construction remains separate from peer punishment: request endpoint errors return failures; synchronous one-way throws retain disconnect/blacklist behavior, and asynchronous one-way rejection retains disconnect-only behavior. Failed response sends have one attempt. Internal uncaught dispatch failures reach the root error handler from the port callback. Message callbacks remain independent, so a held invocation does not block reply or cancellation traffic.

## RPC category and ingress ownership

Network frame limits, response-first parsing and authenticated same-peer response admission live in the manager’s single NetworkRpcRouter. Peer penalties remain manager operations. Internal roots and services are explicitly composed under their own category; centralized exports do not register them on the peer root. Typed transport constructors reject cross-category routers. Shared forwarding adds no universal closed guard: closed internal input remains ignored and network late-frame admission is preserved. Live MessagePort/data-channel transfers continue to use structured clone and explicit transfer lists, without a new attachment protocol.

## Shared runtime RPC trust boundary

The refactor keeps peer authentication and penalties on NetworkTransport/P2PManager. Internal
transports cannot enter peer recipient selection, profile registration, handshake or blacklist
policy. Structural predicates recognize complete service/transport shapes across module graphs;
they do not authenticate senders. Internal responses must match the exact owning connection.
Network responses retain authenticated same-peer replacement admission before pending settlement.

Shared dispatch rejects constructors, base helpers, accessors and non-function shadows. Each
invocation keeps its own sender, including interleaved awaited and detached work. Domain services
prepare serializable errors; the router does not choose codecs based on trust or method names.
Network JSON still rejects raw BigInt. Ethers structs retain named Codec encodings.

The approved test controls are internal construction dependencies. Ordinary SDK creation installs
no probe; test worker entries use production bootstrap and retain live references locally. These
controls do not add a production default service or a new authentication bypass. The broader
security review below remains pending.

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
[`OQ-AUDIT-LOBBY-1-9S3GVD` (Lobby accepted-lease exclusion versus the no-punishment rule)](open-questions.md#oq-audit-lobby-1-9s3gvd).

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
tracked in [`OQ-AUDIT-RUNTIME-1-HH601X` (Watchdog threshold under gate load)](open-questions.md#oq-audit-runtime-1-hh601x).

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
| Prototype-inherited RPC names reachable ([`DEF-7-PK564B`](open-findings.md#def-7-pk564b))                                                                                                                      | RPC dispatch                                                                                                                         | Call `toString`/`constructor` etc. remotely                                                                                                                                                                                           | Descriptor-based endpoint resolution stops before the RPC/language bases, never evaluates accessors, and captures the accepted function once                                                                                                    | validation rule                                                                                                             | Implemented in [`ANetworkRpcService`](../implementation/source/src/rpc/network/ANetworkRpcService.ts.md)                                                        | component boundary matrix + authenticated-peer rejection/isolation E2E | Resolved 2026-08-17   |
| Honest peers blacklisted for availability / local faults ([`DEF-5-E8TP9N`](open-findings.md#def-5-e8tp9n), [`DEF-9-724SXP`](open-findings.md#def-9-724sxp), [`DEF-10-199C7F`](open-findings.md#def-10-199c7f)) | Peer classification                                                                                                                  | Griefer weaponizes unavailability, or our own chain-provider failure, into mutual blacklisting                                                                                                                                        | None; failure classes conflated                                                                                                                                                                                                                 | validation rule                                                                                                             | Separate unavailable/local-fault from Byzantine before penalizing                                                                                               | unavailability-not-blacklisted                                         | Open                  |
| Attacker-controlled ICE targets ([`DEF-11-JN8N6H`](open-findings.md#def-11-jn8n6h))                                                                                                                            | WebRTC setup                                                                                                                         | Induce STUN/connectivity traffic toward arbitrary hosts (reflection)                                                                                                                                                                  | None; candidates unfiltered                                                                                                                                                                                                                     | validation rule                                                                                                             | Filter candidate targets, or reclassify as accepted limitation under the [`OQ-6-4JPNE5`](../specification/open-questions.md#oq-6-4jpne5) limiter with rationale | ICE target filtering                                                   | Open                  |
| Unguarded harness-control root is network-reachable and ships in the package ([`OQ-37-0Y7YWS`](../implementation/open-questions.md#oq-37-0y7yws))                                                              | RPC dispatch / peer boundary                                                                                                         | Any connected peer calls `scenario.exec` (arbitrary code via `new Function` in the host realm), `handshake.signMessage` (signing oracle), or `signer` (key import) on a peer built with the test harness — 207 endpoints, zero guards | None: no harness service sets `guards`, dispatch is structural over any transport, and `dist/test/...` + `exports["./test-harness"]` publish the root. Blast radius limited only by production `p2pSetup` registering the bare `MainRpcService` | validation rule                                                                                                             | Restrict harness services to the trusted loopback transport **and** exclude them from the published artifact                                                    | network-peer cannot reach a harness service                            | Open, production gate |

New findings from either source append to the appropriate subsection.

## 5. Known open design items

Items already known to be missing, ahead of the full review.

### 5.1 P2P gossip rate limiting

**Open question:** the P2P layer has no gossip rate-limiting policy. It is not yet designed, and
it is required for availability, resource control, and griefing resistance.

**Current:** [NetworkRpcRouter](../../../src/rpc/router/NetworkRpcRouter.ts#L43) broadcasts RPCs to all connected
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
[`REQ-RPC-8-44XECF` (Compatibility before protected calls)](../specification/peer-communication/rpc.md#req-rpc-8-44xecf) compatibility
permutations remain unassigned. The design decision belongs to
[`OQ-34-FY08V2` (RPC boundary decisions)](../specification/open-questions.md#oq-34-fy08v2).

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

[`REQ-DISPUTE-PIPE-10-BT8YAR` (Recheck an early timeout submission)](../specification/disputes/dispute-processing.md#req-dispute-pipe-10-bt8yar) preserves chain admission while retrying a specific early-timestamp refusal through the existing timeout owner. Retries must revalidate current evidence, stop after fork replacement or disposal, and keep an older-window refusal ineligible. Repeated attempts may incur transaction cost while chain time lags; this does not relax the deadline or unrelated error policy.

## Accepted PR 472 fixes after the SDK refactor

The leave watchdog now routes a failed dispute start to the pending leave promise. Both the
missing-marker and expired-evidence outcomes have explicit runtime-port declarations. The configured
production bound remains 15 seconds: it may pre-empt an otherwise healthy turn and incur a dispute.
This is the recorded owner policy under [channel leave and runtime reuse](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay).

Current dispute upload eligibility now uses the snapshot participant set plus the unconsumed inbound
JOIN interval, with the snapshot boundary excluded, the latest head included, and on-chain slashes
removed. Snapshot participants retain eligibility regardless of JOIN age. Historical proof thresholds
retain their historical walk. See the [shared Solidity report](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol.md)
and [upload rule](../specification/disputes/disputes.md#req-dis-2-pkvz7e).

The accepted-lease liability policy is retained. [Profile-loss recovery](../specification/peer-communication/lobby-matching.md#req-lobby-8-31be0f)
already requires a healthy replacement or fallback transport to preserve the profile and attempt.
Retiring an old transport while its replacement remains attached does not emit profile loss. The
assessment's reported four-peer blacklist failure still lacks causal evidence identifying its call
site; static inspection and non-reproduction do not establish its cause. No speculative transport or
liability change is made. The implementation record keeps this limitation separate from the confirmed
profile lifecycle behavior.

Verification mappings name individual browser declarations and the new component failure and race
cases. Maintained documents remain pending engineer review; this update grants no approval and does
not resolve the assessment's five review-body findings that were explicitly left for discussion.

## Non-terminal channel leave and runtime reuse

A settled leave now returns the runtime to its pre-channel state instead of disposing it
([`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9),
[`REQ-TJOIN-7-NNGTAY` (Channel leave and runtime reuse)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)).
Departure itself is unchanged: the same fully signed snapshot update or self-removal dispute fallback, the
same settled-removal and local `SYNCED` conditions. What changed is only what happens after the departure is
observed, so no on-chain safety property moves with this change.

The protected asset the reuse touches is the isolation between two channels served by one runtime. The
release is complete by construction rather than by inspection: every channel-scoped store is rebuilt through
one facade call, peers and profiles go through one manager reset, and the selected channel id, fork id, and
status all return to their pre-channel values (the leader flag is application-owned and stays with its single
writer). The ordering is the safety argument —
producers stop, the chain feed is detached and drained, peers and timers go, and only then is storage
cleared — so nothing in flight can read a half-released runtime or, worse, write a record from the old
channel into a store the next channel will read. The isolation is asserted end to end as well: after a reuse
the runtime tracks only its new channel while the peers of the channel it left neither list it nor move
([`REQ-LIF-10-QR8NQ9.T1.P15`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p15)).

Residual exposure, all accepted here as recorded rather than resolved:

- **Exclusions do not survive the change of channel.** Peer blacklists live on the profiles and are dropped
  with them. This is deliberate and argued in the source, but the protocol has not decided whether an
  exclusion is channel-scoped or identity-scoped; a misbehaving peer therefore regains a clean slate when its
  victim moves to another channel. Recorded as
  [`OQ-SPEC-LEAVE-1-9Q4BV3` (Scope of peer exclusion across a channel change)](../specification/open-questions.md#oq-spec-leave-1-9q4bv3). The exposure is
  bounded by the fact that exclusions were never persisted across a restart either.
- **The drain before the reset is bounded, not guaranteed.** Scheduled chain-log work is awaited under a
  fixed 30-second bound and the running-task drain has its own bound; both continue after the bound expires
  with a warning. A pathologically slow provider could therefore let a task from the old channel finish after
  the stores were cleared. It can no longer schedule channel work — producers are stopped and the feed is
  detached first — so the worst observable outcome is a dropped late result, not a cross-channel write.
- **A rejected leave leaves the runtime bound to its channel.** This is the safe direction: local membership
  is indeterminate after a failed departure, so the runtime keeps refusing other channel work rather than
  starting it against a half-left channel. It has no exact evidence yet
  ([`FIND-LEAVE-REUSE-1-GSK8BB`](open-findings.md#find-leave-reuse-1-gsk8bb)).
- **Work from the channel left can outlive the reset.** A runtime that owes no departure resets at once,
  possibly while its initial sync for the old channel is still in flight. The reset advances a channel
  generation first, the sync persistence checks it under the same mutex the reset clears storage under, and
  the initial-sync latch ignores a result from an older generation and is re-armed only after the reset's
  status change, so a late sync neither installs old state nor decides the next channel's initial sync
  ([`REQ-LIF-10-QR8NQ9.T1.P17`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p17)). The old
  fork is retired before the first await, so a chain-log handler still running during the drain cannot
  start a reduction the drain would then strand
  ([`REQ-LIF-10-QR8NQ9.T1.P18`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p18)). A stale
  sync is not held against its responder; that side, and a sync resuming inside the reset itself, have no
  exact evidence yet ([`FIND-LEAVE-REUSE-2-1NVKS3`](open-findings.md#find-leave-reuse-2-1nvks3)).
- **Reset is refused after shutdown,** keeping `dispose()` and `abort()` terminal; the non-terminal path
  cannot resurrect a runtime that has already released its signer and provider.

## Review 472 follow-up decisions

Explicit runtime disposal is local shutdown and does not await a pending dispute upload. Graceful leave is the supported route when the caller needs completed removal, and it now also keeps the runtime; the channel-leave requirement records this distinction.

Dispute upload, reduction admission, and fraud-proof target eligibility share the bounded current snapshot/inbound set. Once a participant leaves that chain set, an old join does not keep it slashable. If the chain snapshot still lists a locally departed participant, a valid fraud proof still writes the chain slash record. Later slash/removal application to a state without that participant is an idempotent no-op under [`REQ-SM-10-JD8TSF`](../specification/protocol-model/state-machines.md#req-sm-10-jd8tsf). The stale-snapshot workflow checks repeated application and unchanged withdrawal totals.

Queue-expiry probes may accept a successor only through verified reduction lineage containing the requested fork, as specified by [`REQ-SYNC-1-T2589H` (Minimum-target proving)](../specification/peer-communication/synchronization.md#req-sync-1-t2589h). Ordinary pinned sync follows the same verified-successor rule; the pinned height applies only on the pinned fork. Blacklist and profile lifecycle logs now identify the path through existing call stacks; they do not change the accepted-lease policy. Non-reproduction of the earlier four-peer failure still does not establish its cause.

Synchronization replay always uses the spectating context. Uncommitted observers abort on provable participant fraud without requesting a dispute. Pending and participating peers retain their on-chain stake and delegate these faults to live fraud-proof and dispute handling. Pending participants also use live handling for arrivals, while the commit guard still excludes them from counter-signing. The exact declarations are mapped in the [validation report](../verification/tests/test/unit/ValidationService.test.ts.md).

Absent-target handling is specified separately by [`REQ-SM-10-JD8TSF`](../specification/protocol-model/state-machines.md#req-sm-10-jd8tsf). Successful slash and removal now both record their returned exit under [`REQ-SM-8-8CHSQ8`](../specification/protocol-model/state-machines.md#req-sm-8-8chsq8); [`OQ-18-2NK97T` (Exit-recording asymmetry between slash and remove)](../specification/open-questions.md#oq-18-2nk97t) is implemented. Wrapper tests cover absent, present and repeated targets separately; the dispute consumer checks one exit and a matching withdrawal delta.

Sync timeout and transport-failure liability is retained by the owner: honest peers are assumed to observe the same reality within agreementTime. No universal provider or execution bound is proved by this implementation. Local successor installation is not required to serve its already computed proof; requested same-fork heights are minimums.

Sync verification reads chain reduction finality before refreshing its local dispute windows. This preserves a conservative reduction decision when a transaction lands between the reads and prevents another sync’s local-only simulation from suppressing required chain calldata. Proof validation and peer liability are unchanged. One static multicall reads finality for all supplied windows. Successful local reduction verifies the expected fork in Solidity; the already-final branch uses this request’s fetched chain window. A competing sync can overwrite the shared local mirror without invalidating either proof. Payload length remains uncapped, so the batched call and local verification work still scale with supplied windows.

The retained sync design keeps each request's snapshot-update simulation complete independently
of concurrent local proof work. Local verification is not evidence of chain execution, so it
cannot alone remove reduction calldata. Reusing verified work remains a non-blocking
[implementation performance question](../implementation/open-questions.md#oq-impl-sync-1-hjc60d);
proof validation and blacklist liability are unchanged.

Authored departure now rejects if its dispute fallback fails after either a failed fully signed snapshot post or an unsigned exit. The failure notification checks both the operation phase and fork, so a stale task cannot reject a new operation. Observer-hook tests separate provable-fault aborts from disputed-fork discard. Disputed-fork hooks never restore the entry; committed peers retain acknowledged-supplier liability, while unacknowledged suppliers and observers are not penalized for this branch.

Internal lifecycle cleanup accepts requests from registered parent connections only. Readiness resolves only the invoking child connection. These services remain off the network root. Forced connection loss rejects pending readiness, and rejected upward cleanup does not invoke response-triggered closure.

## Root creation boundary

Root entries are selected by trusted local callers through explicit URLs; no remote module-discovery protocol or automatic service registration was added. Startup payloads cross structured clone in both modes, while local constructors, loggers and execution context stay in the receiving realm. Connections remain internal and parent-owned. Lifecycle admission and network service exposure are unchanged. A worker failure rejects its own readiness and pending calls without closing its SDK owner or siblings.

## Initialized root creation follow-up

Common internal error endpoints accept reports from registered child connections only. They remain absent from the network root. Request failures return through their response path; autonomous reports travel upward. Startup failure rejects the owning readiness promise and closes only that child. Cloneable startup data and explicit browser entry URLs retain the existing capability boundary.

Engineer approvals and review fingerprints remain engineer-owned. This update does not clear unrelated audit queues.

## Explicit root creation API

The free createRoot function now constructs local top-level roots or connected children with an explicit parent. Top-level application handlers stay local; child startup keeps the existing clone boundary. SDK root observation retains connection-before-observer and observer-before-child-start order. RootCreation adds two real SDK placement cases and retains child creation/failure recovery cases. Existing approval and impact queues remain unchanged by this API decision.

## Generic worker creation

Root classes now pass directly to createRoot. One platform worker creator takes an explicit URL, with no per-root factory or entry wrapper. Built-in roots use internal static worker entry URLs. Generic custom-root creation accepts an explicit URL; startup payloads do not carry child entry URLs. The shared worker globals use one path for all launched roots. Relevant startup, error, cleanup and browser evidence is being refreshed; engineer fingerprint approval remains pending.

## Client-root ownership and initialization

The application instance now references its initialized client root directly. The client root owns host communication and bridge resources. Application setup owns deployments and adapters; P2pInstance owns application listeners and logger cleanup. Common creation awaits initialization for every root. Top-level creation is inline and returns the root; worker creation requires a parent and returns that parent's registered connection record. No raw bootstrap port is exposed by that record.

The new creation cases exercise delayed standalone initialization, missing parent rejection before allocation, held host readiness in both placements, independent deployments and cleanup after either deployment or client observation fails. Existing client error, timeout, disposal and browser bridge boundaries remain part of verification. A missing logger connection registration found by the report-a-bug E2E was restored; the focused collection and root-creation cases pass together. The focused teardown cases pass; the final full run is recorded in the implementation handoff. Existing generated queues remain unchanged. This update grants no engineer approval.

The engineer approved host shutdown preparation before the child cascade. Run-310 confirmed the earlier race in discovery fallback cleanup: the test body passed, then reduction calls rejected because the executor was closed. The host now invokes the existing StateManager stop-and-drain owner before common child disposal. Final local cleanup still runs after failure and repeated calls reuse completion. A separate startup cleanup change unregisters a host whose observation callback throws before parent attachment. Focused ordering, preparation-failure and teardown cases pass, including an executor read while preparation is held. Parented inline client creation uses host connection options and sends its disposal acknowledgement before closing the parent connection. Missing connection options reject before allocation. Both browser gates pass on this source state. Final full-run evidence and the unchanged generated queues are recorded in the implementation handoff.

## Application setup ownership correction

The user superseded review 4's application-heavy client root. Application setup now owns config, logger creation, adapters, two deployments and final assembly. The client root owns host communication and common lifecycle only; P2pInstance owns application cleanup. Root readiness means usable communication, while application setup still waits for deployment completion. Existing startup errors, parent-required workers, host preparation before child disposal and bridge behavior remain in scope. The focused and final evidence is recorded in the application-setup implementation follow-up. Engineer approval and existing queues remain unchanged.

## Logger gossip follow-up

The engineer replaced acknowledged global flushes with best-effort generation gossip. [LoggerService](../implementation/source/src/rpc/internal/services/logger/LoggerService.ts.md) owns its attached store map and one scalar index; [Logger](../implementation/source/src/utils/logging/Logger.ts.md) owns local uploading and one optional service reference in sharedResources. Common roots create logging before startup. Equal/older generations are suppressed even after the window; invalid indexes are rejected. Remote delivery is not claimed by a local promise. Late entries can wait for another generation under the accepted timing assumption. Existing HTTP retries and secret-field encoding remain with the uploader.

The obsolete folded-summary finding no longer describes the current contract. Source and test changes require engineer re-verification; no approval register was changed.
