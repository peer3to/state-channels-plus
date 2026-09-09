# Implementation Assessment

> **Agent assessment:** In progress.
> **Engineer disposition:** Pending.

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

## Refusal attribution and an admission-only suspension — 2026-09-08

The handshake ack timeout now returns before any consequence when the transport is already closed,
logging the same `ack-timeout` message with a distinct reason. The verified-but-silent exclusion is
unchanged for a transport that is still open.

The reconnect suspension is admission-only. `ProfileManager.banReconnect` sets a profile flag and
nothing else: it bans no discovery handle, the local backend's dial gate skips only a blacklisted
peer, and `allowReconnect` has nothing to restore. A suspended peer therefore keeps being announced,
dialed and accepted at the transport level, and is refused at handshake verification and at final
admission until the suspension lifts; the first attempt after the lift is admitted by the ordinary
retry loop. Only the exclusion path still bans the handle a refused attempt arrived on, which is
what stops a rotated discovery key from bypassing a blacklist.

An intermediate revision made the suspension suppress dials instead — a `reconnect-banned` skip in
the local dial gate and a Hyperswarm handle ban — and then had to add `LocalDiscoveryServer.redialPeer`
so the suspending side could dial the peer back on a lift, because it owned the pair's only dialer.
Both were withdrawn. The suppression starved the pair of its only dialer in the local backend: in
`test/e2e/E2E-LobbyMatching.test.ts` the unmatched peer of a three-peer lobby is a pure acceptor
whenever it holds the highest address, so both matched peers skipped dialing it and the redial the
test waits for never happened. Refusing at admission keeps the observable behavior the lobby needs
(the peer never becomes a session again) without any node owning the pair's reachability.

An intermediate revision instead armed a delayed dial takeover from the accepting side on every
inbound transport close. It was withdrawn as unsound. Close intent is not carried on the wire —
`ATransport.close(isExpected)` is local-only and `LocalTransport` sends a bare socket close whose
code and reason the receiver discards — so from the acceptor, "the primary suspended me" and "the
primary deliberately left" are the same event, and the takeover resurrected transports to peers that
had dropped the feed on purpose. It was caught on the distributed pool: the pre-dispute spectator
case in `test/e2e/E2E-Spectate.test.ts` passed 5/5 on the base revision and failed 5/5 with the
takeover, because four honest peers re-established live sessions to a spectator that had aborted
channel participation, which stalled the reduced fork's writer slot and opened an unplanned second
dispute.
