import type { ParticipantChanges } from "../block/SnapshotAssemblyService";
import type StateManager from "../StateManager";
import Clock from "@/Clock";

import { Block, StateSnapshot } from "@/models";
import { Status } from "@/types";
import { isCommittedParticipantStatus } from "@/types/flags";
import {
    Address,
    ChannelId,
    ChecksumAddress,
    ForkId,
    Hash
} from "@/types/types";
import {
    addressesEqual,
    getChecksumAddress,
    Logger,
    union,
    Codec,
    Type
} from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import { tryDecodeCustomError } from "@/utils/evmErrorHandler";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type {
    JoinChannelConfirmationStruct,
    MessageBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { id, isError } from "ethers";

export enum SourceEligibility {
    ELIGIBLE,
    SLASHED,
    ABSENT
}

/**
 * The membership domain: the channel's participant union (on-chain current +
 * pending), and my own lifecycle in it — joining, topping up, forcing a join
 * that peers refuse to include, and exiting once I have left the participant
 * set.
 */
export default class MembershipService {
    private readonly logger: Logger;
    private eligibilityRefresh?: Promise<boolean>;
    private onChainEligibility: Set<ChecksumAddress> = new Set();
    private offChainEligibility: Set<ChecksumAddress> = new Set();
    private readonly knownSlashes: Set<ChecksumAddress> = new Set();

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "Membership" });
    }

    // Whether I belong to this block's previous/resulting participant union:
    // the set that may sign and relay it. A leaver stays PARTICIPATING until
    // its exit snapshot lands but is outside the union of every later block;
    // signing or relaying those would present it to peers that already
    // applied its exit as a signer or source they no longer admit.
    public isSignerInBlockUnion(block: Block): boolean {
        const union = this.stateManager.storage.getParticipantsUnion(
            block.coordinates,
            block.stateSnapshotHash
        );
        return union.some((participant) =>
            addressesEqual(participant, this.stateManager.signerAddress)
        );
    }

    public getCachedSourceEligibility(source: Address): SourceEligibility {
        const address = getChecksumAddress(source);
        if (this.knownSlashes.has(address)) return SourceEligibility.SLASHED;
        if (
            this.onChainEligibility.has(address) ||
            this.offChainEligibility.has(address)
        )
            return SourceEligibility.ELIGIBLE;
        return SourceEligibility.ABSENT;
    }

    public async resolveSourceEligibility(
        source: Address
    ): Promise<SourceEligibility> {
        const cached = this.getCachedSourceEligibility(source);
        if (cached !== SourceEligibility.ABSENT) return cached;
        await this.refreshOnChainEligibility();
        return this.getCachedSourceEligibility(source);
    }

    public publishOnChainSnapshot(snapshot: StateSnapshotStruct): void {
        this.onChainEligibility = new Set(
            snapshot.snapshotData.participants.map((participant) =>
                getChecksumAddress(String(participant))
            )
        );
        const inbound = this.stateManager.storage.inboundMessages;
        const lowerBlockHash =
            snapshot.snapshotData.latestInboundMessageBlockHash;
        const head = inbound.headNotBehind(
            lowerBlockHash,
            Number(snapshot.snapshotData.latestInboundMessageBlockHeight)
        );
        const pending = inbound.tryGetMessageBlocksInRange({
            upperBlockHash: head.hash,
            lowerBlockHash
        });
        for (const block of pending.blocks)
            this.observeInboundMembership(block);
    }

    public observeInboundMembership(block: MessageBlockStruct): void {
        for (const message of block.messages) {
            if (message.messageType !== id("JOIN_CHANNEL_MESSAGE")) continue;
            const join = Codec.decode(message.data, Type.JoinChannel);
            this.onChainEligibility.add(getChecksumAddress(join.participant));
        }
    }

    public publishOffChainEligibility(participants: readonly Address[]): void {
        this.offChainEligibility = new Set(
            participants.map(getChecksumAddress)
        );
    }

    public observeOnChainSlash(participant: Address): void {
        this.knownSlashes.add(getChecksumAddress(participant));
    }

    public resetEligibility(): void {
        this.onChainEligibility.clear();
        this.offChainEligibility.clear();
        this.knownSlashes.clear();
    }

    public async refreshOnChainEligibility(): Promise<boolean> {
        if (this.eligibilityRefresh) return this.eligibilityRefresh;
        this.eligibilityRefresh = (async () => {
            const sm = this.stateManager;
            try {
                const membership =
                    await sm.eventSyncService.readPinnedChainMembership(
                        sm.channelId
                    );
                for (const participant of membership.slashed)
                    this.observeOnChainSlash(participant);
                await sm.eventSyncService.synchronizeChainMembership(
                    sm.channelId,
                    membership
                );
                return true;
            } catch (error) {
                this.logger.warn("Source eligibility refresh unavailable", {
                    error: errorMessage(error)
                });
                return false;
            }
        })();
        try {
            return await this.eligibilityRefresh;
        } finally {
            this.eligibilityRefresh = undefined;
        }
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

    public includesSigner(participants: readonly Address[]): boolean {
        return participants.some((participant) =>
            addressesEqual(participant, this.stateManager.signerAddress)
        );
    }

    public async isSignerOnChain(): Promise<boolean> {
        return this.includesSigner(await this.getOnChainParticipantUnion());
    }

    public async isSignerInLocalState(): Promise<boolean> {
        return this.includesSigner(
            await this.stateManager.getParticipantsCurrent()
        );
    }

    public async startSelfRemovalDispute(forkId: ForkId): Promise<boolean> {
        const sm = this.stateManager;
        sm.storage.forceExit.setForceExit(true);
        await sm.disputeManager.dispute(forkId);
        return sm.storage.disputes.didIDispute(forkId);
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
                    if (this.includesSigner(participantUnion)) {
                        this.logger.warn(
                            "joinChannel - submission outcome was uncertain but on-chain membership is present"
                        );
                        return true;
                    }
                } catch (reconciliationError) {
                    this.logger.warn(
                        "joinChannel - failed to reconcile uncertain submission",
                        {
                            error: errorMessage(reconciliationError)
                        }
                    );
                }
                this.logger.warn(
                    "joinChannel - submission outcome uncertain; preserving pending state",
                    {
                        error: errorMessage(error)
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
                case "RaceConditionJoinChannelForkDisputed":
                case "ErrorJoinChannelInvalidSignature":
                case "ErrorJoinChannelConfirmationNotThresholdSigned":
                    this.logger.warn(
                        `joinChannel - race condition: ${custom.name}`,
                        {
                            customError:
                                LoggerUtils.getCustomEvmErrorMetadata(custom)
                        }
                    );
                    sm.abort();
                    return false;
            }
            this.logger.warn("joinChannel - tx failed, reverting to SYNCED", {
                error: errorMessage(error)
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
        if (!isCommittedParticipantStatus(sm.status)) {
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
                    customError: LoggerUtils.getCustomEvmErrorMetadata(custom)
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
                    error: errorMessage(error)
                }
            );
            return;
        }
        if (!this.includesSigner(onChainParticipantUnion)) {
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
                    error: errorMessage(error)
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
                        error: errorMessage(error)
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
        sm.disputeManager.requestDispute(sm.forkId);
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
                    let posted = false;
                    try {
                        posted =
                            await sm.snapshotUpdateService.postStateSnapshotWait(
                                block.forkId
                            );
                    } catch (error) {
                        this.logger.error(
                            `startMaybeExitOnChain - failed to post state snapshot`,
                            { error: errorMessage(error) }
                        );
                    }
                    if (!posted) {
                        try {
                            if (
                                !(await this.startSelfRemovalDispute(
                                    block.forkId
                                ))
                            ) {
                                this.logger.warn(
                                    "Self-removal dispute did not start",
                                    { forkId: block.forkId }
                                );
                                sm.leaveChannelService.onExitFallbackFailed(
                                    block.forkId,
                                    new Error(
                                        "Terminal channel leave failed to start a dispute"
                                    )
                                );
                            }
                        } catch (disputeError) {
                            this.logger.error(
                                "startMaybeExitOnChain - failed to create self-removal dispute after snapshot failure",
                                {
                                    error: errorMessage(disputeError)
                                }
                            );
                            sm.leaveChannelService.onExitFallbackFailed(
                                block.forkId,
                                disputeError
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
                        if (
                            !(await this.startSelfRemovalDispute(
                                persistedBlock.forkId
                            ))
                        ) {
                            this.logger.warn(
                                "Self-removal dispute did not start",
                                { forkId: persistedBlock.forkId }
                            );
                            sm.leaveChannelService.onExitFallbackFailed(
                                persistedBlock.forkId,
                                new Error(
                                    "Terminal channel leave failed to start a dispute"
                                )
                            );
                        }
                    } catch (error) {
                        this.logger.error(
                            `startMaybeExitOnChain - failed to create self-removal dispute`,
                            {
                                error: errorMessage(error)
                            }
                        );
                        sm.leaveChannelService.onExitFallbackFailed(
                            persistedBlock.forkId,
                            error
                        );
                    }
                }
            },
            sm.timeConfig.agreementTime * 1000,
            `MaybeExitOnChain - block ${block.height} - fork ${block.forkId}`
        );
    }
}
