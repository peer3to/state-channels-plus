// W1 - InlinePeer backend. wraps an existing TestPeer record; sub-handles
// run today's action bodies in-process against record.stateManager.*.
// no logic moves between modes (W1 §4) — these bodies live once in the inline
// sub-handle, and once mirrored on the worker route table.
//
// W0 D-15 - signer stays orchestrator-side; inline path holds the real Wallet.
// W0 D-23 - one rpc method per existing inline action surface; inline impls
//           are byte-identical to the today-action body the audit cites.

import type { Address, ForkId } from "@/types/types";
import type { Logger, EventBarrier } from "@/utils";
import type { Signer } from "ethers";

import type {
    ByzantineHandle,
    DebugHandle,
    DisconnectFilterFn,
    LifecycleHandle,
    NamedOpRequest,
    NetworkHandle,
    P2pInternalsHandle,
    PeerHandle,
    ProfileSummary,
    RestoreToken,
    RpcStubHandle,
    RpcStubHandlerFn,
    StubMethodFn,
    SubmitDoubleSignReq,
    TransitionHandle,
    TransportSummary
} from "./PeerHandle";
import { getOp } from "../threaded/worker/opsRegistry";
import { rejectLambdaArgs } from "./namedOpGuards";
import type { EventSpies, TestPeer } from "./types";

class InlineByzantineHandle implements ByzantineHandle {
    // step 1 - sub-handle owns the captured refs for restore. one slot per
    // stub kind; restoreCalldataHandler / restorePendingInboundInclusion
    // consume the matching slot. stubBroadcast has no paired restore today
    // (no test calls it), so no slot kept.
    private originalCalldataHandler: unknown;
    // step 1 - cast through `never` -> the storage field's signature uses
    // ethers BytesLike; binding the original method preserves runtime shape.
    private originalInboundGetLatestBlockHash: unknown;

    constructor(private readonly record: TestPeer) {}

    // step 1 - mirrors ByzantineActions.ts:263-274 (today body)
    async stubCalldataHandler(): Promise<void> {
        const eh = this.record.stateManager.eventHandler;
        this.originalCalldataHandler = eh.onBlockCalldataPosted.bind(
            eh
        ) as unknown;
        eh.onBlockCalldataPosted = (async () => {}) as never;
    }

    // step 1 - mirrors ByzantineActions.ts:276-291 (today body)
    async restoreCalldataHandler(): Promise<void> {
        if (!this.originalCalldataHandler) {
            throw new Error(
                "InlineByzantineHandle: no calldata handler captured to restore"
            );
        }
        this.record.stateManager.eventHandler.onBlockCalldataPosted = this
            .originalCalldataHandler as never;
        this.originalCalldataHandler = undefined;
    }

    // step 1 - mirrors ByzantineActions.ts:293-306 (today body)
    async stubPendingInboundInclusion(): Promise<void> {
        const storage = this.record.stateManager.storage.inboundMessages;
        this.originalInboundGetLatestBlockHash =
            storage.getLatestBlockHash.bind(storage);
        storage.getLatestBlockHash = () => undefined;
    }

    async restorePendingInboundInclusion(): Promise<void> {
        if (!this.originalInboundGetLatestBlockHash) {
            throw new Error(
                "InlineByzantineHandle: no inbound-inclusion stub to restore"
            );
        }
        this.record.stateManager.storage.inboundMessages.getLatestBlockHash =
            this.originalInboundGetLatestBlockHash as never;
        this.originalInboundGetLatestBlockHash = undefined;
    }

    // step 1 - mirrors ByzantineActions.ts:308-328 (today body). today's
    // suppress-broadcast logged each call site - the log line is preserved
    // here so test runs surface the same trace.
    async stubBroadcast(): Promise<void> {
        const remoteRpc = this.record.stateManager.p2pManager.remoteRpc;
        const peerLogger = this.record.logger;
        const peerIndex = this.record.index;
        remoteRpc.stateTransitionService.onBlockConfirmation = ((
            _blockConfirmation: unknown
        ) => {
            peerLogger.info("Suppressed broadcast from peer " + peerIndex);
            return {
                broadcast: () => {},
                sendOne: () => {},
                sendMultiple: () => {}
            };
        }) as never;
    }

    // step 1 - block construction is orchestrator-side per D-15. inline body
    // is the broadcast call only (mirrors ByzantineActions.ts:99-101 today).
    async submitDoubleSignBlock(req: SubmitDoubleSignReq): Promise<void> {
        const remoteRpc = this.record.stateManager.p2pManager.remoteRpc;
        remoteRpc.stateTransitionService
            .onBlockConfirmation(req.signedBlockConfirmation as never)
            .broadcast();
    }

    // step 3 - generic broadcast tail. shares the same path as
    // submitDoubleSignBlock; separated so byzantine action sites read as
    // "construct orchestrator-side + broadcast peer-side" rather than the
    // misleading-named double-sign route.
    async broadcastBlockConfirmation(req: {
        blockConfirmation: unknown;
    }): Promise<void> {
        const remoteRpc = this.record.stateManager.p2pManager.remoteRpc;
        remoteRpc.stateTransitionService
            .onBlockConfirmation(req.blockConfirmation as never)
            .broadcast();
    }
}

class InlineRpcStubHandle implements RpcStubHandle {
    // step 1 - per-peer restore map. keyed by "<serviceName>:<methodName>"
    // (one slot per stubbed method).
    private readonly restoresByKey = new Map<string, () => void>();

    constructor(private readonly record: TestPeer) {}

    // step 1 - install an inline closure as the stub. wraps service.createRPCMethods
    // so methods[methodName] runs the closure with `this` -> the rpc methods
    // instance (services expose senderTransport/service/remoteRpc on this).
    async installCreateRpcMethodStub(
        serviceName: string,
        methodName: string,
        handler: RpcStubHandlerFn
    ): Promise<RestoreToken> {
        const localRpc = (
            this.record.stateManager.p2pManager as unknown as {
                localRpc: Record<string, unknown>;
            }
        ).localRpc;
        const service = localRpc[serviceName] as
            | { createRPCMethods: (t: unknown) => unknown }
            | undefined;
        if (!service)
            throw new Error(
                `InlineRpcStubHandle: service '${serviceName}' not found on localRpc`
            );
        if (typeof service.createRPCMethods !== "function")
            throw new Error(
                `InlineRpcStubHandle: service '${serviceName}' has no createRPCMethods()`
            );

        const originalCreate = service.createRPCMethods.bind(service);
        const key = `${serviceName}:${methodName}`;
        // step 1 - if a prior install for this slot exists, restore first ->
        // we wrap the unmodified service.
        this.restoresByKey.get(key)?.();

        service.createRPCMethods = ((transport: unknown) => {
            const methods = originalCreate(transport) as Record<
                string,
                unknown
            >;
            if (!(methodName in methods)) {
                throw new Error(
                    `InlineRpcStubHandle: method '${methodName}' missing on createRPCMethods() result for '${serviceName}'`
                );
            }
            // step 1 - install the closure verbatim. rpc kernel binds `this`
            // to the methods instance + spreads positional args -> closures
            // that need senderTransport / service / remoteRpc see them.
            methods[methodName] = handler;
            return methods;
        }) as never;

        const restore = () => {
            service.createRPCMethods = originalCreate as never;
            this.restoresByKey.delete(key);
        };
        this.restoresByKey.set(key, restore);
        return { id: key };
    }

    async restoreCreateRpcMethodStub(req: {
        serviceName: string;
        methodName: string;
    }): Promise<void> {
        const key = `${req.serviceName}:${req.methodName}`;
        this.restoresByKey.get(key)?.();
    }

    async restoreAll(): Promise<void> {
        for (const restore of this.restoresByKey.values()) restore();
        this.restoresByKey.clear();
    }
}

class InlineP2pInternalsHandle implements P2pInternalsHandle {
    constructor(private readonly record: TestPeer) {}

    // step 1 - mirrors StateQueryActions.ts:214 + NetworkController.ts:82
    async openConnections(): Promise<TransportSummary[]> {
        const conns = this.record.stateManager.p2pManager
            .openConnections as unknown as Array<{
            connectionId?: string;
            peerAddress?: string;
            kind?: string;
        }>;
        const out: TransportSummary[] = [];
        for (const t of conns) {
            out.push({
                connectionId: t.connectionId ?? "",
                peerAddress: (t.peerAddress ?? "0x") as Address,
                kind: t.kind ?? "unknown"
            });
        }
        return out;
    }

    // step 1 - mirrors StateQueryActions.ts:251
    async getProfileByEvmAddress(
        addr: Address
    ): Promise<ProfileSummary | undefined> {
        const pm = this.record.stateManager.p2pManager as unknown as {
            profileManager?: {
                getProfileByEvmAddress?: (a: Address) =>
                    | {
                          evmAddress?: string;
                          transport?: { connectionId?: string };
                      }
                    | undefined;
            };
        };
        const profile = pm.profileManager?.getProfileByEvmAddress?.(addr);
        if (!profile) return undefined;
        return {
            evmAddress: (profile.evmAddress ?? addr) as Address,
            connectionId: profile.transport?.connectionId ?? ""
        };
    }

    async getProfileByConnectionId(
        connectionId: string
    ): Promise<ProfileSummary | undefined> {
        // step 1 - today-callers (StateQueryActions.ts:216,246) resolve via
        // live ATransport then call profileManager.getProfileByTransport.
        // inline backend mirrors: look up the transport by id, then resolve.
        const pm = this.record.stateManager.p2pManager as unknown as {
            openConnections: Array<{ connectionId?: string }>;
            profileManager?: {
                getProfileByTransport?: (t: unknown) =>
                    | {
                          evmAddress?: string;
                      }
                    | undefined;
            };
        };
        for (const t of pm.openConnections) {
            if (t.connectionId === connectionId) {
                const profile = pm.profileManager?.getProfileByTransport?.(t);
                if (!profile) return undefined;
                return {
                    evmAddress: (profile.evmAddress ?? "0x") as Address,
                    connectionId
                };
            }
        }
        return undefined;
    }

    // step 1 - mirrors StateQueryActions.ts:228
    async connectionCount(): Promise<number> {
        return this.record.stateManager.p2pManager.openConnections.length;
    }

    // step 1a - mirrors RPCActions.isHandshakeCompleted (predicate body).
    async isHandshakeCompletedWith(otherAddr: Address): Promise<boolean> {
        const profile =
            this.record.stateManager.p2pManager.profileManager.getProfileByEvmAddress(
                otherAddr
            );
        return profile?.getIsHandshakeCompleted() ?? false;
    }

    // step 1 - mirrors RPCActions.ts:112 + NetworkController.ts:43 reads.
    // today's callers pass `p2pManager.self` (the live P2PManager) into
    // LocalDiscoveryServer.connectToPeers along with the EVM address as
    // myPeerAddress. for the cross-isolate seam, we expose the EVM address
    // - LocalDiscoveryServer's third arg - which IS serialisable.
    async self(): Promise<Address> {
        return this.record.address as Address;
    }

    // step 1 - dispatcher mirror of worker route. resolves the op against the
    // peer's localRpc service map and invokes it with `args`.
    async isForkDisputedService(req: {
        op: string;
        args: unknown;
    }): Promise<unknown> {
        return this.runLocalRpcOp("isForkDisputedService", req.op, req.args);
    }

    async initHandshakeService(req: {
        op: string;
        args: unknown;
    }): Promise<unknown> {
        return this.runLocalRpcOp("initHandshakeService", req.op, req.args);
    }

    // step 3 - call `<svc>.<method>(transport, ...args)` for service-level
    // methods that take a live ATransport as the first arg (e.g.
    // InitHandshakeService.initHandshake / mapTransportToChallenge.delete).
    async callServiceMethodWithTransport(req: {
        serviceName: string;
        methodName: string;
        otherAddr: Address;
        args: unknown[];
    }): Promise<unknown> {
        const { serviceName, methodName, otherAddr, args } = req;
        const pm = this.record.stateManager.p2pManager;
        const pmAny = pm as unknown as {
            openConnections: Iterable<unknown>;
            profileManager: {
                getProfileByTransport: (
                    t: unknown
                ) => { evmAddress?: string } | undefined;
            };
            localRpc: Record<string, unknown>;
        };
        const target = String(otherAddr).toLowerCase();
        let resolvedTransport: unknown;
        for (const t of pmAny.openConnections) {
            const profile = pmAny.profileManager.getProfileByTransport(t);
            if (String(profile?.evmAddress ?? "").toLowerCase() === target) {
                resolvedTransport = t;
                break;
            }
        }
        if (!resolvedTransport)
            throw new Error(
                `InlinePeer.callServiceMethodWithTransport: no transport to ${otherAddr}`
            );
        const svc = pmAny.localRpc[serviceName] as
            | Record<string, (...a: unknown[]) => unknown>
            | undefined;
        if (!svc)
            throw new Error(
                `InlinePeer.callServiceMethodWithTransport: missing service '${serviceName}'`
            );
        const fn = svc[methodName];
        if (typeof fn !== "function")
            throw new Error(
                `InlinePeer.callServiceMethodWithTransport: '${serviceName}.${methodName}' not a function`
            );
        return await (fn as (...a: unknown[]) => unknown).apply(svc, [
            resolvedTransport,
            ...args
        ]);
    }

    // step 4 - peer scalar
    async getPreferredTransportType(): Promise<number> {
        const pm = this.record.stateManager.p2pManager as unknown as {
            preferredTransport: number;
        };
        return pm.preferredTransport;
    }

    // step 5 - InitHandshakeService.getChallenge(transport) by peer addr.
    async getInitChallenge(otherAddr: Address): Promise<
        | {
              randomChallengeHash: string;
              initTime: number;
          }
        | undefined
    > {
        const t = this.resolveTransportByAddr(otherAddr);
        if (!t) return undefined;
        const svc = (
            this.record.stateManager.p2pManager as unknown as {
                localRpc: Record<string, unknown>;
            }
        ).localRpc["initHandshakeService"] as
            | {
                  getChallenge: (
                      t: unknown
                  ) =>
                      | { randomChallengeHash: string; initTime: number }
                      | undefined;
              }
            | undefined;
        const c = svc?.getChallenge(t);
        if (!c) return undefined;
        return {
            randomChallengeHash: c.randomChallengeHash,
            initTime: c.initTime
        };
    }

    // step 6 - clear challenge for transport to otherAddr.
    async clearInitChallenge(otherAddr: Address): Promise<void> {
        const t = this.resolveTransportByAddr(otherAddr);
        if (!t) return;
        const svc = (
            this.record.stateManager.p2pManager as unknown as {
                localRpc: Record<string, unknown>;
            }
        ).localRpc["initHandshakeService"] as
            | { mapTransportToChallenge: Map<unknown, unknown> }
            | undefined;
        svc?.mapTransportToChallenge.delete(t);
    }

    // step 7 - transport status (presence + isClosed) by addr
    async getTransportStatus(
        otherAddr: Address
    ): Promise<{ present: boolean; isClosed?: boolean }> {
        const t = this.resolveTransportByAddr(otherAddr) as
            | { isClosed?: boolean }
            | undefined;
        if (!t) return { present: false };
        return { present: true, isClosed: t.isClosed };
    }

    // step 8 - helper. shared by step-5/6/etc.
    private resolveTransportByAddr(addr: Address): unknown {
        const pmAny = this.record.stateManager.p2pManager as unknown as {
            openConnections: Iterable<unknown>;
            profileManager: {
                getProfileByTransport: (
                    t: unknown
                ) => { evmAddress?: string } | undefined;
            };
        };
        const target = String(addr).toLowerCase();
        for (const t of pmAny.openConnections) {
            const profile = pmAny.profileManager.getProfileByTransport(t);
            if (String(profile?.evmAddress ?? "").toLowerCase() === target)
                return t;
        }
        return undefined;
    }

    // step 2 - in-thread resolve transport by peer evm address, then call
    // `<svc>.createRPCMethods(transport).<method>(...args)`. mirror of the
    // worker route. inline body lets RPCActions.send* migrate off live refs.
    async callServiceWithTransport(req: {
        serviceName: string;
        methodName: string;
        otherAddr: Address;
        args: unknown[];
    }): Promise<unknown> {
        const { serviceName, methodName, otherAddr, args } = req;
        const pm = this.record.stateManager.p2pManager;
        const pmAny = pm as unknown as {
            openConnections: Iterable<unknown>;
            profileManager: {
                getProfileByTransport: (
                    t: unknown
                ) => { evmAddress?: string } | undefined;
            };
            localRpc: Record<string, unknown>;
        };
        const target = String(otherAddr).toLowerCase();
        let resolvedTransport: unknown;
        for (const t of pmAny.openConnections) {
            const profile = pmAny.profileManager.getProfileByTransport(t);
            if (String(profile?.evmAddress ?? "").toLowerCase() === target) {
                resolvedTransport = t;
                break;
            }
        }
        if (!resolvedTransport) {
            throw new Error(
                `InlinePeer.callServiceWithTransport: no transport to ${otherAddr}`
            );
        }
        const svc = pmAny.localRpc[serviceName] as
            | {
                  createRPCMethods: (
                      t: unknown
                  ) => Record<string, (...a: unknown[]) => unknown>;
              }
            | undefined;
        if (!svc)
            throw new Error(
                `InlinePeer.callServiceWithTransport: missing service '${serviceName}'`
            );
        const methods = svc.createRPCMethods(resolvedTransport);
        const fn = methods[methodName];
        if (typeof fn !== "function")
            throw new Error(
                `InlinePeer.callServiceWithTransport: '${serviceName}.${methodName}' not a function`
            );
        // step 1 - bind to the methods object -> instance methods (e.g.
        // InitHandshakeRpcMethods.onInitHandshakeRequest) keep `this`.
        return await (fn as (...a: unknown[]) => unknown).apply(methods, args);
    }

    private async runLocalRpcOp(
        svcName: string,
        opName: string,
        opArgs: unknown
    ): Promise<unknown> {
        const localRpc = (
            this.record.stateManager.p2pManager as unknown as {
                localRpc: Record<string, unknown>;
            }
        ).localRpc;
        const svc = localRpc[svcName] as
            | Record<string, (...a: unknown[]) => unknown>
            | undefined;
        if (!svc) throw new Error(`${svcName} not present on localRpc`);
        const fn = svc[opName];
        if (typeof fn !== "function") {
            throw new Error(`${svcName}.${opName} not a function`);
        }
        // step 1 - bind to svc so `this` resolves -> service methods reach
        // their own fields. opArgs as array -> spread positional; else single.
        const bound = fn.bind(svc);
        if (Array.isArray(opArgs)) return await bound(...opArgs);
        return await bound(opArgs);
    }
}

class InlineTransitionHandle implements TransitionHandle {
    constructor(private readonly record: TestPeer) {}

    async submitNext(req: NamedOpRequest): Promise<unknown> {
        rejectLambdaArgs("InlinePeer.transition.submitNext", req);
        // step 1 - resolve op id against the shared registry. inline backend
        // runs the op body in-process with a context exposing the live
        // stateManager + p2pInstance. same bodies as the worker route.
        const fn = getOp(req.op);
        const ctx = {
            getStateManager: () => this.record.stateManager as unknown,
            getP2pInstance: () => this.record.p2pInstance as unknown
        };
        return await fn(ctx, req.args);
    }
}

class InlineLifecycleHandle implements LifecycleHandle {
    constructor(private readonly record: TestPeer) {}

    // step 1 - mirrors LifecycleActions.ts:126 + JoinActions.ts:54 inline body
    async connectToChannel(channelId: string): Promise<void> {
        await this.record.p2pInstance.p2pSigner.connectToChannel(channelId);
    }

    // step 1 - mirrors JoinActions.ts:117 inline body. confirmation is the
    // fully-serialisable JoinChannelConfirmationStruct.
    async joinChannel(req: {
        confirmation: unknown;
        expectedSnapshotHash: string;
    }): Promise<void> {
        await this.record.p2pInstance.p2pSigner.joinChannel(
            req.confirmation as never,
            req.expectedSnapshotHash
        );
    }
}

class InlineNetworkHandle implements NetworkHandle {
    // step 1 - single-slot restore (matches the worker route shape; only one
    // disconnect filter per peer at a time).
    private filterRestore: (() => void) | undefined;

    constructor(private readonly record: TestPeer) {}

    // step 1 - mirrors NetworkController.ts:77-90
    async disconnectAll(): Promise<void> {
        const pm = this.record.p2pInstance.p2pSigner.p2pManager;
        const conns = [...(pm.openConnections as Iterable<unknown>)];
        for (const conn of conns) {
            pm.disconnectConnection(conn as never);
        }
    }

    // step 1 - mirrors NetworkController.ts:34-39 + RPCActions.ts:108
    async tryOpenConnectionToChannel(channelId: string): Promise<void> {
        await this.record.stateManager.p2pManager.tryOpenConnectionToChannel(
            channelId
        );
    }

    // step 1 - install an inline closure filter over
    // disconnectAndBlacklistPeerByEvmAddress(addr). predicate returns true ->
    // delegate to original; false -> drop. message arg is the addr string.
    async installDisconnectFilter(
        filter: DisconnectFilterFn
    ): Promise<RestoreToken> {
        const pm = this.record.stateManager.p2pManager as unknown as {
            disconnectAndBlacklistPeerByEvmAddress: (addr: string) => unknown;
        };
        const original = pm.disconnectAndBlacklistPeerByEvmAddress.bind(pm);
        // step 1 - if a prior filter is live, restore first -> wrap clean.
        this.filterRestore?.();

        pm.disconnectAndBlacklistPeerByEvmAddress = (async (addr: string) => {
            const allow = await filter(addr);
            if (!allow) return;
            return original(addr);
        }) as never;
        this.filterRestore = () => {
            pm.disconnectAndBlacklistPeerByEvmAddress = original as never;
            this.filterRestore = undefined;
        };
        return { id: "disconnectFilter" };
    }

    async restoreDisconnectFilter(): Promise<void> {
        this.filterRestore?.();
    }
}

// step 1 - generic method-stubbing on the live stateManager. dotted paths
// walk intermediate objects; the last segment is the slot to overwrite.
// monotonic-id tokens map back to a restore closure that puts the original
// method back on the same object slot.
class InlineDebugHandle implements DebugHandle {
    private nextTokenId = 1;
    private readonly restoresByToken = new Map<string, () => void>();

    constructor(private readonly record: TestPeer) {}

    async stubMethod(path: string, fn: StubMethodFn): Promise<RestoreToken> {
        const { target, leaf } = walkDottedPath(
            this.record.stateManager as unknown as Record<string, unknown>,
            path
        );
        const original = (target as Record<string, unknown>)[leaf];
        (target as Record<string, unknown>)[leaf] = fn as unknown as never;
        const id = `stubMethod#${this.nextTokenId++}`;
        this.restoresByToken.set(id, () => {
            (target as Record<string, unknown>)[leaf] = original as never;
            this.restoresByToken.delete(id);
        });
        return { id };
    }

    async restoreStubbedMethod(token: RestoreToken): Promise<void> {
        this.restoresByToken.get(token.id)?.();
    }

    async restoreAllStubbedMethods(): Promise<void> {
        for (const restore of this.restoresByToken.values()) restore();
        this.restoresByToken.clear();
    }
}

// step 1 - dotted path walker. "a.b.c" -> { target: root.a.b, leaf: "c" }.
// throws on missing intermediates so test source surfaces typos loud.
function walkDottedPath(
    root: Record<string, unknown>,
    path: string
): { target: Record<string, unknown>; leaf: string } {
    const parts = path.split(".");
    if (parts.length === 0 || parts.some((p) => p.length === 0)) {
        throw new Error(`stubMethod: invalid path '${path}'`);
    }
    let cur: Record<string, unknown> = root;
    for (let i = 0; i < parts.length - 1; i++) {
        const next = cur[parts[i]];
        if (next === undefined || next === null) {
            throw new Error(
                `stubMethod: path '${path}' segment '${parts[i]}' is ${String(next)}`
            );
        }
        cur = next as Record<string, unknown>;
    }
    return { target: cur, leaf: parts[parts.length - 1] };
}

export class InlinePeer implements PeerHandle {
    readonly byzantine: ByzantineHandle;
    readonly rpcStub: RpcStubHandle;
    readonly queryInternals: P2pInternalsHandle;
    readonly network: NetworkHandle;
    readonly transition: TransitionHandle;
    readonly lifecycle: LifecycleHandle;
    readonly debug: DebugHandle;

    constructor(public readonly record: TestPeer) {
        this.byzantine = new InlineByzantineHandle(record);
        this.rpcStub = new InlineRpcStubHandle(record);
        this.queryInternals = new InlineP2pInternalsHandle(record);
        this.network = new InlineNetworkHandle(record);
        this.transition = new InlineTransitionHandle(record);
        this.lifecycle = new InlineLifecycleHandle(record);
        this.debug = new InlineDebugHandle(record);
    }

    get index(): number {
        return this.record.index;
    }
    get address(): Address {
        return this.record.address as Address;
    }
    get signer(): Signer {
        return this.record.signer;
    }
    get logger(): Logger {
        return this.record.logger;
    }
    get eventSpies(): EventSpies {
        return this.record.eventSpies;
    }
    get turnBarrier(): EventBarrier {
        return this.record.turnBarrier;
    }
    get forkId(): ForkId | undefined {
        return this.record.stateManager.forkId;
    }

    async queryStatus(): Promise<unknown> {
        return this.record.stateManager.getStatus();
    }

    async queryLatestBlock(forkId: ForkId): Promise<unknown> {
        return this.record.stateManager.storage.blocks.getLatestBlock(forkId);
    }

    // step 4a - diamondStateMachine direct read. inline body matches
    // StateQueryActions.ts:140.
    async queryNextToWrite(): Promise<Address> {
        return (await this.record.stateManager.diamondStateMachine.getNextToWrite()) as Address;
    }

    async queryParticipants(): Promise<Address[]> {
        return (await this.record.stateManager.diamondStateMachine.getParticipants()) as Address[];
    }

    // step 4c - mirrors StateQueryActions.getLatestStateMachineStateHash body
    // in-process (no migration of the storage seam needed for this read).
    async queryLatestStateMachineStateHash(
        forkId: ForkId
    ): Promise<string | null> {
        const storage = this.record.stateManager.storage;
        const latestBlock = storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) return null;
        const snapshot = storage.stateSnapshots.getStateSnapshotByHash(
            latestBlock.stateSnapshotHash
        );
        if (!snapshot) return null;
        const machineState = storage.stateMachineStates.getStateMachineState(
            snapshot.stateMachineStateHash
        );
        if (!machineState) return null;
        return String(snapshot.stateMachineStateHash);
    }

    // step 4b - agreementManager.didEveryoneSignBlock. inline body resolves
    // the block from the local storage by hash so the SyncCoordinator path
    // doesn't need to ship the full Block over the wire.
    async queryDidEveryoneSignBlock(blockHash: string): Promise<boolean> {
        const storage = this.record.stateManager.storage as unknown as {
            blocks: { getBlock: (h: string) => unknown };
        };
        const block = storage.blocks.getBlock(blockHash);
        if (!block) return false;
        return this.record.stateManager.agreementManager.didEveryoneSignBlock(
            block as never
        );
    }

    // step 4d - mirrors storage.blocks.getNextBlockHeight(forkId).
    async queryNextBlockHeight(forkId: ForkId): Promise<number> {
        return Number(
            this.record.stateManager.storage.blocks.getNextBlockHeight(forkId)
        );
    }

    // step 4e - mirrors storage.getStateSnapshot({forkId, height}). returns
    // serialisable summary (hash + stateMachineStateHash + blockHeight).
    async queryStateSnapshotAt(req: {
        forkId: ForkId;
        height: number;
    }): Promise<{
        hash: string;
        stateMachineStateHash: string;
        blockHeight: number;
    } | null> {
        const snap = this.record.stateManager.storage.getStateSnapshot({
            forkId: req.forkId,
            height: req.height
        }) as
            | {
                  hash: string;
                  stateMachineStateHash: string;
                  blockHeight: number;
              }
            | undefined;
        if (!snap) return null;
        return {
            hash: String(snap.hash),
            stateMachineStateHash: String(snap.stateMachineStateHash),
            blockHeight: Number(snap.blockHeight)
        };
    }

    // step 4f - mirrors storage.stateMachineStates.getStateMachineState(hash).
    async queryStateMachineState(hash: string): Promise<string | null> {
        const state = (
            this.record.stateManager.storage.stateMachineStates as unknown as {
                getStateMachineState: (h: string) => string | undefined;
            }
        ).getStateMachineState(hash);
        return state ?? null;
    }

    // step 4g - mirrors stateSnapshots.snapshotsByHash.size (for count-incr
    // assertions).
    async queryStateSnapshotCount(): Promise<number> {
        const snaps = this.record.stateManager.storage
            .stateSnapshots as unknown as {
            snapshotsByHash: Map<unknown, unknown>;
        };
        return snaps.snapshotsByHash.size;
    }

    // step 4l - mirrors StateQueryActions.getPreviousBlockHash inline body.
    async queryPreviousBlockHash(req: {
        forkId: ForkId;
        height?: number;
    }): Promise<string> {
        const ethersLite = await import("ethers");
        const storage = this.record.stateManager.storage;
        if (req.height !== undefined) {
            const previousBlockOrSnapshot = storage.getPreviousBlockOrSnapshot({
                forkId: req.forkId,
                height: req.height
            }) as unknown as {
                block?: { hash: string };
                stateSnapshot?: { hash: string };
            };
            return (
                previousBlockOrSnapshot.block?.hash ??
                previousBlockOrSnapshot.stateSnapshot!.hash
            );
        }
        const previousBlock = storage.blocks.getLatestBlock(req.forkId) as
            | { hash: string }
            | undefined;
        if (previousBlock?.hash) return String(previousBlock.hash);
        const genesis = (
            storage.stateSnapshots as unknown as {
                getGenesisSnapshotByForkId: (
                    f: unknown
                ) => { hash: string } | undefined;
            }
        ).getGenesisSnapshotByForkId(req.forkId);
        return String(genesis?.hash ?? ethersLite.ZeroHash);
    }

    // step 4m - mirrors StateQueryActions.getStateSnapshotHash inline body.
    async queryStateSnapshotHashForFork(req: {
        forkId: ForkId;
        previousBlockHash?: string;
    }): Promise<string> {
        const ethersLite = await import("ethers");
        const storage = this.record.stateManager.storage;
        if (req.previousBlockHash) {
            const block = (
                storage.blocks as unknown as {
                    getBlock: (
                        h: string
                    ) => { stateSnapshotHash: string } | undefined;
                }
            ).getBlock(req.previousBlockHash);
            if (block?.stateSnapshotHash) {
                return String(block.stateSnapshotHash);
            }
        }
        const genesis = (
            storage.stateSnapshots as unknown as {
                getGenesisSnapshotByForkId: (
                    f: unknown
                ) => { hash: string } | undefined;
            }
        ).getGenesisSnapshotByForkId(req.forkId);
        return String(genesis?.hash ?? ethersLite.ZeroHash);
    }

    // step 4n - mirrors storage.fraudProofs.getFraudProofForParticipant.
    async queryFraudProofForParticipant(
        addr: string
    ): Promise<{ proofType: number; participant: string } | null> {
        const storage = this.record.stateManager.storage as unknown as {
            fraudProofs: {
                getFraudProofForParticipant: (
                    a: string
                ) => { proofType: number; participant: string } | undefined;
            };
        };
        const fp = storage.fraudProofs.getFraudProofForParticipant(addr);
        if (!fp) return null;
        return {
            proofType: Number(fp.proofType),
            participant: String(fp.participant)
        };
    }

    // step 4o - mirrors storage.disputeFraudProofs.getDisputeFraudProofs.
    async queryDisputeFraudProofs(): Promise<Array<{ proofType: number }>> {
        const storage = this.record.stateManager.storage as unknown as {
            disputeFraudProofs: {
                getDisputeFraudProofs: () => Array<{ proofType: number }>;
            };
        };
        return storage.disputeFraudProofs
            .getDisputeFraudProofs()
            .map((p) => ({ proofType: Number(p.proofType) }));
    }

    // step 4p - mirrors storage.inboundMessages.{getLatestBlockHash,getLatestBlockHeight}.
    async queryInboundLatestBlockHash(): Promise<string | undefined> {
        const result =
            this.record.stateManager.storage.inboundMessages.getLatestBlockHash();
        return result ? String(result) : undefined;
    }

    async queryInboundLatestBlockHeight(): Promise<number | undefined> {
        const storage = this.record.stateManager.storage
            .inboundMessages as unknown as {
            getLatestBlockHeight: () => number | bigint | undefined;
        };
        const result = storage.getLatestBlockHeight();
        return result === undefined ? undefined : Number(result);
    }

    // step 4q - mirrors storage.timeout.storeTimeout(forkId, timeoutStruct).
    async storeTimeout(req: {
        forkId: ForkId;
        timeout: unknown;
    }): Promise<void> {
        const storage = this.record.stateManager.storage as unknown as {
            timeout: {
                storeTimeout: (forkId: unknown, t: unknown) => void;
            };
        };
        storage.timeout.storeTimeout(req.forkId, req.timeout);
    }

    // step 4q2 - mirrors storage.forceExit.setForceExit(value).
    async setForceExit(value: boolean): Promise<void> {
        const storage = this.record.stateManager.storage as unknown as {
            forceExit: { setForceExit: (v: boolean) => void };
        };
        storage.forceExit.setForceExit(value);
    }

    // step 4s - mirrors storage.timeout.getTimeout(forkId).
    async queryTimeoutForFork(forkId: ForkId): Promise<{
        participant: string;
        isForced: boolean;
        blockHeight?: string;
    } | null> {
        const storage = this.record.stateManager.storage as unknown as {
            timeout: {
                getTimeout: (f: unknown) =>
                    | {
                          participant: string;
                          isForced: boolean;
                          blockHeight?: bigint | number;
                      }
                    | undefined;
            };
        };
        const t = storage.timeout.getTimeout(forkId);
        if (!t) return null;
        return {
            participant: String(t.participant),
            isForced: Boolean(t.isForced),
            blockHeight:
                t.blockHeight !== undefined ? String(t.blockHeight) : undefined
        };
    }

    // step 4t - mirrors storage.disputes.getDisputeConfirmation(hash).
    async queryDisputeConfirmation(
        disputeHash: string
    ): Promise<unknown | null> {
        const storage = this.record.stateManager.storage as unknown as {
            disputes: {
                getDisputeConfirmation: (h: string) => unknown | undefined;
            };
        };
        return storage.disputes.getDisputeConfirmation(disputeHash) ?? null;
    }

    // step 4v - compute expected withdrawals delta in-peer.
    async computeExpectedWithdrawalsDelta(req: {
        upperBlockHash: string;
        lowerBlockHash?: string;
    }): Promise<{ amount: string; data: string }> {
        const sm = this.record.stateManager as unknown as {
            storage: {
                outboundMessages: {
                    getMessageBlocksInRange: (range: {
                        upperBlockHash: string;
                        lowerBlockHash?: string;
                    }) => Array<{
                        messages: Array<{
                            balance: { amount: bigint | number; data: string };
                        }>;
                    }>;
                };
            };
            diamondStateMachine: {
                getZeroBalance: () => Promise<{
                    amount: bigint;
                    data: string;
                }>;
                addBalance: (
                    a: { amount: bigint; data: string },
                    b: { amount: bigint | number; data: string }
                ) => Promise<{ amount: bigint; data: string }>;
            };
        };
        const blocks = sm.storage.outboundMessages.getMessageBlocksInRange(req);
        let total = await sm.diamondStateMachine.getZeroBalance();
        for (const block of blocks) {
            for (const message of block.messages) {
                total = await sm.diamondStateMachine.addBalance(
                    total,
                    message.balance
                );
            }
        }
        return { amount: String(total.amount), data: String(total.data) };
    }

    // step 4x - mirrors diamondStateMachine.subtractBalance(a, b).
    async subtractBalance(req: {
        a: { amount: string; data: string };
        b: { amount: string; data: string };
    }): Promise<{ amount: string; data: string }> {
        const sm = this.record.stateManager as unknown as {
            diamondStateMachine: {
                subtractBalance: (
                    a: { amount: bigint; data: string },
                    b: { amount: bigint; data: string }
                ) => Promise<{ amount: bigint; data: string }>;
            };
        };
        const r = await sm.diamondStateMachine.subtractBalance(
            { amount: BigInt(req.a.amount), data: req.a.data },
            { amount: BigInt(req.b.amount), data: req.b.data }
        );
        return { amount: String(r.amount), data: String(r.data) };
    }

    // step 4y - mirrors diamondStateMachine.areBalancesEqual(a, b).
    async areBalancesEqual(req: {
        a: { amount: string; data: string };
        b: { amount: string; data: string };
    }): Promise<boolean> {
        const sm = this.record.stateManager as unknown as {
            diamondStateMachine: {
                areBalancesEqual: (
                    a: { amount: bigint; data: string },
                    b: { amount: bigint; data: string }
                ) => Promise<boolean>;
            };
        };
        return await sm.diamondStateMachine.areBalancesEqual(
            { amount: BigInt(req.a.amount), data: req.a.data },
            { amount: BigInt(req.b.amount), data: req.b.data }
        );
    }

    // step 4w - mirrors lastMilestoneSnapshot from prepareUpdateSnapshotSameFork.
    async queryLastMilestoneSnapshot(
        forkId: ForkId
    ): Promise<unknown | undefined> {
        const result =
            await this.record.stateManager.prepareUpdateSnapshotSameFork(
                forkId
            );
        return result?.milestoneSnapshots.at(-1);
    }

    // step 4u - mirrors storage.disputes.getOpenDisputeForkIds().
    async queryOpenDisputeForkIds(): Promise<string[]> {
        const storage = this.record.stateManager.storage as unknown as {
            disputes: {
                getOpenDisputeForkIds?: () => string[];
            };
        };
        if (typeof storage.disputes.getOpenDisputeForkIds !== "function") {
            return [];
        }
        return storage.disputes.getOpenDisputeForkIds() ?? [];
    }

    // step 4r - mirrors storage.timeout.getTimeoutsForFork(forkId).
    async queryTimeoutsForFork(forkId: ForkId): Promise<unknown[]> {
        const storage = this.record.stateManager.storage as unknown as {
            timeout: { getTimeoutsForFork: (f: unknown) => unknown[] };
        };
        return storage.timeout.getTimeoutsForFork(forkId);
    }

    // step 4k - mirrors storage.blocks.getLatestBlock -> blockConfirmationStruct.
    async queryLatestBlockConfirmation(
        forkId: ForkId
    ): Promise<unknown | undefined> {
        const block = this.record.stateManager.storage.blocks.getLatestBlock(
            forkId
        ) as { blockConfirmationStruct: unknown } | undefined;
        if (!block) return undefined;
        return block.blockConfirmationStruct;
    }

    // step 4j - mirrors stateManager.isMyTurn?.().
    async queryIsMyTurn(): Promise<boolean> {
        const sm = this.record.stateManager as unknown as {
            isMyTurn?: () => boolean;
        };
        return sm.isMyTurn?.() ?? false;
    }

    // step 4h - mirrors stateManager.postStateSnapshot(forkId).
    async postStateSnapshot(forkId: ForkId): Promise<unknown> {
        return await this.record.stateManager.postStateSnapshot(forkId);
    }

    // step 4i - mirrors stateManager.prepareUpdateSnapshotSameFork(forkId).
    async prepareUpdateSnapshotSameFork(forkId: ForkId): Promise<
        | {
              callData: string[];
              expectedSnapshot: unknown;
              milestoneSnapshots: unknown[];
              milestoneProofs?: unknown[];
              outboundMessageBlocks?: unknown[];
          }
        | undefined
    > {
        const result =
            await this.record.stateManager.prepareUpdateSnapshotSameFork(
                forkId
            );
        if (!result) return undefined;
        return result as unknown as {
            callData: string[];
            expectedSnapshot: unknown;
            milestoneSnapshots: unknown[];
            milestoneProofs?: unknown[];
            outboundMessageBlocks?: unknown[];
        };
    }

    async queryStorageSnapshot(_req: unknown): Promise<unknown> {
        // step 1 - placeholder. real shape comes from W1 appendix A bucket (i)
        // "queryStorageSnapshot" entry once next agent migrates StateQueryActions
        // callers. inline body would be `storage.stateSnapshots.getByForkId(...)`
        // or `storage.stateMachineStates.getStateMachineState(...)` depending on
        // the req discriminator.
        throw new Error(
            "InlinePeer.queryStorageSnapshot: shape not pinned; awaiting caller migration"
        );
    }

    // step 4aa - mirrors disputeManager.constructDispute(forkId).
    async constructDispute(forkId: ForkId): Promise<{
        dispute: unknown;
        disputeConfirmation: unknown;
        auditingData: unknown;
        fraudProofsToApply: unknown[];
    }> {
        const sm = this.record.stateManager as unknown as {
            disputeManager: {
                constructDispute: (f: unknown) => Promise<{
                    dispute: unknown;
                    disputeConfirmation: unknown;
                    auditingData: unknown;
                    fraudProofsToApply: unknown[];
                }>;
            };
        };
        return await sm.disputeManager.constructDispute(forkId);
    }

    // step 4ab - mirrors storage.stateSnapshots.getGenesisSnapshotByForkId.
    // returns the struct (parity with worker route) so callers can read
    // snapshotData / forkId etc. uniformly. callers wanting the class wrapper
    // rehydrate via StateSnapshot.from on the returned struct.
    async queryGenesisSnapshot(forkId: ForkId): Promise<unknown | null> {
        const storage = this.record.stateManager.storage as unknown as {
            stateSnapshots: {
                getGenesisSnapshotByForkId: (
                    f: unknown
                ) => { toStruct: () => unknown } | undefined;
            };
        };
        const snapshot =
            storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        return snapshot?.toStruct() ?? null;
    }

    // step 4ad - mirrors localDiamondContract.getLatestBlockFromStateProof.
    // returns the full block struct so callers may mutate + re-encode.
    async queryLatestBlockFromStateProof(stateProof: unknown): Promise<{
        hasBlock: boolean;
        latestBlock: {
            transaction: {
                header: { transactionCnt: bigint | number | string };
            };
        } & Record<string, unknown>;
    }> {
        const sm = this.record.stateManager as unknown as {
            diamondStateMachine: {
                localDiamondContract: {
                    getLatestBlockFromStateProof: (
                        sp: unknown
                    ) => Promise<[boolean, unknown]>;
                };
            };
        };
        const [hasBlock, latestBlock] =
            await sm.diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                stateProof
            );
        return {
            hasBlock: Boolean(hasBlock),
            latestBlock: latestBlock as never
        };
    }

    // step 4ae - mirrors localDiamondContract.getDisputeWindows.
    async queryDisputeWindows(req: {
        channelId: string;
        forkIds: ForkId[];
    }): Promise<unknown[]> {
        const sm = this.record.stateManager as unknown as {
            diamondStateMachine: {
                localDiamondContract: {
                    getDisputeWindows: (
                        c: unknown,
                        f: unknown[]
                    ) => Promise<unknown[]>;
                };
            };
        };
        return await sm.diamondStateMachine.localDiamondContract.getDisputeWindows(
            req.channelId,
            req.forkIds
        );
    }

    // step 4af - mirrors localDiamondContract.getStateSnapshot(channelId).
    async queryLocalStateSnapshot(channelId: string): Promise<unknown> {
        const sm = this.record.stateManager as unknown as {
            diamondStateMachine: {
                localDiamondContract: {
                    getStateSnapshot: (c: unknown) => Promise<unknown>;
                };
            };
        };
        return await sm.diamondStateMachine.localDiamondContract.getStateSnapshot(
            channelId
        );
    }

    // step 4ac - mirrors disputeManager.getAuditingData(forkId, ...).
    async queryDisputeAuditingData(req: {
        forkId: ForkId;
        args?: unknown[];
    }): Promise<unknown> {
        const sm = this.record.stateManager as unknown as {
            disputeManager: {
                getAuditingData: (
                    f: unknown,
                    ...args: unknown[]
                ) => Promise<unknown>;
            };
        };
        return await sm.disputeManager.getAuditingData(
            req.forkId,
            ...(req.args ?? [])
        );
    }

    // step 4z - mirrors storage.getPreviousStateSnapshot({forkId, height}).
    // returns the struct (parity with worker route); callers read snapshotData
    // subfields directly. rehydrate via StateSnapshot.from when needed.
    async queryPreviousStateSnapshot(req: {
        forkId: ForkId;
        height: number;
    }): Promise<unknown | null> {
        const storage = this.record.stateManager.storage as unknown as {
            getPreviousStateSnapshot: (req: {
                forkId: unknown;
                height: number;
            }) => { toStruct: () => unknown } | undefined;
        };
        const snapshot = storage.getPreviousStateSnapshot(req);
        return snapshot?.toStruct() ?? null;
    }

    // step 1 - mirrors stateManager.applyTransaction(tx). req is the
    // serialisable TransactionStruct; returns { success, encodedState }.
    async applyTransaction(req: unknown): Promise<unknown> {
        const sm = this.record.stateManager as unknown as {
            applyTransaction: (
                tx: unknown
            ) => Promise<{ success: boolean; encodedState: string }>;
        };
        return await sm.applyTransaction(req);
    }

    // step 1 - mirrors stateManager.ingestBlockConfirmation(bc, opts).
    // req shape: { blockConfirmation: BlockConfirmationStruct,
    //              ingestOptions?: IngestBlockConfirmationOptions }.
    async ingestBlockConfirmation(req: unknown): Promise<boolean> {
        const { blockConfirmation, ingestOptions } = (req ?? {}) as {
            blockConfirmation: never;
            ingestOptions?: never;
        };
        return await this.record.stateManager.ingestBlockConfirmation(
            blockConfirmation,
            ingestOptions
        );
    }

    async dispose(): Promise<void> {
        // step 1 - paired with PeerTestHarness.cleanup which already iterates
        // peers calling p2pInstance.dispose. action-namespaces calling
        // peer.dispose() now route here.
        await this.record.p2pInstance.dispose();
    }

    // step 1 - W4 §reset. inline path -> sinon spies own the count; iterate
    // every spy slot and call resetHistory(). worker path uses the two-step
    // rpc + mirror.noteReset on WorkerPeer.
    async resetSpies(): Promise<void> {
        const spies = this.record.eventSpies as Record<
            string,
            { resetHistory?: () => void } | undefined
        >;
        for (const name of Object.keys(spies)) {
            spies[name]?.resetHistory?.();
        }
    }
}
