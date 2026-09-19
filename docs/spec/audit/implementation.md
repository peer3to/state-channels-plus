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

## Channel reset ownership

`StateManager.resetChannel()` is the single owner of the non-terminal release; every other component
contributes one `reset()`/`clear()` that it calls, and none of them decides on its own when to run. That
keeps the ordering — producers, feed detach and drain, peers and RPC root, timers, storage — in one place
where it can be read and reviewed, instead of spread across the leave path. `Storage.clear()` rebuilds the
fifteen sub-stores through the same `initStores()` the constructor runs: consumers hold the aggregate, never a
sub-store, and read each one through the proxy on every access, so fresh instances are visible everywhere at
once and no sub-store has to enumerate its own fields. `TimeoutManager.dispose()` was reduced to the terminal
flag plus the new `cancelAllTasks()`, `ReductionManager.dispose()`/`reset()` share `settlePendingCompletions()`
and both call `ReductionExecutor.dispose()`, and `ProfileManager` now owns one `releaseChannelPeers()` beside
its `dispose()` — the same transport teardown, differing only in that the release keeps the blacklisted
profiles — so none of these lifecycles can drift from the other. `TimeoutManager.scheduleTask` gained an
optional cancel handler that only the wholesale paths run, which is what lets a waiter whose single
completion was a cancelled timer fail instead of hang; the firing path and the owner's own `cancelTask` both
delete the handler without running it, so "cancelled" never doubles as "completed". The leave service keeps one memo:
the operation carries the completion promise callers receive, and `P2pInstance.leaveChannel()` memoizes the
host request only while it is pending. The leader flag is left alone by the reset on both sides of the port;
it is application-owned with a single writer.

Two conformance rows describe deliberately partial contributions and say so in their gap column.
[StateManager](../implementation/source/src/stateManager/StateManager.ts.md) covers only the release-and-reuse
half of [`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9); settlement stays
with the snapshot and dispute owners. [P2PManager](../implementation/source/src/P2PManager.ts.md) covers only
the peer/transport half of the ordered release in
[`REQ-SDK-ARCH-2-QBZAT8` (Ordered lifecycle)](../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8).

The sub-stores implement no reset step of their own (`ForceJoinStorage.clear()` is an in-channel lifecycle
step, not part of the reset), so they carry no unit-test family for it; the obligation is owned by
[`UNIT-TEST-STORAGE-FACADE-3-9N4C6W`](../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w),
whose permutations name each module individually and read it back through the aggregate.

The reset also guards against work it cannot stop. Before its first await it advances a channel generation
and retires the old fork, and only after the mutex section that sets `NOT_OPENED` does it re-arm the
initial-sync latch. Each step answers a failure observed on the distributed farm. A leave from a runtime that
owes no departure resets at once, even while the old channel's initial sync is still waiting on its peer:
that late sync settled the re-armed latch, so the next `connectToChannel` returned `false` without syncing,
and its payload could persist into the reset runtime. Re-arming the latch inside `P2PManager.resetChannel()`
let the reset's own `OPENED` → `NOT_OPENED` transition settle the next channel's wait as failed. And an
old-channel chain-log handler still running during the drain could start a reduction on the still-current
fork whose timer the task drain then cancelled, which showed up as a drain timeout plus a hung detached
promise. The generation has one writer ([StateManager](../implementation/source/src/stateManager/StateManager.ts.md)) and two
readers: [SpectateService](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md) checks it under the
same mutex the reset clears storage under, so a payload lands either before that clear or not at all, and
[P2PManager](../implementation/source/src/P2PManager.ts.md) checks it before settling the latch. Replayed blocks need no fence of
their own because `ValidationService` refuses a block for a different channel id. A stale sync returns
`false` without cutting its responder, since the peer answered a request that was valid when it was made. That
now holds on every exit of the sync, not only the persistence one: `rejectSync` takes the captured generation
and drops the disconnect-and-blacklist when it has moved, and the request-failure path in `runSync` — which
used to blacklist unconditionally — passes it too. The in-flight dedupe entry is deleted only while it still
belongs to the finishing attempt, because `reset()` can clear that map mid-flight and the next channel may
already have registered its own sync to the same peer. `ReductionExecutor.submitDetached` reads the
generation as well, beside its existing disposal check and at the same point — immediately before the
`multicall` — so a submit parked on its gas-limit read when the reset lands abandons the write instead of
sending it into the next channel.

The second review round found that the fence was placed at the last point of each operation rather than at
every point where it leaves a trace, and the corrections follow one rule: the check belongs immediately
before each effect the operation can still produce. In
[SpectateService](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md) it now
runs before `fetchAndPersistOnChainSnapshot`, which is the method's first write and happens before any of
the payload is verified, and once per block in the replay loop, because every ingest awaits the state mutex
and a reset can take it between two blocks. In
[LocalP2pSigner](../implementation/source/src/evm/signer/LocalP2pSigner.ts.md) both join paths capture the
generation before `prepareJoinChannelConfirmation` and re-read it before `joinChannel`/`topUpBalance`: the
collected authorization is still perfectly valid, which is exactly the problem, because submitting it would
put the departed signer back into the channel it just left — the one late effect no local cleanup can undo.
In [IsForkDisputedService](../implementation/source/src/rpc/network/services/isForkDisputedService/IsForkDisputedService.ts.md)
the detached per-peer requests capture it and both consequence branches consult it, since the reset cuts
every transport and would otherwise convert its own teardown into an exclusion of every peer in the round.
[StateManager](../implementation/source/src/stateManager/StateManager.ts.md) gained the predicate those
readers share, `isStaleChannelWork(generation)`, so no call site restates the comparison.

One correction is deliberately not a generation check. A verdict recorded _while the release is running_
cannot be caught by comparing generations — the generation has already moved, and what has to be suppressed
is the verdict rather than a write — so the reset raises `_isResettingChannel` beside the generation bump and
lowers it in a `finally`, which is why the ordered release body moved into the private `releaseChannel()`:
the flag has to fall on the throwing path too, and a `try` around the whole inline sequence would have buried
the sequence that the ordering argument rests on. Both of
[P2PManager](../implementation/source/src/P2PManager.ts.md)'s blacklist entry points read it and only
disconnect while it is up. The justification is the engineer's own decision: since 2026-09-19 an exclusion is
identity-scoped and survives the reset, so a verdict earned against a peer that is being dropped _because_
the channel is being given up would follow that identity into the next channel while belonging to no channel
this runtime served.

Two reset steps can now fail rather than merely finish, and the ownership of that failure is deliberate.
`StateManager.resetChannel()` checks the chain-feed drain and throws when it reports unfinished work, because
a handler outliving the bound would resume against the next channel; it does not itself dispose, since reset
is not a terminal operation and the runtime's fate belongs to the caller. `LeaveChannelService.settleAndReset`
is that caller: it logs, calls `stateManager.abort()`, and rethrows, so the leave rejects and the instance is
retired. Keeping the leave operation would be wrong here — the departure already settled, so there is nothing
to retry — which is why this route differs from a rejected departure, where the operation and the channel
binding are deliberately kept. The result is the pre-reuse behaviour as the failure mode: a leave that cannot
finish leaves a shut-down runtime, exactly as every leave did before runtimes were reusable.

`ProfileManager.releaseChannelPeers()` is the one place the peer half of the reset diverges from disposal,
and it exists because of an engineer decision rather than a mechanism: exclusion is identity-scoped for the
runtime's lifetime (2026-09-19, PR #494), so the release closes every transport and forgets every profile
except the blacklisted ones. The excluded peer's transports still close; only the verdict survives. Nothing
here makes the verdict durable — the indexes are in memory, so a restart still clears them.
