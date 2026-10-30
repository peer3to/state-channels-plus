# Audit Open Questions

> **Status:** Maintained current register.
> **Scope:** Unresolved assessment completeness, residual risk, classification, and readiness requiring engineer decisions.

Every question has one primary layer. Cross-layer effects remain links rather than duplicate entries.
Existing `OQ-*` IDs are preserved; new questions use the layer-scoped namespace documented in governance.

## Index

| ID                                                                         | Question                                                     | Source                          | Affected documents                                                                                                                                                                                             | Status                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| [`OQ-5-4Q38M5`](open-questions.md#oq-5-4q38m5)                             | Fraud-proof completeness security review                     | Specification analysis          | [security/open-security-review.md](./security-assessment.md), [protocol/fraud-proofs.md](../specification/disputes/fraud-proofs.md)                                                                            | Open                  |
| [`OQ-AUDIT-LOBBY-1-9S3GVD`](open-questions.md#oq-audit-lobby-1-9s3gvd)     | Lobby accepted-lease exclusion versus the no-punishment rule | Gate flake root-cause plan 30   | [security-assessment.md](./security-assessment.md), [lobby-matching.md](../specification/peer-communication/lobby-matching.md)                                                                                 | Resolved (2026-09-02) |
| [`OQ-AUDIT-RUNTIME-1-HH601X`](open-questions.md#oq-audit-runtime-1-hh601x) | Watchdog threshold under gate load                           | Gate flake root-cause plan 30   | [security-assessment.md](./security-assessment.md), [runtime/configuration.md](../specification/runtime/configuration.md)                                                                                      | Open                  |
| [`OQ-AUDIT-DISPUTE-1-ER4Y3D`](open-questions.md#oq-audit-dispute-1-er4y3d) | State contributions without another reason                   | Plan 30 decision 9              | [`REQ-DISPUTE-PIPE-9-TDWQPV`](../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv)                                                                                                       | Resolved (2026-09-05) |
| [`OQ-AUDIT-DISPUTE-2-TPMNQX`](open-questions.md#oq-audit-dispute-2-tpmnqx) | Recheck a timeout refused for early chain time               | Plan 30 review 8 owner decision | [`REQ-DISPUTE-PIPE-10-BT8YAR`](../specification/disputes/dispute-processing.md#req-dispute-pipe-10-bt8yar)                                                                                                     | Resolved (2026-09-05) |
| [`OQ-AUDIT-RUNTIME-1-3P2PTW`](open-questions.md#oq-audit-runtime-1-3p2ptw) | Application module cloneability                              | Implementation audit            | [`REQ-RUNTIME-1-RSM6MZ`](../specification/runtime/execution.md#req-runtime-1-rsm6mz), [implementation.md](./implementation.md)                                                                                 | Open                  |
| [`OQ-AUDIT-SYNC-1-83NTJY`](open-questions.md#oq-audit-sync-1-83ntjy)       | Inbound blocks in the sync payload                           | Engineer question (2026-10-07)  | [`FIND-SECURITY-5-1KP5YX`](open-findings.md#find-security-5-1kp5yx), [`FIND-SYNC-4-KGP4KF`](open-findings.md#find-sync-4-kgp4kf), [synchronization.md](../specification/peer-communication/synchronization.md) | Open (low priority)   |
| [`OQ-AUDIT-RPC-1-BQA20A`](open-questions.md#oq-audit-rpc-1-bqa20a)         | Send reads and transactions to multiple nodes                | PR #511 review (2026-10-07)     | [security-assessment.md](./security-assessment.md), [chain-observation.md](../specification/runtime/chain-observation.md)                                                                                      | Open                  |
| [`OQ-AUDIT-RPC-2-4VVAT0`](open-questions.md#oq-audit-rpc-2-4vvat0)         | Universal keepalive for idle chain WebSocket connections     | Live poker bots (2026-10-15)    | [`OQ-AUDIT-RPC-1-BQA20A`](open-questions.md#oq-audit-rpc-1-bqa20a), [chain-observation.md](../specification/runtime/chain-observation.md)                                                                      | Resolved (2026-10-26) |
| [`OQ-AUDIT-RUNTIME-2-BC6Q5G`](open-questions.md#oq-audit-runtime-2-bc6q5g) | Resume after a frozen page or process                        | Phone poker page (2026-10-30)   | [`OQ-AUDIT-RUNTIME-1-HH601X`](open-questions.md#oq-audit-runtime-1-hh601x), [BrowserLogger.ts](../../../src/utils/logging/browser/BrowserLogger.ts)                                                            | Open                  |
| [`OQ-AUDIT-RUNTIME-3-18DXNX`](open-questions.md#oq-audit-runtime-3-18dxnx) | Chain events handled during recovery                         | Phone poker page (2026-10-30)   | [`FIND-RUNTIME-4-5ZZD5T`](open-findings.md#find-runtime-4-5zzd5t), [EventHandler.ts](../../../src/eventHandlers/EventHandler.ts)                                                                               | Open                  |

<a id="oq-5-4q38m5"></a>

## OQ-5-4Q38M5 — Fraud-proof completeness security review

The current fraud-proof list must not be treated as complete. A dedicated security review must ask
which objectively provable violations lack a fraud proof and which attack paths are not prevented,
detected, or recoverable — across block production, signatures/equivocation, virtual voting, state
proofs and milestone hops, membership changes, message streams, snapshot updates, proof
submission, slash-set handling, reduction, timing, data availability, RPC trust, leader election,
and cross-layer interactions. Tracked in detail by
[security/open-security-review.md](./security-assessment.md).

<a id="oq-audit-lobby-1-9s3gvd"></a>

## OQ-AUDIT-LOBBY-1-9S3GVD — Lobby accepted-lease exclusion versus the no-punishment rule

[`REQ-SEC-3-NPPJN5` (The review MUST separate objective slashable violations from non-Byzantine…)](security-assessment.md#req-sec-3-nppjn5) says non-Byzantine failures are never punished.
The lobby handoff bounds both sides with one agreement window, and before this decision the first side to
close a transport cancelled the other side's punishment, so a silent or disconnected counterparty was excluded
only when both bounds fired first. The question was whether a peer that loses its final transport after an
accepted lease may be excluded locally.

**Resolution (owner, 2026-09-02).** Yes. After an accepted lease the loss is an agreement-window liability:
the advertiser excludes at its reservation bound and the selector excludes when its in-flight commitment is
rejected. The exclusion is a local lobby reputation entry, not on-chain punishment, so [`REQ-SEC-3-NPPJN5` (The review MUST separate objective slashable violations from non-Byzantine…)](security-assessment.md#req-sec-3-nppjn5) now
states the objective on-chain rule and this local exception separately. Accepted consequence: a partition
during the handoff excludes two honest peers from each other for the blacklist lifetime. The broader
availability and local-fault blacklist finding ([`DEF-5-E8TP9N`](open-findings.md#def-5-e8tp9n),
[`DEF-9-724SXP`](open-findings.md#def-9-724sxp)) stays open for every other path;
[`DEF-10-199C7F`](open-findings.md#def-10-199c7f) is resolved.

**Revision (owner, 2026-09-17).** The lobby consequence is no longer an exclusion or a session bar. It
is the counted close of the disconnect ladder ([`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)):
each side records one strike against the absent peer at its own timing, the peer stays selectable below
the bound, and the strike that reaches the bound suspends it for the session without a verdict. A
partition during the handoff now costs two honest peers one retry each. The same ladder covers the
sync-request and dispute-acknowledgement silence paths that were retained on 2026-09-07.

<a id="oq-audit-runtime-1-hh601x"></a>

## OQ-AUDIT-RUNTIME-1-HH601X — Watchdog threshold under gate load

The test configuration keeps a one-second `EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS`. After plan 30
a trip inside a worker is a reported detached error with the runner's one starvation retry, not a
dead peer, so the threshold no longer costs a runtime its EVM state. Whether the farm's
six-tests-per-server load and that threshold are compatible is a separate policy question: 41 of
701 gate runs tripped it, 29 of them in the contract-executor worker. Raising the threshold to pass
is not an option (the threshold is the load bound); the open decision is the farm's load per server
or the classification of trips that recur only under that load.

<a id="oq-audit-dispute-1-er4y3d"></a>

## OQ-AUDIT-DISPUTE-1-ER4Y3D — State contributions without another reason

**Resolution (owner, 2026-09-05).** How can an honest peer contribute newer valid state to an open
window without self-removal or an invented reason? The signed `requireExistingDisputeWindow`
boolean supplies the reason only after admission verifies the existing window. Later kills do not
invalidate that accepted reason. A pre-submission window refusal recovers on-chain slashes through
the existing owner and re-enters normal construction when the observed set changed. This closes
the reason-less contribution path; it does not grant exceptions to any other validity check.
See [`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv).

<a id="oq-audit-dispute-2-tpmnqx"></a>

## OQ-AUDIT-DISPUTE-2-TPMNQX — Recheck a timeout refused for early chain time

**Resolution (owner, 2026-09-05).** A specific early-chain-timestamp refusal re-arms the existing
participant-timeout check after marker rollback and mutex release. The delay uses the contract's
minimum and current timestamps with a one-second floor. Revalidate current evidence and fork relevance;
never blindly resend a signed dispute. An older dispute window remains ineligible and unrelated
errors retain their existing handling. See [`REQ-DISPUTE-PIPE-10-BT8YAR` (Recheck an early timeout submission)](../specification/disputes/dispute-processing.md#req-dispute-pipe-10-bt8yar).

<a id="oq-audit-runtime-1-3p2ptw"></a>

## OQ-AUDIT-RUNTIME-1-3P2PTW — Application module cloneability

Open. Internal RPC uses structured cloning. Application-defined custom RPC and precompile inputs must obey that boundary; functions and live provider objects cannot be transferred. The remaining question is whether the SDK should validate all application-defined payload shapes before posting, or continue reporting the platform clone failure. Built-in signer requests are projected before posting. This is a boundary limit, not approval to broaden the wire contract.

Owner: [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../specification/runtime/execution.md#req-runtime-1-rsm6mz). Evidence and scope: [implementation audit](implementation.md).

<a id="oq-audit-sync-1-83ntjy"></a>

## OQ-AUDIT-SYNC-1-83NTJY — Inbound blocks in the sync payload

Open; low priority. Asked by Luka (2026-10-07). Each dispute window in a sync payload carries the
responder's `inboundMessageBlocksAppliedInReduce`. All relevant inbound blocks are already on chain:
the `InboundMessagesProcessed` events and the event-sync log recovery deliver them. Why does sync
receive them from the responder at all? Reading them from the chain would make this input trustless
and remove the edge cases that [`FIND-SECURITY-5-1KP5YX`](open-findings.md#find-security-5-1kp5yx)
and [`FIND-SYNC-4-KGP4KF`](open-findings.md#find-sync-4-kgp4kf) fixed.

Alternatives: keep the field, where the local `reduceAndFinalize` takes it as input and only a
window that this sync reduces stores it (the current rule); or take a window's inbound blocks from
chain data and drop the field from the sync payload. Blocking effect: none; the current rule keeps
unchecked inbound blocks out of trusted storage. Requested decision: whether sync should keep
receiving inbound blocks from the responder.

Owner: [`INV-SYNC-1-XCQZ28` (Nothing trusted on receipt)](../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28).
Evidence and scope: [SpectateService report](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md).

<a id="oq-audit-rpc-1-bqa20a"></a>

## OQ-AUDIT-RPC-1-BQA20A — Send reads and transactions to multiple nodes

Open; not critical now, to consider for production. Subscriptions already use every node: block
events and contract-log subscriptions are made on every connected node socket, again on every
reopened one, and each block and log is delivered once
([`REQ-CHAINOBS-3-N137ZP` (Per-endpoint observation with reconnect and catch-up)](../specification/runtime/chain-observation.md#req-chainobs-3-n137zp),
[`REQ-CHAINOBS-4-JA3YF8` (Application chain access over the same endpoint set)](../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8)).
The open part is requests. The current design sends every read and transaction to the first
connected endpoint and fails over when it drops
([`REQ-CHAINOBS-2-2NCSQ3` (One endpoint per request, with failover)](../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3)).
The alternative is to send each request to several endpoints at once. Endpoints replicate a
transaction in the mempool anyway, so sending it to several should not change on-chain behavior. It
raises the chance of success when the selected endpoint dies: there is no wait to recover and
reconnect to another endpoint, which could be fatal if it takes long. Every response can be
deduplicated: treat the endpoints as redundant connections where the first response wins.

<a id="oq-audit-rpc-2-4vvat0"></a>

## OQ-AUDIT-RPC-2-4VVAT0 — Universal keepalive for idle chain WebSocket connections

Resolved (2026-10-26) by alternative (b). The SDK exports `createRpcNodesProvider` (and the type
`MultiRpcProvider`) from `src/index.ts`: a provider over the same configured endpoints, with the node
layer's heartbeat, reconnect and failover, and contract-log subscriptions over every node socket
([`REQ-CHAINOBS-4-JA3YF8` (Application chain access over the same endpoint set)](../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8)). Luka's rule (shared poker client manager plan): every component
uses the SDK's provider set with the same endpoints as the SDK; failover and when to throw live inside
that provider; a capability the SDK provider lacks is recorded as an SDK open finding, not worked
around. The remaining provider limits are [`FIND-RPC-3-FY8YV3`](open-findings.md#find-rpc-3-fy8yv3),
[`FIND-RPC-4-7H2R11`](open-findings.md#find-rpc-4-7h2r11), [`FIND-RPC-5-G4WNX5`](open-findings.md#find-rpc-5-g4wnx5) and
[`FIND-RPC-6-CZ4GCV`](open-findings.md#find-rpc-6-cz4gcv). The history below is the context of the question.

Seen three times in live poker bots (2026-10-15). An application's own ethers
`WebSocketProvider` that stays idle for minutes was dropped on the path to
`wss://dev.peer3.network/private-testnet-ws/`. The case is the poker client's discovery provider: it is
idle during play, because the SDK runtime uses its own RPC connections. The first read after a long
table session hung for 20–30 s, the socket closed with code 1006, and the bot exited on provider
loss. The most likely cause is a proxy idle timeout. As a stopgap, poker-contracts' `PokerClient` now
sends a cheap keepalive read every 30 s on its provider (Luka, 2026-10-15).

The SDK's own node connections already have a liveness check. Each open node socket runs
`checkHeartbeat` every 10 s (`HEARTBEAT_INTERVAL_MS`,
[RpcNodeProvider.ts:21](../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L21), started at
[RpcNodeProvider.ts:445](../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L445)). It sends
`eth_blockNumber`
([RpcNodeProvider.ts:476](../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L476)); no answer
within 5 s (`HEARTBEAT_TIMEOUT_MS`,
[RpcNodeProvider.ts:23](../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L23)) ends the
socket and starts a reconnect
([RpcNodeProvider.ts:494](../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L494)). This
traffic keeps the path busy below a minutes-long idle timeout, and a dropped socket reconnects with
requests held until then. So the SDK's own connections are not exposed to this drop. The gap is
only the providers that applications create themselves: `RpcNodeProvider` and `MultiRpcProvider`
were not exported from `src/index.ts` then.

Alternatives: (a) every application keeps its own keepalive (the state then); (b) the SDK gives
applications a provider factory or helper built on its node layer
(`src/evm/p2pRuntime/rpcNodes`), so every WebSocket an application opens gets the same heartbeat,
idle detection and reconnect, and the poker client's keepalive is then removed. Blocking effect:
none; the stopgap keeps the bots running. Requested decision: whether the SDK should own one
universal keepalive for every chain WebSocket, including the ones applications open. A timer-based
keepalive also has a browser limit (not verified): browsers throttle timers in hidden tabs, for
example to about once per minute, so a hidden tab's keepalive can fall behind a short proxy idle
timeout; the universal solution must account for that.

Related: [`OQ-AUDIT-RPC-1-BQA20A`](open-questions.md#oq-audit-rpc-1-bqa20a),
[chain-observation.md](../specification/runtime/chain-observation.md).

<a id="oq-audit-runtime-2-bc6q5g"></a>

## OQ-AUDIT-RUNTIME-2-BC6Q5G — Resume after a frozen page or process

Seen on a phone (2026-10-30). A poker page stayed in a background tab for about 8 h 25 min. Android
froze the tab and its workers. On return the browser event-loop monitor measured that frozen time
as one delay of 30,273,182 ms, above the web app's 3,600 s
`EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS`, and threw. The runtime failed, and the page showed
its fatal "Poker stopped" modal.

The monitor measures how late a 50 ms timer fires
([BrowserLogger.ts:188-197](../../../src/utils/logging/browser/BrowserLogger.ts#L188-L197)) and
throws past the threshold
([BrowserLogger.ts:136-149](../../../src/utils/logging/browser/BrowserLogger.ts#L136-L149)). It
cannot tell a frozen page from a thread that runs and is blocked. The SDK has no handling for
page freeze or resume: no `freeze`, `resume` or `visibilitychange` listener exists in `src/`.

Luka's direction (2026-10-30): the SDK gets one general resume hook, for example
`onResumeFromFreeze`. It follows the browser Page Lifecycle convention (`freeze`, `resume`,
`visibilitychange`) and is general enough to apply later to Node.js or other hosts (for example a
process resumed after a system sleep). On resume the SDK resyncs what the frozen time made stale,
and the monitor restarts its measurement, so it measures only the event-loop delay of a running
thread and never trips on frozen time. Other components that depend on timers can use the same
hook.

Rejected for the long term: (a) a browser monitor that only reports and never throws; (b)
per-thread visibility listeners with ad hoc baseline resets forwarded to each worker; (c) a
threshold of 0, which also turns the monitor's reports off.

Open decisions: which events start the hook in each host (browser page, dedicated worker, Node.js);
how the page tells its SDK workers, which get no page lifecycle events; what the SDK resyncs on
resume (chain view, channel membership and state, peer connections, timers and deadlines that
passed while frozen); and whether a stale runtime resyncs in place or is rebuilt.

Second sighting (2026-10-30, channel
`0xba7b073a1a062661814979c9968eb4bf2cdc07033bce1ac06ebf29e0b4bb7675`): the same phone was in the
background for about 90 s, with the web threshold already at 2 s. The worker monitor did not see
the pause: its reports just before and just after it give a maximum delay of 289 ms and 364 ms. Timer
gaps are therefore not a reliable freeze signal, and the hook has to start from the host's resume
events. On return the runtime replayed the dispute events it missed and failed for a different
reason, fixed in `EventHandler.handleDisputeCommitted`: a dispute whose window a later state
snapshot update already cleared is now ignored. A peer still seated after such a missed cycle fails
later: [`FIND-RUNTIME-4-5ZZD5T`](open-findings.md#find-runtime-4-5zzd5t).

Stopgap (2026-10-30): the poker web app reloads the page, instead of showing the fatal modal, when
the fatal failure is an event-loop delay above 3 s. Blocking effect: none while that stopgap is in
place.

Related: [`OQ-AUDIT-RUNTIME-1-HH601X`](open-questions.md#oq-audit-runtime-1-hh601x),
[`OQ-AUDIT-RPC-2-4VVAT0`](open-questions.md#oq-audit-rpc-2-4vvat0).

<a id="oq-audit-runtime-3-18dxnx"></a>

## OQ-AUDIT-RUNTIME-3-18DXNX — Chain events handled during recovery

Raised by Luka (2026-10-30). A runtime that was paused, or that catches up after a gap, handles the
chain events it missed in arrival order, and they run concurrently. Each handler then decides
against chain state that has already moved past the event: a dispute window a later snapshot update
cleared, inbound message blocks it pruned, a fork that was reduced and replaced. Two fixes of
2026-10-30 are local patches for this:

- `EventHandler.getRelevantWindow` ignores a dispute whose window the chain already cleared;
- `LeaveChannelService.dropIfRemovedWhileAway` ends the membership of a peer that a snapshot update
  it never installed removed.

A peer that is still seated after such a cycle cannot install the new fork and fails
([`FIND-RUNTIME-4-5ZZD5T`](open-findings.md#find-runtime-4-5zzd5t)).

Open decisions:

1. How events are handled during recovery in general: handle each in order against the chain as it
   is now, skip events whose effects the chain already settled, or first sync to the latest chain
   state and then handle only the newer events.
2. How a peer that was away reduces: whether it replays the reduction from the events, or adopts the
   reduced fork and its snapshot from the chain and its peers.
3. How it syncs to the new fork: from its persisted state plus the on-chain snapshot (Luka's
   direction in [`FIND-RUNTIME-4-5ZZD5T`](open-findings.md#find-runtime-4-5zzd5t)), or from a peer.
4. Whether the two local patches above stay once this is designed, or are replaced by it.

Blocking effect: none for now; the patches above cover the observed case (a removed peer).

Related: [`OQ-AUDIT-RUNTIME-2-BC6Q5G`](open-questions.md#oq-audit-runtime-2-bc6q5g).
