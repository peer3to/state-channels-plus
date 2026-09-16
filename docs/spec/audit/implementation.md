# Implementation Assessment

> **Agent assessment:** In progress.
> **Engineer disposition:** Pending.

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

The audited ingress and handshake call sites now use `disconnectAndBlacklistPeer` for attributable
wire violations. The helper prefers the authenticated address, so a fault received on a retired
transport still blacklists the current profile and closes both current and reporting transports.
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

The application instance now references its initialized client root directly. The client root owns host communication and bridge resources. Application setup owns deployments and adapters; P2pInstance owns application listeners and logger cleanup. Common creation awaits initialization for every root. Top-level creation is inline and returns the root; worker creation requires a parent and returns a typed remote root handle. Its transport and connection record are private.

The new creation cases exercise delayed standalone initialization, missing parent rejection before allocation, held host readiness in both placements, independent deployments and cleanup after either deployment or client observation fails. Existing client error, timeout, disposal and browser bridge boundaries remain part of verification. Logger connection discovery now follows root relationships without caller registration; the focused collection and root-creation cases pass together. The focused teardown cases pass; the final full run is recorded in the implementation handoff. Existing generated queues remain unchanged. This update grants no engineer approval.

The engineer approved host shutdown preparation before the child cascade. Run-310 confirmed the earlier race in discovery fallback cleanup: the test body passed, then reduction calls rejected because the executor was closed. The host now invokes the existing StateManager stop-and-drain owner before common child disposal. Final local cleanup still runs after failure and repeated calls reuse completion. A separate startup cleanup change unregisters a host whose observation callback throws before parent attachment. Focused ordering, preparation-failure and teardown cases pass, including an executor read while preparation is held. Parented inline client creation uses host connection options and sends its disposal acknowledgement before closing the parent connection. Missing connection options reject before allocation. Both browser gates pass on this source state. Final full-run evidence and the unchanged generated queues are recorded in the implementation handoff.

## Application setup ownership correction

The user superseded review 4's application-heavy client root. Application setup now owns config, logger creation, adapters, two deployments and final assembly. The client root owns host communication and common lifecycle only; P2pInstance owns application cleanup. Root readiness means usable communication, while application setup still waits for deployment completion. Existing startup errors, parent-required workers, host preparation before child disposal and bridge behavior remain in scope. The focused and final evidence is recorded in the application-setup implementation follow-up. Engineer approval and existing queues remain unchanged.

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

Queue retention is now bounded in two dimensions rather than one. The per-entry source caps were
already in place; the block's own confirmation-signature set was not bounded at all, and intake
authenticates only the signed block a copy carries, so one authenticated peer could grow a single
entry without limit. All three write paths — the creating copy, a duplicate merge, and restore —
now cap retention, drop values that are not recoverable ECDSA signatures, and confine attribution to
signatures the entry kept. Bounding cardinality alone would not have bounded memory: confirmation
values were never format-checked and a frame may approach the transport limit, so the byte bound
depends on the value check rather than the count.

Two residuals are assessed as accepted for this change and are visible in the maintained layers.
Retention above the cap is first-come, so a signature offered while an entry is overflowed is not
retained until validation strips unexpected signatures and frees room; this is specified in
[`REQ-QSTORE-2-VYWJAQ`](../specification/storage/queue.md#req-qstore-2-vywjaq) and covered by an
exact test. The cap is now sized against an enforced maximum union size rather than an assumed one:
`open` and `_processJoinChannel` both reject a union larger than the channel's configured
participant maximum, and the client reads that maximum from the contract instead of restating it,
so the two cannot drift. That is sizing, not proof. Two findings record why: the maximum is not
enforced on every path that makes a participant set authoritative, and retention counts signature
bytes while validity counts recovered signers. The cap
bounds per-entry memory, which is what it was added for, and recovery cost is bounded per block
hash so a dequeue cannot refill the allowance. No end-to-end evidence covers the peer-observable path. A case written for it was
withdrawn once it proved vacuous: a block padded with foreign confirmation signatures is cut before
it parks, so the test passed with no signatures sent at all. Reaching the caps end to end requires a
block that parks without being cut, which is a larger fixture than this change warranted; the caps
are covered by unit tests and the gap is recorded rather than papered over.

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
