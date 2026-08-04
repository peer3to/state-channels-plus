import type {
    JoinChannelConfirmationStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

import { Block, StateSnapshot } from "@/models";
import type { ParticipantChanges } from "../block/SnapshotAssemblyService";
import { Status } from "@/types";
import { Address, ChannelId, ForkId, Hash } from "@/types/types";
import { Logger, union } from "@/utils";
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

    public async joinChannel(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<void> {
        const sm = this.stateManager;
        if (sm.status !== Status.SYNCED) {
            throw new Error(
                `joinChannel requires SYNCED status, got ${Status[sm.status]}`
            );
        }

        sm.setStatus(Status.PENDING_PARTICIPANT);
        this.logger.info(
            "joinChannel - promoted to PENDING_PARTICIPANT on broadcast"
        );

        const joinSubmissionHeight =
            sm.storage.blocks.getNextBlockHeight(sm.forkId) - 1;
        sm.storage.forceJoin.setJoinSubmissionBlockHeight(joinSubmissionHeight);
        this.logger.info(
            "joinChannel - recorded force join submission height",
            { joinSubmissionHeight }
        );

        try {
            const tx = await sm.stateChannelManagerContract.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            );
            await tx.wait();
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            if (custom?.name === "ErrorJoinChannelParticipantAlreadyExists") {
                this.logger.warn(
                    "joinChannel - participant already exists; preserving pending join state"
                );
                throw custom;
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
                    // TODO: support concurrent joins by collecting safe extra signatures before submission.
                    // Rethrown as CustomEvmError
                    sm.abort();
                    throw custom;
            }
            this.logger.warn("joinChannel - tx failed, reverting to SYNCED", {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    public async topUpBalance(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<void> {
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
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            if (custom) {
                this.logger.warn(`topUpBalance failed: ${custom.name}`, {
                    name: custom.name,
                    args: custom.errorDescription.args
                });
                throw custom;
            }
            throw error;
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
        if (block.height !== fireOnBlockHeight) return;
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
                        await sm.snapshotUpdateService.postStateSnapshot(
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
