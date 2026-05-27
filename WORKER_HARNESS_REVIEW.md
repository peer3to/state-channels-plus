# Worker harness critical review

Scope: commits `77bd0b14..HEAD` on `threaded-harness-on-v339`
Date: 2026-05-27
Diff size: 87 files, +9,318 / -1,061

---

## TL;DR

1. **The whole worker backend is dormant infrastructure.** Outside of the four self-tests in `test/harness/threaded/__tests__/`, no e2e test ever sets `dedicatedPeerThread: true`. Every committed scenario goes through `InlinePeer`. The boss's actual goal (multi-thread test parallelism) is gated on `W5` chain-access work which the comments themselves call "blocked". Recommendation: **don't ship the worker code in this PR**. Pull `InlinePeer` + the action migrations into a small, separate PR, and resurrect the worker stuff when a real consumer demands it.
2. **`subHandleRoutes.ts` (1,682 LOC, 74 routes) re-declares the SDK's `StateManager` shape inline ~42 times** via `as unknown as { storage: { blocks: { ... } } }` blocks. The shapes drift silently when the SDK changes — exactly the user's pet peeve. One typed accessor + direct SDK type imports would cut this file by ~60%.
3. **`InlinePeer` (1,374 LOC) and `WorkerPeer` (726 LOC) duplicate ~50 method signatures three times** (PeerHandle interface, InlinePeer body, WorkerPeer body) and again as a route table in subHandleRoutes. Most of those bodies are 1-line passthroughs to `peer.stateManager.x.y(args)`. A single generic `query(path, args)` rpc plus typed wrapper helpers would collapse 3,000+ LOC into ~200.
4. **The 200+ duplicated "serializable" type fragments (`{ amount: string; data: string }`, `{ hash; height; stateMachineStateHash }`, etc.) inline in `PeerHandle.ts` are mostly avoidable.** The SDK already has `toStruct()`/`from()` for the models that need it (StateSnapshot, Block) — but the harness invents new flat shapes instead of riding the round-trip. Use `Pick<SDKType, ...>` plus the existing `toStruct/from` pair.
5. **The boot-time `W5BlockedError`, `LoopDelayExceededError`, `WorkerSpyUnsupportedError`, `UnsupportedInWorkerMode`, `WorkerOpAlreadyRegisteredError`, `WorkerOpNotFoundError`, `DeploymentRegistryConflict`, `DeploymentNotFoundError`** are all error subclasses with zero `instanceof` consumers in product code. Delete them or use plain `Error` with `name`.

**Realistic line reduction: ~4,000-5,000 LOC (out of ~9,300 new) without losing any functionality that currently runs.**

---

## Pain point 1: interface/struct duplication

The user is right: the new code defines local mimics of SDK shapes everywhere, almost always so the value survives `structured-clone` across the worker boundary. Each duplicate is a drift hazard.

### 1.1 — Inline structural casts of `StateManager` and `Storage`

`test/harness/threaded/worker/subHandleRoutes.ts:17-73` declares a top-level `WorkerStateManager` "structural stand-in" — then **every single route handler re-declares its own slice anyway** via `ctx.getStateManager() as unknown as { storage: { blocks: { getLatestBlock: ... } } }`:

- `subHandleRoutes.ts:153-168` (queryBlockAt — re-declares `storage.blocks.getBlock`)
- `subHandleRoutes.ts:194-212` (latestStateMachineStateHash — re-declares three storage sub-types)
- `subHandleRoutes.ts:229-234` (nextBlockHeight)
- `subHandleRoutes.ts:243-253` (stateSnapshotAt)
- `subHandleRoutes.ts:271-279` (stateMachineState)
- `subHandleRoutes.ts:283-289` (stateSnapshotCount)
- ...42 occurrences in this file alone (`grep -c "as unknown as"` = 47).

**SDK source it mimics:** `src/stateManager/StateManager.ts`, `src/storage/*`. The real types live there; the worker route doesn't reach for them because **importing `StateManager` from `@/stateManager` would tug in chain/p2p code at boot**. That cost is real but it's bounded — `type StateManager from "@/stateManager"` (type-only import) is free.

**Inference for why it was created:** the author was minimising worker-boot cost and (separately) didn't want subHandleRoutes to break if the action audit cited slightly different field paths.

**Proposed alternative:** one shared `WorkerStateManagerShape` defined as `import type StateManager from "@/stateManager"; type WorkerStateManagerShape = StateManager` (or `Pick<StateManager, "storage" | "diamondStateMachine" | ...>`). The `ctx.getStateManager()` signature returns `StateManager`; every handler reads it normally.

**Estimated line savings:** the 42 inline-cast blocks average ~10 lines each → ~400 LOC. Plus removes the drift hazard entirely.

### 1.2 — `InlinePeer` redeclares SDK paths

`test/harness/core/InlinePeer.ts` does the same thing on the inline side, 43 `as unknown as` casts (`grep -c "as unknown as"` = 43). Same fix: import the real types.

- `InlinePeer.ts:233-242` casts `p2pManager` to a hand-written shape to read `profileManager`
- `InlinePeer.ts:257-266` does it again for `getProfileByConnectionId`
- `InlinePeer.ts:329-338`, `InlinePeer.ts:464-472` do it again for `callServiceMethodWithTransport`/`callServiceWithTransport`

**Proposed alternative:** define one `type LiveStateManager = TestPeer["stateManager"]` at the top of the file (already imported as `StateManager` in `test/harness/core/types.ts:9`) and use it everywhere. Most inline methods become ≤3 lines.

**Estimated line savings:** ~300 LOC.

### 1.3 — Hand-rolled "serializable" shapes in `PeerHandle.ts`

`test/harness/core/PeerHandle.ts` invents shapes that mimic existing SDK structs but with all `bigint` flattened to `string` and all class instances flattened to plain records:

| Local shape (PeerHandle.ts)                                      | SDK source it mimics            | Why introduced             |
| ---------------------------------------------------------------- | ------------------------------- | -------------------------- |
| `BlockSummary = unknown` (line 20)                               | `Block` / `BlockStruct`         | placeholder, never refined |
| `{ amount: string; data: string }` (lines 357, 366-373)          | `BalanceStruct`                 | bigint serialise           |
| `{ hash: string; height: number; author: Address }` (line 263)   | `BlockStruct` (subset)          | structured-clone safe      |
| `{ hash; stateMachineStateHash; blockHeight }` (line 289)        | `StateSnapshotStruct` (subset)  | structured-clone safe      |
| `{ proofType: number; participant: string }` (line 324)          | `FraudProofStruct` (subset)     | drop typechain getters     |
| `{ randomChallengeHash; initTime }` (line 156)                   | `Challenge` (handshake service) | drop class methods         |
| `{ participant; isForced; blockHeight? }` (line 344)             | `TimeoutStruct`                 | bigint serialise           |
| `{ blockConfirmationStruct: unknown }` ...                       | `BlockConfirmationStruct`       | `unknown` placeholder      |
| The whole `prepareUpdateSnapshotSameFork` return (lines 421-430) | live SDK return type            | strip class wrappers       |

**Why it was created (your inference):** structured-clone doesn't preserve class methods/private fields, so the author projected each result to a plain record at the worker boundary. But the SDK already has `toStruct()` on `StateSnapshot` (`src/models/StateSnapshot.ts:27`) and `static fromBlockConfirmation` on `Block` (`src/models/Block.ts:52`) — that round-trip is the canonical way to cross a boundary.

**Proposed alternative — one of:**

a. **Use `Pick<>` on the SDK struct types directly.** Replace `{ hash: string; height: number; author: Address }` with `Pick<BlockStruct, "hash" | "previousBlockHash"> & { height: number }` so type drift is caught at compile time. Zero runtime cost.

b. **Standardise on `toStruct/from` for all model boundaries.** Worker always ships the typechain struct; orchestrator always rehydrates via `StateSnapshot.from(struct)`. The current code does this for _some_ paths (`subHandleRoutes.ts:639-640`, `824-846`) but invents new flat shapes for others. Pick one rule.

c. **One generic `query(path: string, args)` rpc plus a typed orchestrator-side wrapper.** Today's 74 routes become 1 route. The wrappers are still type-safe via a `Path -> ReturnType` mapping. Lines saved: ~1,200.

**Estimated line savings:** ~400 LOC in PeerHandle.ts alone, plus ~600 LOC of "destructure-flatten-restringify" in InlinePeer + subHandleRoutes.

### 1.4 — Multiple `unknown` placeholders that drift from reality

`PeerHandle.ts:19-26` defines `StateStatus = unknown`, `BlockSummary = unknown`, `StorageReadRequest = unknown`, `ApplyTxRequest = unknown`, `IngestBlockReq = unknown` etc. — six type aliases that all resolve to `unknown`. They look like documentation but contribute zero type safety.

**Proposed alternative:** either delete them (callers already cast to the right SDK type) or wire them to the SDK type. The current state is the worst of both worlds.

---

## Pain point 2: over-engineering

### 2.1 — Five-layer indirection per harness call

A test-side call like `peer.byzantine.stubCalldataHandler()` traverses:

1. Action class method (e.g. `ByzantineActions.stubX`)
2. `harness.getPeerHandle(i)` lookup
3. `handle.byzantine` sub-handle (one of seven sub-handle namespaces)
4. `InlineByzantineHandle.stubX` body — OR — `WorkerByzantineHandle.stubX` → rpc
5. Worker side: rpc dispatch → `byzantine.stubCalldataHandler` route → `ctx.getStateManager()` → real call

Most of these layers are passthroughs.

**Concrete simplification:** collapse the seven sub-handle classes (`ByzantineHandle`, `RpcStubHandle`, `P2pInternalsHandle`, `NetworkHandle`, `DebugHandle`, `LifecycleHandle`, `TransitionHandle`) into **plain methods on `PeerHandle`** — they're already namespaced by method name anyway (`stubCalldataHandler`, `installCreateRpcMethodStub`, ...). Killing the sub-handle layer:

- removes 7 class declarations × 2 backends = **14 wrapper classes** (`InlineByzantineHandle`, `WorkerByzantineHandle`, ...)
- removes the constructor wiring in `InlinePeer` (lines 685-700) and `WorkerPeer` (425-437)
- `PeerHandle` becomes a flat interface; route ids become `<method>` not `<namespace>.<method>`.

**Line delta: ~300 LOC removed, no semantic change.**

### 2.2 — `RpcEndpoint` (`rpc-endpoint.ts`) is one function call

`test/harness/threaded/rpc/rpc-endpoint.ts:18-31` exports `attach(port)` returning `{ client, server, dispose }`. It's used in two places (worker `entry.ts`, orchestrator `PeerWorker.ts`) — but those two places **don't actually use `attach()`**, they construct `RpcClient` and `RpcServer` independently and dispose them independently. The helper exists for one consumer it doesn't have.

**Recommendation:** delete `rpc-endpoint.ts` (31 LOC). Either resurrect it as the one canonical way to make a bidirectional endpoint and use it in `PeerWorker.spawn` + `entry.ts`, or remove it.

### 2.3 — `HttpHardhatNode` wraps one `hre.run()` call

`test/harness/threaded/HttpHardhatNode.ts` (49 LOC) is a class with one method (`start()`) and one cleanup (`close()`). It captures one variable (`this.server`).

**Recommendation:** make it two free functions `startHttpHardhatNode()` / `closeHttpHardhatNode(server)`. Save ~20 LOC and one allocation per test.

### 2.4 — `PeerWorker` and `WorkerPeer` are two classes for one job

`test/harness/threaded/PeerWorker.ts` (353 LOC) spawns the worker and exposes an RpcClient. `test/harness/core/WorkerPeer.ts` (726 LOC) wraps the RpcClient and implements `PeerHandle`. They could be one class. The split adds:

- `worker.getRpcClient()` / `worker.getRpcServer()` accessors used only to plumb between the two.
- `onDispose: async () => { await worker.dispose() }` plumbing (`PeerTestHarness.ts:746-748`).
- A second listener registration site (`PeerWorker` registers `lifecycle.*` push, `WorkerPeer` registers `fork.changed`).

**Recommendation:** fold `PeerWorker` into `WorkerPeer.create(args)` static factory.

### 2.5 — `StubCallbackRegistry` is one Map with a string-keyed namespace

`test/harness/core/StubCallbackRegistry.ts` (54 LOC) has two maps (`stubs`, `filters`) keyed by `"stub#N"` / `"filter#N"` strings. It exists because the orchestrator side wanted _two_ invoke endpoints (`harness.invokeStubCallback`, `harness.invokeFilterCallback`) registered on the worker rpc server (`PeerTestHarness.ts:658-674`).

**Recommendation:** one map, one rpc endpoint `harness.invokeCallback(id, args)`. The "kind" is encoded in the id prefix already. Drop one map, drop one rpc registration, drop one indirection. Saves ~30 LOC.

### 2.6 — `deploymentRegistry.ts` does sha-256 derivation for a feature with no consumers

`test/harness/core/deploymentRegistry.ts:105-116` exports `deriveAutoKey()` that hashes deployer function names + arities to produce an `"auto:<sha>"` key. **No caller in the new tree uses `deriveAutoKey()`** (grep returns zero hits in `test/`). The docstring says "used by SingleThreadedHarness" — there is no `SingleThreadedHarness` class.

**Recommendation:** delete `deriveAutoKey`, `_resetRegistryForTests`, `listDeployments`, `hasDeployment` (only used to short-circuit double-registration which a simple `Map.has` covers inline). The whole registry is ~10 LOC if you keep just `register/resolve`.

### 2.7 — `namedOpGuards.ts` has a runtime guard for a class no longer in scope

`test/harness/core/namedOpGuards.ts` exports `rejectClosureInWorkerMode` + `rejectLambdaArgs`. The first is used by `TransitionActions.submit` (line 265) to throw if you pass a `txFn`. **But the env doesn't ever flip `dedicatedPeerThread=true` for the e2e suites** (see Pain point 3) — so the guard never fires. It's pre-positioned for a flow that doesn't exist.

The "write-time lint" the comment promises (a "closure-capture analyser") is also not in the diff.

**Recommendation:** keep `rejectLambdaArgs` (cheap), delete `rejectClosureInWorkerMode` + its single import in `TransitionActions.ts:265-268`. Re-add when a real test demands it.

### 2.8 — Spy mirror push channel does the work `SinonSpy` does

`SpyMirror.ts` + `SpyRegistry.ts` + the entry.ts `EventHandler` proxy together push frames over rpc to keep an orchestrator-side `Map` of spy counts. The fan-out switch in `PeerTestHarness.ts:710-723` then re-signals barriers based on the spy name (string-matching `onConnection`, `onDisconnection`, `onTurn`). This is rebuilding sinon + event-emitter from scratch over rpc.

**Recommendation:** the worker can use real `sinon` spies internally. On `resetSpies()`, push the worker's spy call counts via a single rpc; on `getCount()`, do a synchronous read of a cached value or a one-shot rpc. The push-frame fanout is needed for barrier wake-ups, but the _spy state_ doesn't need a mirror — the events fire the barriers and that's sufficient. A real test only reads `.callCount` after a `waitFor` resolves.

This is speculative; leaving as an idea.

---

## Pain point 3: YAGNI

### 3.1 — The entire worker backend has zero e2e consumers (BLOCKER)

`grep -rn "dedicatedPeerThread.*true"` in `test/` returns **one match outside the new `__tests__` smoke tests:** `test/harness/threaded/__tests__/PeerHandle.test.ts:85`. The `HARNESS_DEDICATED_PEER_THREAD` env var is referenced only by `scripts/probe-list.sh` and `scripts/probe-worker.sh` (developer probes, not CI).

- All ~50 `test/e2e/**` tests inherit `dedicatedPeerThread=false`.
- All harness-internal smoke tests are in `test/harness/threaded/__tests__/` and self-test the worker code.
- The "real" feature (worker peers running real disputes) is gated on W5 (chain access), which is documented in-line as unfinished (`worker/types.ts:48-52`).

**Cost of leaving in:**

- 5,500 LOC of `test/harness/threaded/`, `test/harness/core/{WorkerPeer,SpyMirror,StubCallbackRegistry,deploymentRegistry,namedOpGuards,LoopDelayExceededError}.ts`, plus all the worker-mode branches scattered through actions (`ByzantineActions`, `RPCActions`, `NetworkController`, `PeerTestHarness`, etc.).
- Every action class that's been "migrated to sub-handles" pays the indirection tax on every test run for a feature no test uses.
- The SDK drift hazard from §1 is unbounded (worker routes silently mismatch SDK changes; nobody notices because nobody runs them).

**Recommendation:** split this PR. Land the **action-class → PeerHandle migration** (which is real value — it forces a single seam) as one PR. Land the **inline body extractions** (e.g. moving today's stub bodies into `InlinePeer.byzantine.*`) as another PR. **Defer the worker backend entirely** until W5 (chain-in-thread) is real and at least one e2e test demonstrates the value.

Alternatively: keep the worker code but **delete the dormant routes**. Of the 74 routes in `subHandleRoutes.ts`, only ~10 are exercised by the `__tests__/` smoke tests. The other 64 are infrastructure for tests that don't exist. They drift silently.

### 3.2 — `queryStorageSnapshot` placeholder

`PeerHandle.ts:431` declares `queryStorageSnapshot(req: StorageReadRequest): Promise<StorageReadResult>` where both arg + return are `unknown`. `InlinePeer.ts:1182-1191` throws `"shape not pinned; awaiting caller migration"`. **Zero callers**.

**Recommendation:** delete.

### 3.3 — `applyTransaction` / `ingestBlockConfirmation` on PeerHandle

`PeerHandle.ts:432-433` defines both. `applyTransaction` has zero callers (`grep -rn "handle.applyTransaction\|\.applyTransaction(" test/` outside the inline body returns nothing). `ingestBlockConfirmation` is similarly unused at the handle level.

**Recommendation:** delete both.

### 3.4 — `WorkerEventSpy.getCalls` throws `WorkerSpyUnsupportedError`

`SpyMirror.ts:115-117` throws because per-call args are not propagated. The error class is declared (`WorkerSpyUnsupportedError`) and there are zero `instanceof` consumers.

**Recommendation:** if no test currently reads `.getCalls()` on a worker spy, just leave it unimplemented; delete the error class.

### 3.5 — `LIFECYCLE_PUSH.log` is wired but no worker pushes log frames

`PeerWorker.ts:186-188` subscribes to `LIFECYCLE_PUSH.log` and re-emits as `"log"` events. No code in `entry.ts` (or anywhere in `test/`) ever calls `server.push(LIFECYCLE_PUSH.log, ...)`. Pre-positioned listener for a feature not implemented.

**Recommendation:** delete the listener + the constant.

### 3.6 — `LIFECYCLE_RPC.drainDetached` is a no-op rpc round-trip

`entry.ts:328-333` registers `drainDetached` to return `{drained: 0}` always. `PeerWorker.drainDetached` (lines 214-220) calls it and races against a 5s timeout. **Zero functional behaviour**; it just adds rpc latency to every call site (zero call sites today).

**Recommendation:** delete.

### 3.7 — `loopDelayMaxMs` is plumbed but the orchestrator does nothing with `loop.stall` frames

`loopGuard.ts` pushes `"loop.stall"` frames. The only consumer is the unit test `LoopGuard.test.ts` which subscribes manually. `PeerWorker` does NOT subscribe to `"loop.stall"`, does NOT convert to `LoopDelayExceededError`, does NOT mark the test failed. The class exists, the wire format exists, but **the orchestrator-side handler the comment promises ("orchestrator marks the active test failed") doesn't exist**.

**Recommendation:** delete `LoopDelayExceededError`, `loopGuard.ts`, the `loopDelayMaxMs` plumbing through `PeerWorker.spawn` (and the W6 default in `PeerTestHarness.ts:649`). Re-add when a real test demands stall detection.

### 3.8 — `phasesCompleted: BootstrapPhase[]` in ReadyPayload

`entry.ts` pushes `phasesCompleted` in the ready frame. **No consumer reads it.**

### 3.9 — `workerBundleManifest` plumbing for one module

The manifest infrastructure (`HarnessConstructorOptions.workerBundleManifest`, `WorkerData.bundleManifest`, the loop at `entry.ts:343-345`) exists to dynamic-import per-test modules. **The actual usage** is a single module: `test/harness/worker-ops/index.ts` which imports `./math`. One module, one consumer.

**Recommendation:** hardcode the import path until a second bundle exists. Saves ~20 LOC.

### 3.10 — Reverted "named handler registries"

Commit `e404cadb` "replace named-handler registries with inline closure callbacks via bidirectional rpc" deletes the named-handler approach. Commit `01a01a34` then **reverts test-source named-handler form back to inline closures**. Two registries were built and demolished. Lessons learned, but the artifacts (the `harness.invokeStubCallback` + `harness.invokeFilterCallback` round-trip, the `StubCallbackRegistry`) are the surviving tail end of a thrice-rebuilt design. The current shape works but it's worth asking whether the inline-closure path _only_, without the registry indirection, suffices.

---

## Pain point 4: type smells

Total `as unknown as` count across the new tree: **94** (`subHandleRoutes.ts` 47, `InlinePeer.ts` 43, `entry.ts` 4, `PeerHandle.ts` etc.).
Total `as never` count: **24+** in `InlinePeer.ts` + `entry.ts`.

Notable individual issues:

- **`PeerHandle.ts:79-83`** `RpcStubHandlerFn = (this: any, ...args: any[]) => unknown | Promise<unknown>` — both `any`. The comment says "`this` is not bound cross-thread", so just typing it `(...args: unknown[])` would do. The `any[]` is to keep callers from having to type each arg, but at the cost of all type safety inside the closure.

- **`InlinePeer.ts:54`** `eh.onBlockCalldataPosted = (async () => {}) as never;` — coercing a no-op async to satisfy a typechain-generated signature. The signature has `BytesLike` args; using a `Partial<...>` overload on the inline path would type cleanly.

- **`InlinePeer.ts:642`** `(target as Record<string, unknown>)[leaf] = fn as unknown as never;` — assigning a closure into a dynamic slot. Acceptable for a stubbing helper but the `never` is misleading.

- **`PeerTestHarness.ts:604`** `return new InlinePeer(peer as unknown as TestPeer);` — `TestPeer` is generic; `peer` has the concrete generic params. This is a recurring shape; consider `TestPeer<TFactories, TStateMachine>` widening at the InlinePeer ctor.

- **`PeerTestHarness.ts:538-543`** worker-mode peer fakes have `p2pInstance: undefined as never, stateManager: undefined as never, contractInstance: undefined as never`. Every consumer that reads `peer.stateManager.x` in worker mode NPEs. The fact that no real tests run worker mode is why this hasn't bitten yet; it will the moment one does.

- **Proxy traps in two places:** `PeerTestHarness.ts:808` (inline `eventHandler` spy proxy) and `entry.ts:534` (worker-side same proxy, recoded with `EVENT_HANDLER_SPY_METHODS` whitelist instead of `prop in spies`). **The two implementations have diverged.** Pull both into one shared `wrapEventHandlerWithSpies(eventHandler, onCall)` and call it from both sides.

- **`entry.ts:14-21`** stubs `global.Hyperswarm` with a fake object. This is a workaround for a worker-only failure mode that the inline tests never hit. Cross-environment hack worth flagging — it'll break the moment `Hyperswarm` is actually used in tests.

---

## Structural simplifications

### S1 — Collapse the worker boundary to one generic rpc

Today: 74 named routes in `subHandleRoutes.ts`, each ~20 LOC, each requiring a hand-written WorkerPeer wrapper. Plus 1,374 LOC of `InlinePeer` doing the same call in-process.

**Idea:** one rpc `invoke(path: string, args)` on the worker server. Worker resolves `stateManager.<dotted>(args)` and returns it. `InlinePeer` and `WorkerPeer` collapse into a tiny class that just does `await this.invoke('stateManager.storage.blocks.getLatestBlock', forkId)` either via rpc or via direct property access. Add struct serialization at the boundary (one `toStruct/from` helper).

This is the model boss's `ContractExecutor` (per the PR-339 ContractExecutor pattern) uses: one polymorphic invoke, derived from the SDK type.

**Size of v3:** PeerHandle + InlinePeer + WorkerPeer + subHandleRoutes could realistically be ~600 LOC instead of ~3,700.

### S2 — Drop the inline mode entirely from the worker code path

The `InlinePeer` exists to give inline tests the same `PeerHandle` API. But inline tests **already** read `peer.stateManager.*` directly in many places (see all the `getInlineRecord(peerIndex)` escape hatches in `RPCActions.ts:39-50`, etc.). The "uniform polymorphic surface" leaks in both directions: inline tests do unsafe casts to `InlinePeer` to reach `.record`, worker tests check `instanceof WorkerPeer`.

**Idea:** drop the polymorphism. Tests against `inline` mode call `peer.stateManager.x` (today's path). Tests against `worker` mode use a separate, narrow worker rpc proxy. They share nothing except the action-class interface. Half the abstractions vanish.

### S3 — One bidirectional rpc, one dispatch table per side

Today: each side (orchestrator, worker) has its own `RpcClient` + `RpcServer` constructed independently. The `attach()` helper exists but isn't used. The split is theoretical purity (orchestrator initiates, worker responds — except for tamper-bridge where worker initiates) but the wire is the same.

**Idea:** one `Endpoint` class per side with a `register(method, fn)` and `call(method, args)` and a `push(topic, payload)` and `on(topic, fn)`. Drop `RpcClient`/`RpcServer` as separate classes. `rpc-endpoint.ts:18` already gestured at this — finish the job.

### S4 — SDK should declare round-trip helpers; harness shouldn't

`subHandleRoutes.ts:756-764` manually does `.toStruct()` on milestone snapshots, returns `result.milestoneSnapshots.map((s) => s.toStruct())`. `subHandleRoutes.ts:826-851` does the same for `prepareUpdateSnapshotSameFork`. This pattern repeats. If `StateManager` had a `serialize()` helper for the dozen shapes the harness needs, the worker side would be a one-liner per route. Worth asking boss to add.

---

## Out of scope (don't simplify these)

- **`RpcClient` + `RpcServer`** kernel (rpc-client.ts, rpc-server.ts). They're tight, well-tested, single-responsibility. Could collapse to one class (per S3) but that's polish, not value.
- **`PeerWorker.spawn` boot orchestration** (waitForReady, crash plumbing, exit handlers, timeout race). This is real engineering for a real concern.
- **`HttpHardhatNode`** as a _concept_ — boss's chain-in-thread work needs an http json-rpc anyway; the wrapper class is fine to keep small.
- **The bidirectional `attach()` for tamper-bridge** — orchestrator-side closure execution via rpc-back IS the right pattern for "the closure can't cross". The implementation in `PeerTestHarness.ts:680-697` is clean.
- **`namedOpGuards.rejectLambdaArgs`** — cheap, real value (clear runtime error).
- **The `EventBarrier` infrastructure** (boss's existing code) — already there, harness builds on it correctly.

---

## Honest verdict

### How much code could be cut without losing functionality?

**~4,500 LOC** of the ~8,300 net new (87 files, +9,318/-1,061). Breakdown:

- Defer/delete the worker backend entirely until a real test demands it: ~3,000 LOC (WorkerPeer + threaded/ + worker-handlers + most of subHandleRoutes)
- Replace 74 hand-written routes with one generic invoke + SDK round-trips: ~800 LOC
- Drop the 7 sub-handle namespaces, flatten PeerHandle methods: ~400 LOC
- Delete unused error classes, unused registries, unused placeholders, dead helpers: ~300 LOC

### Top 3 changes that would deliver the most value

1. **Split this PR.** Land the action-class → PeerHandle migration (real value: forces a single seam, makes tests more uniform). Land the inline body extractions (e.g. moving stub bodies into InlinePeer.byzantine.\*). **Defer the worker backend entirely.** The worker code today is infrastructure looking for a consumer; that's the YAGNI smell at its purest.
2. **Replace the 74 hand-written `subHandleRoutes` entries with one generic `invoke(path, args)` + SDK `toStruct/from` round-trips.** This addresses the user's #1 complaint (interface duplication / drift) and saves the most LOC.
3. **Delete the dormant tail.** `LoopDelayExceededError`, `loopGuard.ts`, `drainDetached`, `LIFECYCLE_PUSH.log`, `queryStorageSnapshot`, `applyTransaction`/`ingestBlockConfirmation` on PeerHandle, `deriveAutoKey`, `_resetRegistryForTests`, `WorkerEventSpy.getCalls`, `phasesCompleted`. Each is small individually; together they signal that the design grew faster than the consumers.

### Top 3 changes that look attractive but aren't worth it

1. **Collapsing `PeerWorker` + `WorkerPeer`.** The split is awkward but pulling them apart paid for itself once (testability of the spawn path, clean lifecycle ownership). Don't merge unless §S1 happens first.
2. **Rewriting the rpc kernel.** It's a clean ~250 LOC; tempting to "improve" but no real bug. Leave it.
3. **Removing the bidirectional rpc.** The tamper-bridge use case is real; removing the worker→orchestrator direction means tamper bridges have to be pre-registered, which is exactly what was tried and reverted (commit `01a01a34`).
