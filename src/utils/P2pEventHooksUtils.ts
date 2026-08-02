import ADiamondStateMachine from "@/ADiamondStateMachine";
import { Block } from "@/models";
import P2pEventHooks from "@/P2pEventHooks";
import Storage from "@/storage";
import { TimeConfig } from "@/types";
import {
    Address,
    BlockHeight,
    ChannelId,
    ForkId,
    Hash,
    Timestamp
} from "@/types/types";
import { addressesEqual, getChecksumAddress } from "@/utils/address";
import type { Logger } from "@/utils/logging";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

type NotifyDisputeUpdateOptions = {
    channelId: ChannelId;
    forkId: ForkId;
    storage: Storage;
    p2pEventHooks: P2pEventHooks;
    diamondStateMachine: ADiamondStateMachine;
    logger: Logger;
};

type MaybeNotifyBlockFinalizedOptions = {
    block: Block;
    storage: Storage;
    p2pEventHooks: P2pEventHooks;
    logger: Logger;
};

type NotifyBlockConfirmationProcessedOptions = {
    blockHash: Hash;
    keepConnection: boolean;
    p2pEventHooks: P2pEventHooks;
};

type NotifyTurnOptions = {
    nextToWrite: Address;
    nextBlockHeight: BlockHeight;
    relevantTimestamp: Timestamp;
    currentTimestamp: Timestamp;
    timeConfig: TimeConfig;
    p2pEventHooks: P2pEventHooks;
    logger: Logger;
};

export default class P2pEventHooksUtils {
    static async notifyDisputeUpdate({
        channelId,
        forkId,
        storage,
        p2pEventHooks,
        diamondStateMachine,
        logger
    }: NotifyDisputeUpdateOptions): Promise<void> {
        let disputeCommitments: Hash[];
        try {
            disputeCommitments =
                await diamondStateMachine.localDiamondContract.getWindowCommitments(
                    channelId,
                    forkId
                );
        } catch (error) {
            logger.debug("Skipping dispute update hook", {
                channelId,
                forkId,
                error: error instanceof Error ? error.message : String(error)
            });
            return;
        }

        const disputes: DisputeStruct[] = [];
        for (const commitment of disputeCommitments) {
            const dispute = storage.disputes.getDispute(commitment);
            if (!dispute) {
                logger.debug(
                    "Skipping missing local dispute in dispute update hook",
                    {
                        channelId,
                        forkId,
                        commitment
                    }
                );
                continue;
            }

            disputes.push(dispute);
        }

        if (disputes.length === 0) return;

        const slashes = new Set<Address>();
        let timeout: { participant: Address; minTimestamp: bigint } | undefined;

        for (const dispute of disputes) {
            for (const slash of dispute.input.onChainSlashes) {
                const address = P2pEventHooksUtils.getNonZeroAddress(slash);
                if (address) slashes.add(address);
            }

            const participant = P2pEventHooksUtils.getNonZeroAddress(
                dispute.input.timeout.participant
            );
            if (!participant) continue;

            const minTimestamp = BigInt(
                dispute.input.timeout.minTimeStamp.toString()
            );
            if (!timeout || minTimestamp < timeout.minTimestamp) {
                timeout = { participant, minTimestamp };
            }
        }

        const slashList = Array.from(slashes);
        try {
            p2pEventHooks.onDisputeUpdate?.(
                slashList,
                slashList.length > 0 ? undefined : timeout?.participant
            );
        } catch (error) {
            logger.debug("Dispute update hook failed", {
                channelId,
                forkId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    static maybeNotifyBlockFinalized({
        block,
        storage,
        p2pEventHooks,
        logger
    }: MaybeNotifyBlockFinalizedOptions): void {
        try {
            const participantsUnion = storage.getParticipantsUnion(
                block.coordinates,
                block.stateSnapshotHash
            );
            if (block.didEveryoneSign(participantsUnion)) {
                p2pEventHooks.onBlockFinalized?.();
            }
        } catch (error) {
            logger.debug("maybeNotifyBlockFinalized skipped", {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    static notifyBlockConfirmationProcessed({
        blockHash,
        keepConnection,
        p2pEventHooks
    }: NotifyBlockConfirmationProcessedOptions): void {
        p2pEventHooks.onBlockConfirmationProcessed?.(blockHash, keepConnection);
    }

    static notifyTurn({
        nextToWrite,
        nextBlockHeight,
        relevantTimestamp,
        currentTimestamp,
        timeConfig,
        p2pEventHooks,
        logger
    }: NotifyTurnOptions): void {
        logger.info(`onTurn signal txHeight: #${nextBlockHeight}`, {
            currentTimestamp,
            nextToWrite,
            nextBlockHeight,
            relevantTimestamp
        });

        // The StateManager's hooks object is a bus-publishing proxy, so this
        // one call also reaches every realm-local
        // `events.on("p2pEventHooks", "onTurn", ...)` subscriber.
        p2pEventHooks.onTurn?.(
            nextToWrite,
            timeConfig.p2pTime,
            timeConfig.agreementTime,
            timeConfig.chainFallbackTime,
            relevantTimestamp
        );
    }

    private static getNonZeroAddress(address: Address): Address | undefined {
        const normalized = getChecksumAddress(address);
        return addressesEqual(
            normalized,
            "0x0000000000000000000000000000000000000000"
        )
            ? undefined
            : normalized;
    }
}
