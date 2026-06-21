import { LocalDiamond, StateChannelManagerProxy } from "@typechain-types";
import { hexlify } from "ethers";

import { ChannelId } from "@/types/types";

import { EventHandler } from "@/eventHandlers/EventHandler";
import type { Logger } from "@/utils";

//TODO - made a PR to ethers.js to fix Deferred Topic Filter

class StateChannelEventListener {
    stateChannelManagerContract: StateChannelManagerProxy;
    eventHandler: EventHandler;
    localDiamondContract: LocalDiamond;
    private logger: Logger;
    private currentChannelKey?: string;
    private disposed = false;
    private subscriptionChain: Promise<void> = Promise.resolve();
    private seenLogs = new Set<string>();
    filters: Record<
        string,
        { filter: any; listener: (logObj: any) => Promise<void> }
    > = {};

    constructor(
        stateChannelManagerContract: StateChannelManagerProxy,
        eventHandler: EventHandler,
        localDiamondContract: LocalDiamond,
        logger: Logger
    ) {
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.eventHandler = eventHandler;
        this.localDiamondContract = localDiamondContract;
        this.logger = logger.child({ component: "EventListener" });
    }

    private createListener(
        key: string,
        handler: (logObj: any) => Promise<void>
    ) {
        return async (logObj: any) => {
            const logKey = this.getLogKey(key, logObj);
            if (logKey && this.seenLogs.has(logKey)) {
                this.logger.debug(`Duplicate on-chain event skipped - ${key}`, {
                    event: key,
                    logKey
                });
                return;
            }

            if (logKey) {
                this.seenLogs.add(logKey);
            }

            this.logger.info(`On-chain event received - ${key}`, {
                event: key,
                args: logObj?.args
            });
            return handler(logObj);
        };
    }

    private async removeAllListeners() {
        const filters = Object.values(this.filters);
        this.filters = {};

        await Promise.all(
            filters.map(({ filter, listener }) =>
                this.stateChannelManagerContract.off(filter, listener)
            )
        );
    }

    private getLogKey(key: string, logObj: any): string | undefined {
        const transactionHash =
            logObj?.transactionHash ?? logObj?.log?.transactionHash;
        const index = logObj?.index ?? logObj?.logIndex ?? logObj?.log?.index;
        if (!transactionHash || index === undefined) return undefined;

        return `${key}:${transactionHash}:${String(index)}`;
    }

    private getChannelKey(channelId: ChannelId): string {
        return typeof channelId === "string"
            ? channelId.toLowerCase()
            : hexlify(channelId).toLowerCase();
    }

    private async replaceChannelListeners(channelId: ChannelId) {
        if (this.disposed) return;

        const channelKey = this.getChannelKey(channelId);
        const eventCount = Object.keys(this.eventHandlers).length;
        if (
            this.currentChannelKey === channelKey &&
            Object.keys(this.filters).length === eventCount
        ) {
            return;
        }

        await this.removeAllListeners();
        this.seenLogs.clear();
        this.currentChannelKey = channelKey;

        if (this.disposed) return;

        for (const [key, { filterFactory, handler }] of Object.entries(
            this.eventHandlers
        )) {
            const filter = filterFactory(channelId);
            const listener = this.createListener(key, handler);
            await this.stateChannelManagerContract.on(filter, listener);

            if (this.disposed) {
                await this.stateChannelManagerContract.off(filter, listener);
                return;
            }

            this.filters[key] = { filter, listener };
        }
    }

    //Mark resources for garbage collection
    public async dispose() {
        this.disposed = true;
        await this.subscriptionChain.catch(() => undefined);
        await this.removeAllListeners();
        this.seenLogs.clear();
        this.currentChannelKey = undefined;
    }

    private readonly eventHandlers = {
        ChannelOpened: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.ChannelOpened(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, stateSnapshot, encodedState } = logObj.args;
                return this.eventHandler.onChannelOpened(
                    channelId,
                    stateSnapshot,
                    encodedState
                );
            }
        },
        StateSnapshotUpdated: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.StateSnapshotUpdated(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, stateSnapshot } = logObj.args;
                return this.eventHandler.onStateSnapshotUpdated(
                    channelId,
                    stateSnapshot
                );
            }
        },

        BlockCalldataPosted: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.BlockCalldataPosted(
                    channelId
                ),
            handler: (logObj: any) => {
                const {
                    channelId,
                    commitmentHash,
                    sender,
                    signedBlock,
                    timestamp
                } = logObj.args;
                return this.eventHandler.onBlockCalldataPosted(
                    channelId,
                    commitmentHash,
                    sender,
                    signedBlock,
                    timestamp
                );
            }
        },
        DisputeCommitted: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.DisputeCommitted(
                    channelId
                ),
            handler: (logObj: any) => {
                const {
                    channelId,
                    disputeConfirmation,
                    disputeCreationTimestamp,
                    isFinal,
                    windowCreationTimestamp
                } = logObj.args;

                return this.eventHandler.onDisputeCommitted(
                    channelId,
                    disputeConfirmation,
                    Number(disputeCreationTimestamp),
                    isFinal,
                    Number(windowCreationTimestamp)
                );
            }
        },
        ChainSlashed: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.ChainSlashed(
                    channelId
                ),
            handler: async (logObj: any) => {
                const { channelId, participant, timestamp } = logObj.args;
                return this.eventHandler.onChainSlashed(
                    channelId,
                    participant,
                    timestamp
                );
            }
        },
        DisputeReducedResultCommitted: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.DisputeReducedResultCommitted(
                    channelId
                ),
            handler: (logObj: any) => {
                const {
                    forkId,
                    channelId,
                    reducedForkId,
                    reductionTimestamp,
                    reducer
                } = logObj.args;
                return this.eventHandler.onDisputeReducedResultCommitted(
                    channelId,
                    forkId,
                    reducedForkId,
                    reductionTimestamp,
                    reducer
                );
            }
        },
        DisputeCommittedWithAuditingData: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.DisputeCommittedWithAuditingData(
                    channelId
                ),
            handler: (logObj: any) => {
                const {
                    channelId,
                    disputeConfirmation,
                    disputeCreationTimestamp,
                    isFinal,
                    windowCreationTimestamp,
                    disputeAuditingData
                } = logObj.args;
                return this.eventHandler.onDisputeCommitted(
                    channelId,
                    disputeConfirmation,
                    Number(disputeCreationTimestamp),
                    isFinal,
                    Number(windowCreationTimestamp),
                    disputeAuditingData
                );
            }
        },
        WithdrawalsUpdated: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.WithdrawalsUpdated(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, totalWithdrawals } = logObj.args;
                return this.eventHandler.onWithdrawalsUpdated(
                    channelId,
                    totalWithdrawals
                );
            }
        },
        ChannelStorageCleared: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.ChannelStorageCleared(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, latestInboundMessageBlockHash } =
                    logObj.args;
                return this.eventHandler.onChannelStorageCleared(
                    channelId,
                    latestInboundMessageBlockHash
                );
            }
        },
        DisputeKilled: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.DisputeKilled(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, forkId, disputer, disputeHash } =
                    logObj.args;
                return this.eventHandler.onDisputeKilled(
                    channelId,
                    forkId,
                    disputer,
                    disputeHash
                );
            }
        },

        InboundMessagesProcessed: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.InboundMessagesProcessed(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, messageBlock } = logObj.args;
                return this.eventHandler.onInboundMessagesProcessed(
                    channelId,
                    messageBlock
                );
            }
        }
    };

    public async setChannelId(channelId: ChannelId) {
        this.subscriptionChain = this.subscriptionChain.then(
            () => this.replaceChannelListeners(channelId),
            () => this.replaceChannelListeners(channelId)
        );
        await this.subscriptionChain;
    }
}

export default StateChannelEventListener;
