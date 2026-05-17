import { StateChannelManagerProxy } from "@typechain-types";

import Clock from "@/Clock";
import { EventHandler } from "@/eventHandlers/EventHandler";
import { OnChainBlockStatus, TimeConfig } from "@/types";
import {
    Address,
    BlockCalldata,
    BlockHeight,
    ChannelId,
    ForkId,
    Hash
} from "@/types/types";
import { DetachedPromises, Logger } from "@/utils";

export default class BlockDataAvailabilityService {
    // Key format: `${forkId}:${blockHeight}:${lowercaseBlockAuthor}`.
    private readonly pendingOnChainBlockValidationKeys = new Set<string>();
    private readonly processedOnChainBlockValidationKeys = new Set<string>();
    private readonly logger: Logger;

    constructor(
        private channelId: ChannelId,
        private readonly stateChannelManagerContract: StateChannelManagerProxy,
        private readonly eventHandler: EventHandler,
        private readonly timeConfig: TimeConfig,
        logger: Logger
    ) {
        this.logger = logger.child({
            component: "BlockDataAvailabilityService"
        });
    }

    setChannelId(channelId: ChannelId): void {
        this.channelId = channelId;
    }

    shouldDeferCurrentValidation(status: OnChainBlockStatus): boolean {
        return (
            status === OnChainBlockStatus.SCHEDULED ||
            status === OnChainBlockStatus.ALREADY_SCHEDULED
        );
    }

    async tryFetchOnChainBlockAndScheduleValidation(
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address
    ): Promise<OnChainBlockStatus> {
        const validationKey = this.getOnChainBlockValidationKey(
            forkId,
            blockHeight,
            blockAuthor
        );

        if (this.pendingOnChainBlockValidationKeys.has(validationKey)) {
            return OnChainBlockStatus.ALREADY_SCHEDULED;
        }

        if (this.processedOnChainBlockValidationKeys.has(validationKey)) {
            return OnChainBlockStatus.ALREADY_PROCESSED;
        }

        this.pendingOnChainBlockValidationKeys.add(validationKey);

        try {
            const commitmentResult =
                await this.stateChannelManagerContract.getBlockCallDataCommitment(
                    this.channelId,
                    forkId,
                    blockHeight,
                    blockAuthor
                );
            if (!commitmentResult.found) {
                this.pendingOnChainBlockValidationKeys.delete(validationKey);
                return OnChainBlockStatus.NOT_FOUND;
            }

            const fetchedCalldata = await this.fetchBlockCommitmentCalldata(
                commitmentResult.blockCalldataCommitment
            );

            if (!fetchedCalldata) {
                this.pendingOnChainBlockValidationKeys.delete(validationKey);
                return OnChainBlockStatus.NOT_FOUND;
            }

            const validationPromise = this.eventHandler
                .onBlockCalldataPosted(
                    this.channelId,
                    commitmentResult.blockCalldataCommitment,
                    blockAuthor,
                    fetchedCalldata.signedBlock,
                    fetchedCalldata.onChainTimestamp
                )
                .catch((error) => {
                    this.logger.error(
                        "tryFetchOnChainBlockAndScheduleValidation - scheduled validation failed",
                        {
                            forkId,
                            blockHeight,
                            blockAuthor,
                            error
                        }
                    );
                })
                .finally(() => {
                    this.pendingOnChainBlockValidationKeys.delete(
                        validationKey
                    );
                    this.processedOnChainBlockValidationKeys.add(validationKey);
                });

            DetachedPromises.collect(validationPromise);

            return OnChainBlockStatus.SCHEDULED;
        } catch (error) {
            this.pendingOnChainBlockValidationKeys.delete(validationKey);
            this.logger.error(
                `Error tryFetchOnChainBlockAndScheduleValidation:`,
                { error }
            );
            return OnChainBlockStatus.NOT_FOUND;
        }
    }

    private getOnChainBlockValidationKey(
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address
    ): string {
        return `${String(forkId)}:${blockHeight}:${String(blockAuthor).toLowerCase()}`;
    }

    private async fetchBlockCommitmentCalldata(
        blockCommitment: Hash
    ): Promise<BlockCalldata | undefined> {
        try {
            const filter =
                this.stateChannelManagerContract.filters.BlockCalldataPosted(
                    this.channelId,
                    blockCommitment
                );

            const latestBlock =
                await this.stateChannelManagerContract.runner?.provider?.getBlockNumber();
            if (!latestBlock) {
                const message =
                    "fetchBlockCommitmentCalldata - Unable to fetch latest block number from provider";
                this.logger.error(message);
                throw new Error(message);
            }
            const avgBlockTime = Clock.getAverageOnChainBlockTime();
            const maxTime =
                this.timeConfig.p2pTime +
                this.timeConfig.agreementTime +
                this.timeConfig.chainFallbackTime;
            const blocksToLookBack = Math.ceil(maxTime / avgBlockTime) * 2;
            const fromBlock = Math.max(0, latestBlock - blocksToLookBack);

            const logs = await this.stateChannelManagerContract.queryFilter(
                filter,
                fromBlock,
                "latest"
            );

            if (logs.length == 0) {
                return undefined;
            }
            if (logs.length > 1) {
                throw new Error(
                    `Multiple logs found for commitment: ${blockCommitment} - logs: ${logs}`
                );
            }

            const signedBlock = {
                encodedBlock: logs[0].args.signedBlock.encodedBlock,
                signature: logs[0].args.signedBlock.signature
            };

            return {
                signedBlock,
                onChainTimestamp: Number(logs[0].args.timestamp)
            };
        } catch (error) {
            this.logger.error(`Error fetchBlockCommitmentCalldata:`, { error });
            return undefined;
        }
    }
}
