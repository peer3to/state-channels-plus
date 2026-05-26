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
    LifecycleHandle,
    NamedOpRequest,
    NetworkHandle,
    P2pInternalsHandle,
    PeerHandle,
    ProfileSummary,
    RestoreToken,
    RpcStubHandle,
    SubmitDoubleSignReq,
    TransitionHandle,
    TransportSummary
} from "./PeerHandle";
import { getOp } from "../threaded/worker/opsRegistry";
import {
    getRpcStubHandler,
    type RpcStubHandler
} from "../worker-handlers/rpc-stub-handlers";
import {
    getDisconnectFilter,
    type DisconnectFilter
} from "../worker-handlers/disconnect-filters";
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
}

class InlineRpcStubHandle implements RpcStubHandle {
    // step 1 - per-peer restore map. keyed by "<serviceName>:<methodName>"
    // (one slot per stubbed method), matching the worker route's table.
    private readonly restoresByKey = new Map<string, () => void>();

    constructor(private readonly record: TestPeer) {}

    // step 1 - mirror of subHandleRoutes "rpcStub.installCreateRpcMethodStub"
    // body running against record.stateManager.p2pManager.localRpc. handler
    // body is resolved against the shared named registry; same registry the
    // worker isolate imports at boot.
    async installCreateRpcMethodStub(req: {
        serviceName: string;
        methodName: string;
        handlerId: string;
        handlerArgs?: unknown;
    }): Promise<RestoreToken> {
        const { serviceName, methodName, handlerId, handlerArgs } = req;
        const handler: RpcStubHandler = getRpcStubHandler(handlerId);
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
            methods[methodName] = async function (
                this: unknown,
                ...callArgs: unknown[]
            ) {
                return await handler({
                    thisCtx: this,
                    args: callArgs,
                    handlerArgs
                });
            };
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
        // stateManager. same body as the worker route (one impl, two paths).
        const fn = getOp(req.op);
        const ctx = {
            getStateManager: () => this.record.stateManager as unknown
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

    // step 1 - mirror of subHandleRoutes "network.installDisconnectFilter" body
    // running against record.stateManager.p2pManager. filter body resolved
    // against the shared named-filter registry.
    async installDisconnectFilter(req: {
        filterId: string;
        args?: unknown;
    }): Promise<RestoreToken> {
        const filter: DisconnectFilter = getDisconnectFilter(req.filterId);
        const pm = this.record.stateManager.p2pManager as unknown as {
            disconnectAndBlacklistPeerByEvmAddress: (addr: string) => unknown;
        };
        const original = pm.disconnectAndBlacklistPeerByEvmAddress.bind(pm);
        // step 1 - if a prior filter is live, restore first -> wrap clean.
        this.filterRestore?.();

        pm.disconnectAndBlacklistPeerByEvmAddress = (async (addr: string) => {
            const allow = await filter({
                address: addr,
                filterArgs: req.args
            });
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

export class InlinePeer implements PeerHandle {
    readonly byzantine: ByzantineHandle;
    readonly rpcStub: RpcStubHandle;
    readonly queryInternals: P2pInternalsHandle;
    readonly network: NetworkHandle;
    readonly transition: TransitionHandle;
    readonly lifecycle: LifecycleHandle;

    constructor(public readonly record: TestPeer) {
        this.byzantine = new InlineByzantineHandle(record);
        this.rpcStub = new InlineRpcStubHandle(record);
        this.queryInternals = new InlineP2pInternalsHandle(record);
        this.network = new InlineNetworkHandle(record);
        this.transition = new InlineTransitionHandle(record);
        this.lifecycle = new InlineLifecycleHandle(record);
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

    async applyTransaction(_req: unknown): Promise<unknown> {
        throw new Error(
            "InlinePeer.applyTransaction: shape not pinned; awaiting caller migration " +
                "(TransitionActions.submitNext data-path)"
        );
    }

    async ingestBlockConfirmation(_req: unknown): Promise<boolean> {
        throw new Error(
            "InlinePeer.ingestBlockConfirmation: shape not pinned; awaiting caller migration"
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
