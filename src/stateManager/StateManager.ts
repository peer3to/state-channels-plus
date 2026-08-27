// External libraries
import { ethers, ZeroHash } from "ethers";

// TypeChain types - Data types
import { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";

// TypeChain types - Contract interfaces
import { StateChannelManagerInterface } from "@typechain-types";

// Core components
import AgreementManager from "../agreementManager/AgreementManager";
import ADiamondStateMachine from "@/ADiamondStateMachine";
import DisputeManager from "@/disputeManager";
import P2PManager from "@/P2PManager";
import StateChannelEventListener from "@/StateChannelEventListener";
import ValidationService from "./ingest/ValidationService";
import { ReductionManager } from "./reduction";
import {
    SnapshotUpdateService,
    StateApplicationService
} from "./snapshotUpdate";
import {
    BlockCommitService,
    BlockProductionService,
    SnapshotAssemblyService
} from "./block";
import { BlockIngestService, StoredBlockMergeService } from "./ingest";
import {
    CalldataPostingService,
    ParticipantTimeoutService
} from "./chainFallback";
import { MembershipService } from "./membership";
import Storage from "@/storage";
import { EventHandler } from "@/eventHandlers/EventHandler";

// Event handlers and processors
import P2pEventHooks from "@/P2pEventHooks";

// Models
import { StateSnapshot } from "@/models";

// Utils
import {
    DebugProxy,
    Mutex,
    Logger,
    DetachedPromises,
    createEthersResultProxy
} from "@/utils";
import type { MutexLockOptions, MutexUnlockOptions } from "@/utils";
// Types
import { Status, TimeConfig } from "@/types";
import { Address, ChannelId, ForkId, Hash } from "@/types/types";

import FraudProofService from "./utils/FraudProofService";
import DisputeValidationService from "./dispute/DisputeValidationService";
import AValidationStrategy from "./validationStrategy/AValidationStrategy";
import BlockValidationStrategy from "./validationStrategy/BlockValidationStrategy";
import SpectatingValidationStrategy from "./validationStrategy/SpectatingValidationStrategy";

import { config } from "@/utils/config";
import { TimeoutManager } from "@/utils/TimeoutManager";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { createBusPublishingHooks, EventBus } from "@/events/EventBus";
import MainRpcService from "@/rpc/MainRpcService";
import type { CustomRpcConstructor } from "@/rpc/registry";
import EventSyncService from "./eventSync/EventSyncService";
import BlockQueueManager from "./ingest/BlockQueueManager";

const NULL = ZeroHash;

class StateManager<
    TCustomRpc extends MainRpcService = MainRpcService,
    TCustomRpcOptions = undefined
> {
    diamondStateMachine: ADiamondStateMachine;
    p2pEventHooks: P2pEventHooks;
    signer: ethers.Signer;
    signerAddress: Address;
    agreementManager: AgreementManager;
    stateChannelEventListener: StateChannelEventListener;
    disputeManager: DisputeManager;
    stateChannelManagerContract: StateChannelManagerInterface;
    p2pManager: P2PManager<TCustomRpc>;
    timeConfig: TimeConfig;
    private _channelId: ChannelId = NULL;
    mutex: Mutex;
    self = config.DEBUG_STATE_MANAGER ? DebugProxy.createProxy(this) : this;
    isDisposed: boolean = false;
    validationService: ValidationService;
    disputeValidationService: DisputeValidationService;
    storage: Storage;
    fraudProofService: FraudProofService;
    private latestForkId: ForkId = NULL;
    blockValidationStrategy: BlockValidationStrategy;
    spectatingValidationStrategy: SpectatingValidationStrategy;
    eventHandler: EventHandler;
    private _status: Status = Status.NOT_OPENED;
    timeoutManager: TimeoutManager;
    logger: Logger;
    readonly eventSyncService: EventSyncService;
    blockQueueManager: BlockQueueManager;
    readonly reductionManager: ReductionManager;
    readonly snapshotUpdateService: SnapshotUpdateService;
    /** Realm subscription surface: p2p hooks, contract events, handler events. */
    readonly events: EventBus = new EventBus((kind, eventName, error) =>
        this.logger?.error("Event bus listener failed", {
            kind,
            eventName,
            error: error instanceof Error ? error.message : String(error)
        })
    );
    private appP2pEventHooks: P2pEventHooks;
    readonly stateApplicationService: StateApplicationService;
    readonly snapshotAssemblyService: SnapshotAssemblyService;
    readonly blockCommitService: BlockCommitService;
    readonly blockProductionService: BlockProductionService;
    readonly blockIngestService: BlockIngestService;
    readonly storedBlockMergeService: StoredBlockMergeService;
    readonly participantTimeoutService: ParticipantTimeoutService;
    readonly calldataPostingService: CalldataPostingService;
    readonly membershipService: MembershipService;
    private disposalPromise?: Promise<void>;

    constructor(
        signer: ethers.Signer,
        signerAddress: Address,
        stateChannelManagerContract: StateChannelManagerInterface,
        diamondStateMachine: ADiamondStateMachine,
        timeConfig: TimeConfig,
        p2pEventHooks: P2pEventHooks,
        storage: Storage,
        logger: Logger,
        customRpc?: CustomRpcConstructor<TCustomRpc, TCustomRpcOptions>,
        customRpcOptions?: TCustomRpcOptions
    ) {
        this.signer = signer;
        this.signerAddress = signerAddress;
        this.diamondStateMachine = diamondStateMachine;
        // Stable publishing proxy: every hook call anywhere in the runtime
        // publishes on `events` first, then forwards to the current app hooks.
        // Components capture this one object; setP2pEventHooks swaps only the
        // app target behind it.
        this.appP2pEventHooks = p2pEventHooks;
        this.p2pEventHooks = createBusPublishingHooks(
            this.events,
            () => this.appP2pEventHooks
        );
        this.timeConfig = timeConfig;
        this.stateChannelManagerContract = createEthersResultProxy(
            stateChannelManagerContract
        ) as StateChannelManagerInterface;
        this.storage = storage;

        this.logger = logger.child({ component: "StateManager" });
        this.mutex = new Mutex(
            this.logger.child({ component: "StateManager:Mutex" })
        );
        this.timeoutManager = new TimeoutManager(logger);

        this.eventHandler = new EventHandler(
            this.storage,
            this.self,
            this.p2pEventHooks,
            this.diamondStateMachine,
            logger
        );
        this.eventSyncService = new EventSyncService(
            this.channelId,
            this.stateChannelManagerContract,
            this.eventHandler,
            this.storage,
            this.timeConfig,
            logger
        );
        this.stateChannelEventListener = new StateChannelEventListener(
            this.stateChannelManagerContract,
            this.eventSyncService,
            logger
        );
        this.agreementManager = new AgreementManager(
            this.storage,
            this.eventSyncService,
            this.logger
        );
        this.disputeManager = new DisputeManager(
            this.channelId,
            signer,
            signerAddress,
            this.agreementManager,
            this.stateChannelManagerContract,
            this.p2pEventHooks,
            this.storage,
            this.diamondStateMachine,
            this.eventSyncService,
            logger
        );
        this.p2pManager = new P2PManager<TCustomRpc>(
            this.self,
            signer,
            customRpc,
            customRpcOptions
        );
        this.blockQueueManager = new BlockQueueManager(
            this.self,
            this.timeConfig,
            this.timeoutManager,
            this.logger
        );
        this.reductionManager = new ReductionManager(this.self, this.logger);
        this.snapshotUpdateService = new SnapshotUpdateService(
            this.self,
            this.logger
        );
        this.stateApplicationService = new StateApplicationService(
            this.self,
            this.logger
        );
        this.snapshotAssemblyService = new SnapshotAssemblyService(
            this.self,
            this.logger
        );
        this.blockCommitService = new BlockCommitService(
            this.self,
            this.logger
        );
        this.blockProductionService = new BlockProductionService(
            this.self,
            this.logger
        );
        this.blockIngestService = new BlockIngestService(
            this.self,
            this.logger
        );
        this.storedBlockMergeService = new StoredBlockMergeService(
            this.self,
            this.logger
        );
        this.participantTimeoutService = new ParticipantTimeoutService(
            this.self,
            this.logger
        );
        this.calldataPostingService = new CalldataPostingService(
            this.self,
            this.logger
        );
        this.membershipService = new MembershipService(this.self, this.logger);
        this.fraudProofService = new FraudProofService(
            this.storage,
            this.logger
        );
        this.validationService = new ValidationService(
            this.storage,
            this.diamondStateMachine,
            this.stateChannelManagerContract,
            this.timeConfig,
            this.eventSyncService,
            this.self,
            this.logger
        );
        this.disputeValidationService = new DisputeValidationService(this.self);
        this.blockValidationStrategy = new BlockValidationStrategy(
            this.storage,
            this.p2pManager,
            this.disputeManager,
            this.blockQueueManager,
            this.logger
        );
        this.spectatingValidationStrategy = new SpectatingValidationStrategy(
            this.storage,
            this.p2pManager,
            this.blockQueueManager,
            this.logger
        );
    }
    /**
     * General abort: give up participation in the current channel and tear down
     * P2P and chain resources. Used by any component/service that needs to stop
     * participating (slashed/removed by dispute resolution, unrecoverable sync
     * failure, race-condition join). We tear down the event listener so we no
     * longer track state — drop to OPENED (channel exists on-chain, not synced)
     * rather than SYNCED or NOT_OPENED.
     */
    public abort() {
        if (this.disposalPromise) return;
        // TODO: Abort should tear down the entire peer runtime and control port
        // so disposed peers cannot continue serving host RPC queries.
        this.logger.warn("Aborting channel participation", {
            channelId: this.channelId,
            status: Status[this.status]
        });
        this.p2pEventHooks.onAbort?.();
        this.setStatus(Status.OPENED);
        DetachedPromises.collect(this.dispose());
    }

    //Mark resources for garbage collection
    public dispose(): Promise<void> {
        if (this.disposalPromise) {
            return this.disposalPromise;
        }

        this.isDisposed = true;
        this.reductionManager.dispose();

        // Event handlers may still need the local EVM while draining already
        // scheduled contract logs. Dispose their dependencies only afterward.
        this.disposalPromise = (async () => {
            // The custom RPC root disposes first so it can settle waits that
            // depend on the timeout manager and p2p below. A broken root must
            // never skip runtime teardown: its error is captured and rethrown
            // only after the remaining cleanup finished.
            let customRpcError: Error | undefined;
            try {
                await this.p2pManager.localRpc.dispose();
            } catch (error) {
                customRpcError =
                    error instanceof Error ? error : new Error(String(error));
            }
            try {
                await this.stateChannelEventListener.dispose();
            } finally {
                // Drain scheduled work (queued block applications) before its
                // dependencies disappear: a queued entry mid-execution still
                // needs the EVM executor and p2p below. The drain is bounded
                // by the timeout manager's dispose wait.
                await this.timeoutManager.dispose();
                await Promise.all([
                    this.p2pManager.dispose(),
                    this.diamondStateMachine.dispose()
                ]);
            }
            if (customRpcError) {
                throw customRpcError;
            }
        })().finally(() => {
            this.logger.dispose({
                cascadeChildren: true,
                cascadeParent: true
            });
        });
        return this.disposalPromise;
    }
    public setP2pEventHooks(p2pEventHooks: P2pEventHooks) {
        this.appP2pEventHooks = p2pEventHooks;
    }

    /**
     * High-level status for SDK consumers.
     *
     * - NOT_OPENED: channel not opened on-chain
     * - OPENED: opened on-chain but local node not yet synced (no fork id)
     * - SYNCED: opened on-chain and locally synced, but signer is not a participant
     * - PARTICIPATING: opened on-chain, locally synced, and signer is a participant
     */
    public get status(): Status {
        return this._status;
    }

    public setStatus(status: Status) {
        const oldStatus = this._status;
        if (oldStatus === status) {
            return;
        }
        this.logger.debug("Status changed", {
            oldStatus: Status[oldStatus] ?? `UNKNOWN(${oldStatus})`,
            newStatus: Status[status] ?? `UNKNOWN(${status})`
        });
        this._status = status;
        this.p2pEventHooks.onStatusChanged?.(oldStatus, status);
    }
    /**
     * Refreshes the status from on-chain `isChannelOpen(channelId)`.
     *
     * Intended for the early lifecycle where we know the channelId (e.g. after
     * `connectToChannel`) but we haven't synced/appplied the genesis snapshot yet.
     */
    public async refreshOpenedStatusFromChain(): Promise<Status> {
        if (!this.channelId || this.channelId === NULL) {
            this.setStatus(Status.NOT_OPENED);
            return this.status;
        }

        try {
            const [isOpen, snapshotStruct] =
                await this.stateChannelManagerContract.isChannelOpen(
                    this.channelId
                );

            if (isOpen) {
                // Best-effort cache: store the latest on-chain snapshot in LocalDiamond
                try {
                    await this.diamondStateMachine.localDiamondContract.onStateSnapshotUpdated(
                        this.channelId,
                        snapshotStruct,
                        0,
                        0
                    );
                    const snapshotMeta = LoggerUtils.getSnapshotMetadata(
                        StateSnapshot.from(snapshotStruct)
                    );
                    this.logger.debug(
                        "Cached on-chain snapshot in LocalDiamond",
                        snapshotMeta
                    );
                } catch {
                    // ignore caching errors
                }
            }

            if (!isOpen) {
                this.setStatus(Status.NOT_OPENED);
                return this.status;
            }

            // Only move to OPENED if we haven't already synced/applied state.
            if (this.status === Status.NOT_OPENED) {
                this.setStatus(Status.OPENED);
            }
        } catch {
            // Best-effort: don't flip status on transient RPC errors.
        }

        return this.status;
    }
    public get channelId(): ChannelId {
        return this._channelId;
    }

    public async setChannelId(channelId: ChannelId): Promise<void> {
        this.logger.verbose("Setting channel ID", { channelId });
        this._channelId = channelId;
        this.logger.updateSharedContext({ channelId: String(channelId) });
        this.disputeManager.setChannelId(channelId);
        this.eventSyncService.setChannelId(channelId);
        await this.stateChannelEventListener.setChannelId(channelId);
    }
    public getParticipantsCurrent(): Promise<Address[]> {
        return this.diamondStateMachine.getParticipants();
    }
    public get forkId(): ForkId {
        return this.latestForkId;
    }
    public set forkId(forkId: ForkId) {
        if (this.latestForkId !== forkId) {
            // Queue recovery gates are tied to the active fork. Reduction
            // operations and their kill-period observations remain fork-scoped.
            this.blockQueueManager.onForkTransition();
        }
        this.latestForkId = forkId;
    }

    public async onInboundMessage(
        messageBlock: MessageBlockStruct,
        messageBlockHash: Hash
    ) {
        this.storage.inboundMessages.store(messageBlock, {
            hash: messageBlockHash
        });
    }

    public async withMutex<T>(
        fn: () => T | Promise<T>,
        options?: MutexLockOptions,
        unlockOptions?: MutexUnlockOptions
    ): Promise<T> {
        await this.mutex.lock(options);
        try {
            return await fn();
        } finally {
            this.mutex.unlock(unlockOptions);
        }
    }

    public getActiveValidationStrategy(): AValidationStrategy {
        return this.getStrategyByStatus(this.status);
    }

    private getStrategyByStatus(status: Status): AValidationStrategy {
        if (status === Status.PARTICIPATING) {
            return this.blockValidationStrategy;
        }
        return this.spectatingValidationStrategy;
    }
}
export default StateManager;
