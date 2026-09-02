import type {
    JoinChannelConfirmationStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { isError } from "ethers";

import Clock from "@/Clock";
import { Block, StateSnapshot } from "@/models";
import type { ParticipantChanges } from "../block/SnapshotAssemblyService";
import { Status } from "@/types";
import { Address, ChannelId, ForkId, Hash } from "@/types/types";
import { addressesEqual, Logger, union } from "@/utils";
import { tryDecodeCustomError } from "@/utils/evmErrorHandler";

import type StateManager from "../StateManager";

/**
 * The membership domain: the channel's participant union (on-chain current +
 * pending), and my own lifecycle in it — joining, topping up, forcing a join
 * that peers refuse to include, and exiting once I have left the participant
 * set.
 */
export default class MembershipService {
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "Membership" });
    }

    public async getOnChainParticipantUnion(
        channelId: ChannelId = this.stateManager.channelId
    ): Promise<Address[]> {
        const sm = this.stateManager;
        const [participants, pendingParticipants] = await Promise.all([
            sm.stateChannelManagerContract.getParticipants(channelId),
            sm.stateChannelManagerContract.getPendingParticipants(channelId)
        ]);
        return [
            ...union(new Set(participants), new Set(pendingParticipants))
        ].map(String) as Address[];
    }

    public async getOnChainThresholdSet(
        channelId: ChannelId = this.stateManager.channelId
    ): Promise<Address[]> {
        return (
            await this.stateManager.stateChannelManagerContract.getOnChainThresholdSet(
                channelId
            )
        ).map(String) as Address[];
    }

    public async joinChannel(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<boolean> {
        const sm = this.stateManager;
        if (sm.status !== Status.SYNCED) {
            throw new Error(
                `joinChannel requires SYNCED status, got ${Status[sm.status]}`
            );
        }

        const joinSubmissionHeight =
            sm.storage.blocks.getNextBlockHeight(sm.forkId) - 1;
        sm.storage.forceJoin.setJoinSubmissionBlockHeight(joinSubmissionHeight);
        this.logger.info(
            "joinChannel - recorded force join submission height",
            { joinSubmissionHeight }
        );
        sm.setStatus(Status.PENDING_PARTICIPANT);
        this.logger.info(
            "joinChannel - promoted to PENDING_PARTICIPANT before submission"
        );

        try {
            const tx = await sm.stateChannelManagerContract.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            );
            await tx.wait();
            return true;
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            if (
                custom?.name === "ErrorJoinChannelParticipantAlreadyExists" &&
                sm.storage.forceJoin.getJoinSubmissionBlockHeight() !==
                    undefined
            ) {
                this.logger.warn(
                    "joinChannel - participant already exists; preserving pending join state"
                );
                return true;
            }

            const failedReceipt =
                isError(error, "CALL_EXCEPTION") &&
                error.receipt !== null &&
                error.receipt !== undefined &&
                Number(error.receipt.status) === 0;
            const commitmentRuledOut = custom !== null || failedReceipt;
            if (!commitmentRuledOut) {
                try {
                    const participantUnion =
                        await this.getOnChainParticipantUnion();
                    if (
                        participantUnion.some((participant) =>
                            addressesEqual(participant, sm.signerAddress)
                        )
                    ) {
                        this.logger.warn(
                            "joinChannel - submission outcome was uncertain but on-chain membership is present"
                        );
                        return true;
                    }
                } catch (reconciliationError) {
                    this.logger.warn(
                        "joinChannel - failed to reconcile uncertain submission",
                        {
                            error:
                                reconciliationError instanceof Error
                                    ? reconciliationError.message
                                    : String(reconciliationError)
                        }
                    );
                }
                this.logger.warn(
                    "joinChannel - submission outcome uncertain; preserving pending state",
                    {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    }
                );
                return false;
            }

            sm.setStatus(Status.SYNCED);
            sm.storage.forceJoin.clear();
            switch (custom?.name) {
                case "RaceConditionJoinChannelExpired":
                case "RaceConditionSnapshotForkMismatch":
                case "RaceConditionJoinChannelSnapshotMismatch":
                case "RaceConditionForceInboundJoinForkDisputed":
                case "ErrorJoinChannelInvalidSignature":
                    this.logger.warn(
                        `joinChannel - race condition: ${custom.name}`,
                        {
                            name: custom.name,
                            args: custom.errorDescription.args
                        }
                    );
                    sm.abort();
                    return false;
            }
            this.logger.warn("joinChannel - tx failed, reverting to SYNCED", {
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    public async topUpBalance(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<boolean> {
        const sm = this.stateManager;
        if (
            sm.status !== Status.PARTICIPATING &&
            sm.status !== Status.PENDING_PARTICIPANT
        ) {
            throw new Error(
                `topUpBalance requires PARTICIPATING or PENDING_PARTICIPANT status, got ${Status[sm.status]}`
            );
        }

        try {
            const tx = await sm.stateChannelManagerContract.topUpBalance(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            );
            await tx.wait();
            return true;
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            if (custom) {
                this.logger.warn(`topUpBalance failed: ${custom.name}`, {
                    name: custom.name,
                    args: custom.errorDescription.args
                });
                return false;
            }
            return false;
        }
    }

    // Fires the force-join dispute exactly once when N turns have passed without the joiner being included
    public async maybeInitiateForceJoinDispute(
        block: Block,
        participants: Address[]
    ): Promise<void> {
        const sm = this.stateManager;
        const joinSubmissionHeight =
            sm.storage.forceJoin.getJoinSubmissionBlockHeight();
        if (joinSubmissionHeight === undefined) return;
        const N = participants.length + 1;
        const fireOnBlockHeight = joinSubmissionHeight + N;
        if (
            block.height < fireOnBlockHeight ||
            sm.storage.forceJoin.hasDisputeStarted()
        )
            return;

        let onChainParticipantUnion: Address[];
        try {
            onChainParticipantUnion = await this.getOnChainParticipantUnion();
        } catch (error) {
            this.logger.warn(
                "Force join dispute deferred: on-chain membership could not be read",
                {
                    forkId: sm.forkId,
                    blockHeight: block.height,
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            );
            return;
        }
        if (
            !onChainParticipantUnion.some((participant) =>
                addressesEqual(participant, sm.signerAddress)
            )
        ) {
            this.logger.info(
                "Force join dispute deferred: local pending membership is not on chain",
                { forkId: sm.forkId, blockHeight: block.height }
            );
            return;
        }

        let disputeWindowCreationTimestamp: number;
        try {
            disputeWindowCreationTimestamp = Number(
                await sm.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                    sm.channelId,
                    sm.forkId
                )
            );
        } catch (error) {
            this.logger.warn(
                "Force join dispute deferred: dispute window could not be read",
                {
                    forkId: sm.forkId,
                    blockHeight: block.height,
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            );
            return;
        }
        if (disputeWindowCreationTimestamp !== 0) {
            let chainTimestamp: number;
            try {
                chainTimestamp = (await Clock.getBlockchainTime()).timestamp;
            } catch (error) {
                this.logger.warn(
                    "Force join dispute deferred: chain time could not be read",
                    {
                        forkId: sm.forkId,
                        blockHeight: block.height,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    }
                );
                return;
            }
            if (
                chainTimestamp >=
                disputeWindowCreationTimestamp + sm.timeConfig.evidenceTime
            ) {
                this.logger.info(
                    "Force join dispute deferred: dispute evidence window expired",
                    {
                        forkId: sm.forkId,
                        blockHeight: block.height,
                        disputeWindowCreationTimestamp,
                        chainTimestamp
                    }
                );
                return;
            }
        }

        sm.storage.forceJoin.setDisputeStarted();
        this.logger.info(
            "Force join dispute triggered: N turns passed without inclusion",
            { N, forkId: sm.forkId, blockHeight: block.height }
        );
        await sm.disputeManager.dispute(sm.forkId);
    }

    public async startMaybeExitOnChain(
        block: Block,
        _stateSnapshot: StateSnapshot,
        participantChanges: ParticipantChanges,
        _outboundMessageBlock?: MessageBlockStruct
    ): Promise<void> {
        const sm = this.stateManager;
        if (!participantChanges.left.has(sm.signerAddress)) {
            // I didn't exit, nothing to do
            return;
        }

        this.logger.info(
            `startMaybeExitOnChain - I left the channel at block ${block.height}, waiting agreementTime to attempt N/N exit`,
            { blockHeight: block.height, forkId: block.forkId }
        );

        sm.timeoutManager.scheduleTask(
            async () => {
                const persistedBlock =
                    sm.storage.blocks.getBlock(block.forkId, block.height) ??
                    block;
                const everyoneSigned =
                    sm.agreementManager.didEveryoneSignBlock(persistedBlock);

                if (everyoneSigned) {
                    this.logger.info(
                        `startMaybeExitOnChain - everyone signed block ${block.height}, posting state snapshot`,
                        { blockHeight: block.height, forkId: block.forkId }
                    );
                    try {
                        await sm.snapshotUpdateService.postStateSnapshotWait(
                            block.forkId
                        );
                    } catch (error) {
                        this.logger.error(
                            `startMaybeExitOnChain - failed to post state snapshot`,
                            {
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error)
                            }
                        );
                        try {
                            sm.storage.forceExit.setForceExit(true);
                            await sm.disputeManager.dispute(block.forkId);
                        } catch (disputeError) {
                            this.logger.error(
                                "startMaybeExitOnChain - failed to create self-removal dispute after snapshot failure",
                                {
                                    error:
                                        disputeError instanceof Error
                                            ? disputeError.message
                                            : String(disputeError)
                                }
                            );
                        }
                    }
                } else {
                    // Slow path: not everyone signed - create a self-removal dispute
                    this.logger.info(
                        `startMaybeExitOnChain - not everyone signed block ${persistedBlock.height}, creating self-removal dispute`,
                        {
                            blockHeight: persistedBlock.height,
                            forkId: persistedBlock.forkId
                        }
                    );
                    try {
                        sm.storage.forceExit.setForceExit(true);
                        await sm.disputeManager.dispute(persistedBlock.forkId);
                    } catch (error) {
                        this.logger.error(
                            `startMaybeExitOnChain - failed to create self-removal dispute`,
                            {
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error)
                            }
                        );
                    }
                }
            },
            sm.timeConfig.agreementTime * 1000,
            `MaybeExitOnChain - block ${block.height} - fork ${block.forkId}`
        );
    }
}
