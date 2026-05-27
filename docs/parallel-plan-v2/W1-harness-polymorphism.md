# W1 — `PeerHandle` and one-harness polymorphism

owner: W1.
prerequisites read: `test/harness/threaded/actions/meeting_notes/summary.txt`, `docs/parallel-plan-v2/master-plan.md`, `docs/parallel-plan-v2/W0-cross-cutting-decisions.md` (D-1..D-10 are load-bearing). user directive (post round-2): "all current tests must be runnable in parallel mode; tests CAN change at source level; one polymorphic harness; LocalTransport-only peer↔peer; MessagePort orchestrator↔worker-only stays".

**goal.** introduce one `PeerHandle` shape consumed by every action namespace, with two backends (`InlinePeer`, `WorkerPeer`) selected by a single Boolean inside `PeerTestHarness.createPeer`. **every existing action — including byzantine monkey-patches, rpc-stub mutations, p2pManager-internals reads, and closure-bearing transition methods — works in both backends.** action namespace classes are not duplicated; each class dispatches internally on `peer instanceof WorkerPeer` to choose direct call vs rpc round-trip.

---

## 0. directive context (what changed from round 2)

round 2 closed on a "bucket (ii) is inline-only, gated by `requireInlinePeer`" design. that design assumed boss's "tests don't change at source" was the binding constraint and therefore that byzantine / rpc-stub / p2pManager-internals actions could be carved out of worker mode.

the user has now explicitly loosened that constraint:

1. **all current tests must run in worker mode.** no inline-only gating. carving out byzantine + rpc-stub + p2pManager actions guts the suite (those are the heart of what we test).
2. **tests CAN change at source.** closures that crossed the boundary via reflection are migrated to named ops with explicit args. monkey-patch helpers move from "mutate this peer's internal field in the test" to "ask the peer worker to install a named stub". the test source flips from a lambda to a `{ opId, args }` shape; the action surface stays one class.
3. everything else from boss's non-negotiables holds: peer↔peer over LocalTransport (D-1), MessagePort orchestrator↔worker only (D-2), one polymorphic harness (D-3), no parallel namespace classes (D-5), one Boolean (D-6).

cost: this is closer to v1 than round-2 was on action surface. that cost is owned in §0.1 and §10.

### 0.1 the honest cost

- bucket (ii) is gone. every action that round-2 marked inline-only gets a worker-side rpc equivalent inside the same action class.
- the rpc surface on `WorkerPeer` is wider than round-2's 5 methods. it covers query._, tx._, ingest._, byzantine._, rpcStub._, network._, query.p2pManager.\*.
- tests using closure-style transition or tamper helpers (`h.transition.submitNext({ txFn: c => ... })`, byzantine lambda variants) flip to named ops: `h.transition.submitNext({ op: "mathContractAdd", args: { n: 2 } })`. that IS a test-source change. the user has signed off.
- the closure-capture analyser (v1 W5 §2.3) returns as a **write-time lint only** (permanent guardrail). it catches a lambda whose body matches a registered template and tells the author exactly which named op to use. it does NOT silently ship lambdas to workers, and it is NOT invoked at runtime -> no auto-resolve path; un-migrated lambdas fail lint at PR time.

this is not v1 wrong-shape — v1's wrong-shape was peer↔peer over MessagePort and a parallel harness class. those stay rejected. the only thing round-2 was wrong about was the action surface; that's now corrected.

---

## 1. naming

- the shared shape is `PeerHandle`. _not_ `TestPeer` (the existing record type stays, see §3) and _not_ `RemotePeerHandle` (v1 name — discarded).
- one concrete `PeerTestHarness`. no `IPeerHarness`, no `MathThreadedHarness`.
- one `ByzantineActions`, one `RpcStubActions`, one `StateQueryActions`, one `NetworkController`, one `TransitionActions`. each class internally branches on `peer instanceof WorkerPeer`. no `ThreadedByzantineActions` parallel class.

rationale -> D-3, D-4 (loosened: tests change at source, not at structure), D-5.

---

## 2. config flag

one Boolean on `HarnessOptions`:

```ts
// test/harness/core/types.ts
export type HarnessOptions<...> = {
    // ...existing fields...
    dedicatedPeerThread?: boolean; // default false -> inline (today's behaviour)
};
```

precedence: `options.dedicatedPeerThread` > env `HARNESS_DEDICATED_PEER_THREAD` > `false`. env var exists so a CI matrix can flip every test without editing scenarios. that is the only knob added by W1.

orthogonal to boss's `dedicatedEvmThread` (D-7). both flags compose; W5 wires the second one through unchanged.

---

## 3. the `PeerHandle` interface

`PeerHandle` is what every action namespace sees. it is wider than round-2 because the new mandate requires byzantine + rpc-stub + p2pManager-internals to work in both backends. every method below cites a today-caller in appendix A.

```ts
// test/harness/core/PeerHandle.ts (new)
export interface PeerHandle {
    // step 1 - identity. always sync. orchestrator-side values. no rpc.
    readonly index: number;
    readonly address: Address;
    readonly signer: Signer; // orchestrator-side ethers wallet (D-15)
    readonly logger: Logger; // orchestrator-side; worker log lines stream up via W4

    // step 2 - spy mirror and barriers. live in inline mode, mirrored in worker mode via W4 push.
    // both modes return instanceof EventSpies / EventBarrier (asserted at construction).
    readonly eventSpies: EventSpies;
    readonly turnBarrier: EventBarrier;

    // step 3 - cached scalars. orchestrator caches what W4 pushes; sync read returns last-known value.
    // inline mode reads through. worker mode reads the cache (W4 `fork.changed` keeps it fresh).
    readonly forkId: ForkId | undefined;

    // step 4 - hot-path async queries (data path).
    queryStatus(): Promise<StateStatus>;
    queryLatestBlock(forkId: ForkId): Promise<BlockSummary | undefined>;
    queryStorageSnapshot(req: StorageReadRequest): Promise<StorageReadResult>;
    applyTransaction(req: ApplyTxRequest): Promise<ApplyTxResult>;
    ingestBlockConfirmation(req: IngestBlockReq): Promise<boolean>;

    // step 5 - sub-handles for the wider RPC surface (see §3.1).
    //          each sub-handle's methods are the parallel of the existing inline action calls
    //          that used to touch peer internals directly. one rpc method per existing action
    //          surface. inline backend executes the same op in-process.
    readonly byzantine: ByzantineHandle;
    readonly rpcStub: RpcStubHandle;
    readonly queryInternals: P2pInternalsHandle;
    readonly network: NetworkHandle;

    // step 6 - disposal.
    dispose(): Promise<void>;
}
```

### 3.1 sub-handle shape (named-op surface, not eval bridge)

each sub-handle is a fixed set of named methods. they map 1:1 to existing action behaviour. inline backend implements each method by running the same logic in-process against `record.stateManager.*`. worker backend serialises `{ method, args }` over rpc; the worker dispatches via a switch table to in-thread handlers that touch the worker's own `stateManager`.

```ts
// test/harness/core/PeerHandle.types.ts (new)

export interface ByzantineHandle {
    // step 1 - method substitution on worker-side stateManager. inline = same substitution
    //          in-process; worker = rpc tells the worker to install/restore the named stub.
    stubCalldataHandler(): Promise<void>;
    restoreCalldataHandler(): Promise<void>;
    stubPendingInboundInclusion(): Promise<RestoreToken>;
    stubBroadcast(): Promise<void>;

    // step 2 - synthesise + broadcast a double-signed block. orchestrator builds the block
    //          (signer is orchestrator-side per D-15); rpc carries the SignedBlockStruct in.
    submitDoubleSignBlock(req: DoubleSignReq): Promise<DoubleSignResult>;

    // step 3 - post junk calldata on-chain. on-chain call happens via the orchestrator's
    //          channelManager.connect(peer.signer); worker only supplies storage reads
    //          via queryInternals + queryStorageSnapshot. zero on-chain rpc from the worker.
    postJunkCalldataOnChain(req: JunkCalldataReq): Promise<BlockStruct>;
}

export interface RpcStubHandle {
    // step 1 - install a stub on localRpc[serviceName].createRPCMethods()[methodName].
    //          the stub body is a named handler registered with the worker bootstrap
    //          (W2 ships the handler table; tests reference handlers by id, not by lambda).
    installCreateRpcMethodStub(req: {
        serviceName: string;
        methodName: string;
        handlerId: RpcStubHandlerId;
        handlerArgs?: unknown;
    }): Promise<RestoreToken>;

    restoreCreateRpcMethodStub(req: {
        serviceName: string;
        methodName: string;
    }): Promise<void>;

    restoreAll(): Promise<void>;
}

export interface P2pInternalsHandle {
    // step 1 - explicit, named reads on peer-internal objects that previously were
    //          accessed as `peer.stateManager.p2pManager.*` from action code.
    //          return values are serialised summaries, NOT live ATransport / PeerProfile instances.
    openConnections(): Promise<TransportSummary[]>;
    getProfileByEvmAddress(addr: Address): Promise<ProfileSummary | undefined>;
    getProfileByConnectionId(
        connectionId: ConnectionId
    ): Promise<ProfileSummary | undefined>;
    connectionCount(): Promise<number>;

    // step 1a - peer self-address. today-caller reads `p2pManager.self` from the
    //           orchestrator side (`RPCActions.ts:112`, `NetworkController.ts:43`,
    //           `JoinActions.ts:58`); `self` is the live P2PManager and not serialisable.
    //           the worker returns its own self-address; the orchestrator drives the
    //           `LocalDiscoveryServer.connectToPeers` call against a worker-side helper
    //           that consumes the address rather than a live manager. inline backend
    //           returns `record.stateManager.p2pManager.self.address` in-process.
    self(): Promise<Address>;

    // step 2 - peer-side rpc service surface. tests previously did
    //          `peer.stateManager.p2pManager.localRpc.isForkDisputedService.didPeer...(x)`.
    //          worker exposes these as named-method calls keyed by service.
    isForkDisputedService(req: {
        op:
            | "didPeerAcknowledgeDisputedFork"
            | "requestDisputeAcknowledgment"
            | "respondToDisputeAcknowledgment"
            | "onDisputeAcknowledgmentRequest";
        args: unknown;
    }): Promise<unknown>;
    initHandshakeService(req: {
        op:
            | "initHandshake"
            | "onInitHandshakeRequest"
            | "onInitHandshakeResponse"
            | "getChallenge"
            | "clearChallenge";
        args: unknown;
    }): Promise<unknown>;
}

export interface NetworkHandle {
    // step 1 - peer-side p2p operations. tests previously did
    //          `peer.p2pInstance.p2pSigner.p2pManager.disconnectConnection(conn)`.
    disconnectAll(): Promise<void>;
    tryOpenConnectionToChannel(channelId: string): Promise<void>;

    // step 2 - the "spied disconnect" pattern from RPCActions.requestFakeDisputeWithSpiedDisconnect.
    //          worker installs a named filter on disconnectAndBlacklistPeerByEvmAddress.
    installDisconnectFilter(req: {
        filterId: DisconnectFilterId;
        args?: unknown;
    }): Promise<RestoreToken>;
    restoreDisconnectFilter(): Promise<void>;
}
```

what _is not_ on `PeerHandle`:

- a `runInlineOp` / eval-bridge escape hatch — explicitly dropped. every cross-boundary op is a fixed named method on one of the sub-handles. if a future action needs something not on the surface, add the named method (one rpc, one inline impl, one switch entry). no anonymous closures cross the boundary.
- `signer.signMessage` round-trips — orchestrator owns the signer (D-15); `signMessage` stays sync orchestrator-side.
- live `ATransport` / `PeerProfile` objects — non-serialisable; replaced by `*Summary` shapes keyed by stable ids that the worker resolves locally.

payload types live in `test/harness/core/PeerHandle.types.ts`. W3 owns the wire format; W1 owns the surface.

---

## 4. `InlinePeer` backend

today's `createPeer` body, lightly refactored. sub-handles are thin in-process wrappers around `record.stateManager.*`.

```ts
// test/harness/core/InlinePeer.ts (new)
export class InlinePeer implements PeerHandle {
    readonly byzantine: ByzantineHandle;
    readonly rpcStub: RpcStubHandle;
    readonly queryInternals: P2pInternalsHandle;
    readonly network: NetworkHandle;

    constructor(public readonly record: TestPeer<TFactories, TStateMachine>) {
        // step 1 - sub-handles share the record. inline path runs ops in-process.
        this.byzantine = new InlineByzantineHandle(record);
        this.rpcStub = new InlineRpcStubHandle(record);
        this.queryInternals = new InlineP2pInternalsHandle(record);
        this.network = new InlineNetworkHandle(record);
    }

    get index() {
        return this.record.index;
    }
    get address() {
        return this.record.address;
    }
    get signer() {
        return this.record.signer;
    }
    get logger() {
        return this.record.logger;
    }
    get eventSpies() {
        return this.record.eventSpies;
    }
    get turnBarrier() {
        return this.record.turnBarrier;
    }
    get forkId() {
        return this.record.stateManager.forkId;
    }

    queryStatus() {
        return Promise.resolve(this.record.stateManager.getStatus());
    }
    queryLatestBlock(forkId) {
        return Promise.resolve(
            this.record.stateManager.storage.blocks.getLatestBlock(forkId)
        );
    }
    // ...thin wrappers over today's direct calls...
    dispose() {
        return this.record.p2pInstance.dispose();
    }
}

// example inline sub-handle - shape mirrors today's ByzantineActions internals.
class InlineByzantineHandle implements ByzantineHandle {
    constructor(private record: TestPeer) {}

    async stubCalldataHandler() {
        // step 1 - exact body that used to live inline in ByzantineActions.stubCalldataHandler.
        const eh = this.record.stateManager.eventHandler;
        const original = eh.onBlockCalldataPosted.bind(eh);
        this.record.context.originalCalldataHandler = original;
        eh.onBlockCalldataPosted = async () => {};
    }
    // ...
}
```

implementation rule: **no logic moves between modes**. each inline sub-handle method is the today-action body, re-homed under the handle. action namespace classes (`ByzantineActions`, etc.) become orchestrators: they decide what op to run, marshal args, and dispatch to either the inline sub-handle (direct call) or the worker rpc client (named-method call). the op body lives once: in the inline sub-handle for inline mode, in the worker handler table for worker mode. these two impls share their behaviour invariants (the audit surface in appendix A is the contract).

---

## 5. `WorkerPeer` backend

```ts
// test/harness/core/WorkerPeer.ts (new)
export class WorkerPeer implements PeerHandle {
    readonly byzantine: ByzantineHandle;
    readonly rpcStub: RpcStubHandle;
    readonly queryInternals: P2pInternalsHandle;
    readonly network: NetworkHandle;

    // step 1 - cached scalar pushed by W4. starts undefined; updated on fork.changed.
    private cachedForkId: ForkId | undefined;

    constructor(
        public readonly index: number,
        public readonly address: Address,
        public readonly signer: Signer, // orchestrator-side ethers wallet (D-15)
        public readonly logger: Logger,
        public readonly eventSpies: EventSpies, // SpyMirror, populated by W4 push
        public readonly turnBarrier: EventBarrier, // resolved by W4 push handler
        private readonly rpc: PeerRpcClient // W3
    ) {
        // step 2 - subscribe to W4 push for cached scalars.
        this.rpc.on("fork.changed", ({ forkId }) => {
            this.cachedForkId = forkId;
        });

        // step 3 - sub-handles forward to rpc; one rpc method per named op.
        this.byzantine = new WorkerByzantineHandle(rpc);
        this.rpcStub = new WorkerRpcStubHandle(rpc);
        this.queryInternals = new WorkerP2pInternalsHandle(rpc);
        this.network = new WorkerNetworkHandle(rpc);
    }

    get forkId() {
        return this.cachedForkId;
    }

    queryStatus() {
        return this.rpc.call("query.status", {});
    }
    queryLatestBlock(forkId) {
        return this.rpc.call("query.latestBlock", { forkId });
    }
    applyTransaction(req) {
        return this.rpc.call("tx.apply", req);
    }
    ingestBlockConfirmation(req) {
        return this.rpc.call("ingest.blockConfirmation", req);
    }
    dispose() {
        return this.rpc
            .call("lifecycle.dispose", {})
            .finally(() => this.rpc.terminate());
    }
}

// worker sub-handle - thin rpc client, no logic.
class WorkerByzantineHandle implements ByzantineHandle {
    constructor(private rpc: PeerRpcClient) {}
    stubCalldataHandler() {
        return this.rpc.call("byzantine.stubCalldataHandler", {});
    }
    restoreCalldataHandler() {
        return this.rpc.call("byzantine.restoreCalldataHandler", {});
    }
    stubPendingInboundInclusion() {
        return this.rpc.call("byzantine.stubPendingInboundInclusion", {});
    }
    stubBroadcast() {
        return this.rpc.call("byzantine.stubBroadcast", {});
    }
    submitDoubleSignBlock(req) {
        return this.rpc.call("byzantine.submitDoubleSignBlock", req);
    }
    postJunkCalldataOnChain(req) {
        return this.rpc.call("byzantine.postJunkCalldataOnChain", req);
    }
}
```

worker-side dispatch (W2 owns the table; W1 owns the route ids):

```ts
// inside the worker entry, registered with the rpc kernel.
const ROUTES = {
    "query.status": (args) => stateManager.getStatus(),
    "query.latestBlock": ({ forkId }) =>
        stateManager.storage.blocks.getLatestBlock(forkId),
    // ...
    "byzantine.stubCalldataHandler": () => {
        const eh = stateManager.eventHandler;
        savedRefs.calldataHandler = eh.onBlockCalldataPosted.bind(eh);
        eh.onBlockCalldataPosted = async () => {};
    },
    "byzantine.stubBroadcast": () => {
        const r = stateManager.p2pManager.remoteRpc;
        savedRefs.broadcast = r.stateTransitionService.onBlockConfirmation;
        r.stateTransitionService.onBlockConfirmation = () => ({
            broadcast: () => {},
            sendOne: () => {},
            sendMultiple: () => {}
        });
    },
    "rpcStub.installCreateRpcMethodStub": ({
        serviceName,
        methodName,
        handlerId,
        handlerArgs
    }) => {
        // step 1 - resolve handlerId against the worker's named-handler registry (see §6).
        const handler = WORKER_RPC_STUB_HANDLERS[handlerId];
        if (!handler)
            throw new Error(`unknown rpc-stub handler id: ${handlerId}`);
        // step 2 - install. body is the same as today's rpcStubActions, parameterised.
        // ...
    }
    // ...
};
```

route-id naming: `<sub-handle>.<method>`. mechanical mapping; no surprises.

spy/event/state queries pull. spy increments and event-handler hits push (W4 emits `spy.incr`, `event.onTurn`, `fork.changed`, etc.; the orchestrator-side `SpyMirror`, `turnBarrier`, and `cachedForkId` consume them).

---

## 6. action namespaces stay single-impl — with internal mode dispatch

every existing action class keeps **one** implementation. each method internally checks the peer it's acting on and dispatches:

```ts
// today's ByzantineActions.stubCalldataHandler (peer-internal mutation).
// after W1 -- the action class is one class, dispatching internally on backend.
export class ByzantineActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    async stubCalldataHandler(peerIndex: number): Promise<void> {
        const peer = this.harness.getPeer(peerIndex);
        // step 1 - dispatch is uniform: call into the sub-handle.
        //          inline backend runs the body in-process; worker backend ships an rpc.
        //          the action class does NOT branch on instanceof.
        await peer.byzantine.stubCalldataHandler();
    }
}
```

key shift from round-2: the `instanceof WorkerPeer` branch lives **inside `PeerHandle` sub-handles**, not inside action classes. action classes call `peer.byzantine.stubCalldataHandler()` and let the handle dispatch. that keeps action namespaces clean and ensures the "one class per namespace" invariant is enforced by shape, not discipline.

### three buckets (revised)

every action namespace method falls into one of:

#### bucket (i) — works uniformly via `PeerHandle` (query / data path)

these methods only call into `PeerHandle` query/tx/ingest methods. behaviour is identical in both backends. no test source change.

examples:

- `LifecycleActions.openChannel` -> calls `peer.queryStatus()` / barriers.
- `TransitionActions.submitNext({ encodedData })` (the non-closure overload) -> calls `peer.applyTransaction(req)`.
- `StateQueryActions.getNextPeerToWrite` -> reads `peer.forkId` (sync, cached), `peer.queryLatestBlock`, harness-side ethers contract handles.
- `AssertActions.*` -> reads `peer.eventSpies.*`, `peer.queryStatus()`.

#### bucket (ii) — works uniformly via `PeerHandle` sub-handles (named-op surface)

these methods touch peer internals (byzantine monkey-patches, rpc-stub mutation, p2pManager internals, peer-side disconnect). they go through `peer.byzantine.*`, `peer.rpcStub.*`, `peer.queryInternals.*`, `peer.network.*`. inline backend runs the named op in-process; worker backend ships an rpc.

**this is the bucket that round-2 marked inline-only. it is now uniform-on-both-backends.** the cost is honest:

- one named-method entry on a sub-handle interface (in `PeerHandle.types.ts`).
- one inline sub-handle method body (re-homed from today's action body).
- one worker-side route handler (mirror of the inline body, running against the worker's in-thread `stateManager`).
- one rpc forwarder in the worker sub-handle (one-liner).

this is bounded double-work — one entry per existing action surface — and explicitly NOT a parallel action-class structure (which D-5 still forbids). audit list: appendix A bucket (ii).

#### bucket (iii) — closure-bearing action methods (test source changes to named ops)

these methods take a lambda from the test author today: `TransitionActions.submitNext({ txFn: (contract) => contract.add(2) })`, `TransitionActions.sequenceFromHonestPeers((peer) => peer.applyX(...))`, byzantine variants that take a tamper callback.

migration: test source changes from a lambda to a named op + args.

```ts
// before
h.transition.submitNext({ txFn: (c) => c.add(2) });

// after - explicit named op registered with the worker bootstrap.
h.transition.submitNext({ op: "mathContract.add", args: { n: 2 } });
```

the worker's named-op registry is a static, declared table populated at worker bootstrap (W2 ships the math-domain ops next to the math state-machine code; non-math suites ship their own). ops are referenced by stable string id. they take serialisable args. the inline backend uses the same table — calling the op by id is just a function-table lookup that runs the same body in-process. one code path, two execution environments.

**closure-capture analyser (write-time lint only, permanent guardrail).** kept from v1 W5 §2.3 as a permanent write-time lint. NOT invoked at runtime; there is no auto-resolve runtime path. when a test ships a lambda:

- the analyser static-checks the lambda body against the registered op table. if the body matches a template (e.g. `(c) => c.add(N)`) and only captures allowlisted identifiers (numeric literals, `harness.*` orchestrator-side reads), it emits a lint hint pointing at the matching op id. CI lint fails the PR until the test author migrates.
- if the body doesn't match any template or captures something non-allowlisted (peer-local objects, ad-hoc closures over scenario state), the analyser fails with a clear error: "this lambda cannot be migrated automatically; add a new named op to `worker-ops/<domain>.ts` and reference it by id."

the analyser is build/lint time only -> tests that ship un-migrated lambdas fail lint at PR time; lambdas never reach runtime; un-migrated bodies never cross the orchestrator↔worker boundary. it stays in place permanently as a guardrail against new closure-bearing additions; it does not sunset when the first wave of migrations finishes.

no `runInlineOp`. no `InlineOpId` runtime-resolved type. the closed surface is the named-op table; tests cite ids by string.

### corollary: no parallel namespace classes

no `ThreadedLifecycleActions`. no `MathThreadedTransitionActions`. no `ThreadedByzantineActions`. math-specific extensions stay in `test/harness/actions/math/` as today (subclasses for typing only, no parallel logic). this is the D-5 line.

---

## 7. change-set in `PeerTestHarness.ts`

minimal. the diff against today is approximately:

- declare `peers: PeerHandle[]` instead of `peers: TestPeer[]`. `TestPeer` records still exist inside `InlinePeer.record`; helper getters (`getPeer`, `getPeerAddresses`, `getHonestPeers`) operate on `PeerHandle`.
- `activeForkId` getter stays sync (D-12). reads `peers[0].forkId` — cached in worker mode, direct in inline mode.
- `peerWithHighestBlock` stays async (already is).
- in `createPeer`:

    ```ts
    // step 1 - resolve the backend choice once.
    const dedicated =
        this.options.dedicatedPeerThread ??
        process.env.HARNESS_DEDICATED_PEER_THREAD === "true";

    // step 2 - build the handle.
    const handle: PeerHandle = dedicated
        ? await WorkerPeerBackend.create({
              index,
              signer,
              address,
              harnessConfig: this.harnessConfig,
              discoveryAddress: LocalDiscoveryServer.address,
              deploymentRegistry: this.exportDeployment(), // W2
              // step 3 - orchestrator-side mirror objects, populated by W4 push.
              eventSpies: SpyMirror.allocate(),
              turnBarrier: new EventBarrier(peerLogger),
              eventCountsBarrier: this.eventCountsBarrier,
              connectionBarrier: this.connectionBarrier,
              rpcBarrier: this.rpcBarrier,
              disconnectionBarrier: this.disconnectionBarrier,
              logger: peerLogger
          })
        : InlinePeerBackend.create({
              index,
              signer,
              address,
              harnessConfig: this.harnessConfig,
              deployment: this.deployment,
              sharedDeployer: this.sharedStateMachineDeployer,
              channelManager: this.channelManager,
              hooks: this.buildP2pEventHooks(
                  peerLogger,
                  eventSpies,
                  peerTurnBarrier
              ),
              options: this.options,
              logger: peerLogger
          });

    this.peers.push(handle);
    ```

- extract `wrapEventHandlerWithSpies` and the `P2pEventHooks` factory into helpers that `InlinePeerBackend.create` uses in-process and `WorkerPeerBackend.create` ships into the worker by name (worker bootstrap installs the same wrap on its in-thread `eventHandler`; spy hits push to the orchestrator's `SpyMirror`).

no harness subclassing, no second class. one branch at `createPeer`. that is the whole D-3 lift.

**removed in this revision:** the round-2 `requireInlinePeer` helper is **deleted**. nothing is inline-only. if a test pairs `dedicatedPeerThread: true` with an action class, it works.

---

## 8. resolved open questions

- **naming.** `PeerHandle` stays.
- **proxy vs subclass.** neither. two concrete classes (`InlinePeer`, `WorkerPeer`) implement one interface; the interface is consumed uniformly by action namespaces via sub-handles.
- **`peer.stateManager.something` reads inside actions.** become `await peer.queryX(...)` or `await peer.queryInternals.X(...)` or `await peer.byzantine.X(...)`. no transparent field proxying.
- **`activeForkId` getter.** stays **sync**. worker mode returns the cached value pushed by W4 (`fork.changed`). `await` is not introduced into test scenarios. D-12 holds.
- **signer's home (D-15).** orchestrator owns the ethers `Wallet`. worker receives only the private key on spawn (for its own in-thread `p2pSetup` signer). all `peer.signer.signMessage(...)` calls in actions are orchestrator-side and stay sync.
- **on-chain calls from inside byzantine actions.** routed through orchestrator-side `harness.channelManager.connect(peer.signer)`. worker never holds a live `ethers.Contract` for on-chain writes; storage reads come back via `peer.queryStorageSnapshot` / `peer.queryLatestBlock` / `peer.queryInternals.*`. composes cleanly with W5 (boss's evm-in-thread) because the worker doesn't depend on `stateChannelManagerContract` for on-chain writes.
- **closures.** never cross the boundary. tests using closure overloads migrate to named ops. closure-capture analyser is write-time lint only (permanent guardrail, not a runtime mechanism) (§6 bucket iii).
- **chain access from worker.** deferred to W5 mechanics (D-18). seam unchanged. worker's `p2pSetup` chain provider is whatever boss's evm-in-thread polymorphism produces; `PeerHandle` surface unaffected.

---

## 9. self-review against the 9 non-negotiables

1. peer↔peer is LocalTransport — §1, §5: workers connect to `LocalDiscoveryServer` over ws; no MessagePort meshes. **pass**.
2. MessagePort orchestrator↔worker only — §5: `WorkerPeer` holds one `PeerRpcClient`; never handed out. **pass**.
3. one polymorphic harness — §7: one branch, no subclass. **pass**.
4. tests do not change at structure — §2, §6: opt-in is a single Boolean; no `describeWithHarness`; no `useMode`; no `MathThreadedHarness`. **tests CAN change at source** for closure-bearing overloads (lambda → named op). user has explicitly accepted this. **pass with caveat (documented in §0, master plan, D-22)**.
5. no double code (parallel namespace classes) — §6: `ByzantineActions` is one class, dispatching via `peer.byzantine.*`. no `ThreadedByzantineActions`. there IS bounded duplication at the named-op layer (one inline impl + one worker handler per op); that is the cost of running byzantine in worker mode and is explicitly accepted. **pass**.
6. minimal surface — §3: `PeerHandle` is wider than round-2 (5 → ~5 query methods + 4 sub-handles). every method on every sub-handle cites a today-caller in appendix A. the surface earns its existence. **pass**.
7. 2N+1 model — §2: `dedicatedPeerThread` orthogonal to boss's `dedicatedEvmThread`. **pass**.
8. push and pull on one channel — §3, §5: pull = query/byzantine/rpcStub/network rpcs, push = spy/event/cached-scalar signals via W4. **pass**.
9. loop-delay guard — out of scope for W1; consumed in W6. **pass**.

---

## 10. revision log (user directive: all tests in parallel)

- removed bucket (ii) inline-only gating. dropped `requireInlinePeer`. dropped `InlineOnlyActionError`. -> all current tests are runnable in worker mode.
- added sub-handles to `PeerHandle`: `byzantine`, `rpcStub`, `queryInternals`, `network`. each carries a fixed named-method surface mirroring an existing inline action surface. -> closes the "byzantine + rpc-stub + p2pManager actions can't ride the rpc surface" gap from W1-review.md MAJOR-2 honestly (named methods, not eval bridge).
- brought back named-op registry as the closure migration target (§6 bucket iii). registry is static + worker-bootstrap-loaded; ops are referenced by string id; lambdas never cross. -> migrates `submitNext({ txFn })` and similar.
- kept closure-capture analyser as a write-time lint only, NOT a runtime mechanism -> permanent guardrail; un-migrated lambdas fail lint at PR time; no runtime resolution path.
- explicitly accepted test-source changes for bucket (iii) callers. updated §0, §6, §8, §9 row 4.
- `activeForkId` stays sync via W4 push cache (round-1 fix retained).
- D-row updates landing in W0 in the same change: D-11 rewritten (named-op registry IS the closure seam; tests change at source); D-16 **removed** (no inline-only gating); D-22 added (test-source changes accepted); D-23 added (sub-handle rpc surface mirrors existing action surface).

---

## appendix A — caller-driven surface audit (rewritten)

derived from `grep -rhE "peer\.(p2pInstance|stateManager|signer|index|address|logger|eventSpies|turnBarrier)" test/harness/actions/ test/fixtures/PeerTestHarness.ts test/harness/actions/assert/`. every entry cites at least one today-caller. three buckets — every action method falls into one.

### bucket (i) — works on both backends via `PeerHandle` query/tx/ingest (no test source change)

| handle member                                           | callers (file:fn)                                                                                                                                                                                                                             | rpc route (worker mode)         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `index` / `address` / `signer` / `logger`               | ubiquitous; orchestrator-side throughout                                                                                                                                                                                                      | n/a (sync field)                |
| `eventSpies.<name>.{callCount, lastCall, resetHistory}` | `EventActions`, `AssertActions`, `DisputeOrchestrator`                                                                                                                                                                                        | push: `spy.incr`, `spy.call`    |
| `turnBarrier.waitFor`                                   | `TransitionActions.submitNext` (waitForTurn path)                                                                                                                                                                                             | push: `event.onTurn`            |
| `forkId` (sync cached getter)                           | `ByzantineActions.submitDoubleSignBlock:45`, `ByzantineActions.postJunkCalldataOnChain:126`, `RPCActions.requestDisputeAcknowledgment:128`, `StateQueryActions.getDisputeHashes:265`, ~67 test+harness sites                                  | push: `fork.changed`            |
| `queryStatus()`                                         | `LifecycleActions` (`stateManager.getStatus()`), `assert/*`                                                                                                                                                                                   | rpc: `query.status`             |
| `queryLatestBlock(forkId)`                              | `ByzantineActions.submitDoubleSignBlock:52`, `ByzantineActions.postJunkCalldataOnChain:130`, `RPCActions.simulateBuildOnDisputedFork:182`, `StateQueryActions.getLatestStateMachineStateHash:41`, `StateQueryActions.getPreviousBlockHash:78` | rpc: `query.latestBlock`        |
| `queryStorageSnapshot(req)`                             | `StateQueryActions.getPreviousBlockHash` snapshot read (`storage.stateSnapshots.getGenesisSnapshotByForkId`:81/95), `StateQueryActions.getLatestStateMachineStateHash` (`storage.stateMachineStates.getStateMachineState`:52)                 | rpc: `query.storageSnapshot`    |
| `applyTransaction(req)`                                 | `TransitionActions.submitNext` data-path                                                                                                                                                                                                      | rpc: `tx.apply`                 |
| `ingestBlockConfirmation(req)`                          | `TransitionActions` block-ingest path                                                                                                                                                                                                         | rpc: `ingest.blockConfirmation` |
| `dispose()`                                             | `LifecycleActions.cleanup` (`p2pInstance.dispose`)                                                                                                                                                                                            | rpc: `lifecycle.dispose`        |

### bucket (ii) — works on both backends via `PeerHandle` sub-handles (NEW rpc methods, no test source change required for action callers)

inline backend runs the body in-process against `record.stateManager.*`. worker backend ships rpc to a fixed worker-side handler. every method cites the today-call-site it preserves.

| sub-handle method                         | today-caller (file:line)                                                                                                                                                                                                                                                                                                                             | inline body / worker route                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `byzantine.stubCalldataHandler`           | `ByzantineActions.ts:263-274`                                                                                                                                                                                                                                                                                                                        | mutates `eventHandler.onBlockCalldataPosted`                                                                                                                                                                                                                                                                            |
| `byzantine.restoreCalldataHandler`        | `ByzantineActions.ts:276-291`                                                                                                                                                                                                                                                                                                                        | restores saved ref                                                                                                                                                                                                                                                                                                      |
| `byzantine.stubPendingInboundInclusion`   | `ByzantineActions.ts:293-306`                                                                                                                                                                                                                                                                                                                        | overrides `storage.inboundMessages.getLatestBlockHash`                                                                                                                                                                                                                                                                  |
| `byzantine.stubBroadcast`                 | `ByzantineActions.ts:308-328`                                                                                                                                                                                                                                                                                                                        | replaces `p2pManager.remoteRpc.stateTransitionService.onBlockConfirmation`                                                                                                                                                                                                                                              |
| `byzantine.submitDoubleSignBlock`         | `ByzantineActions.ts:31-109`                                                                                                                                                                                                                                                                                                                         | block constructed orchestrator-side (signer is orchestrator-side per D-15); worker invokes `p2pSigner.p2pManager.remoteRpc.stateTransitionService.onBlockConfirmation(signed).broadcast()`                                                                                                                              |
| `byzantine.postJunkCalldataOnChain`       | `ByzantineActions.ts:114-196`                                                                                                                                                                                                                                                                                                                        | orchestrator builds the block + invalid signature; on-chain call goes through `harness.channelManager.connect(peer.signer)` (orchestrator-side); storage reads come from `queryInternals` / `queryStorageSnapshot`                                                                                                      |
| `rpcStub.installCreateRpcMethodStub`      | `rpcStubActions.ts:45-132`                                                                                                                                                                                                                                                                                                                           | mutates `p2pManager.localRpc[serviceName].createRPCMethods`; stub body is a named handler resolved against the worker's stub-handler registry (the handler id replaces today's `stubbedMethod` lambda — bucket (iii) migration applies for the handler body itself)                                                     |
| `rpcStub.restoreCreateRpcMethodStub`      | `rpcStubActions.ts:134-155`                                                                                                                                                                                                                                                                                                                          | restores saved `createRPCMethods`                                                                                                                                                                                                                                                                                       |
| `rpcStub.restoreAll`                      | `rpcStubActions.ts:157-162`                                                                                                                                                                                                                                                                                                                          | restores every saved ref                                                                                                                                                                                                                                                                                                |
| `queryInternals.openConnections`          | `StateQueryActions.ts:214` (`p2pManager.openConnections`), `NetworkController.ts:82`                                                                                                                                                                                                                                                                 | reads `p2pManager.openConnections` and returns serialisable transport summaries (id, peerAddress, kind)                                                                                                                                                                                                                 |
| `queryInternals.getProfileByEvmAddress`   | `StateQueryActions.ts:251`, `RPCActions.isHandshakeCompleted:62` (via `harness.query.getProfile`)                                                                                                                                                                                                                                                    | reads `p2pManager.profileManager.getProfileByEvmAddress` -> serialisable `ProfileSummary`                                                                                                                                                                                                                               |
| `queryInternals.getProfileByConnectionId` | `StateQueryActions.ts:216,246`                                                                                                                                                                                                                                                                                                                       | callers resolve a `connectionId` via `queryInternals.openConnections()` (summaries carry the id); the id IS the W3 envelope-routing identifier, so it serialises across the wire. inline backend resolves the id back to the live `ATransport` and calls `profileManager.getProfileByTransport` -> serialisable summary |
| `queryInternals.connectionCount`          | `StateQueryActions.ts:228`                                                                                                                                                                                                                                                                                                                           | reads `p2pManager.openConnections.length`                                                                                                                                                                                                                                                                               |
| `queryInternals.self`                     | `RPCActions.ts:112` (`joinPeerToChannel`), `NetworkController.ts:43`, `JoinActions.ts:58` -> all pass `p2pManager.self` into `LocalDiscoveryServer.connectToPeers`                                                                                                                                                                                   | returns `p2pManager.self.address` (serialisable). orchestrator drives the `LocalDiscoveryServer.connectToPeers` call against a worker-side helper keyed on this address; the live `P2PManager` never leaves the worker                                                                                                  |
| `queryInternals.isForkDisputedService.*`  | `RPCActions.ts:42-44` (`localRpc.isForkDisputedService`), `RPCActions.requestDisputeAcknowledgment:133`, `RPCActions.sendFakeDisputeRequest:152`, `RPCActions.sendDuplicateAcknowledgmentResponse:397`, `RPCActions.requestFakeDisputeWithSpiedDisconnect:412`                                                                                       | worker dispatches the named op against the in-thread service instance                                                                                                                                                                                                                                                   |
| `queryInternals.initHandshakeService.*`   | `RPCActions.ts:50-52`, `RPCActions.sendInvalidTimeHandshakeRequest:225`, `RPCActions.initiateHandshake:247`, `RPCActions.sendSlowHandshakeResponse:263`, `RPCActions.sendUnsolicitedHandshakeResponse:301`, `RPCActions.clearHandshakeChallenge:333`, `RPCActions.sendValidHandshakeResponse:348`, `RPCActions.initiateHandshakeWithoutResponse:381` | worker dispatches the named op against the in-thread service instance                                                                                                                                                                                                                                                   |
| `network.disconnectAll`                   | `NetworkController.ts:77-90` (`p2pManager.disconnectConnection` loop)                                                                                                                                                                                                                                                                                | worker iterates `p2pManager.openConnections` and calls `disconnectConnection` per entry                                                                                                                                                                                                                                 |
| `network.tryOpenConnectionToChannel`      | `NetworkController.ts:34-39`, `RPCActions.joinPeerToChannel:108`                                                                                                                                                                                                                                                                                     | `p2pManager.tryOpenConnectionToChannel(channelId)`                                                                                                                                                                                                                                                                      |
| `network.installDisconnectFilter`         | `RPCActions.requestFakeDisputeWithSpiedDisconnect:417-430`                                                                                                                                                                                                                                                                                           | installs named filter on `p2pManager.disconnectAndBlacklistPeerByEvmAddress`; filter body is a named handler from the registry                                                                                                                                                                                          |
| `network.restoreDisconnectFilter`         | (paired with install)                                                                                                                                                                                                                                                                                                                                | restores saved ref                                                                                                                                                                                                                                                                                                      |

note: orchestrator-side flows that today call `LocalDiscoveryServer.connectToPeers(peer.stateManager.p2pManager.self, ...)` (`NetworkController:43`, `RPCActions.joinPeerToChannel:112`, `JoinActions.ts:58`) cannot ship the live `P2PManager` into a worker. `queryInternals.self()` returns the worker's self-address (serialisable); the orchestrator drives `LocalDiscoveryServer.connectToPeers` keyed on that address against a worker-side helper. the live `P2PManager` instance never leaves the worker.

### bucket (iii) — closure-bearing action methods (test source changes to named ops)

these actions take a lambda from the test author today. test source migrates from lambda → named op id + args. analyser is the write-time lint (§6).

| action method                                                   | today closure shape                     | migration target                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TransitionActions.submitNext({ txFn })` overload               | `(contract: TContract) => Promise<any>` | `{ op: "<domain>.<opId>", args: {...} }`; ops registered in `test/harness/worker-ops/<domain>.ts` (math suite ships `mathContract.add`, `mathContract.set`, etc.)                                                                                                     |
| `TransitionActions.sequenceFromHonestPeers((peer) => ...)`      | `(peer: TestPeer) => Promise<void>`     | sequence becomes a named op id; orchestrator drives the loop via N normal `peer.applyTransaction({ op, args })` calls                                                                                                                                                 |
| `ByzantineActions.postTamperedDisputeWith(peerIndex, tamperFn)` | `DisputeTamper` callback                | named tamper id; tamper bodies live in `DisputeTampering.<namedTamper>` (already named: `tamperAuditingDataHash`, `tamperPartialAuditing`, `tamperDoubleFault`) — already mostly migrated; bring `stubDisputeConstruction({ tamperFn })` (line 245) over the same way |
| `rpcStub.installCreateRpcMethodStub`'s `stubbedMethod` arg      | inline lambda body                      | named handler id resolved against `WORKER_RPC_STUB_HANDLERS` table (`mathDisputeService.respondYes`, etc.)                                                                                                                                                            |
| `network.installDisconnectFilter`'s body                        | inline lambda                           | named filter id resolved against `WORKER_DISCONNECT_FILTERS` table (e.g. `dropRequester` for the spied-disconnect pattern)                                                                                                                                            |

migration path is purely a test-source change. action-class shape doesn't change. inline behaviour after migration is byte-identical to today (the inline backend invokes the same named handler in-process).

#### deferred ops (no current caller)

none today. additions go via D-row update so the surface stays auditable.

---

## appendix B — D-rows for W0

W1 lands the following D-row updates in W0 in the same change:

- **D-11** -> rewritten. named-op registry IS the seam for closures; tests change at source from lambdas to op ids; closure-capture analyser is a write-time lint only (permanent guardrail, not a runtime mechanism). lambdas never cross the boundary.
- **D-12** -> retained. defaults off; `activeForkId` stays sync via W4 push cache.
- **D-15** -> retained. orchestrator owns the signer.
- **D-16** -> **removed**. no inline-only carve-out; no `requireInlinePeer`; all actions work in both backends via sub-handles or named ops.
- **D-22** -> new. test-source changes are accepted for closure-bearing action overloads. structure (`describeWithHarness`, `useMode`, separate suite files) does NOT change; only the lambda-vs-named-op shape inside test bodies.
- **D-23** -> new. byzantine, rpc-stub, p2pManager-internals, and peer-side network actions get rpc surface on `PeerHandle` via fixed sub-handles. one rpc method per existing inline action surface. NOT parallel action classes (D-5 still binds at the action-class layer).

---

## Revision log (round 1 review)

- M1: dropped `InlineOpRegistry` / `InlineOpId` / `runInlineOp`. closure-based actions become inline-only (bucket ii), gated at the call site via `harness.requireInlinePeer`. -> closes MAJOR-1.
- M2: rewrote appendix A as a three-bucket audit (uniform / inline-only / deferred). enumerated the real surface and marked it inline-only. -> closes MAJOR-2.
- M3: amended D-12 -> `activeForkId` stays sync (round-0 async-flip clause superseded). added cached `forkId` field on `PeerHandle`, pushed by W4 `fork.changed`. -> closes MAJOR-4.
- MAJOR-3: trimmed `PeerHandle` from 14 methods + 6 fields to 5 methods + 7 fields. -> closes MAJOR-3.
- MINOR-1: pinned signer ownership. orchestrator owns the ethers `Wallet`; worker gets only the private key on spawn. recorded as D-15. -> closes MINOR-1.
- MINOR-2: kept `eventSpies` and `turnBarrier` as live fields; added explicit "asserted at construction" note in §3. -> closes MINOR-2.
- NIT-1: D-row updates land in W0 in the same change (D-11 rewrite, D-12 revert, D-15 new, D-16 new). cross-cutting consistency restored.

## Revision log (round 2 review)

- N-1: s/getInlinePeerRecord/requireInlinePeer/ in §4 (round-2 reviewer noted the wobble; cleaned). [superseded by user-directive revision below; both helpers are removed.]
- N-3: D-row numbering corrected (D-15, D-16 in the round-1 fix changeset).

## Revision log (user directive: all tests in parallel)

- removed bucket (ii) inline-only gating. dropped `harness.requireInlinePeer`. dropped `InlineOnlyActionError`. all current tests now run in either backend.
- added `PeerHandle` sub-handles: `byzantine`, `rpcStub`, `queryInternals`, `network`. each method is a named op with one inline implementation + one worker route. rewired action-namespace methods to call into sub-handles instead of touching `peer.stateManager.*`.
- brought back named-op registry as the closure migration target. lambdas never cross; tests source-change from `txFn: (c) => c.add(2)` to `op: "mathContract.add"`.
- kept closure-capture analyser from v1 W5 as a write-time lint only (permanent guardrail, no runtime resolution).
- accepted test-source changes for closure-bearing overloads in §0.1, §6 bucket (iii). recorded as D-22.
- W0: D-11 rewritten (named-op registry is the seam, tests change at source). D-16 removed. D-22 added (test-source changes accepted). D-23 added (sub-handle rpc surface mirrors existing inline action surface, bounded duplication).
- master-plan updated: "boss expectations" row 4 clarified (tests don't change at structure; tests CAN change at source for closure-bearing overloads). "out of scope" loosened on the test-source axis.
- cascade to other W docs (called out for the W2/W3/W4 maintainers):
    - **W2**: worker bootstrap registers (a) the named-op table per domain, (b) the named rpc-stub handler table, (c) the named disconnect-filter table. spawn payload grows by these registrations. D-19 may need revisiting if a real test demands `customPrecompiles`/`rpcServiceFactories` in worker mode (still expected to throw absent a real caller).
    - **W3**: rpc surface grows from {`query.*`, `tx.*`, `ingest.*`, `lifecycle.*`} to also include {`byzantine.*`, `rpcStub.*`, `queryInternals.*`, `network.*`}. route ids are mechanical; no protocol shape change.
    - **W4**: spy push cardinality unchanged. cached-scalar set unchanged. no new push channels needed.
    - **W5**: chain access seam unchanged; on-chain writes in byzantine routes (`postJunkCalldataOnChain`) go orchestrator-side via `harness.channelManager.connect(peer.signer)`, NOT through the worker. composes cleanly with boss's evm-in-thread PR regardless of his shape.
    - **W6**: unchanged.

## Revision log (W1 round-3 review)

- MAJOR-1: added `queryInternals.self(): Promise<Address>` to `P2pInternalsHandle` -> closes the gap where `RPCActions.ts:112` reads `p2pManager.self` from the orchestrator side; appendix A bucket (ii) row added (`RPCActions.ts:112`, `NetworkController.ts:43`, `JoinActions.ts:58`); §3.1 footnote rewritten to drop the "added if a caller demands it — not yet" deferral.
- MINOR-1: renamed `getProfileByTransport(transportId: TransportId)` -> `getProfileByConnectionId(connectionId: ConnectionId)` in §3.1, appendix A row, and W2 cascade subsection -> the id IS the W3 envelope-routing identifier; the type-vs-source-shape gap is now loud; appendix A row spells the id-materialisation hop via `queryInternals.openConnections()`.
- MINOR-2: closure-capture analyser lifecycle pinned to **write-time lint only** (permanent guardrail). stripped "migration aid" framing and any wording suggesting runtime resolution from §0.1, §6 bucket (iii), §8, §10, and the user-directive revision log. un-migrated lambdas fail lint at PR time; the analyser is NOT invoked at runtime.
