# Implementation Assessment

> **Agent assessment:** In progress.
> **Engineer disposition:** Pending.

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
