import { TransactionResponse } from "ethers";

import Clock from "@/Clock";
import { timeoutWaitTime } from "@/types";
import { Hash } from "@/types/types";
import { DetachedPromises, Logger } from "@/utils";
import {
    tryDecodeCustomError,
    tryHandleEvmError
} from "@/utils/evmErrorHandler";
import { LoggerUtils } from "@/utils/LoggerUtils";

import type StateManager from "../StateManager";

/**
 * Posts my authored block's calldata on-chain when not everyone signed it, so
 * the writer's turn is provably taken and no peer can time me out.
 */
export default class CalldataPostingService {
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "CalldataPosting" });
    }

    public maybePostBlockOnChain(blockHash: Hash) {
        const sm = this.stateManager;
        // Retrieve the latest version of the block from storage (with all collected signatures)
        const block = sm.storage.blocks.getBlock(blockHash);
        if (!block) {
            return;
        }
        // If not everyone has signed, do the on-chain post
        const participants = sm.storage.getParticipantsUnion(
            block.coordinates,
            block.stateSnapshotHash
        );

        // TODO - this can be race conditioned and we could be granted extra time, but we don't care to check that on-chain and will assume we're not granted extra time for this
        const previousRelevantTimestamp =
            sm.storage.getPreviousRelevantTimestamp(
                block.coordinates,
                block.author
            );

        if (!block.didEveryoneSign(participants)) {
            sm.p2pEventHooks.onPostingCalldata?.();

            const maxTimestamp =
                previousRelevantTimestamp +
                timeoutWaitTime(sm.timeConfig, block.height);

            const blockMetadata = LoggerUtils.getBlockMetadata(
                block,
                sm.storage
            );
            const currentTime = Clock.getTimeInSeconds();
            this.logger.info(
                `Posting block calldata on-chain #${blockMetadata.blockHeight}`,
                {
                    block: blockMetadata,
                    maxTimestamp,
                    currentTime
                }
            );

            let txResponse: TransactionResponse;
            const txResponsePromise = sm.stateChannelManagerContract
                .postBlockCalldata(block.signedBlock, maxTimestamp)
                .then((tx) => {
                    txResponse = tx;
                    const txReceiptPromise = txResponse.wait();
                    DetachedPromises.collect(txReceiptPromise);
                    return txReceiptPromise;
                })
                .catch(async (error) => {
                    const success = await tryHandleEvmError(error, {
                        logger: this.logger,
                        signer: sm.signer,
                        tx: txResponse!,
                        handlers: {
                            RaceConditionBlockCalldataTimestampTooLate:
                                async () => {
                                    const localErrorTimestamp =
                                        Clock.getTimeInSeconds();
                                    const currentOnChainTimestamp =
                                        await Clock.getBlockchainTime();
                                    this.logger.warn(
                                        "RaceConditionBlockCalldataTimestampTooLate",
                                        {
                                            localErrorTimestamp,
                                            maxTimestamp,
                                            currentOnChainTimestamp,
                                            previousRelevantTimestamp,
                                            block: blockMetadata
                                        }
                                    );
                                }
                        }
                    });
                    //
                    if (success) return;
                    const custom = tryDecodeCustomError(error);
                    this.logger.error(
                        "Posting block calldata ERROR",
                        custom, // tryHandleEvmError already logged the custom error if not null
                        error
                    );
                });
            DetachedPromises.collect(txResponsePromise);
        }
    }
}
