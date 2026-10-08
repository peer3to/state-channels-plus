# Implementation Assessment

> **Agent assessment:** In progress.
> **Engineer disposition:** Pending.

## PR #520 third-review and CI corrections (2026-10-07)

The [localDiamond report](../implementation/source/src/utils/localDiamond.ts.md) now anchors its
conformance claims to the current declarations and expressions. The
[stale-membership test report](../verification/tests/test/e2e/E2E-StaleMembershipDispute.test.ts.md)
records direct malicious-dispute submission instead of a double-sign trigger that also opened an
unrelated honest dispute. The
[balance-invariant test report](../verification/tests/test/e2e/disputeValidation/balanceInvariant.test.ts.md)
records the previously approved 15-second evidence window for both sequential audit orders.
Their existing membership-fraud, exact-counter, slash and reduction oracles are retained.
The CI artifacts demonstrate expired evidence/kill windows, not an invalid membership-proof verdict.
No SDK or contract behavior changes are made for these failures; the sync-reduction gas finding remains deferred.

## PR #520 second-review corrections (2026-10-07)

The local-first revert behavior is unchanged: local errors propagate without a chain fallback.
The [local-mirror test plan](../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys.t1)
now names separate fatal-revert permutations for the four audit predicates and dispute construction.
Their existing declarations are mapped in the
[audit-read report](../verification/tests/test/unit/DisputeValidationServiceLocalFirst.test.ts.md)
and [construction report](../verification/tests/test/unit/DisputeManagerLocalFirst.test.ts.md).
The [local binding report](../implementation/source/src/utils/localDiamond.ts.md) also removes
obsolete revert-fallback claims and gives the helper's two revert tests explicit obligations.
This repairs traceability, not the deferred sync-reduction gas finding; that finding remains open.
Runtime validation is recorded in the private round-two assessment; this paragraph makes no
claim that the full gate passed on the modified tree.

## PR #520 author decisions (2026-10-07)

Luka confirms the deliberate fixture timing increases, including `balanceInvariant`’s 15-second evidence
window, as exceptions permitted by the test guidance. Keep PR #520 targeting `crew/cost-scheduler`;
its base-relative integration scope is intentional. Neither decision certifies runtime tests or closes
unrelated protocol findings. The P2P timing changes were also explicitly requested earlier.

Luka deferred SO1 and its complete local/on-chain reduction gas investigation outside this PR; see
[`FIND-SYNC-REDUCTION-GAS-1-AJE985`](open-findings.md#find-sync-reduction-gas-1-aje985).
Successful on-chain replay must be established in the follow-up. Local exhaustion alone does not prove
on-chain impossibility, and this PR does not change reduction failure handling.

## Local discovery endpoint replacement

The local adapter now retains the latest endpoint announcement per peer within its topic session and resolves it at retry. Previously an announcement arriving during a stale endpoint dial could be discarded by cross-topic deduplication, leaving retries permanently targeting the closed port. The existing authenticated transport and pending-dial admission gates remain; new endpoint metadata does not bypass authentication. See the [source report](../implementation/source/src/utils/node/LocalDiscoveryServer.ts.md) and [component evidence](../verification/tests/test/utils/LocalDiscoveryServer.test.ts.md). Historical cost run 435 and FIFO (`-w 6`) run 436 were reported to pass all 3,405 tasks, including Forge and both browser gates, with no starvation or infrastructure retries. Their exact source SHA has not been established; they are not evidence that the current PR head passes. Subsequent runner and dispute-test changes require fresh validation.

## Runtime cleanup and context forwarding

[LocalDiscoveryServer](../implementation/source/src/utils/node/LocalDiscoveryServer.ts.md) checks the accepting manager before constructing an inbound transport, including while shared discovery remains active. [LoggerService](../implementation/source/src/rpc/internal/services/logger/LoggerService.ts.md) suppresses context echo to the inbound connection, so rapid channel changes do not replay older values between adjacent roots. These repairs preserve the existing lifecycle and identity requirements.

## Root ownership and startup

[AInternalRpcRoot](../implementation/source/src/rpc/internal/AInternalRpcRoot.ts.md) owns the parent and children and the shared disposal sequence. Each concrete root implements abstract instance startup and disposal. Common creation constructs the class and retains the instance before awaiting startup; no separate static lifecycle interface remains. Host preparation stops and drains work before recursive child disposal; final cleanup runs even after an earlier failure. [RemoteRoot](../implementation/source/src/rpc/internal/RemoteRoot.ts.md) keeps RPC access, diagnostics and connection lifetime together. Application setup remains outside the client communication root.

The bridge tree is host, worker bridge, then main-thread broker. The port travels through services; external broker installation does not block readiness. An unattached broker connection can be disposed without waiting for installation. Built-in worker URLs are internal platform assets. Thin worker entries explicitly start their roots. Root imports are inert; class names no longer select bootstrap. Worker policy is common and threadName is diagnostic global state. Public worker overrides and the separate executor dependency bag are removed.

Each RuntimeHost creates its fallback bridge and binds its factory to that host’s WebRTC setup service. Native WebRTC still uses the local factory. Separate inline hosts cannot replace each other’s bridge or peer maps.

## Shared runtime RPC ownership

Each manager now owns one [NetworkRpcRouter](../implementation/source/src/rpc/router/NetworkRpcRouter.ts.md), constructed before services and without active constructor work. The manager no longer inherits request tracking. Unused manager routing delegates have been removed; transport ingress, requests, broadcasts and disconnect rejection reach that same router directly. Network/internal services and internal roots have explicit category bases and reside under `src/rpc`; all routers share `src/rpc/router`.

The manager dependency remains explicit after extraction: live connections, root, logger, scheduling and peer-policy methods are used directly. No smaller dependency abstraction is needed for this move. Common transport forwarding uses a typed sender/router contract. Network conversion and internal structured clone remain distinct, including live-resource transfers. Receive-after-close behavior is preserved: internal input is filtered at the runtime router, while network admission remains unchanged. No new universal closed guard is claimed.

The runtime refactor separates [network transports](../implementation/source/src/transport/NetworkTransport.ts.md)
from [internal port transports](../implementation/source/src/transport/InternalTransport.ts.md).
[ARpcRouter](../implementation/source/src/rpc/router/ARpcRouter.ts.md) owns all request registration,
correlation, deadlines and settlement. [RpcDispatch](../implementation/source/src/rpc/RpcDispatch.ts.md)
owns endpoint lookup and one response-send attempt. The shared router awaits service.runRPC. RpcDispatch keeps execution and response construction together; category services retain local guard and error/reply policies. Guard replay calls the original service, whose consumed verdict prevents early acknowledgements. Independent transport callbacks preserve concurrent ingress. Peer admission, authenticated
replacement response admission belongs to NetworkRpcRouter; penalties remain manager operations and peer guards remain network-service policy.

Each SDK/client/executor endpoint composes one root across its connections. SDK setup owns
executor creation and the common facade in both placements. Inline calls cross a MessageChannel;
abort disposes the owning host root and its children in both placements. Local initiation sends a disposal notification before closing its parent connection; request-driven cleanup sends its response first. Parent handles retire the connection and await worker shutdown without sending another cleanup request to a closed port. The engineer confirmed full abort cleanup on 2026-09-11.

The old SDK, executor, WebRTC and logger protocols, duplicate pending registries, logger bus and
standalone public executor factory are removed. Domain error preparation, signer encodings,
readiness order, worker first-fatal error selection and report-and-continue callbacks retain their
owners. Explicit transfer lists reach postMessage once. The impact checker reads removed reports
from the selected Git comparison and keeps missing ownership/migration visible.

Logger collection walks each root’s parent and child connections, including worker
children owned by inline SDK roots. Each caller receives its local upload outcome; gossip has no global completion total. The removed folded-summary collection policy imposes no current completion obligation; other logger limitations remain separately recorded. Manifest functions and live resources cannot
cross the approved inline structured-clone boundary.

The simplification review fixes narrow bytes32 inputs through an assertion signature and remove the remaining queue-key forwarding method. The separate import-order change preserves all non-import executable statements, all imported bindings, and side-effect import boundaries. Runtime initialization order is checked by the distributed and browser gates; TypeScript suppression comments remain attached to their original imports.

Post-handshake connection ownership is now centralized in `P2PManager`. Local channel status is
the only admission input: every completed live transport is promoted, while `OPENED` alone performs
the participant read and sync. Join and spectate RPC paths provide no alternate promotion or
peer-supplied membership hint. Participant-read failure, close, disposal, and replacement races are
contained without undoing valid authentication or creating a late connection.

Every network transport creates an addressless `PeerProfile` immediately, and the Holepunch ban handle is
stored there before authentication. `ProfileManager` authenticates and indexes that same profile and
owns all ban/unban policy. Generic transports expose no SDK ban handle. Fallback release checks the
profile's full live transport set, so a non-preferred WebRTC transport in upgrade grace keeps Holepunch
banned and explicit blacklist state wins.
Authentication is also a final admission gate: a late Holepunch connection cannot replace healthy
WebRTC or reattach an excluded identity, while a fallback after current-WebRTC close can become
current and carry traffic.
Relay retry state has one owned timer, which success cancels before resetting the pool. Holepunch
topic join/leave retains its byte-exact `Buffer` contract.

Join admission now keeps recorded membership separate from countersign eligibility: snapshot and
pending participants remain members, on-chain-slashed members lose veto power, and slashed members
cannot top up. The public paths preserve exact fork/snapshot pins and deadline semantics and invoke
the manager's atomic composable-deposit path; the manager, not the facet, owns the inbound JOIN
append and cumulative-total update.

Off-chain join authorization uses the same slash-excluding threshold set on collector and
responder paths. The collector now rejects a deadline with no positive collection window before
it signs or sends requests; positive windows cap every request at the earlier of the agreement
timeout and the join deadline. The responder keeps the inclusive deadline boundary used by
on-chain submission.

Snapshot submission now has explicit component obligations for admissible submission, unresolved
reduction stand-down, unconsumed-inbound preparation refusal, and no on-chain mutation after that
refusal. Forced-inclusion verification follows the pending JOIN through reduction into the
successor participant set and through one complete leader-election cycle where the joiner authors
an accepted block.

The runtime lifecycle waits for the application root's readiness hook before admission and preserves readiness failures while disposing partial resources. Each isolated context starts monitoring after its own ready work and uses the same configured fatal-delay threshold. The test harness starts its main-thread monitor after initial peer setup.

Runtime extension boundaries no longer depend on constructor identity for RPC services, transports, or ethers Result values. They validate the complete public shape consumed by the caller, so compatible SDK and ethers copies can coexist in one production bundle without breaking proxy resolution, dispatch overloads, or result normalization. The linked source reports and runtime design views record these boundaries; engineer review remains pending.

Inbound RPC endpoint authorization is separate from those structural checks. The dispatcher walks the
application methods hierarchy only up to `ANetworkRpcMethods.prototype`, accepts function-valued data properties,
rejects base members and accessors, and invokes the captured function on both delivery paths. This resolves
[`DEF-7-PK564B`](open-findings.md#def-7-pk564b) without breaking inherited application endpoint families.

RPC wire parsing, ingress ordering, guards, and every implemented request-settlement path now have
exact component obligations and evidence. Request settlement remains partial because there is no
cancellation API. Resource control remains partial: the frame-size bound exists, but pending-call,
per-peer, and aggregate work limits do not. Protocol compatibility remains missing because neither
the envelope nor handshake negotiates a version. [`DEF-8-HWJ10N`](open-findings.md#def-8-hwj10n)
is resolved: handler and guard response sends use one guarded attempt, then disconnect on failure
without a second send or unhandled rejection.

The authenticated-RPC guard records admission per exact transport. A replaced but open authenticated
pipe remains valid during upgrade grace overlap. Queued work releases only when its own transport
authenticates; closure, timeout, and disposal clear it, and stale failure cannot punish a replacement.
A frame dispatched after local transport close is dropped instead of treating retirement as peer malice.

The runtime event bridge also preserves application-defined hook names and cloneable payloads without adding
those names to the SDK hook declaration. The EventBus source report and real worker-to-client test now own
that extension contract.

The canonical codec now exposes typed decode overloads for every mapped protocol and proof schema,
including the previously omitted inbound-hash dispute proof. Its source report covers the full enum,
EVM-result, Result-normalization, cache, and failure surface.

The ethers Result proxy now keeps callback-wrapper identity after one listener removal, so repeated
registrations can also be removed repeatedly through the original callback. Its source report now
records the complete method, listener, event-log, query, and passthrough boundary instead of only
the structural Result predicate.

Other specification-mirrored implementation subjects, exhaustive source inventories, conformance decisions, and unit variants remain visible in generated coverage.

Balance validation, byte/key conversion, same-block copy merge, frame classification and log reporting have single owners. Extraction retains input/error order, raw commitment comparisons, timestamp-defined checks, response precedence and platform timer lifetime. Existing strategy instanceof checks remain. The deleted connectivity utility had no reachable consumer; each of its five data-type IDs retains other source contributors.

## Targeted pre-open channel join assessment — 2026-08-31

The implementation keeps `joinLobby` and `connectToChannel` as separate public wrappers over one generic
matcher and one negotiation service. The targeted wrapper holds a fixed ID, consumes direct mode-specific
negotiation outcomes, performs one exact-channel post-open entry, and calls existing sync and membership
owners. Full balances survive client/worker/peer encodings. The state machine's neutral zero and existing
lesser-than operation remain the remote trust boundary. Match acceptance removes matcher timeout and
cancellation ownership before negotiation.

SO5 is deliberate: one valid selected-peer response supplies usable state for later enforcement; selected-peer
failure proves the early cooperation precondition failed and permits no fallback before abort. RO3 is peer
identity response authority, not rebinding or resend. RY3 is targeted-only and skips opening submission after
the attempt has handed off to an authoritative open. Pending/participating failures preserve the attached
runtime. The normal Hyperswarm one-live-connection-per-unique-peer handoff remains an accepted production
assumption; automated coverage uses `DEBUG_LOCAL_TRANSPORT` and proves only transient duplicate cleanup.

## Focused safety follow-up — 2026-09-01

LocalDiscovery topic sessions now own active dial keys and capped-backoff retry timers. An authenticated close
recreates an eligible connection only while the exact session remains active; `leave` removes the session and
cancels its timers before closing registry and listener ownership. The existing `P2PManager` blacklist check
blocks replacement. `MembershipService.joinChannel` now sets local pending status before contract invocation,
restores `SYNCED` only after a proven no-commitment result, and preserves pending on uncertainty. Force-join
checks defer until authoritative on-chain membership and a usable window, with one stored start flag.

## Peer-fault call-site audit — 2026-09-01

The audited ingress and handshake call sites now state `DisconnectPolicy.BLACKLIST` with a reason at
the one close entry point for attributable wire violations (2026-09-18: the former
`disconnectAndBlacklistPeer` helper is gone). The switch prefers the authenticated address, so a
fault received on a retired transport still blacklists the current profile and closes both current
and reporting transports.
Lifecycle cleanup, network loss, timeouts without proof, response-send failure, and local dispatch
exceptions continue to call `disconnectConnection`.

Logger service composition follow-up: logger binding and release now belong to LoggerService. The root exposes generic close subscriptions and retains explicit common-service composition. Existing readiness points and collection behavior remain unchanged.

Common lifecycle composition: every internal endpoint owns readiness and quiescence through its lifecycle service; root disposal owns the child cascade and local cleanup. SDK deployment completion remains separate. Repeated cleanup shares completion, and domain readiness points stay unchanged. Forced port removal remains distinct from graceful request/acknowledgement cleanup.

## Common root creation follow-up

[createRoot](../implementation/source/src/rpc/internal/createRoot.ts.md) now owns channel creation, parent/child registration, exact inline links and worker cleanup. SDK and executor callers pass their receiving root class and entry URL. Thin worker entry files call the shared worker startup with their root class; root imports do not start workers. Built-in launch sites import bundler-emitted URLs internally; the platform adapter creates the module worker.

All launched roots use the shared worker-global initializer before domain imports. Inline hosts do not receive a worker-close hook. On Node, unexpected executor exit supplies the fatal cause before transferred-port close settles requests. Concrete root cleanup runs before platform shutdown. The old runtime and entry reports moved with their obligations; no new network exposure or request registry was added.

Current source counts and per-owner changes are recorded in the implementation handoff after verification.

## Initialized root creation follow-up

The free createRoot function takes the root class and an explicit worker URL, then awaits initialization and child readiness; SDK contract deployment follows separately. Common RootErrorService owns upward autonomous reports and startup failure settlement. RpcContractExecutor only adapts the consumer interface. Disposing the executor handle retires that child in either placement. StateManager abort invokes full host-root cleanup, including its executor; domain cleanup remains the final host-owned phase.

Engineer approvals and review fingerprints remain engineer-owned. This update does not clear unrelated audit queues.

## Explicit root creation API

The free createRoot function now constructs local top-level roots or connected children with an explicit parent. Top-level application handlers stay local; child startup keeps the existing clone boundary. SDK root observation retains connection-before-observer and observer-before-child-start order. RootCreation adds two real SDK placement cases and retains child creation/failure recovery cases. Existing approval and impact queues remain unchanged by this API decision.

## Generic worker creation

Root classes now pass directly to createRoot. One platform worker creator takes an explicit URL, with no per-root factory or entry wrapper. Built-in URL selection remains internal; startup payloads carry domain configuration without worker URL overrides. The shared worker globals use one path for all launched roots. Relevant startup, error, cleanup and browser evidence is being refreshed; engineer fingerprint approval remains pending.

Unexpected Node worker exit now reports failure for every root, including SDK roots, through the same owner path. All roots use the shared platform resource limits and graceful-shutdown policy. The platform creator does not restrict creation to named roots.

The shared global initializer does not create window. A temporary unified shim did so in Node SDK workers and changed Holepunch platform selection; the existing lobby E2E exposed it. The corrected initializer keeps the generic startup path while preserving Node/browser detection.

## Client-root ownership and initialization

The application instance now references its initialized client root directly. The client root owns host communication and bridge resources. Application setup owns deployments and adapters; P2pInstance owns application listeners and logger cleanup. Common creation awaits initialization for every root. Top-level creation is inline and returns the root; worker creation returns a typed remote root handle, and without an explicit parent it adds one hidden parent for that worker alone (see the parentless-worker section below). Its transport and connection record are private.

The new creation cases exercise delayed standalone initialization, parentless worker creation and cleanup, held host readiness in both placements, independent deployments and cleanup after either deployment or client observation fails. Existing client error, timeout, disposal and browser bridge boundaries remain part of verification. Logger connection discovery now follows root relationships without caller registration; the focused collection and root-creation cases pass together. The focused teardown cases pass; the final full run is recorded in the implementation handoff. Existing generated queues remain unchanged. This update grants no engineer approval.

The engineer approved host shutdown preparation before the child cascade. Run-310 confirmed the earlier race in discovery fallback cleanup: the test body passed, then reduction calls rejected because the executor was closed. The host now invokes the existing StateManager stop-and-drain owner before common child disposal. Final local cleanup still runs after failure and repeated calls reuse completion. A separate startup cleanup change unregisters a host whose observation callback throws before parent attachment. Focused ordering, preparation-failure and teardown cases pass, including an executor read while preparation is held. Parented inline client creation uses host connection options and sends its disposal acknowledgement before closing the parent connection. Missing connection options reject before allocation. Both browser gates pass on this source state. Final full-run evidence and the unchanged generated queues are recorded in the implementation handoff.

## Application setup ownership correction

The user superseded review 4's application-heavy client root. Application setup now owns config, logger creation, adapters, two deployments and final assembly. The client root owns host communication and common lifecycle only; P2pInstance owns application cleanup. Root readiness means usable communication, while application setup still waits for deployment completion. Existing startup errors, parented and parentless workers, host preparation before child disposal and bridge behavior remain in scope. The focused and final evidence is recorded in the application-setup implementation follow-up. Engineer approval and existing queues remain unchanged.

A worker exit during an awaited disposal now rejects that acknowledgement and removes its child connection. It is not ignored as an expected late exit; already closed connections still preserve their settled result. The real-worker regression checks repeat disposal and parent usability.

## Implicit root startup wiring

Common creation now attaches the parent before the concrete parameterless start() and owns parent-close disposal, response-before-close cleanup and readiness. Host and broker roots use the inherited typed parent reference. Concrete roots contain domain initialization only. Focused root creation, lifecycle, executor and bridge verification belongs to this follow-up; earlier full-suite results are historical. No engineer approval is granted here.

Executor monitoring and logger ownership now belong to ContractExecutorRoot. The service selects its clock from explicit request data before falling back to Clock and receives its logger directly. Logger instances share one monitor per thread; non-owner disposal does not stop it. Focused clock, monitoring and worker-error evidence is recorded in the executor-dependencies follow-up. No engineer approval is granted.

## Logger gossip follow-up

The engineer replaced acknowledged global flushes with best-effort generation gossip. [LoggerService](../implementation/source/src/rpc/internal/services/logger/LoggerService.ts.md) owns its attached store map and one scalar index; [Logger](../implementation/source/src/utils/logging/Logger.ts.md) owns local uploading and one optional service reference in sharedResources. Common roots create logging before startup. Equal/older generations are suppressed even after the window; invalid indexes are rejected. Remote delivery is not claimed by a local promise. Late entries can wait for another generation under the accepted timing assumption. Existing HTTP retries and secret-field encoding remain with the uploader.

The obsolete folded-summary finding no longer describes the current contract. Source and test changes require engineer re-verification; no approval register was changed.

The application-defined cloneability limit is tracked as [`OQ-AUDIT-RUNTIME-1-3P2PTW` (Application module cloneability)](open-questions.md#oq-audit-runtime-1-3p2ptw).

Review 10 aligns the quiescence permutation with fresh later drains and assigns the concurrent-drain evidence. Manager disposal now has one registered-transport walk; live leave/dispute disconnection keeps its existing behavior. Bootstrap payload typing and unknown WebRTC state have shared owners. Failed-setup tests distinguish application descendants from caller-owned siblings and the separate inline discovery lifetime. Crash stream checks use receiver arrivals after the trigger. The reviewed directory links and store-limit descriptions are updated; engineer approvals remain untouched.

## Review 14 lifecycle and host isolation corrections

Admitted disposal now reaches final connection and worker closure even if its parent disappears while domain cleanup is held. The response hook runs after failed posts as well as successful replies; failed application setup uses the same closure. A fatal child cause is recorded before close observers run, so client cleanup does not emit a second generic host error. Pending request diagnostics retain the exact wire request IDs.

Each fallback SDK host owns its WebRTC factory. Threaded placement remains preferred; multiple inline hosts in a browser worker remain supported. The browser boundary exercises disposal in both sibling orders. Current evidence is recorded in the implementation record; earlier full-run results cover their earlier snapshots. No index or engineer approval was changed.

## Shared runtime review 15

Child-initiated disposal waits for a parent acknowledgement before worker exit. Parent-initiated disposal uses its existing reply; final connection and platform cleanup still run after a failed response attempt. Manager cleanup continues after individual transport failures, and concurrent discovery cleanup shares one promise. Signer message serialization preserves bytes versus text. The browser worker and WebRTC gates are now configured in the pull-request CI workflow.

The earlier log-bus collection families were withdrawn when the engineer replaced acknowledged collection with local store upload and generation-based gossip. The private implementation plan records all six withdrawn families and their replacement by the current logger-gossip family; withdrawn definitions are not restored to maintained specification tables.

## Shared cleanup helper follow-up

Ordered cleanup now uses [runCleanup](../implementation/source/src/utils/runCleanup.ts.md). Root creation attempts both endpoint closes and worker shutdown even if an earlier close fails. The first failure remains the reported cause; confirmed inline domain failures retain their original reporting owner. No wire, admission or acknowledgement ordering change is intended. Helper unit coverage and existing lifecycle fault tests verify this extraction.

## Review 17 parent-loss disposition

The engineer chose to close RY1 at the parent owner. [Root creation](../implementation/source/src/rpc/internal/createRoot.ts.md) marks expected worker shutdown before closing the owned port. A real SDK-worker regression holds client disposal until after the child exits, and observes the fatal adapter callback as well as the public error surface. Unexpected worker exits remain errors. Full and browser gates are rerun after this change and the shared cleanup extraction.

## Per-entry queue retention bound — 2026-09-08

Queue retention uses independent source allowances ([`REQ-QSTORE-2-VYWJAQ` (Independent source allowances)](../specification/storage/queue.md#req-qstore-2-vywjaq)): at most N admitted
identities and N supplied values per source, including the author. The contribution map travels with the dequeued entry into ordinary validation. Later copies form an independent entry; restore merges source contributions under the limits. No queue-side recovery budget
or shared signature pool remains. Storage bounds the number of supplied values; ValidationService handles invalid values through each strategy. No queue-side encoding filter or fixed-byte bound remains. The wire intake and stored shortcut both gate
transport eligibility before retention.

The two caches accept chain current/pending membership or verified current-fork off-chain membership,
with known slash precedence. Positive hits avoid chain/VM reads. An absent source after refresh
triggers ordinary sync. Intake awaits it and returns; no candidate registry, retry-window limits,
admission cancellation or post-sync block insertion remains. SpectateService is unchanged.

Real network scenarios now cover independent supplier slots, alternate valid signatures, stored merges,
pre-dequeue accumulation, independent stored copies, unknown-source sync success/failure, pending joins and slashes. Exact evidence belongs in
the verification reports. Runtime-mode and canonical regression evidence, including environment
limits for browser execution, is recorded in the implementation handoff. Browser execution is not
inferred from TypeScript or distributed success.

[`FIND-QSTORE-3-1HF4V6`](open-findings.md#find-qstore-3-1hf4v6) is resolved for shared-slot monopolization. [`FIND-SETTLE-1-G2CPV6`](open-findings.md#find-settle-1-g2cpv6) remains open
for generic authoritative roster writes. Positive cache staleness, first-N source churn, aggregate
hash/connection/rate limits, and repeated work across later lifetimes remain explicit limits. The
reference math insertion bounds its producer and preserves balances; it does not grant chain dispute
standing before confirmed adoption. Pending joiners persist late confirmations silently until promotion,
matching the fresh-block relay guard and avoiding premature admission sync during join submission.

Both TypeScript builds, import checks, compilation and focused Docker tests pass for the source-map correction. The implementation handoff records the final canonical run and isolated guard checks; earlier ownership and byte-filter results do not verify this correction. Specification generation and ID links pass; strict completeness remains blocked by existing repository gaps and pending engineer approvals. Browser constructor wiring and its separate runtime evidence are recorded in that handoff.

The simplification review fixes narrow bytes32 inputs through an assertion signature and remove the remaining queue-key forwarding method. The separate import-order change preserves all non-import executable statements, all imported bindings, and side-effect import boundaries. Runtime initialization order is checked by the distributed and browser gates; TypeScript suppression comments remain attached to their original imports.

Post-handshake connection ownership is now centralized in `P2PManager`. Local channel status is
the only admission input: every completed live transport is promoted, while `OPENED` alone performs
the participant read and sync. Join and spectate RPC paths provide no alternate promotion or
peer-supplied membership hint. Participant-read failure, close, disposal, and replacement races are
contained without undoing valid authentication or creating a late connection.

Every transport creates an addressless `PeerProfile` immediately, and the Holepunch ban handle is
stored there before authentication. `ProfileManager` authenticates and indexes that same profile and
owns all ban/unban policy. Generic transports expose no SDK ban handle. Fallback release checks the
profile's full live transport set, so a non-preferred WebRTC transport in upgrade grace keeps Holepunch
banned and explicit blacklist state wins.
Authentication is also a final admission gate: a late Holepunch connection cannot replace healthy
WebRTC or reattach an excluded identity, while a fallback after current-WebRTC close can become
current and carry traffic.
Relay retry state has one owned timer, which success cancels before resetting the pool. Holepunch
topic join/leave retains its byte-exact `Buffer` contract.

Join admission now keeps recorded membership separate from countersign eligibility: snapshot and
pending participants remain members, on-chain-slashed members lose veto power, and slashed members
cannot top up. The public paths preserve exact fork/snapshot pins and deadline semantics and invoke
the manager's atomic composable-deposit path; the manager, not the facet, owns the inbound JOIN
append and cumulative-total update.

Off-chain join authorization uses the same slash-excluding threshold set on collector and
responder paths. The collector now rejects a deadline with no positive collection window before
it signs or sends requests; positive windows cap every request at the earlier of the agreement
timeout and the join deadline. The responder keeps the inclusive deadline boundary used by
on-chain submission.

Snapshot submission now has explicit component obligations for admissible submission, unresolved
reduction stand-down, unconsumed-inbound preparation refusal, and no on-chain mutation after that
refusal. Forced-inclusion verification follows the pending JOIN through reduction into the
successor participant set and through one complete leader-election cycle where the joiner authors
an accepted block.

The runtime lifecycle waits for the application root's readiness hook before admission and preserves readiness failures while disposing partial resources. Each isolated context starts monitoring after its own ready work and uses the same configured fatal-delay threshold. The test harness starts its main-thread monitor after initial peer setup.

Runtime extension boundaries no longer depend on constructor identity for RPC services, transports, or ethers Result values. They validate the complete public shape consumed by the caller, so compatible SDK and ethers copies can coexist in one production bundle without breaking proxy resolution, dispatch overloads, or result normalization. The linked source reports and runtime design views record these boundaries; engineer review remains pending.

Inbound RPC endpoint authorization is separate from those structural checks. The dispatcher walks the
application methods hierarchy only up to `ARpcMethods.prototype`, accepts function-valued data properties,
rejects base members and accessors, and invokes the captured function on both delivery paths. This resolves
[`DEF-7-PK564B`](open-findings.md#def-7-pk564b) without breaking inherited application endpoint families.

RPC wire parsing, ingress ordering, guards, and every implemented request-settlement path now have
exact component obligations and evidence. Request settlement remains partial because there is no
cancellation API. Resource control remains partial: the frame-size bound exists, but pending-call,
per-peer, and aggregate work limits do not. Protocol compatibility remains missing because neither
the envelope nor handshake negotiates a version. [`DEF-8-HWJ10N`](open-findings.md#def-8-hwj10n)
is resolved: handler and guard response sends use one guarded attempt, then disconnect on failure
without a second send or unhandled rejection.

The authenticated-RPC guard records admission per exact transport. A replaced but open authenticated
pipe remains valid during upgrade grace overlap. Queued work releases only when its own transport
authenticates; closure, timeout, and disposal clear it, and stale failure cannot punish a replacement.
A frame dispatched after local transport close is dropped instead of treating retirement as peer malice.

The runtime event bridge also preserves application-defined hook names and cloneable payloads without adding
those names to the SDK hook declaration. The EventBus source report and real worker-to-client test now own
that extension contract.

The canonical codec now exposes typed decode overloads for every mapped protocol and proof schema,
including the previously omitted inbound-hash dispute proof. Its source report covers the full enum,
EVM-result, Result-normalization, cache, and failure surface.

The ethers Result proxy now keeps callback-wrapper identity after one listener removal, so repeated
registrations can also be removed repeatedly through the original callback. Its source report now
records the complete method, listener, event-log, query, and passthrough boundary instead of only
the structural Result predicate.

Other specification-mirrored implementation subjects, exhaustive source inventories, conformance decisions, and unit variants remain visible in generated coverage.

Balance validation, byte/key conversion, same-block copy merge, frame classification and log reporting have single owners. Extraction retains input/error order, raw commitment comparisons, timestamp-defined checks, response precedence and platform timer lifetime. Existing strategy instanceof checks remain. The deleted connectivity utility had no reachable consumer; each of its five data-type IDs retains other source contributors.

Proof replay builds standalone processing input. Queue cleanup cannot cancel it through a storage handle. The replay/cleanup regression continues to exercise snapshot persistence and fork reduction.

### Optimistic membership mirror correction

The engineer removed membership generations, pending-read invalidation and automatic read retries. Cached positives remain optimistic; concurrent misses now share one in-flight refresh, cleared on completion or failure. Intake rechecks cached eligibility after ordinary sync and blacklists a sender that remains ineligible, including the accepted in-flight collision case. Observed slashes still override cached membership, and channel selection clears the three plain sets. There is no metadata wrapper or channel/fork check in membership lookups. A read already in flight can complete after a newer push; no latest-generation guarantee is claimed. Queue processing and ordinary sync remain unchanged. [MembershipService](../implementation/source/src/stateManager/membership/MembershipService.ts.md) and its [exact tests](../verification/tests/test/unit/MembershipService.test.ts.md) describe the current behavior. Earlier invalidation permutations remain withdrawn; the current shared-refresh case asserts one read for concurrent misses.

Eligibility now has three enum values. A failed refresh leaves the sets unchanged; an absent sender follows ordinary sync. The earlier unavailable-result path and its separate no-sync guarantee are withdrawn by the engineer. The ordinary sync service retains its existing peer-failure behavior.

Membership events now push into the fast sets without membership reads. A miss pulls pinned snapshot/inbound/slash data and reuses event handlers to update LocalDiamond and the fast mirror. Positive-hit staleness before unseen events remains the accepted optimistic-cache policy. Focused tests verify delivered and missed JOINs, snapshot preservation of pending JOINs, slash publication, post-sync supplier exclusion, cache cleanup and failed chain-inspection rollback. Equivalent source-address casing uses one queue allowance. The full distributed gate passes all 2,539 tests; seven automatic starvation retries recovered.

## Dispute gas estimation and the transition stipend — 2026-09-08

**Trigger.** In the poker consumer's farm runs, `applyDisputeFraudProofs` and other dispute sends
missed their windows: the kill period is 5 s in those fixtures, and the transaction preparation
(populate, sign, broadcast) held the nonce mutex for 13–15 s per send, ending in
`RaceConditionDisputeKillPeriodExpired` raised by `eth_estimateGas` itself. `uploadDispute`, which
passes an explicit gas limit, took 32 ms–1.1 s on the same node in the same minute. The cost is the
node's gas estimation, not the chain, the ZK precompile (14 calls, all under 7 ms), or poker logic.

**Mechanism, three parts.**

1. _Requirement far above usage._ `stateTransition` forwarded a fixed stipend with
   `call{gas: gasLimit}`. A dispute replay used about 3M gas but the transaction had to carry
   about 10.7M so the stipend could be granted. Every estimator has to search that gap, and every
   probe inside it is a full replay of the transition.
2. _Hardhat's search._ Hardhat runs the transaction at the block limit, then at the gas it used; when
   that fails it bisects to a 50k tolerance for up to 20 rounds with no informed first guess. Geth and
   anvil probe `(used + refund) * 64/63` first. Any diamond call fails hardhat's exact-gas probe
   because the proxy fallback's delegatecall retains 1/64 (EIP-150) and does no work afterwards.
   Hardhat's pending-block context is re-mined per probe, so chain time advances during a long
   estimate and the kill period can expire inside it.
3. _Soundness gap (now closed)._ A CALL never fails for asking more gas than remains; it hands over
   63/64 of what is left. An under-funded replay therefore silently gave the transition less than
   the stipend, the transition ran out of gas, `executeStateTransition` returned `success = false`,
   and both fraud-proof facets read that as an invalid transition. The gas a sender attached could
   decide a verdict ([`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2), [`REQ-FP-7-4DD0D7` (A valid dispute fraud proof applied within the kill period kills the committed…)](../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7)).

**Changes made in this tree.** _Superseded 2026-09-26 for the stipend rule and the mirror gas:
see [Signature-parity authentication, upfront replay funding, and local EVM call gas](#signature-parity-authentication-upfront-replay-funding-and-local-evm-call-gas--2026-09-27).
The list below records the 2026-09-08 state._

- [AStateMachine.sol](../implementation/source/contracts/V1/AStateMachine.sol.md): the wrapper records what the stipend call can grant (`available - available/64 - reserve`,
  capped at `gasLimit`). A transition that completes is judged on its result whatever was granted,
  since transitions may not read gas. An out-of-gas counts as exceeding the budget only when the full
  `gasLimit` was granted; otherwise it reverts with `ErrorInsufficientGasForStateTransition(required,
granted)`, a refusal rather than a verdict. An upfront `gasleft() >= stipend` guard was tried first
  and rejected by measurement: it pins the requirement at the stipend, so estimators search the
  expensive region and the geth-style first probe can never succeed.
- [StateChannelManagerProxy.sol](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md): `executeStateTransition` re-raises that refusal and turns an empty-returndata machine frame
  into `ErrorStateTransitionFrameOutOfGas`, so the facets never adjudicate an under-funded replay.
- [ContractExecutor.ts](../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md): every local EVM call is funded with 1e9 gas. The ethereumjs default of 0xffffff (about 16.7M)
  sat at the manager's dispute-execution budget, so a mirror replay could have been under-funded and
  diverged from a funded on-chain one ([`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)).
- Tests: `test/V1/AStateMachineStipend.t.sol` (8 tests) with a gas-hungry Math variant. Direct:
  a cheap transition executes below the stipend; a never-finishing one is refused below the stipend
  and reported as an invalid transition when funded. Through the manager: the honest block is judged
  below the stipend and its author keeps standing; the over-budget block reverts with the refusal
  below the stipend and slashes its author when funded; two fuzzes over attached gas from 100k to 9M
  show the honest author is never slashed and the over-budget author is slashed exactly when the call
  succeeded ([`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF`](../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf), [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X`](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x), [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2) P5–P8). Full Foundry suite: 120 passing.

**Measurements** (Math fixture, 10M stipend, `applyFraudProofs` over an honest block, cost of one
`eth_estimateGas` relative to one `staticCall`, median of seven):

| Node                                                      | Contracts                | 30M block      | 100M block  | 1e9 block   | Estimate    |
| --------------------------------------------------------- | ------------------------ | -------------- | ----------- | ----------- | ----------- |
| hardhat 2.20 (peer3 fork, the runner's node)              | before                   | 11.5x          | 11.5x       | 11.6x       | 511k        |
| hardhat 2.20, stock                                       | after                    | same as before |             |             | 511k        |
| hardhat 2.20 with a `(used + refund) * 64/63` first probe | after                    | 2.6x           | 2.7x        | 2.7x        | 514k        |
| hardhat 2.22 EDR (this repository's in-process network)   | before / after           | 4.7x / 4.8x    | 4.1x / 4.5x | 4.4x / 4.4x | 511k / 511k |
| hardhat 2.22 EDR                                          | upfront guard (rejected) | 4.3x           | 4.1x        | 5.3x        | 11.0M       |

Gas used by the transaction: 443k. The block gas limit does not change the estimate cost in any
row. The refund term is required for the optimistic probe: the estimate sits about 15% above gas
used because of storage refunds, so a plain 64/63 probe fails and falls back to bisection.

**Assessment.** The contract change removes the soundness gap and makes the gas a transaction needs
track the gas it uses, which is the precondition for any fast estimate. It does not by itself speed
up estimation on the runner's hardhat, whose bisection dominates. A fixed high gas limit on dispute
sends would avoid estimation but reserves block space by declared limit, not by use: three 10M
declarations fill a 30M block that could hold fifteen 2M executions. The adopted resolution is recorded
as [`FIND-GASEST-1-28J88D`](open-findings.md#find-gasest-1-28j88d): the runner's node gained Geth's
first probe, `(spent + refund) * 64/63`, in the peer3 hardhat fork (release `precompile-v2`). It
converges only because the post-hoc stipend rule made the gas a replay needs track the gas it
uses, so the two changes belong together. Metering in the local mirror was rejected as unreliable
(the mirror does not guarantee chain-equal state), and `eth_estimateGas` remains the send path,
which production nodes already answer in two or three executions.

## Block authenticity moved off the EVM — 2026-09-09

**Trigger.** A CPU profile of the poker consumer's six-player timing test showed the six
contract-executor threads busiest (about 69% of their time, ethereumjs interpreter 45%, secp256k1
recovery 8%, GC 10%), while ZK verification was negligible. Each received block executes once
([SnapshotAssemblyService.ts](../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md),
[BlockIngestService.ts](../implementation/source/src/stateManager/ingest/BlockIngestService.ts.md));
stored-block re-confirmations merge signatures without execution. The redundant EVM work was the author
signature recovery, run in the EVM twice per block (intake in
[BlockQueueManager.ts](../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md) and
pre-execution in BlockIngestService), plus the consumer's own view calls per block.

_Decided 2026-09-26: the TypeScript check stays under an explicit carve-out with exact contract
parity; see [Signature-parity authentication, upfront replay funding, and local EVM call gas](#signature-parity-authentication-upfront-replay-funding-and-local-evm-call-gas--2026-09-27).
This section records the 2026-09-09 state._

**Change.** [Block.ts](../implementation/source/src/models/Block.ts.md) gains `isAuthentic`
(original signature recovers to the header participant, malformed signature is `false`);
intake reads it through the per-thread signer recovery cache. A later change removed the
`ValidationService.isBlockConfirmationAuthentic` wrapper: [BlockQueueManager.ts](../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md)
decodes each incoming confirmation once with `tryFromBlockConfirmation` and checks `isAuthentic` on that
instance, which the rest of the ingest reuses, and [BlockIngestService.ts](../implementation/source/src/stateManager/ingest/BlockIngestService.ts.md)
checks it on the entry's decoded block. [QueueStorage.ts](../implementation/source/src/storage/QueueStorage.ts.md)
builds the entry's base block with `Block.authorSignedCopy()` (renamed from `withoutConfirmationSignatures`, review 5 LO5) on its per-call copy
instead of decoding it again. No contract change: `LocalDiamond.isBlockAuthentic`
stays for the dispute path on-chain. Both call sites drop their `await`.

**Assessment.** The TypeScript and Solidity checks share one scheme (EIP-191 over
`keccak256(encodedBlock)`), and the predicate reads no state, so
[`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)'s equivalence
concern does not arise. The literal text of
[`INV-MIRROR-1-VAF778` (Single implementation)](../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) is contradicted
and recorded as [`FIND-AUTH-1-C1ZHBJ`](open-findings.md#find-auth-1-c1zhbj) for a specification decision.
Regression: [`UNIT-TEST-BLOCK-MODEL-1-037DM6`](../implementation/source/src/models/Block.ts.md#unit-test-block-model-1-037dm6)
P13 plus three neighbouring authenticity tests, and the forged-author E2E intake test.

## Subscription logs from a reverted block — 2026-09-09

**Trigger.** The poker consumer's parallel runs failed with peers whose genesis fork differed from
the chain's stored genesis by one second. The cause is the test node: hardhat's pending-block
simulation (`eth_estimateGas`, pending `eth_call`) mines every pending transaction into a temporary
block, notifies `newHeads` and `logs` subscribers and polling filters, then reverts the block. On a
shared node another client's estimate leaks logs of a block that never becomes canonical. The peer3
hardhat fork now mutes notifications during a simulation.

**Assessment for this repository.** The node's event path trusts the provider's log feed as
canonical and has no `removed`-log handling or block-hash confirmation. That is correct for a
well-behaved node and for the local runner after the fork fix, and it is the same assumption a real
chain breaks on a reorg. Recorded as
[`FIND-EVENTS-1-3JF8FM`](open-findings.md#find-events-1-3jf8fm) for a specification decision; no
code change made here.

## Estimate margin instead of a search — 2026-09-09

**Trigger.** With the fork's optimistic probe in place, the poker consumer's farm still measured
`eth_estimateGas` for the batched dispute `multicall` at 12 executions and 5 to 11 s per estimate,
while single-call estimates (`uploadDisputeWithCalldata`, `open`, `postBlockCalldata`) took one to
three executions. The multicall adds delegatecall frames in front of the fraud-proof path, each
retaining 1/64 of the remaining gas, so the one-boundary probe `(spent + refund) * 64/63` is short
and hardhat bisects from the block limit to a 50k tolerance. Hardhat serves one request at a time, so
each such estimate stalled every other client's reads and the interval miner for the same seconds.
Geth's estimator misses the probe for the same reason but converges in about nine executions on a
native EVM, milliseconds rather than seconds, and serves requests concurrently; on a production node
this is cost, not a stall.

**Change (fork release `precompile-v4`).** `eth_estimateGas` runs the transaction once and returns
the gas it needed before its refund (the refund counter capped as the EVM caps it, a quarter of the
net figure after EIP-3529) plus 30%, capped at the block gas limit. The exact-gas run, the probe and
the bisection are removed. The margin covers the retained gas of nested frames and refunds handed back
after they were spent. Estimates are no longer minimal; the block-packing argument against declared
limits applies to a fixed high limit, not to a proportional margin.

**Residual.** Production nodes keep their own estimators; the durable fix for their nine executions is
a shallower fraud-proof call path in the contracts, recorded for a separate review.

## Local-first dispute audit and milestone proof tiers

AgreementManager owns verification from local finalized state, local diamond and canonical chain.
Only missing or completed false results move to the next tier. Local reverts, executor failures,
required-state failures and RPC failures propagate; they do not become invalid-proof verdicts.
Independent availability, below-anchor or final-conflict counters can stop audit before these tiers.
Replay restarts from each tier's verified state. Block-specific challenge eligibility depends on
the canonical anchor, so the old pure/global header-check account no longer applies.

Construction starts from the mirrored chain anchor. Omission follows the empty-genesis or last
milestone anchor/everyone rule. Reduction and committed-result validation retain their chain-owned
computation. A different trusted start may skip older history; this is not proof that all auditors
must check identical bytes. Concrete source owners and exact permutation evidence are linked from
[state proofs](../implementation/views/protocol/state-proofs.md). The full source/test gate passed
before documentation edits; individual Covers assignments still require semantic inspection.

## Signature-parity authentication, upfront replay funding, and local EVM call gas — 2026-09-27

**Trigger.** Reviews 1–4 of the local-first change
(`temp/plan-implementation-reviews/33-dispute-rebase-local-first/`) and the engineer's decisions on
them: author signatures in TypeScript must match the contracts exactly (XO1, SR2); fraud-proof
replay is funded upfront (SO1), the send declaring its estimate plus the requirement (FR1, confirmed
by the engineer in review 5, FO1); the upfront check must come after all input-dependent work (SR1);
the previous transition's outbound messages are deleted before the check and paid outside the
budget (review 6, FO3, engineer decision; this replaced the count reset that answered FY1); the local
EVM's 1e9 call gas is dropped (SY1) and named for the local EVM (LO2); the evidence memo is invalidated
on a kill (FY1) and belongs to DisputeManager (LO1); block decoding stays in `Codec` and decoding
parity with the contracts is deferred (LO3, decision of 2026-09-27).

**Signature parity.** [SignerRecoveryCache.ts](../implementation/source/src/cache/SignerRecoveryCache.ts.md)
refuses, before recovery, every signature encoding OpenZeppelin `ECDSA.tryRecover(bytes32, bytes)`
rejects (not exactly 65 bytes, `v` not 27 or 28, `r` outside `(0, n)`, `s` outside `(0, n/2]`); ethers
had accepted compact signatures and normalized `v`. Every protocol recovery — author and
confirmation signatures in [Block.ts](../implementation/source/src/models/Block.ts.md), join, open and
dispute signatures in [SignatureUtils.ts](../implementation/source/src/utils/SignatureUtils.ts.md) — goes
through it, so author and confirmation signatures follow one rule. The dead
`UtilityFacet.isBlockAuthentic` route and interface declaration are removed.
[EcrecoverCache.ts](../implementation/source/src/cache/EcrecoverCache.ts.md) memoizes the local EVM's ecrecover
precompile; it is a pure cache and changes no answer or gas figure (tested against a plain EVM at the
precompile's acceptance and gas boundaries). [`FIND-AUTH-1-C1ZHBJ`](open-findings.md#find-auth-1-c1zhbj)
is resolved by the signature carve-out in
[`INV-MIRROR-1-VAF778` (Single implementation)](../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778).

**Decoding.** `Codec` is the only block decoder. Network intake
([BlockQueueManager.ts](../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md)) decodes once with
`Block.tryFromBlockConfirmation` and then checks `isAuthentic`; the struct entry
([BlockIngestService.ts](../implementation/source/src/stateManager/ingest/BlockIngestService.ts.md)) refuses a
confirmation that does not decode through `authenticateBlockFailed`;
[QueueStorage.ts](../implementation/source/src/storage/QueueStorage.ts.md) reuses the target's decoded block when it
merges signatures, so a network copy is decoded once.
[ValidationService.ts](../implementation/source/src/stateManager/ingest/ValidationService.ts.md) has no decoding logic:
the contract-decode path that existed for one review round (a local-diamond decode of
non-canonical bytes, with its memos) is removed. The client and
contract decoders are not held to one rule; that open exposure is
[`FIND-DECODE-1-FD1V6V`](open-findings.md#find-decode-1-fd1v6v), with identical encoding and decoding
on both sides as the planned resolution.

**Upfront replay funding.** [AStateMachine.sol](../implementation/source/contracts/V1/AStateMachine.sol.md)
refuses with `ErrorInsufficientGasForStateTransition` before the transition runs unless it can grant
the full `gasLimit`, and publishes `getStateTransitionGasRequirement`. It copies the call input and
reads the budget before the gas check and calls in assembly, so only fixed opcodes run between the
check and the call. It deletes the previous transition's outbound messages first, before the input
copy and the gas check, so the caller pays for the deletion outside the transition budget and a
transition always writes its messages into empty slots.
[UtilityFacet.sol](../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md)
`getStateTransitionReplayGas` adds the share kept at each of the four enclosing calls.
[DisputeManager.ts](../implementation/source/src/disputeManager/DisputeManager.ts.md) sends only the replay
transactions (the fraud-proof multicall and `applyDisputeFraudProofs`) with the signer's estimate
with its headroom plus the requirement, the requirement read once (engineer decision 2026-09-27).
The machine refuses unless the full budget is free when the replay starts; an estimator that
reports the gas spent (the peer3 hardhat fork used by poker) counts only the gas the transition
used, and the work before the replay can exceed any fixed margin over the requirement (a poker
dispute: about 3.9M before the replay, requirement 5.64M, about 9.5M needed, while the larger of
the estimate and the requirement × 1.3 gives 8.89M). The sum covers both. A searching estimator
(the SDK test node was measured to search) already includes the requirement, so the sum declares
more than needed: at least about 2.5 × the requirement with the signer's headroom. That does not
change a verdict, but it must still fit the block gas limit, which then depends on the consumer's
budgets; nothing caps the declared limit. The whole gas and estimation topic is open as
[`FIND-GASEST-2-94YFZ6`](open-findings.md#find-gasest-2-94yfz6). This
replaces the 2026-09-08 post-hoc rule, whose pending assumption (a transition cannot catch an inner
out-of-gas) did not hold.
Residual: see [security-assessment.md](security-assessment.md#gas-dependent-verdicts--2026-09-08).

**Local EVM call gas.** [ContractExecutor.ts](../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md)
`localEvmCallGasLimit` funds each local EVM call with the larger of `DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT`
(0xffffff), the manager's `getGasLimit` and twice its replay requirement (the requirement covers
only the budget and fixed setup; deleting previous outbound messages and copying the input come on
top), read once at host start
([P2pRuntimeHostRoot.ts](../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md)) and
passed through [createContractExecutor.ts](../implementation/source/src/evm/contractExecutor/createContractExecutor.ts.md)
and [ContractExecutorService.ts](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md);
inline and dedicated-thread runtimes are tested with a budget above the default. Deviation from the
recorded decision text (`max(16.7M, getGasLimit)`): the replay term is required, because without it
every local replay would be refused by the upfront rule above. A local `stateTransition` that the
machine refuses, whose call frame runs out of gas outside the transition, or whose executor fails is
a local failure: [EvmDiamondStateMachine.ts](../implementation/source/src/evm/EvmDiamondStateMachine.ts.md)
rethrows it (`isInvalidStateTransitionError` in
[evmErrorHandler.ts](../implementation/source/src/utils/evmErrorHandler.ts.md)) and
[BlockIngestService.ts](../implementation/source/src/stateManager/ingest/BlockIngestService.ts.md)
restores the state with no fraud proof and no dispute. The accepted residual (the 16.7M
floor) is recorded under [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)
and in [security-assessment.md](security-assessment.md#local-evm-call-gas--2026-09-26).

**Evidence memo.** [DisputeManager.ts](../implementation/source/src/disputeManager/DisputeManager.ts.md) owns it
(`shouldAddOwnEvidence`, `forgetEvidenceComparison`); [EventHandler.ts](../implementation/source/src/eventHandlers/EventHandler.ts.md)
only calls them from `onDisputeCommitted`, `onDisputeKilled` and `onDisputeReducedResultCommitted`.
`didIDispute` stays first; a kill drops the fork's stored comparison; a comparison ended by partial
own auditing data is not stored; the reduced result prunes the entry; concurrent audits share one
comparison; a positive answer survives a failed upload; a comparison dropped while in flight cannot
erase its replacement. All of these are tested through real audits
([`UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM`](../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-7-q63jzm) P1–P9).
Specified in dispute-processing stage 5
([`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)).

**Negotiation cleanup.** [OpenChannelNegotiationService.ts](../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts.md)
`clearAttempt` takes the attempt it ends and does nothing when that attempt is no longer current, so a
late opening-hook failure cannot clear its replacement.

## Host-only guard, local owners, parentless workers, and executor drain — 2026-09-29

Conformance: [LocalOnlyGuard](../implementation/source/src/rpc/network/guards/LocalOnlyGuard.ts.md) implements the host-only part of [`REQ-RPC-7-9CBSHK` (Guard semantics)](../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) with an always-failing check, a normal-return
failure handler that delegates to `P2PManager.disconnectConnection` with `DisconnectPolicy.BLACKLIST`,
and a `WeakSet`-scoped override of `AGuard.suppressesFailureResponse`; it is exported from the guard
barrel and the public entry. For [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../specification/runtime/execution.md#req-runtime-3-vqxw59), the host passes `{ owner: this }` through `StateManager` and
`P2PManager` to the custom-RPC constructor, the executor passes `router.rpcRoot` through `createEvm` to
precompile factories, `createRoot` supports parentless workers with a per-creation hidden parent, and
`ContractExecutorService` owns admission and drain with all three endpoints delegating to it and
`ContractExecutorRoot` running the drain as its disposal preparation. Node `.ts` worker preloads now
resolve from the SDK package. File reports, the guards and internal-RPC inventories, and the runtime
view record these; new component families are [`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8`](../implementation/source/src/rpc/network/guards/LocalOnlyGuard.ts.md#unit-test-local-only-guard-1-gk4gr8),
[`UNIT-TEST-EVM-FACTORY-1-002C8D`](../implementation/source/src/evm/EvmFactory.ts.md#unit-test-evm-factory-1-002c8d), [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb), and
[`UNIT-TEST-P2P-RUNTIME-HOST-34-517JAX`](../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md#unit-test-p2p-runtime-host-34-517jax); the root-creation family replaced its parentless-rejection
permutation with six parentless-worker permutations. No contradiction is demonstrated. The executor
drain is bounded by the engineer decision [`OQ-IMPL-EXECUTOR-DRAIN-1-5D71YM` (Resolved executor admission drain bound)](../implementation/open-questions.md#oq-impl-executor-drain-1-5d71ym): `closeAdmission` races the admitted set against the exported
`IN_FLIGHT_REPLY_DRAIN_MS`, logs and abandons work still admitted at the limit, and lets disposal proceed.
The second implementation review showed that `admit` returned the operation's own promise, so a call that
completed after the limit, during the later in-flight reply drain, still returned its success to a caller
the executor had declared abandoned. By the engineer's decision (option a) `admit` now returns a
caller-facing promise behind a settle-once latch; at the limit `closeAdmission` rejects every caller still
waiting with `Contract executor shut down before the operation finished`, and the operation's later
success or failure is dropped with no host error, while work that finishes within the limit keeps its own
result or error. This matches the amended [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../specification/runtime/execution.md#req-runtime-3-vqxw59) rule, which now states that the
disposal rejection holds even when the operation later succeeds or fails. The admission family has
[`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P5`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb) for the stuck call and gained
[`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P6`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb), [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P7`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb) and
[`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P8`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb) for late success, late failure, and mutex-queued work released after
the limit; [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P2`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb) now names a late deploy and simulation beside the late call.

The earlier record said an unidentified transport's "handle is barred". That was wrong:
`ProfileManager.blacklistPeer(transport)` does nothing when the transport has no profile, so a transport
with neither a profile nor a proven address is only closed and nothing is barred, which is what
[`REQ-RPC-7-9CBSHK` (Guard semantics)](../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) states. The [LocalOnlyGuard](../implementation/source/src/rpc/network/guards/LocalOnlyGuard.ts.md) and
[P2PManager](../implementation/source/src/P2PManager.ts.md) reports now say so, matching the corrected comment in
`P2PManager.disconnectConnection`. Parentless workers now also document that a worker thread that exits
unexpectedly leaves its hidden parent live until the handle is disposed, which then releases it
([`UNIT-TEST-ROOT-CREATION-1-1NWN3V.P33`](../implementation/source/src/rpc/internal/createRoot.ts.md#unit-test-root-creation-1-1nwn3v)).

A pre-existing shutdown defect is fixed in the same change: `InitHandshakeService` never settled pending
`waitForHandshakeCompleted` waits at shutdown, so a wait timer could fire after its logger was disposed and
surface as an unhandled `Logger InitHandshakeService has been disposed` error, contrary to the
detached-work rule of [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../specification/runtime/execution.md#req-runtime-3-vqxw59). The service now has a `dispose()` that marks it disposed and
clears the completion barrier, so every pending and later wait settles as not completed at once, and
`MainRpcService.dispose()` calls it first; the handshake guard suite reaches it through that runtime
shutdown hook. The [InitHandshakeService](../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md) and
[MainRpcService](../implementation/source/src/rpc/network/MainRpcService.ts.md) reports record it with
[`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P19`](../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r) and [`UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P9`](../implementation/source/src/rpc/network/MainRpcService.ts.md#unit-test-main-rpc-service-1-awn39m).

The first implementation review asked whether this settlement at runtime shutdown makes a
`DeferredAdmissionGuard` queue expire as a peer timeout, with a warning and an `allowRetry` disconnect
against a peer that was only mid-handshake. It does not, and no code change was made: at real runtime
shutdown `StateManager.stop()` sets `isDisposed` before `localRpc.dispose()` runs, and
`HandshakeAdmissionPolicy.onExpired` returns early when the state manager is disposed. The settled
handshake wait therefore never leads to an expiry warning or a retry disconnect.

## Milestone-only proof update — current assessment

The proof format now contains milestones only. Same-fork anchor clipping and explicit genesis
semantics replace the old separate signed-tail model. Historical membership hops include all
consumed JOINs and never subtract later slashes. Shared verification/replay tiers distinguish false
proof results from fatal execution or RPC failures. Per-step invalidity, below-anchor,
timeout-superseded and same-height final-conflict counters use the common predicates.

Sync retains verified reconstruction data and the latest proved final full state. An older anchor
state is not separately required once newer finality is established. Audit replay persists evidence
without signing or advancing the active view. Inbound-head races reload, rebuild and retry on real
progress; stopped progress or failed loading is fatal. Initial responders are selected from chain
eligibility, and founder discovery and join observation/expiry handling have corresponding tests.

Residual questions remain explicit in [specification questions](../specification/open-questions.md):
loss of the sole higher commitment after admission closes, late-challenge recovery, stale or
adoption-racing honest sync blacklists, admission gas/length caps and whole-data challenge cost.
Per-step checking does not prove constant total gas. Other existing findings remain unchanged
unless separately revalidated. Documentation and mappings remain pending engineer review; this
assessment grants no human approval and does not claim the repository's baseline coverage queues
are empty.

## Milestone proof review repairs

The proof owner now separates an exact final height from later virtual-voting support, including stored evidence above a frozen view. Verification returns its actual trusted start atomically with the verdict. Audit rechecks conflicting final history after asynchronous verification and refused persistence. The invalid-step handler no longer walks an unrelated final milestone to decide omission permission. Membership deadline work retains a join generation and fork across reads and scheduling, and missing old history uses an explicit validation-strategy deviation. These repairs preserve the existing finality, checked-region persistence and lifecycle rules.

The exact-height participant-change follow-up adds no production behavior. Its owner-level coverage checks join and exit union evidence beyond the requested final height, removal of the sole later required vote, and both single-hop and two-hop construction from audit evidence above a frozen view. The original whole-plan review inventory remains separate from this scoped correction.
