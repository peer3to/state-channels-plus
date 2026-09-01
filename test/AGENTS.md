// @spec-test-coverage-ignore: repository-local test guidance; it contains no executable evidence

# Test harness guide (`test/`)

Root conventions still apply (see `../AGENTS.md`). This file covers the
architecture that is specific to the test suite — especially the harness and the
host-side control RPC, which are not obvious from the code alone.

## The runtime-port boundary (read this first)

On the `sdk-thread` branch the whole P2P engine runs behind a **serializable
message-port boundary** (`src/evm/p2pRuntime/*`). It runs either inline or in a
real worker thread depending on `RUN_SDK_IN_THREAD`, but **both modes
structured-clone every value across the port** — inline is _not_ pass-by-
reference. Consequences for tests:

- `peer.p2pInstance.getStateManager()` **throws**; there is no client-side state
  manager. `TestPeer` has no `stateManager` field.
- The harness is a **thin client**. Anything that needs the live signer,
  `p2pManager`, storage, disputeManager, or contracts must run **host-side** via
  the harness-control RPC and return a **serializable projection** (hash, height,
  address, plain struct) — never a live `Block`/transport/profile.
- Don't reason about "inline is faster / by-reference." If something works inline
  but not in a worker, it's almost always a serialization bug (e.g. `BigInt`,
  an ethers `Result`, a `Map`/`Set`, or a revert that lost its `.data`), not a
  mode difference.

## HarnessControlRpc — the host-side control surface

`test/fixtures/customRpc/harnessControl/HarnessControlRpc.ts` is a custom RPC
(`extends MainRpcService`) that every peer is built with. It groups host-side
operations into focused services. Call them from the client:

```ts
harness.control(peer).query.getForkId().request(); // loopback to self
harness.control(peer).network.connectToChannel(id).request();
ctl(peer0).pingService.ping("hi").sendOne(peer1.address); // target another peer by EVM address
```

`.request()` = loopback (run on this peer's host). Target _another_ peer by **EVM
address** (`.sendOne(address)` / `.request(address)`) — never by passing an
`ATransport` (not serializable).

### Adding / changing a service (mirror `src/rpc/services/*`)

Each service is a directory `services/<name>/` with two classes:

- `<Name>Service extends ARpcService<<Name>RpcMethods>` — holds **all** accessors
  and shared state (`get sm() { return this.p2pManager.stateManager }`, etc.) and
  `createRPCMethods(transport)`. The service is **not** routable.
- `<Name>RpcMethods extends ARpcMethods` — **only public endpoint functions**. At
  runtime `private` doesn't exist and the dispatcher routes by name, so any
  method here is callable by a crafted payload. Helpers go on the service; reach
  them via `this.service.*`.

Then register it in `HarnessControlRpc` (field + `new …Service(p2pManager)` in the
constructor). **Map by the action that uses it**: balance math → `balance`,
read-only queries → `query`, state-transition ops → `transition`, etc. If a
harness `FooActions` drives it, its host methods belong in a `foo` service —
don't grow a catch-all.

Current services: `query`, `transition`, `balance`, `network`, `byzantine`,
`stub`, `handshake`, `signer`, `spectate`, `scenario`, `dispute`.

### Serialization rules for endpoints

- Return projections, not live objects (`block.toStruct()`, hashes, addresses).
- Cross ethers/typechain structs with `Codec.encode`/`Codec.decode`; name the hex
  payloads `encoded*` (see root `AGENTS.md`).
- Stub sites are **concrete methods**, not free-form path strings, so an SDK
  rename breaks compilation here instead of failing silently (`stub` service).
- Function-valued inputs become **named strategies**, never shipped source — the
  one exception is `scenario.exec` / `harness.execOnHost(...)`, the deliberate
  white-box escape hatch that ships a **closure-free** `fn.toString()` and reaches
  everything through the injected `sm` (pass captured values via `args`).

## The harness object model

- `PeerTestHarness<TCustomRpc extends HarnessControlRpc = HarnessControlRpc,
TStateMachine>` — the base is `HarnessControlRpc` (not `MainRpcService`), so
  every harness instance is type-required to expose the control services.
  `MathPeerTestHarness` fixes `TStateMachine = MathStateMachine`.
- Behaviour lives in **action classes** (`test/harness/actions/*`), each generic
  over the same `TCustomRpc` and taking `harness: PeerTestHarness<TCustomRpc>`.
  `Math*` subclasses specialize them for the math state machine.
- Events (spies + barriers) stay on the **main thread**: the host forwards
  `p2pEventHooks` + `EventHandler` invocations over the port and
  `registerPeerEventListeners` drives the sinon spies / `eventCountsBarrier` from
  the client.

### Intentional network isolation

- `network.blacklistAndDisconnectPeer(index)` is persistent test isolation, not a raw
  transport failure. It blacklists the peer pair in both directions and closes
  the current transports, so joined Holepunch topics cannot reconnect it.
- `network.reconnectPeers(indices)` is the explicit inverse. It clears the
  pairwise harness blacklist on both hosts before it rejoins discovery.
- `network.connectPeers(indices)` performs initial connection only and does not
  change blacklist policy.
- Raw transport-close controls are only for component tests that exercise
  natural LocalDiscovery reconnect behavior. Do not use them to stage an
  offline peer in a protocol test.

### Typing model — why `control()` has the one cast

`peer.p2pInstance.hostRpc` is `RemoteRpcProxyType<TCustomRpc>`. That proxy type is
a **non-homomorphic mapped type** (it filters keys with an `as` clause), and TS
will **not** expand it over a generic `TCustomRpc` — so even though
`TCustomRpc extends HarnessControlRpc`, `.query`/`.network`/… are invisible on a
generic peer, and `PeerTestHarness<TCustomRpc>` is not assignable to
`PeerTestHarness<HarnessControlRpc>`.

Resolution (don't re-litigate this):

- The generic is propagated through every action class so `new XActions(this)`
  type-checks with no cast.
- `PeerTestHarness.control(peer)` holds the **single** bridge cast
  (`hostRpc as unknown as RemoteRpcProxyType<HarnessControlRpc>`) — the one spot
  that narrows a generic peer to the services it actually runs. Member access
  goes through `control()`; `SyncCoordinator` receives `control` as an injected
  fn so it needs no cast of its own.
- A test with its _own_ custom RPC (`PeerTestHarness<PingPongRpc>`) reads its
  extra services off the concrete `peer.p2pInstance.hostRpc` directly, or casts
  `control(p)` once to its RPC type (see `E2E-PingService`).

Don't add `as unknown as` at call sites to reach control services — route through
`control()`.

## Config & modes

- `peer3.test.config.ts` is loaded at **config-file precedence** inside
  `setup()` (`createConfig(overrides, testConfig)`), so `process.env`
  (`RUN_SDK_IN_THREAD`, `PROVIDER_URL`, `LOCAL_DISCOVERY_REGISTRY_URL`, …) and
  explicit `configOverrides` still win over it.
- Inline vs worker is `RUN_SDK_IN_THREAD`. Worker mode derives each peer's
  `signerSecret` from the hardhat mnemonic so the host thread can sign.

## Unit tests

- **Unit tests use the same harness framework — no mocks, no junk data.** The
  framework isn't e2e-only: teleport a real session to the scenario you need
  (spin up peers, advance/sync to the target state), then exercise the one
  component under test host-side (`execOnHost` / a control service) with all
  of its real collaborators wired. Same machinery as e2e, unit-test scope.
- Components with collaborators (e.g. `BlockQueueManager` needs a live
  `StateManager`) are tested exactly this way — never by stubbing the
  collaborators.
- **Fixtures trigger src code, they never reimplement it.** A side effect a
  test asserts (disconnect, blacklist, fraud proof, …) must be produced by
  the real source path — e.g. send over the real RPC so the receiver's entry
  point runs — not mirrored inside a harness endpoint.
- Pure data structures (`QueueStorage`, `Block`, codecs) can skip the session
  and be exercised directly — but still with real domain objects built via
  `test/factory.ts` and real identities via ethers wallets, never placeholder
  data that couldn't decode/verify in production.
- **Record-only host probes are the one sanctioned stub shape.** When a real
  side effect would derail the live session (e.g. `disputeManager.dispute`
  posting an on-chain dispute against an honest block mid-test), a host-side
  patch may _record_ the call instead of forwarding it — record, never
  reimplement, restore in the same block. The logic under test must still be
  the real code path; the recorded call proves the boundary was reached, and
  the real side effect must have its own coverage on an e2e path where it can
  run for real.
- **Test files contain tests, not helpers.** Any staging used (or usable) by
  more than one test lives in the harness where other tests can discover it:
  host-side manipulations as concrete `stubX`/`restoreX` pairs on the `stub`
  control service (holds, records, fault injection), client-side combos on
  `rpcStub` actions, adversarial payload crafting on `byzantine`. Existing
  examples: `stub.stubHoldReductionTasks` / `rpcStub.holdReductionRace`,
  `rpcStub.recordSpectateSync`, `byzantine.craftBogusForkBlockZero`. Inline
  `execOnHost` staging is acceptable only for genuinely single-use, bespoke
  instrumentation inside one test.
- **No per-test restore hooks.** Each test starts a fresh session and teardown
  discards the peers, so patched host internals die with them — don't add
  `afterEach` cleanup for host patches. Release staged holds mid-test via the
  teardown the stub action returned; the one thing that must not be left
  behind is a _paused in-flight call_ (release its resolver before the test
  ends).

## Async join/spectate/leave — never block the authoring window

Spectating, joining, and leave completion are asynchronous to the channel:
remaining participants author blocks on their own cadence and never wait for a
spectator to sync, a joiner to be admitted, or a leaver's on-chain exit to
complete. Tests must model this. Once a block exists, the next block's timestamp
is capped at `prev + p2pTime` while validators only accept it within
`|now - blockTs| <= agreementTime` — so a blocking setup step placed between
transitions burns the author's window and ends in a rejected block, a
participant-timeout dispute, and a dead fork. Widening the timeConfig to fit the
setup is not a fix; it hides the modeling error.

Harness `network.connectToChannel` dispatches detached work. Its immediate RPC
acknowledgement does not mean the signer connected or synced. A full-flow test
must drive the real attempt to its terminal boundary and call
`TestSession.settleDetached()` before returning. Teardown only reports forgotten
work; it does not cancel or dispose the feature operation.

- `addSpectatorDetached` is the default way to add a spectator.
  `addSpectatorWait` is reserved for tests whose subject is the sync flow
  itself and that schedule no state transitions while it blocks.
- `addSpectatorDetached()` still returns only after the peer process is
  created and connected. On an active fork, keep that returned promise without
  awaiting it, produce the overlapping blocks, then await the peer and its
  `SYNCED` status.
- Need the spectator synced for a later step (e.g. `joinChannelWait`)? Keep
  transitions flowing first, then await
  `h.event.waitUntilPeerStatus(peer.index, Status.SYNCED)` immediately before
  the step that needs it — by then the sync has overlapped the transitions.
- `participantLeaveDetached` is the default when remaining participants will
  author another block. Use `participantLeaveWait` only when completed exit or
  the leaver's `SYNCED` status is the test subject and no later transition needs
  the current authoring window. After a detached leave, keep the remaining
  participants moving, then await the leaver's `SYNCED` status immediately
  before the assertion or action that needs the completed exit.
- An overlapping transition must wait only for the current participants. Do
  not include a syncing spectator or exiting leaver in `waitForPeers`. After
  its status wait completes, add a full sync barrier if the next assertion
  needs every observer at the same head.
- Treat every blocking `*Wait` in the join/spectate family the same way: place
  it directly adjacent to the transition that depends on it, never stacked
  behind other blocking setup inside the authoring window.
- The scheduled-transition rule cuts both ways: multi-second setup with no
  scheduled transition (e.g. before the first block) is fine — nothing is
  waiting — but the height-0 participant timeout
  (`p2p + agreement + chainFallback + evidence` after genesis) is still a hard
  deadline for producing block 0.

## Protocol wait budgets

- Never increase a test's `timeConfig` to fix a flake unless the user explicitly
  asks for that change. `timeConfig` is protocol input, not a test wait budget.
  Diagnose and fix the ordering, detached-work, lifecycle, or event-barrier bug
  that made the test depend on extra protocol time.
- Do not hardcode timeout values for protocol, event, status, sync, dispute, or
  snapshot waits. Omit the timeout when the action has a derived default, or use
  `h.event.protocolEventTimeoutMs(...)` when a lower-level API requires one.
- A fixed duration is allowed only when time is the test input or oracle, such
  as testing timeout behavior, holding an absence window, or injecting a short
  scheduling delay. Keep that reason clear at the call site.

## Chai comparators and contract-bearing objects

`hardhat-chai-matchers` overwrites `.equal`/`.gt`/… and probes **both operands**
with ethers `getAddress`. A failed probe constructs an `INVALID_ARGUMENT` error
whose info embeds the whole operand, and ethers stringifies it **recursively** —
on a graph containing ethers Contract proxies (a `TestPeer`, `p2pInstance`,
`contractInstance`, …) every unknown key spawns another error: thousands of
`makeError`s, a multi-second main-thread stall, and a watchdog kill (shows up as
a "starved" test). Never pass peers/contracts/rich harness objects through an
overwritten comparator — assert on a scalar projection (`peer.index`, a hash) or
use a non-overwritten form (`expect(x, "msg").to.not.be.undefined`). Found via
cpu-profile on the wrong-fork dispute tests (2026-07-06); the starvation counter
in the parallel summary is the detector.

## Comparing addresses — no defensive conversions

Addresses are already ethers-checksummed everywhere a test can reach them:
`peer.address`, control-service projections (`signerAddress`, `author`,
`sourcePeers`, `disconnectedAddresses`, `confirmationSignerAddresses`) and
contract reads (`getParticipants`, `getPendingParticipants`). **Compare them
directly.** No `.toLowerCase()` on either side, no
`.map((a: unknown) => String(a))` to "normalize" a contract array, no `String(x)`
around a value that is already a string.

These conversions are noise: they hide which side is actually wrong and make an
assertion pass for the wrong reason. If a comparison only passes with one, the
projection or its type is wrong — fix that, don't paper over it. Verified by
stripping all 29 of them from `test/unit/ValidationService.test.ts` (2026-07-28)
with the suite still green.

## Running tests

- Parallel and distributed discovery requires direct, static test declarations.
  Every case must be an explicit `it("literal name", ...)` in the test file.
  Do not generate tests with loops, `.forEach`, parameter matrices, dynamic
  names, or helper functions that register tests. Move shared bodies to a
  separate helper or fixture file and pass explicit arguments from each `it`.
- Typecheck: `yarn tsc --noEmit -p tsconfig.json` (the `TestPeer`/control surface
  is fully typed — a removed/renamed field is a compile error, your free
  checklist).
- Canonical full gate: `yarn test:parallel:distributed`. Add `--e2e-only` to run
  only E2E tests, or `--grep <regexp>` for the narrowest relevant task.
- Legacy in-process unit/integration: `yarn test`. E2E inline: `yarn test:e2e`.
- E2E in worker mode: `yarn test:e2e:worker` (per-file process isolation +
  internal X/N progress; needs the hardhat node — `yarn infra:hardhat-node`).
- Local parallel runner: `yarn test:parallel` — use it for focused local runs;
  each run logs to a fresh
  `./logs/run-N/`; earlier run dirs (and their `error_*` logs) are retained
  for cross-run comparison. Only the current run's dir is cleared. See root
  `AGENTS.md` ("Canonical test command and parallel run logs").
- Distributed runner: start workers with `yarn test:parallel:server` and run the
  canonical full gate with `yarn test:parallel:distributed`. See the "Distributed
  parallel tests" section in `README.md` for setup and options.
- Narrow first: run the single `*.test.ts` you touched before the suite.
