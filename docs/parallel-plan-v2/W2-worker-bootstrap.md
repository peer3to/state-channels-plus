# W2 - worker bootstrap (`PeerWorker`)

source of truth: `test/harness/threaded/actions/meeting_notes/summary.txt` (may 26).
status: design (round 2 — addresses W2-review.md). dependencies: W0 D-1..D-10. consumed by W1 (PeerHandle), W3 (rpc kernel), W4 (spies/barriers), W5 (boss's evm-in-thread seam), W6 (loop-delay guard).

scope: the worker that owns one peer's runtime end-to-end. it constructs a real `P2pInstance` via `EvmStateMachine.p2pSetup`, dials the orchestrator's `LocalDiscoveryServer` over a real WebSocket, and is reachable from the orchestrator via one MessagePort. nothing more.

what this doc rejects up front:

- `PortTransport`, `PortMesh`, `PortTransportEnvelope` -> peers talk LocalTransport (D-1). all three files in `test/harness/threaded/transport/` get deleted.
- `ChainBridge`, `PortEip1193Provider`, `PortJsonRpcProvider`, `ChainRpcMethods` -> no per-worker chain shim (D-6, D-10). see §6.
- a second `entry.ts` flow per scenario, per-test deploy registry, per-peer signer-key rotation -> the existing inline path already does none of that.
- a separate `worker/bundles/deployments/` tree -> reuse the canonical `test/harness/core/deploymentRegistry.ts` (M3, see §4).
- a control-port + rpc-port split -> one port total (M1, see §1).

---

## 1. orchestrator-side api

one entry point. `PeerWorkerSpawnArgs` is flat and structured-clone-safe — no functions, no class instances, no contract handles.

```ts
// test/harness/threaded/PeerWorker.ts

export type PeerWorkerSpawnArgs = {
    index: number; // peer index
    signerPk: string; // hex pk; wallet derived in-worker
    channelId: string; // pins LocalDiscoveryServer registration (registry only forwards matching channelId)
    discoveryRegistryPort: number; // orchestrator's LocalDiscoveryServer port (§3)
    channelManagerAddress: string; // address orchestrator already deployed (§4)
    deploymentName: string; // key into test/harness/core/deploymentRegistry.ts (§4)
    harnessConfig: SerializableHarnessConfig; // timeConfig, configOverrides, gas limits, chainId
    logConfig: { level: LogLevel; peerIndex: number };
    testTitle: string;
};

export class PeerWorker {
    readonly index: number;
    readonly peerAddress: string; // resolved at ready-handshake

    static async spawn(
        args: PeerWorkerSpawnArgs,
        opts?: SpawnOpts
    ): Promise<PeerWorker>;
    getPort(): MessagePort; // one port. W3 frames carry both push and pull (D-8).
    drainDetached(opts?: { timeoutMs?: number }): Promise<void>;
    dispose(opts?: { graceMs?: number }): Promise<DisposeResult>;
    on(
        event: "exit" | "error" | "crash" | "detached-rejection" | "log",
        listener
    ): this;
}
```

points of interest:

- `spawn()` constructs exactly **one** `MessageChannel` (M1 fix). lifecycle frames (`ready`, `dispose`, `disposed`, `crash`, `log`, `detached-rejection`) ride the same port as W3 rpc traffic, distinguished by W3's `{kind: "req"/"res"/"push"}` envelope. lifecycle control messages are simply rpc methods/pushes (`lifecycle.ready` push, `lifecycle.dispose` req, `lifecycle.disposed` res, `lifecycle.crash` push). v1's three-port split (control/req/evt/chain) was the over-engineering this plan repudiates; collapsing four -> one matches D-8 ("same channel, one abstraction").
- ready-handshake stays as in v1: `spawn()` resolves only after the worker posts `lifecycle.ready` carrying `peerAddress` and both bootstrap phases have cleared. boot-timeout: 60s first spawn, 15s subsequent — values inherited from the v1 PeerWorker.ts constants (cite location once W1 implementation PR lands; for now treat as "existing tunables").
- `discoveryRegistryPort` comes from the orchestrator's already-running `LocalDiscoveryServer` instance. one registry per orchestrator session; shipped to every worker.
- `customPrecompiles` / `rpcServiceFactories` are not args. if the caller passes a `harnessConfig` carrying non-empty versions of either AND `dedicatedPeerThread: true`, `PeerWorker.spawn` throws `UnsupportedInWorkerMode` at construction. silent divergence violates D-3 ("from the usage, it's indifferent") — loud failure is the correct shape (M4 fix, see §7).
- removed from v1: `bootMetadata` (`bootDurationMs`/`pid`/`tid` were unused observability — D-6 cuts them; `peerAddress` is exposed directly as a field), `terminateSync()` (process-exit-hook foot-gun; `worker.terminate()` is async, calling it sync from `process.exit` doesn't actually wait — drop until someone proves it useful), and the second port.

---

## 2. worker entry script lifecycle

one file: `test/harness/threaded/worker/entry.ts`. ordered stages (each blocks the next):

1. side-effect imports `./stackLimit` + `./bigintJson` before anything else (W0 D-65).
2. crash plumbing — `uncaughtException` posts `lifecycle.crash` push + exits 99; `unhandledRejection` posts `lifecycle.detached-rejection` push and stays alive. port captured first so the push works during stage failures.
3. read `workerData`. cast node MessagePort <-> lib.dom MessagePort once (helper in `worker/portCast.ts`).
4. install W3 rpc server on the single port. lifecycle frames share the envelope; the dispatcher routes by `kind`.
5. start W6 loop-delay sampler (`monitorEventLoopDelay` + `setInterval(checkP99, 200)`; emits stall pushes via the rpc push channel).
6. run bootstrap in two named phases (M2 fix — was six, only two have real failure modes):
    - `boot` — logger, wallet construction, provider acquisition (§6), `StateChannelManagerProxy__factory.connect(args.channelManagerAddress, signer)`, `resolveDeployment(args.deploymentName)`, rpc handler registration. all steps are constructor-shaped or local-only; failure means a caller bug (malformed pk, wrong address, unknown deployment). one phase tag is enough — anything more is unactionable noise (D-6).
    - `p2pSetup` — call `EvmStateMachine.p2pSetup` exactly like the inline path. real I/O, real WebSocket dial, real handshakes. this is the phase that flakes; this is the one that earns its own attribution.
7. `postPush({ kind: "lifecycle.ready", payload: { peerAddress } })` once both phases clear.

p2pSetup call (verbatim shape from `test/fixtures/PeerTestHarness.ts:444-460`):

```ts
p2pInstance = await EvmStateMachine.p2pSetup(
    signer,
    channelManagerContract,
    deployment.connectSigner(ethers.ZeroAddress, signer),
    sharedStateMachineDeployer, // wraps deployment.deployLocalStateMachine + args.harnessConfig
    {
        peerId: args.index,
        peerLogger,
        p2pEventHooks: hooks, // W4 wires spy + barrier signals here
        customPrecompiles: [], // §7 (hardcoded; M4 throws upstream if caller tries to pass)
        rpcServiceFactories: {}, // §7
        config: args.harnessConfig.configOverrides
    }
);
```

drop from v1 worker entry: `chainPort` + `nodePortRpcTransport` + chain shim (§6); `PortMesh` + `PortTransport` construction (§3); manual `PeerProfile` registration after p2pSetup (LocalTransport runs the real `initHandshakeService.initHandshake` via `LocalDiscoveryServer.connectToSinglePeer`); deferred `lifecycle.p2pSetup` RPC (p2pSetup runs at boot, not on demand — mirrors inline `createPeer`); two-port construction (M1).

keep from v1: crash + detached-rejection plumbing, log streamer (push frames merged into `./logs/wtf.ansi`), loop-stall sampler, two-phase bootstrap attribution, debug RPC hooks (`debugBusyLoop`, `debugSetDisposeDelay`, `debugEmitDetachedRejection`, `debugFireMixedFrames`).

---

## 3. LocalDiscoveryServer reuse

assertion (from reading `src/utils/LocalDiscoveryServer.ts`):

- the class has **static fields** (`discoveryServer`, `discoveryPort`, `registeredPeers`, lines 50-73). state lives at module scope, in one isolate.
- `tryStart()` binds one WebSocketServer on `127.0.0.1` on a random port (line 435), accepts N WebSocket connections, broadcasts peer announcements.
- in inline mode `NetworkController.connectPeers` starts the registry once and every peer's `P2PManager` dials it via `LocalDiscoveryServer.connectToPeers(self, channelId, address)`.
- a worker has its own module copy with its own (null) static `discoveryPort`. workers never call `tryStart`; they dial the orchestrator's port by URL.

snag: `LocalDiscoveryServer.connectToPeers` at line 579 guards on `this.discoveryPort`. inside a worker the static is always null because `tryStart` ran in a different isolate. and the closure inside `connectRegistry` reads `this.discoveryPort` again at lines 591, 597, 609, 619, 632, 657, 665, 677 — eight more reads downstream of the first guard.

### 3.1 honest prod-side change scope (B2 fix)

W2 round 1 (proposed D-11) framed this as a "four-line change, production callers unaffected." that misframed the touch:

- **prod caller status.** the only `src/` caller is `P2PManager.tryOpenConnectionToChannel` (`src/P2PManager.ts:134-147`). it is gated behind `if (config.DEBUG_LOCAL_TRANSPORT) { return; ... }` — the `return` is the **first** statement inside the `if`, so the subsequent `LocalDiscoveryServer.tryStart()` and `connectToPeers(...)` calls are unreachable. confirmed dead code today. the production path is `holepunch.join(topic)` immediately below.
- **change set.** to make worker-side calls work, every `this.discoveryPort` read on the connect path must honor an injected port:
    - line 584: `const registryPort = this.discoveryPort;` -> read from param.
    - line 579 guard: relax to "param OR static set".
    - line 591 inner guard inside `connectRegistry(attempt)`: same.
    - lines 597, 609, 619, 632, 657, 665, 677: log-only reads. either pass `registryPort` through the closure or capture it once before defining `connectRegistry`.

simplest correct implementation: capture `registryPort` once at the top of `connectToPeers` (after the guard), bind it in the closure, replace every `this.discoveryPort` read in the function with the captured const. that's a single-variable refactor + one new parameter — call it ~15 lines touched, not 4. still test-only behavior (no caller path changed in prod).

### 3.2 D-17 statement (was round-1 D-11)

`LocalDiscoveryServer.connectToPeers` takes a required `registryPort: number` parameter. the function captures it locally and uses it everywhere the static `this.discoveryPort` was previously read on the connect path. the static field is retained only for `tryStart` and `cleanup` bookkeeping.

- **prod caller status.** dead code. `P2PManager.tryOpenConnectionToChannel` returns immediately under `DEBUG_LOCAL_TRANSPORT` and uses holepunch otherwise. updating its (unreachable) call to pass `this.discoveryPort` is mechanical; alternatively, the dead branch can be deleted in the same PR. either way no live prod path changes.
- **test-side callers.** inline mode (`NetworkController.connectPeers`) starts the registry, reads `this.discoveryPort` from the static field, passes it explicitly. worker mode passes `args.discoveryRegistryPort` shipped from the orchestrator.

if this turns out to be larger than ~15 lines once implemented, that's a finding for W0 / master plan, not a silent overrun.

### 3.3 wire-up

```
orchestrator (main thread)             worker N (per peer)
─────────────────────────────────      ──────────────────────────────────
LocalDiscoveryServer.tryStart()        ethers.Wallet(args.signerPk).connect(provider)
  -> registry on 127.0.0.1:PORT        EvmStateMachine.p2pSetup(...) -> stateManager.p2pManager
                                       inside p2pSetup -> p2pManager.tryOpenConnectionToChannel
                                                       -> LocalDiscoveryServer.connectToPeers(self, channelId, address, PORT)
                                                          -> binds local PeerServer
                                                          -> dials ws://127.0.0.1:<PORT>
                                                          -> registry broadcasts to other workers
                                                          -> peers connect via LocalTransport (prod path)
```

peer ↔ peer traffic stays on LocalTransport (D-1). neither side touches LocalTransport itself.

---

## 4. deployment shipping (M3 fix)

closures cannot cross the worker boundary. `HarnessDeploymentConfig` (test/harness/core/types.ts) has three function fields. v2 reuses the **single canonical registry** that already exists:

- `test/harness/core/deploymentRegistry.ts` holds `HarnessDeploymentConfig` keyed by string. registration is a normal module side-effect on import (the existing pattern).
- **inline mode** imports this map today. **worker mode** imports the same file — same module path, same registration calls, same map. one registry, one source of truth.
- orchestrator runs `deployment.deployOnChainContracts(...)` once per test session on the main thread (no change vs inline). result is one `channelManagerAddress` string shipped in `args`.
- worker calls `resolveDeployment(args.deploymentName)` and gets the same module-scoped object, or `DeploymentNotFoundError` listing known keys.

deleted from this plan vs round 1: the `worker/bundles/deployments/<name>.ts` tree. that was a parallel registry layered on top of the canonical one — exactly the double-bookkeeping D-6 forbids. workers receive registry entries via spawn args (specifically, `deploymentName` indexes into the shared map). ABIs are not shipped; workers import `StateChannelManagerProxy__factory` from `@typechain-types` statically (inline path does the same).

new deployment = one registration call in the canonical registry. no second registry, no bytecode shipping, no bundle layer.

---

## 4.5 sub-handle wiring (W1 cascade — D-23)

per W1 §3.1 the worker now exposes a wider rpc surface than round-2's `query.*`/`tx.*`/`ingest.*`/`lifecycle.*`. each `PeerHandle` sub-handle's methods map 1:1 to a fixed worker-side route. the bootstrap is responsible for populating four registries before any rpc method is exposed, and for registering one rpc handler per sub-handle method.

### what the worker loads at boot

after the §2 step 6 `boot` phase resolves logger/wallet/channelManager/deployment, and **before** rpc handlers are registered, the worker loads the per-domain op tables and the per-test-suite handler tables. two equivalent patterns are acceptable; pick one per W2 PR:

- **bundle-manifest.** the orchestrator ships `args.bundleManifest: string[]` listing the module paths to import (e.g. `["test/harness/worker-ops/math.ts", "test/harness/worker-ops/poker.ts"]`). worker `import`s each in order; modules register themselves as a side-effect (same shape as deployment registry in §4).
- **canonical registry reuse.** mirror `test/harness/core/deploymentRegistry.ts`: one `test/harness/worker-ops/registry.ts` module that aggregates per-domain ops via side-effect imports. worker imports the registry root once; new ops are added by appending to its import list.

both shapes keep the registry static + finite + worker-bootstrap-loaded per D-11. lambdas never cross.

### registries the worker holds

- **per-domain op registry** (`WORKER_OPS[domain][opId] -> (args) => result`). populated by `mathContract.add`, `mathContract.set`, etc. consumed by `transition.runRegisteredOp` and the worker-side `tx.apply` path when the orchestrator sends `{ op, args }`.
- **rpc-stub handler table** (`WORKER_RPC_STUB_HANDLERS[handlerId] -> (stubArgs, originalCtx) => result`). resolved by the `rpcStub.installCreateRpcMethodStub` route; handler bodies are the lambdas tests previously inlined.
- **disconnect-filter table** (`WORKER_DISCONNECT_FILTERS[filterId] -> (peerAddress, ctx) => boolean`). resolved by `network.installDisconnectFilter`; covers the spied-disconnect pattern from `RPCActions.requestFakeDisputeWithSpiedDisconnect`.
- **named-tamper table** (`WORKER_DISPUTE_TAMPERS[tamperId] -> (disputeInput) => disputeInput`). already-named tamper bodies (`tamperAuditingDataHash`, `tamperPartialAuditing`, `tamperDoubleFault`, etc.) move from inline-imported functions to a string-keyed table.

### rpc method registration

once the registries are loaded, the worker registers one rpc handler per sub-handle method. the worker-side body of each handler is the **existing inline action body**, lifted from the action class into the worker's route table and rebound to the worker's in-thread `stateManager`. one method per W1 appendix A bucket (ii) entry:

- `byzantine.*` — `stubCalldataHandler`, `restoreCalldataHandler`, `stubPendingInboundInclusion`, `stubBroadcast`, `submitDoubleSignBlock`, `postJunkCalldataOnChain`. block construction + signing stays orchestrator-side (D-15); worker routes receive serialised structs and storage-read args.
- `rpcStub.*` — `installCreateRpcMethodStub`, `restoreCreateRpcMethodStub`, `restoreAll`. install routes resolve `handlerId` against `WORKER_RPC_STUB_HANDLERS` -> throw `UnknownRpcStubHandler` if absent.
- `queryInternals.*` — `openConnections`, `getProfileByEvmAddress`, `getProfileByConnectionId`, `connectionCount`, `self`, plus the `isForkDisputedService` and `initHandshakeService` dispatchers. returns serialisable summaries / addresses only (no live `ATransport` / `PeerProfile` / `P2PManager`).
- `network.*` — `disconnectAll`, `tryOpenConnectionToChannel`, `installDisconnectFilter`, `restoreDisconnectFilter`. install routes resolve `filterId` against `WORKER_DISCONNECT_FILTERS`.
- `transition.runRegisteredOp` — single entrypoint that resolves `{ op, args }` against `WORKER_OPS` and runs the body in-thread. covers the bucket (iii) closure-migration target.

### boot-time validation

each route handler's registration goes through one helper. when an op-id / handler-id / filter-id / tamper-id is referenced at registration time and the corresponding table entry is missing, the helper throws `UnknownWorkerOp` / `UnknownRpcStubHandler` / `UnknownDisconnectFilter` / `UnknownDisputeTamper` at boot — **not** at first rpc call. failing fast on the bootstrap path means a typo in a test surfaces during `PeerWorker.spawn`, not deep inside a scenario.

per-route inline bodies remain authoritative for inline mode (W1 §4); worker bodies are byte-for-byte mirrors over the worker's own `stateManager`. when a new sub-handle method lands, the cascade is: append to `PeerHandle.types.ts` (W1), append one inline body to the inline sub-handle (W1), append one rpc handler to the worker route table (W2), append one rpc forwarder to the worker sub-handle (W1).

`UnsupportedInWorkerMode` (D-19) is unaffected — `customPrecompiles` / `rpcServiceFactories` still throw at `PeerWorker.spawn`. sub-handle ops are orthogonal.

---

## 5. dispose / drain semantics

orchestrator calls `peerWorker.dispose({graceMs: 5000})` -> sends `lifecycle.dispose` req on the port. worker, in order:

1. drain in-flight detached promises (`DetachedPromises.awaitAllAndClear`, best-effort).
2. `clearInterval(loopSampler)`, `loopHistogram.disable()`.
3. `await p2pInstance.dispose()` -> `P2PManager.disconnectAll()` -> closes every LocalTransport (`LocalTransport._close` -> `ws.close`).
4. `rpcServer.dispose()` (aborts handlers).
5. reply with `lifecycle.disposed` res carrying `durationMs`.
6. `queueMicrotask` -> close port.
7. return from entry; node exits 0.

orchestrator on `lifecycle.disposed`: defensive `worker.terminate()` (protects against stuck microtasks), close orch-side port, resolve `dispose()` -> `{kind: "graceful"}`.

forced-paths preserved from v1: worker already exited -> `{kind: "forced", reason: "crashed"}`; graceMs elapses -> `{kind: "forced", reason: "timeout"}` + `worker.terminate()`.

`LocalDiscoveryServer.cleanup()` stays on the orchestrator side and runs after every worker has disposed (closes the registry server + orchestrator-side peer connections; workers do not touch it).

drain-detached has its own RPC method (`lifecycle.drain-detached` req -> `lifecycle.drain-detached` res) so `afterEach` can flush detached promises without tearing the worker down. keep the v1 wire and 5s best-effort timeout.

---

## 6. EVM provider access (B1 resolved — defer to W5)

constraint: workers cannot reach `hre.ethers.provider` directly — hardhat lives in the orchestrator's isolate. inline path uses `signer.connect(hre.ethers.provider)`; the worker has no equivalent.

### 6.1 decision

**v1 threaded tests where the worker needs chain access are blocked on W5** (boss's evm-in-thread PR). this plan does NOT ship a JSON-RPC URL field, does NOT ship a `--network localhost` flow, does NOT ship an in-process HTTP bridge.

rationale (B1 fix):

- the round-1 plan proposed running threaded tests against `npx hardhat node` via `--network localhost`. that is not a one-line `package.json` change: hardhat's `node` doesn't carry the deploy fixtures / snapshots / automine settings the e2e suite depends on without re-running them against it. flipping worker-mode to a separate node would also fork chain-state truth: inline tests against in-process EVM, worker tests against a separate node. two test matrices is the wrong shape.
- an in-process HTTP bridge (proxying `hre.network.provider` over localhost) is more concrete and preserves single-source-of-truth — but it introduces a bridge that will be obsoleted when boss's evm-in-thread seam lands. building infrastructure that has a known sunset date is exactly the speculation D-6 / D-10 forbid.
- the honest read: chain access is W5's seam, not W2's problem. tests that don't need worker-side chain access work today (peer ↔ peer is LocalTransport, not RPC). tests that do need it wait for W5.

### 6.2 scope of "tests that work today"

what works in v2 worker mode without W5:

- everything that exercises peer-to-peer protocol (handshake, message exchange, dispute proposal/finalization via p2p, state machine transitions that don't touch on-chain contracts).
- everything that exercises orchestrator-side chain state — orchestrator still has `hre.ethers.provider` and reads chain state inline.

what is blocked until W5 lands:

- worker-initiated chain reads (e.g. a peer's own balance check via its signer).
- worker-initiated chain writes (e.g. dispute submission from inside the peer worker).

if a specific currently-passing test trips this seam before W5, mark it skipped in worker mode (`it.skip` with reason `"awaiting W5: worker-side chain access"`) — that's a tracked, visible block rather than a silent flake.

### 6.3 final shape (post-W5)

per master-plan §architecture, boss's PR makes chain access polymorphic inside `P2pInstance`. when it lands, the chain provider is whatever shape his `p2pSetup` polymorphism produces. nothing on our side changes — the worker still calls `EvmStateMachine.p2pSetup(signer, ...)` and lets boss's seam decide. our `dedicatedPeerThread` Boolean composes with boss's `dedicatedEvmThread` Boolean; the worker forwards both unchanged.

**what we do not build, ever**: `PortEip1193Provider`, `ChainBridge`, `PortJsonRpcProvider`. v1 wrong-shape. delete `test/harness/threaded/chain/`.

---

## 7. customPrecompiles / rpcServiceFactories (M4 fix)

closure fields. they cannot cross the boundary. neither is used by the currently-passing e2e suite (`grep -r customPrecompiles test/e2e` and `rpcServiceFactories test/e2e` return only harness-side plumbing). but `test/evm/EvmFactory.test.ts` does use them, and the SDK exposes them publicly.

round 1 silently hardcoded both to empty in the worker's `p2pSetup` call. that's silent divergence between inline and worker modes — D-3 says "from the usage, it's indifferent" and silent ignoring is not indifferent.

**decision (D-19 statement; was round-1 D-13).** the worker still hardcodes `customPrecompiles: []` and `rpcServiceFactories: {}` in `p2pSetup`. but `PeerWorker.spawn` inspects the `harnessConfig` it receives, and if the caller has supplied non-empty `customPrecompiles` or `rpcServiceFactories` AND `dedicatedPeerThread: true`, it throws `UnsupportedInWorkerMode` at construction with a message naming the field. loud failure, not silent divergence.

when a real test needs either field in worker mode, we add a string-keyed registry mirroring §4 (same canonical-registry pattern, one new entry) and drop the throw. until then, the surface is empty and any test that tries to use it gets a clear error.

---

## 8. ts-node vs pre-built worker (W2-private decision; not promoted to W0)

decision: **ts-node** via the existing JS shim (`test/harness/threaded/worker/entry.js` -> `require('ts-node/register'); require('./entry.ts')`). rationale: hardhat already registers ts-node in the main isolate; workers are fresh isolates so the shim re-registers per-worker (the existing entry.js does this today — call it out at the shim site). pre-build adds a `test:e2e:build-worker` script + separate tsconfig + alias remapping + CI step for ~5-10s/spawn savings; introduces drift risk. revisit only if spawn cost becomes a measured problem. cutover is mechanical (swap the path constant).

---

## 9. worker reset vs respawn (W2-private decision; not promoted to W0)

decision: **respawn per test**. ts-node first-compile dominates spawn time; subsequent spawns hit the warm cache (<1s in practice). reset semantics (channelId rebind, deployment swap, spy reset) are the surface v1 drowned in. `afterEach` -> `peerWorker.dispose()`, `beforeEach` -> `PeerWorker.spawn()`, mirroring inline `createPeer`. pool reuse is additive when respawn proves too slow.

---

## 10. what the worker does NOT do

reiterated for the next reviewer:

- does not own a chain provider shim. chain access is W5's seam (§6).
- does not implement a per-peer chain bridge.
- does not talk to other workers over MessagePort. peer ↔ peer is LocalTransport over LocalDiscoveryServer's WebSocket (D-1, D-2).
- does not maintain a deployment registry. it imports the canonical one (§4, M3).
- does not own the loop-delay policy. it emits samples (D-9).
- does not register a parallel action-namespace surface. action namespaces stay on the orchestrator and route through `PeerHandle.rpc.call(...)` (W1 + W3).
- does not start its own `LocalDiscoveryServer` registry. it dials the orchestrator's (§3).
- does not expose `terminateSync` (foot-gun; removed).
- does not expose `bootDurationMs`/`pid`/`tid` (unused observability; removed).
- does not split lifecycle from rpc onto separate ports (D-8; one port).

---

## 11. file layout (final)

```
test/harness/threaded/
├── PeerWorker.ts                  # orchestrator-side handle (this doc)
├── worker/
│   ├── entry.js                   # ts-node shim (re-registers ts-node in-isolate; call out at the shim)
│   ├── entry.ts                   # bootstrap + two-phase runner
│   ├── stackLimit.ts              # side-effect import
│   ├── bigintJson.ts              # side-effect import
│   ├── serializeError.ts          # crash/log err wire
│   ├── portCast.ts                # node MessagePort <-> lib.dom helper (called once at boot)
│   └── types.ts                   # WorkerData, ReadyPayload, BootstrapPhase = "boot" | "p2pSetup"
```

deleted (vs v1 threaded/):

- `chain/` — entire directory (no chain bridge; §6, §10).
- `transport/` — entire directory (no `PortMesh` / `PortTransport`; D-1).
- `worker/bundles/deployments/` — never existed at impl time; round-1 plan proposed it; round-2 deletes it before it ships (M3, §4).
- `worker/connectViaDiscovery.ts` — superseded by the D-17 in-place edit (§3.2).

handled by other W items (see them for the post-merge picture):

- `ThreadedHarness.ts`, `MathThreadedHarness.ts` — W1's collapse into the single polymorphic `PeerTestHarness` (master-plan deletion order).
- `RemotePeerHandle.ts` — W1's `PeerHandle`.
- `events/FlushFrame.ts` retention, `SpyMirror` etc. — W4's call.

---

## 12. open / decided D-rows in W0 owned by W2

(landed in `W0-cross-cutting-decisions.md`. W4 took D-13 / D-14; W1 took D-15 / D-16; W2 round-2 D-rows start at D-17.)

- **D-17 (open).** `LocalDiscoveryServer.connectToPeers` takes a required `registryPort: number` parameter. the function captures it locally and substitutes for every `this.discoveryPort` read on the connect path (~15 lines touched, including `connectRegistry` closure). prod caller (`P2PManager.tryOpenConnectionToChannel`) is dead code today — under `DEBUG_LOCAL_TRANSPORT` it returns before reaching `connectToPeers`, otherwise it goes through holepunch. update the (unreachable) call or delete the dead branch; either way no live prod path changes.

- **D-18 (open, was round-1 "providerUrl").** worker-side chain access is W5's seam. v2 does NOT ship a `providerUrl` field, a `--network localhost` flow, or an in-process HTTP bridge. tests that need worker-initiated chain reads/writes are `it.skip`-ed in worker mode with reason `"awaiting W5: worker-side chain access"`.

- **D-19 (open).** worker hardcodes `customPrecompiles: []` and `rpcServiceFactories: {}`. `PeerWorker.spawn` throws `UnsupportedInWorkerMode` at construction if the caller has supplied non-empty versions of either with `dedicatedPeerThread: true`. silent divergence is not an option. when a real test needs either, add a string-keyed registry entry mirroring §4 and drop the throw.

- **D-20 (decided, M2 fix).** `BootstrapPhase = "boot" | "p2pSetup"`. round 1 listed six phases; only `provider` and `p2pSetup` had distinct failure modes, and `provider` collapses into `boot` once chain access is W5's problem (§6). add more phases only when a real flake demands attribution.

- **D-21 (decided, M1 fix).** one MessagePort per worker. lifecycle frames (`ready`, `dispose`, `disposed`, `crash`, `log`, `detached-rejection`) ride W3's envelope as rpc methods/pushes. starting with two ports violates D-8 ("same channel, one abstraction") and is the over-engineering D-6 forbids. add a second port only if a measured concern surfaces.

W2-owned decided rows that didn't change this round: ts-node-via-shim (worker bundling) and respawn-per-test stay decided as in round 1; both predate the D-row renumbering. (treat them as W2-private until a future cross-cutting need promotes them to W0.)

---

## 13. self-review checklist

walked through against the 9 non-negotiables:

- D-1 peer ↔ peer is LocalTransport: §2 (no transportFactory), §3 (LocalDiscoveryServer + LocalTransport). pass.
- D-2 MessagePort orchestrator ↔ worker only: §1 spawns one port, no chain port, no mesh ports. pass.
- D-3 one polymorphic harness: `PeerWorker` is `WorkerPeerBackend`'s impl. no second harness class. M4 enforces "from the usage, it's indifferent" — silent divergence on `customPrecompiles` is rejected. pass.
- D-4 tests do not change: no mode directive, no parallel namespace. pass.
- D-5 no double code: `EvmStateMachine.p2pSetup` is called identically to inline (§2); deployment registry is the single canonical one (§4, M3); D-17 (§3.2) is an in-place edit, not a parallel module. pass.
- D-6 minimal surface: `PeerWorkerSpawnArgs` has 9 data fields, all required; `terminateSync` / `bootDurationMs` / `pid` / `tid` / control-port removed; two phases not six; one port not two; one registry not two. pass.
- D-7 2N+1, evm split orthogonal: §6 defers EVM transport to W5/boss's PR. pass.
- D-8 push + pull on one channel: §1 + §2 step 4 (one port, W3 envelope). pass.
- D-9 loop-delay guard boss-shipped: §2 step 5 emits samples, no policy. pass.

over-engineering checks: `PortTransport`/`PortMesh`, per-peer chain shim, parallel action namespace, parallel deployment registry, two-port lifecycle/rpc split, six-phase bootstrap, fragile providerUrl bootstrap — all explicitly rejected in §10, §4, §6, §1, §2. no violations.

---

## Revision log (round 1 review)

- B1 — dropped `providerUrl` + `--network localhost` plan. worker-side chain access deferred to W5; tests that need it are `it.skip`-ed with a clear reason. no HTTP bridge built. -> W0 D-18 (was round-1 W2 D-12).
- B2 — rewrote §3 to honestly scope the `LocalDiscoveryServer.connectToPeers` change: it's a ~15-line in-place edit threading `registryPort` through `connectRegistry`'s closure, not a four-line change. confirmed prod caller (`P2PManager.tryOpenConnectionToChannel`) is dead code (`return` under `DEBUG_LOCAL_TRANSPORT`). framing changed from "production callers unaffected" (technically true, misleading) to "dead code today, harness-only in practice". -> W0 D-17 (was round-1 W2 D-11).
- M1 — collapsed control + rpc ports into one. lifecycle frames ride W3's envelope as rpc methods/pushes. dropped `getControlPort()`/`getRpcPort()`; one `getPort()`. -> W0 D-21.
- M2 — collapsed six bootstrap phases to two (`boot` + `p2pSetup`). dropped `loggerInit`/`walletConstruct`/`provider`/`channelManagerConnect`/`rpcRegister` as distinct phases — none had real failure modes. -> W0 D-20.
- M3 — deleted the proposed `worker/bundles/deployments/` tree. workers import the canonical `test/harness/core/deploymentRegistry.ts` directly. one registry, one source of truth. §4 rewritten.
- M4 — `customPrecompiles` / `rpcServiceFactories` now throw `UnsupportedInWorkerMode` at `PeerWorker.spawn` when non-empty with `dedicatedPeerThread: true`. silent divergence rejected per D-3. -> W0 D-19 (was round-1 W2 D-13).
- m1 — dropped `terminateSync()` from the orchestrator-side api (process-exit foot-gun; `worker.terminate()` is async).
- m2 — dropped `bootMetadata.bootDurationMs` / `pid` / `tid` (unused observability per D-6). kept `peerAddress` as a direct field on `PeerWorker`.
- m4 — clarified §11 file layout with forward references to W1 (harness collapse, `RemotePeerHandle`) and W4 (events retention).
- n3 — called out that the ts-node shim re-registers ts-node per-worker isolate (workers are fresh isolates).

## Revision log (W1 cascade)

- added §4.5 — worker bootstrap loads per-domain op registry, rpc-stub handler table, disconnect-filter table, named-tamper table; registers one rpc handler per `PeerHandle` sub-handle method (`byzantine.*`, `rpcStub.*`, `queryInternals.*`, `network.*`, `transition.runRegisteredOp`). op-id / handler-id / filter-id / tamper-id references are validated at boot, not on first rpc call. -> absorbs W1 §10 cascade for D-23 + D-11.
