// W1 - PeerHandle interface + sub-handle shapes. one concrete shape consumed
// by every action namespace. two backends: InlinePeer (today's path), WorkerPeer
// (rpc proxy over W3).
//
// W0 D-3 - one polymorphic harness. PeerHandle is the polymorphism axis.
// W0 D-23 - byzantine, rpcStub, queryInternals, network are sub-handles.
//           one rpc method per existing inline action surface.
// W0 D-5 - action namespaces stay single-class; dispatch lives inside the
//          sub-handle (not the action class).

import type { Signer } from "ethers";
import type { Address, ForkId } from "@/types/types";
import type { Logger, EventBarrier } from "@/utils";
import type { EventSpies } from "./types";

// step 1 - data-path queries. uniform on both backends; worker mode forwards
// via W3 rpc. shapes are placeholder for the audit surface in W1 appendix A
// (next agent fleshes these out per real callers).
export type StateStatus = unknown;
export type BlockSummary = unknown;
export type ApplyTxRequest = unknown;
export type ApplyTxResult = unknown;
export type IngestBlockReq = unknown;

// step 1 - sub-handle support types. opaque tokens so worker mode can restore
// orchestrator-side captured state by id; inline mode resolves locally.
export type RestoreToken = { id: string };
export type ConnectionId = string;
export type ProfileSummary = {
    evmAddress: Address;
    connectionId: ConnectionId;
};
export type TransportSummary = {
    connectionId: ConnectionId;
    peerAddress: Address;
    kind: string;
};

// step 1 - per-action sub-handle interfaces. each method has one inline
// implementation (calls `record.stateManager.*` in-process) and one worker
// rpc forwarder (stub until next agent wires named handlers).

export interface ByzantineHandle {
    // step 1 - method substitution on state-manager internals.
    stubCalldataHandler(): Promise<void>;
    restoreCalldataHandler(): Promise<void>;
    stubPendingInboundInclusion(): Promise<void>;
    restorePendingInboundInclusion(): Promise<void>;
    stubBroadcast(): Promise<void>;
    // step 2 - synthesised + broadcasted misbehaviour. block construction is
    // orchestrator-side (D-15); worker routes receive serialised structs.
    submitDoubleSignBlock(req: SubmitDoubleSignReq): Promise<void>;
    // step 3 - generic broadcast. mirrors
    // remoteRpc.stateTransitionService.onBlockConfirmation(bc).broadcast().
    // used by submitInvalidStateTransitionBlock + variants which all share
    // the same broadcast tail. block construction is orchestrator-side.
    broadcastBlockConfirmation(req: {
        blockConfirmation: unknown;
    }): Promise<void>;
}

// step 1 - byzantine.submitDoubleSignBlock payload. block construction is
// orchestrator-side per D-15 -> the sub-handle receives the signed confirmation
// struct ready to broadcast. concrete shape uses `unknown` at the seam to keep
// PeerHandle.ts independent of generated typechain types; sub-handle bodies
// cast at the call site.
export type SubmitDoubleSignReq = {
    signedBlockConfirmation: unknown;
};

// step 1 - inline-closure rpc-stub handler signature. the closure IS the
// replacement method: in inline mode, it's installed verbatim onto the
// service's rpc methods object (called with the rpc methods instance as
// `this` + the positional args). in worker mode, the wrapped method calls
// back via "harness.invokeStubCallback" and the closure runs orchestrator-side
// with the args (no `this` available cross-thread).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RpcStubHandlerFn = (
    this: any,
    ...args: any[]
) => unknown | Promise<unknown>;

export interface RpcStubHandle {
    installCreateRpcMethodStub(
        serviceName: string,
        methodName: string,
        handler: RpcStubHandlerFn
    ): Promise<RestoreToken>;
    restoreCreateRpcMethodStub(req: {
        serviceName: string;
        methodName: string;
    }): Promise<void>;
    restoreAll(): Promise<void>;
}

export interface P2pInternalsHandle {
    openConnections(): Promise<TransportSummary[]>;
    getProfileByEvmAddress(addr: Address): Promise<ProfileSummary | undefined>;
    getProfileByConnectionId(
        connectionId: ConnectionId
    ): Promise<ProfileSummary | undefined>;
    connectionCount(): Promise<number>;
    // step 1a - cheap boolean read used by RPCActions.waitForHandshakeCompleted
    // (called inside a barrier predicate). avoids returning a live Profile.
    isHandshakeCompletedWith(otherAddr: Address): Promise<boolean>;
    // step 1 - peer self-address. used by orchestrator-side LocalDiscoveryServer
    // wiring (RPCActions:112, NetworkController:43, JoinActions:58). worker
    // returns serialisable address; live P2PManager never leaves the worker.
    self(): Promise<Address>;
    // step 2 - peer-side rpc service surface. worker dispatches the named op
    // against the in-thread service instance.
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
    // step 2 - invoke a `<service>.createRPCMethods(transport).<method>(...args)`
    // chain where transport is resolved in-thread by the other peer's evm
    // address. lets worker mode reach the live ATransport that orchestrator
    // cannot reference across the thread boundary (W1 D-23 §transport-id).
    callServiceWithTransport(req: {
        serviceName: string;
        methodName: string;
        otherAddr: Address;
        args: unknown[];
    }): Promise<unknown>;
    // step 3 - call `<service>.<method>(transport, ...args)` where transport
    // is resolved in-thread by otherAddr. for service-level methods that take
    // a live ATransport as the first arg (e.g. InitHandshakeService.initHandshake).
    callServiceMethodWithTransport(req: {
        serviceName: string;
        methodName: string;
        otherAddr: Address;
        args: unknown[];
    }): Promise<unknown>;
    // step 4 - peer scalar: preferred transport type enum (number).
    getPreferredTransportType(): Promise<number>;
    // step 5 - InitHandshakeService challenge lookup by peer addr. resolves
    // transport in-thread; returns serialisable { randomChallengeHash, initTime }
    // or undefined if no challenge stored for that peer's transport.
    getInitChallenge(otherAddr: Address): Promise<
        | {
              randomChallengeHash: string;
              initTime: number;
          }
        | undefined
    >;
    // step 6 - clear the InitHandshakeService challenge for the transport to
    // otherAddr. mirrors `service.mapTransportToChallenge.delete(transport)`.
    clearInitChallenge(otherAddr: Address): Promise<void>;
    // step 7 - serialisable transport status: present + isClosed.
    getTransportStatus(otherAddr: Address): Promise<{
        present: boolean;
        isClosed?: boolean;
    }>;
}

// step 1 - inline-closure disconnect-filter signature. predicate over the
// disconnectAndBlacklistPeerByEvmAddress(addr) callsite; true -> delegate to
// original, false -> short-circuit. closure runs orchestrator-side either
// way -> worker mode ships an opaque id + callbacks via bidirectional rpc.
export type DisconnectFilterFn = (
    message: unknown
) => boolean | Promise<boolean>;

// step 1 - generic method-stub closure. closure runs orchestrator-side with
// positional args; worker-side replacement method calls back via bidirectional
// rpc. used by tests that need to monkey-patch a state-manager method (or any
// dotted path off it). `this` is NOT bound cross-thread.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StubMethodFn = (...args: any[]) => unknown | Promise<unknown>;

export interface DebugHandle {
    // step 1 - replace stateManager[<path>] with the closure. dotted paths walk
    // intermediate objects; the last segment is the slot to overwrite. returns
    // a RestoreToken for cleanup via restoreStubbedMethod.
    stubMethod(path: string, fn: StubMethodFn): Promise<RestoreToken>;
    restoreStubbedMethod(token: RestoreToken): Promise<void>;
    restoreAllStubbedMethods(): Promise<void>;
}

export interface NetworkHandle {
    disconnectAll(): Promise<void>;
    tryOpenConnectionToChannel(channelId: string): Promise<void>;
    installDisconnectFilter(filter: DisconnectFilterFn): Promise<RestoreToken>;
    restoreDisconnectFilter(): Promise<void>;
}

// step 1 - peer-side channel lifecycle (connect, join). today's callers reach
// `peer.p2pInstance.p2pSigner.connectToChannel/joinChannel` directly; both
// surfaces live inside the peer, so worker mode routes through rpc here.
// payloads are serialisable structs (no live ethers objects).
export interface LifecycleHandle {
    // step 1 - mirrors P2pSigner.connectToChannel. used by openChannel +
    // addSpectator paths.
    connectToChannel(channelId: string): Promise<void>;
    // step 1 - mirrors P2pSigner.joinChannel. takes a fully serialisable
    // JoinChannelConfirmationStruct + the expected on-chain snapshot hash.
    joinChannel(req: {
        confirmation: unknown;
        expectedSnapshotHash: string;
    }): Promise<void>;
}

// step 1 - W1 §6 bucket (iii) - named-op transition surface. closures never
// cross the boundary; tests pass {op, args} where op is a stable string id
// registered with the worker bootstrap. lambdas in submitNext throw at runtime
// with a clear migration error (write-time lint is the permanent guardrail).
export type NamedOpRequest = {
    op: string;
    args?: unknown;
};

export interface TransitionHandle {
    // step 1 - run a named op. inline -> registry lookup runs in-process;
    // worker -> rpc 'transition.runOp' with the same id + args.
    submitNext(req: NamedOpRequest): Promise<unknown>;
}

export interface PeerHandle {
    // step 0 - backend discriminator. WorkerPeer sets to true; InlinePeer
    // leaves undefined. consumers branch off this instead of `as unknown as`
    // shape probes. keeps PeerHandle a single interface with one extra
    // optional brand field instead of a discriminated union of two classes.
    readonly __workerBackend?: true;

    // step 1 - identity. always sync. orchestrator-side per D-15.
    readonly index: number;
    readonly address: Address;
    readonly signer: Signer;
    readonly logger: Logger;

    // step 2 - spy mirror + barriers. inline -> real sinon; worker -> SpyMirror
    // (W4) populated by push frames. live fields either way.
    readonly eventSpies: EventSpies;
    readonly turnBarrier: EventBarrier;

    // step 3 - cached scalar (D-12). sync read; worker mode keeps cache fresh
    // via W4 `fork.changed` push.
    readonly forkId: ForkId | undefined;

    // step 4 - hot-path data queries.
    queryStatus(): Promise<StateStatus>;
    queryLatestBlock(forkId: ForkId): Promise<BlockSummary | undefined>;
    // step 4a2 - mirrors storage.blocks.getBlock(forkId, height). returns the
    // block summary (hash, height, author) or undefined. used by tamper closures
    // that need to read a specific block's author/height for dispute construction.
    queryBlockAt(req: { forkId: ForkId; height: number }): Promise<
        | {
              hash: string;
              height: number;
              author: Address;
          }
        | undefined
    >;
    // step 4a - diamondStateMachine read-throughs. worker mode -> rpc; inline
    // mode -> direct call on the live diamond. used by StateQueryActions to
    // pick the next writer / report participant count.
    queryNextToWrite(): Promise<Address>;
    queryParticipants(): Promise<Address[]>;
    // step 4b - agreementManager.didEveryoneSignBlock(block). worker mode
    // sends the serialised block hash + height; inline body matches the
    // SyncCoordinator.checkSync today path.
    queryDidEveryoneSignBlock(blockHash: string): Promise<boolean>;
    // step 4c - mirrors StateQueryActions.getLatestStateMachineStateHash.
    // returns null if the state isn't yet materialised in storage.
    queryLatestStateMachineStateHash(forkId: ForkId): Promise<string | null>;
    // step 4d - mirrors storage.blocks.getNextBlockHeight(forkId). returns the
    // next-to-write block height; 0 when no blocks exist on the fork.
    queryNextBlockHeight(forkId: ForkId): Promise<number>;
    // step 4e - mirrors storage.getStateSnapshot({forkId, height}). returns
    // serialisable snapshot summary (hash + stateMachineStateHash) or null
    // when no snapshot exists at the height. callers needing the full struct
    // can extend the returned shape; today's callers only read hash.
    queryStateSnapshotAt(req: { forkId: ForkId; height: number }): Promise<{
        hash: string;
        stateMachineStateHash: string;
        blockHeight: number;
    } | null>;
    // step 4f - mirrors storage.stateMachineStates.getStateMachineState(hash).
    // returns the raw encoded state machine state hex string, or null.
    queryStateMachineState(hash: string): Promise<string | null>;
    // step 4g - mirrors storage.stateSnapshots size for "count increased" assertions.
    queryStateSnapshotCount(): Promise<number>;
    // step 4j - mirrors stateManager.isMyTurn?.(). returns false if state
    // manager isn't initialised yet (early-boot path). used by waitForTurn.
    queryIsMyTurn(): Promise<boolean>;
    // step 4k - mirrors storage.blocks.getLatestBlock returning enough fields
    // for orchestrator-side Block reconstruction. ships the full
    // BlockConfirmationStruct (signedBlock + confirmation signatures) so the
    // caller can `Block.fromBlockConfirmation` and read every getter.
    queryLatestBlockConfirmation(forkId: ForkId): Promise<unknown | undefined>;
    // step 4k2 - mirrors storage.blocks.getBlock(forkId, height) but ships the
    // full BlockConfirmationStruct + onChainTimestamp so callers can
    // Block.fromBlockConfirmation and read every getter (signedBlock,
    // confirmationSignatures, blockConfirmationStruct, ...).
    queryBlockConfirmationAt(req: { forkId: ForkId; height: number }): Promise<
        | {
              blockConfirmation: unknown;
              onChainTimestamp?: number;
          }
        | undefined
    >;
    // step 4k3 - mirrors storage.blocks.getBlock(hash). returns the full
    // BlockConfirmationStruct + onChainTimestamp + raw confirmationSignatures
    // array so callers can either reconstruct a Block via Block.fromBlockConfirmation
    // or read scalars directly. undefined when no block exists at hash.
    queryBlockByHash(hash: string): Promise<
        | {
              blockConfirmation: unknown;
              onChainTimestamp?: number;
              confirmationSignatures: string[];
          }
        | undefined
    >;
    // step 4k4 - mirrors storage.queues.queueBlock(block). takes a
    // BlockConfirmationStruct + optional onChainTimestamp so the worker can
    // reconstruct the Block in-process and enqueue it.
    queueBlock(req: {
        blockConfirmation: unknown;
        onChainTimestamp?: number;
    }): Promise<void>;
    // step 4k5 - mirrors p2pManager.isBlacklisted(addr). cheap boolean read.
    isBlacklisted(addr: Address): Promise<boolean>;
    // step 4k6 - mirrors stateChannelManagerContract.postBlockCalldata
    // (signedBlock, maxTimestamp) + tx.wait(). on-chain write lives in the
    // peer's process so the contract reference never crosses the boundary.
    postBlockCalldata(req: {
        signedBlock: unknown;
        maxTimestamp: number;
    }): Promise<void>;
    // step 4l - mirrors StateQueryActions.getPreviousBlockHash. when height is
    // omitted, returns latestBlock.hash || genesisSnapshot.hash || ZeroHash.
    // when height is set, returns getPreviousBlockOrSnapshot({forkId,height})
    // -> block.hash or stateSnapshot.hash.
    queryPreviousBlockHash(req: {
        forkId: ForkId;
        height?: number;
    }): Promise<string>;
    // step 4m - mirrors StateQueryActions.getStateSnapshotHash. when
    // previousBlockHash is set, returns the block's stateSnapshotHash. when
    // not, returns the genesis snapshot hash for the fork (or ZeroHash).
    queryStateSnapshotHashForFork(req: {
        forkId: ForkId;
        previousBlockHash?: string;
    }): Promise<string>;
    // step 4n - mirrors storage.fraudProofs.getFraudProofForParticipant(addr).
    // returns the serialised fraud proof or null. used by AssertStorageActions.
    queryFraudProofForParticipant(addr: string): Promise<{
        proofType: number;
        participant: string;
    } | null>;
    // step 4o - mirrors storage.disputeFraudProofs.getDisputeFraudProofs().
    queryDisputeFraudProofs(): Promise<Array<{ proofType: number }>>;
    // step 4p - mirrors storage.inboundMessages.getLatestBlockHash() +
    // getLatestBlockHeight(). returns scalars.
    queryInboundLatestBlockHash(): Promise<string | undefined>;
    queryInboundLatestBlockHeight(): Promise<number | undefined>;
    // step 4q - mirrors storage.timeout.storeTimeout(forkId, timeoutStruct).
    storeTimeout(req: { forkId: ForkId; timeout: unknown }): Promise<void>;
    // step 4q2 - mirrors storage.forceExit.setForceExit(value). flips the
    // in-peer "i intend to leave" flag the dispute manager honours when
    // constructing a self-removal dispute.
    setForceExit(value: boolean): Promise<void>;
    // step 4r - mirrors storage.timeout.getTimeoutsForFork(forkId).
    queryTimeoutsForFork(forkId: ForkId): Promise<unknown[]>;
    // step 4s - mirrors storage.timeout.getTimeout(forkId). returns
    // serialised timeout struct or null.
    queryTimeoutForFork(forkId: ForkId): Promise<{
        participant: string;
        isForced: boolean;
        blockHeight?: string;
    } | null>;
    // step 4t - mirrors storage.disputes.getDisputeConfirmation(hash).
    queryDisputeConfirmation(disputeHash: string): Promise<unknown | null>;
    // step 4u - mirrors storage.disputes.getOpenDisputeForkIds().
    queryOpenDisputeForkIds(): Promise<string[]>;
    // step 4v - compute the expected withdrawals delta in-peer. mirrors
    // ContextActions.computeExpectedWithdrawalsDelta (outboundMessages walk
    // + diamondStateMachine.addBalance). returns serialised Balance struct.
    computeExpectedWithdrawalsDelta(req: {
        upperBlockHash: string;
        lowerBlockHash?: string;
    }): Promise<{ amount: string; data: string }>;
    // step 4w - mirrors prepareUpdateSnapshotSameFork(forkId).milestoneSnapshots
    // -> last entry only (the snapshot ContextActions uses as `lastSnapshot`).
    queryLastMilestoneSnapshot(forkId: ForkId): Promise<unknown | undefined>;
    // step 4x - mirrors diamondStateMachine.subtractBalance(a, b). returns
    // serialised Balance.
    subtractBalance(req: {
        a: { amount: string; data: string };
        b: { amount: string; data: string };
    }): Promise<{ amount: string; data: string }>;
    // step 4y - mirrors diamondStateMachine.areBalancesEqual(a, b).
    areBalancesEqual(req: {
        a: { amount: string; data: string };
        b: { amount: string; data: string };
    }): Promise<boolean>;
    // step 4z - mirrors storage.getPreviousStateSnapshot({forkId, height}).
    // returns serialised StateSnapshot or null.
    queryPreviousStateSnapshot(req: {
        forkId: ForkId;
        height: number;
    }): Promise<unknown | null>;
    // step 4aa - mirrors disputeManager.constructDispute(forkId). returns
    // the full serialisable result.
    constructDispute(forkId: ForkId): Promise<{
        dispute: unknown;
        disputeConfirmation: unknown;
        auditingData: unknown;
        fraudProofsToApply: unknown[];
    }>;
    // step 4ab - mirrors storage.stateSnapshots.getGenesisSnapshotByForkId.
    queryGenesisSnapshot(forkId: ForkId): Promise<unknown | null>;
    // step 4ac - mirrors disputeManager.getAuditingData(forkId, ...).
    queryDisputeAuditingData(req: {
        forkId: ForkId;
        args?: unknown[];
    }): Promise<unknown>;
    // step 4ad - mirrors localDiamondContract.getLatestBlockFromStateProof.
    // returns the full block struct; callers may mutate + re-encode.
    queryLatestBlockFromStateProof(stateProof: unknown): Promise<{
        hasBlock: boolean;
        latestBlock: {
            transaction: {
                header: { transactionCnt: bigint | number | string };
            };
        } & Record<string, unknown>;
    }>;
    // step 4ae - mirrors localDiamondContract.getDisputeWindows.
    queryDisputeWindows(req: {
        channelId: string;
        forkIds: ForkId[];
    }): Promise<unknown[]>;
    // step 4af - mirrors localDiamondContract.getStateSnapshot(channelId).
    // returns the raw struct (callers wrap via StateSnapshot.from).
    queryLocalStateSnapshot(channelId: string): Promise<unknown>;
    // step 4h - mirrors stateManager.postStateSnapshot(forkId). returns the
    // posted snapshot summary (hash + serialised fields) or undefined. used
    // by transition.postSnapshot in worker mode.
    postStateSnapshot(forkId: ForkId): Promise<unknown>;
    // step 4i - mirrors stateManager.prepareUpdateSnapshotSameFork(forkId).
    // returns the full struct (or undefined). callers may select subfields
    // (callData, expectedSnapshot, milestoneSnapshots, ...). worker mode
    // sends the struct as-is via structured clone.
    prepareUpdateSnapshotSameFork(forkId: ForkId): Promise<
        | {
              callData: string[];
              expectedSnapshot: unknown;
              milestoneSnapshots: unknown[];
              milestoneProofs?: unknown[];
              outboundMessageBlocks?: unknown[];
          }
        | undefined
    >;
    applyTransaction(req: ApplyTxRequest): Promise<ApplyTxResult>;
    ingestBlockConfirmation(req: IngestBlockReq): Promise<boolean>;

    // step 5 - sub-handles. per D-23, one rpc method per existing inline
    // action surface. inline backend runs the body in-process; worker
    // backend forwards via W3 rpc.
    readonly byzantine: ByzantineHandle;
    readonly rpcStub: RpcStubHandle;
    readonly queryInternals: P2pInternalsHandle;
    readonly network: NetworkHandle;
    // step 5c - debug surface for tests that need to monkey-patch a method on
    // the live stateManager (or any dotted path off it). today's callers used
    // `peer.stateManager.foo = ...` directly -> impossible cross-thread.
    readonly debug: DebugHandle;
    // step 5a - named-op transition surface (W0 D-11, D-22). closure-bearing
    // overloads migrate at test source from lambdas to op ids.
    readonly transition: TransitionHandle;
    // step 5b - peer-side channel lifecycle. connect / join. orchestrator-side
    // discovery wiring stays in NetworkController; the in-peer p2pSigner calls
    // route through here.
    readonly lifecycle: LifecycleHandle;

    // step 6 - disposal. inline -> P2pInstance.dispose. worker -> lifecycle rpc.
    dispose(): Promise<void>;

    // step 7 - W4 - spy reset. inline path calls sinon.SinonSpy.resetHistory()
    // on every spy. worker path is a two-step (rpc + mirror.noteReset) locked
    // inside the method body so callers see one atomic clear (W4 §reset).
    resetSpies(): Promise<void>;
}
