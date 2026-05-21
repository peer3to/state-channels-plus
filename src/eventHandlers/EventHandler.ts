import {
    BlockConfirmationStruct,
    MessageBlockStruct,
    SignedBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeAuditingDataStruct,
    DisputeConfirmationStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type StateManager from "@/stateManager";
import P2pEventHooks from "@/P2pEventHooks";
import {
    ChannelId,
    Timestamp,
    Address,
    Hash,
    ForkId,
    Bytes
} from "@/types/types";
import Storage from "@/storage";
import ADiamondStateMachine from "@/ADiamondStateMachine";
import {
    addressesEqual,
    Codec,
    getChecksumAddress,
    hash,
    Logger,
    tryDecodeCustomError,
    Type
} from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { isEqual } from "lodash";
import CalldataCommittedStrategy from "@/stateManager/validationStrategy/CalldataCommittedStrategy";
import { Status } from "@/types";
import { Block } from "@/models";

export class EventHandler {
    private logger: Logger;

    constructor(
        private storage: Storage,
        private stateManager: StateManager,
        private p2pEventHooks: P2pEventHooks,
        private diamondStateMachine: ADiamondStateMachine,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "EventHandler" });
    }

    async onChannelOpened(
        channelId: ChannelId,
        stateSnapshot: StateSnapshotStruct,
        encodedState: Bytes
    ): Promise<void> {
        this.logger.debug("Channel opened", {
            channelId,
            forkId: stateSnapshot.forkId
        });

        await this.diamondStateMachine.localDiamondContract.onChannelOpened(
            channelId,
            stateSnapshot,
            encodedState
        );

        await this.stateManager.setGenesisState(
            stateSnapshot.snapshotData,
            encodedState,
            stateSnapshot.forkId,
            Number(stateSnapshot.timestamp)
        );
    }

    async onStateSnapshotUpdated(
        channelId: ChannelId,
        stateSnapshot: StateSnapshotStruct
    ): Promise<void> {
        //TODO - make sure snapshots are in ascending order if events can be collected in random order - e.g we have the latest one always

        await this.diamondStateMachine.localDiamondContract.onStateSnapshotUpdated(
            channelId,
            stateSnapshot
        );

        const signerAddress = this.stateManager.signerAddress;
        const snapshotParticipants = stateSnapshot.snapshotData
            .participants as Address[];
        const status = this.stateManager.getStatus();

        const snapshotHasSigner = snapshotParticipants.some((p) =>
            addressesEqual(p, signerAddress)
        );

        // Detect when we've fully left the channel: PARTICIPATING → SYNCED
        if (status === Status.PARTICIPATING) {
            const localParticipants =
                await this.stateManager.getParticipantsCurrent();
            const inLocal = localParticipants.some((p) =>
                addressesEqual(p, signerAddress)
            );
            if (!snapshotHasSigner && !inLocal) {
                const pendingParticipants =
                    (await this.stateManager.stateChannelManagerContract.getPendingParticipants(
                        channelId
                    )) as Address[];
                const inPending = pendingParticipants.some((p) =>
                    addressesEqual(p, signerAddress)
                );
                if (!inPending) {
                    this.logger.info(
                        "onStateSnapshotUpdated - signer left channel, transitioning PARTICIPATING → SYNCED",
                        { channelId }
                    );
                    this.stateManager.setStatus(Status.SYNCED);
                }
            }
        }

        // Check if channel should be closed (0 participants remaining)
        if (stateSnapshot.snapshotData.participants.length === 0) {
            this.logger.info(
                "Channel has 0 participants remaining, closing channel",
                {
                    channelId
                }
            );
            await this.handleChannelClose(channelId);
        }
    }

    private async handleChannelClose(channelId: ChannelId): Promise<void> {
        this.logger.info("Handling channel close", { channelId });

        this.stateManager.setStatus(Status.NOT_OPENED);

        // Disconnect from all peers in this channel
        this.stateManager.p2pManager.disconnectAll();

        // Trigger channelclosed hook?
        this.p2pEventHooks.onCloseChannel?.(channelId);
    }

    async onBlockCalldataPosted(
        channelId: ChannelId,
        commitmentHash: Hash,
        sender: Address,
        signedBlock: SignedBlockStruct,
        timestamp: Timestamp
    ): Promise<void> {
        this.logger.verbose("Block calldata posted on-chain", {
            channelId,
            commitmentHash,
            sender,
            signedBlock: LoggerUtils.getBlockMetadata(
                Block.fromSignedBlock(signedBlock)
            )
        });
        this.storage.blockCalldata.storeBlockCalldata({
            signedBlock,
            onChainTimestamp: timestamp
        });
        await this.diamondStateMachine.localDiamondContract.onBlockCalldataPosted(
            channelId,
            commitmentHash,
            sender,
            signedBlock,
            timestamp
        );
        this.p2pEventHooks.onPostedCalldata?.();

        const blockConfirmation: BlockConfirmationStruct = {
            signedBlock,
            signatures: []
        };
        await this.stateManager.ingestBlockConfirmation(blockConfirmation, {
            onChainTimestamp: Number(timestamp),
            validationStrategy: new CalldataCommittedStrategy(
                this.stateManager.disputeManager,
                this.stateManager.blockValidationStrategy
            )
        });
    }

    async onDisputeCommitted(
        channelId: ChannelId,
        disputeConfirmation: DisputeConfirmationStruct,
        disputeCreationTimestamp: Timestamp,
        isFinal: boolean,
        windowCreationTimestamp: Timestamp,
        disputeAuditingData?: DisputeAuditingDataStruct
    ): Promise<void> {
        const dispute = Codec.decode(
            disputeConfirmation.signedDispute.encodedDispute,
            Type.Dispute
        );
        const forkId = dispute.input.forkId;

        const disputeMeta = LoggerUtils.getDisputeMetadata(dispute);
        const formattedHash = LoggerUtils.formatHash(disputeMeta.disputeHash);
        this.logger.info(`✅ Dispute received: ${formattedHash}`, {
            dispute: disputeMeta,
            isFinal: isFinal,
            disputeConfirmation,
            windowCreationTimestamp,
            auditingDataPosted: disputeAuditingData ? true : false
        });

        // sync LocalDiamond state
        await this.diamondStateMachine.localDiamondContract.onDisputeCommitted(
            channelId,
            dispute,
            disputeCreationTimestamp,
            isFinal,
            windowCreationTimestamp
        );

        // isDisputeWindowRelevant?
        const isRelevant = this.stateManager.forkId === forkId;
        if (!isRelevant) {
            return;
        }

        this.stateManager.blockQueueManager.clearFork(forkId);

        const isFirstOccurrence =
            this.stateManager.p2pManager.localRpc.isForkDisputedService.requestDisputeAcknowledgment(
                channelId,
                forkId
            );

        if (isFirstOccurrence) {
            this.p2pEventHooks.onDisputeStarted?.(
                this.stateManager.timeConfig.evidenceTime * 3
            );
        }

        if (isFinal) {
            if (!disputeAuditingData) {
                const { isPartial, auditingData } =
                    this.stateManager.disputeManager.getAuditingData(
                        forkId,
                        dispute.input.stateProof,
                        {
                            disputeLatestInboundMessageBlockHash:
                                dispute.input.latestInboundMessageBlockHash
                        }
                    );
                if (isPartial)
                    throw new Error(
                        "DisputeAuditingData not available on a final dispute"
                    );
                disputeAuditingData = auditingData;
            }

            const latestSnapshot =
                this.stateManager.agreementManager.getLatestSnapshotFromStateProof(
                    dispute.input.stateProof,
                    forkId
                );
            const latestStateMachineState =
                this.storage.stateMachineStates.getStateMachineState(
                    latestSnapshot.stateMachineStateHash as Hash
                );

            if (!latestStateMachineState) {
                throw new Error(
                    `StateMachineState not available for latest snapshot hash: ${latestSnapshot.stateMachineStateHash}`
                );
            }

            const outputSnapshotData =
                await this.diamondStateMachine.localDiamondContract.computeDisputeOutputSnapshotData.staticCall(
                    dispute.input,
                    latestSnapshot.toStruct(),
                    latestStateMachineState,
                    disputeAuditingData.inboundMessageBlocks
                );

            const disputeOutputState =
                await this.diamondStateMachine.localDiamondContract.computeDisputeOutputState.staticCall(
                    dispute.input,
                    latestSnapshot.toStruct(),
                    latestStateMachineState,
                    disputeAuditingData.inboundMessageBlocks
                );

            const evidenceTime = this.stateManager.timeConfig.evidenceTime;

            // TODO - unified single place for genesis timestamp
            // TODO - currently not use, but not sure if genesis timestamp is calculated like this in this case - come back later
            const genesisTimestamp =
                Number(disputeCreationTimestamp) + evidenceTime;

            return this.stateManager.setGenesisState(
                outputSnapshotData,
                disputeOutputState.encodedModifiedState as Bytes,
                dispute.outputSnapshotDataHash as ForkId,
                genesisTimestamp,
                disputeOutputState.outboundMessageBlock.messages.length > 0
                    ? disputeOutputState.outboundMessageBlock
                    : undefined
            );
        }

        // not final - validate dispute and challenge if invalid
        const isValid =
            await this.stateManager.disputeValidationService.validateDispute(
                dispute,
                disputeAuditingData
            );

        if (!isValid) {
            const disputeFraudProof =
                this.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                    dispute
                );
            const killReason = disputeFraudProof
                ? LoggerUtils.getDisputeFraudProofMeta(disputeFraudProof)
                : undefined;

            this.logger.warn(
                `❌ Dispute auditing failed - killing dispute ${formattedHash}`,
                {
                    killReason
                }
            );

            // Sequential: kill must mine first so the spammer appears in onChainSlashes,
            // otherwise the counter-dispute would be constructed with onChainSlashes=[]
            // and could itself be killed as InvalidDisputeReason.
            //  TODO - should be multicall
            await this.stateManager.disputeManager.killDispute(dispute);
            // TODO, under the multicall pass the expectation who to slash (who will be killed) to dispute(),
            // otherwise don't run dispute(forkId) here, since we pickup on-chain slashes from DisputeKilled event and here we might end up creating an empty dispute since we didn't observe on-chain slashes
            // await this.stateManager.disputeManager.dispute(forkId);
            return;
        }

        this.logger.info(`✅ Dispute auditing successful ${formattedHash}`);

        this.storage.disputes.storeDisputeConfirmation(disputeConfirmation);
        await this.updateDisputeView(channelId, forkId);

        // this is like success - TODO - consider moving this to DisputeStrategy.success
        const canConstructMoreEvidence =
            await this.canConstructMoreEvidence(dispute);
        if (canConstructMoreEvidence) {
            this.logger.info(
                `More evidence can be constructed for dispute ${formattedHash}, disputing...`
            );
            return this.stateManager.disputeManager.dispute(forkId);
        }

        const { killPeriodEnd } =
            await this.diamondStateMachine.localDiamondContract.isKillPeriodExpired(
                channelId,
                forkId
            );

        this.stateManager.setReductionTimeout(forkId, Number(killPeriodEnd));
    }

    private async updateDisputeView(
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void> {
        let disputeCommitments: Hash[];
        try {
            disputeCommitments =
                await this.diamondStateMachine.localDiamondContract.getWindowCommitments(
                    channelId,
                    forkId
                );
        } catch (error) {
            this.logger.debug("Skipping dispute update hook", {
                channelId,
                forkId,
                error: error instanceof Error ? error.message : String(error)
            });
            return;
        }

        const disputes: DisputeStruct[] = [];
        for (const commitment of disputeCommitments) {
            const dispute = this.storage.disputes.getDispute(commitment);
            if (!dispute) {
                this.logger.debug(
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

        const slashes = new Set<string>();
        let timeout: { participant: string; minTimestamp: bigint } | undefined;

        for (const dispute of disputes) {
            for (const slash of dispute.input.onChainSlashes) {
                const address = this.getNonZeroAddress(slash);
                if (address) slashes.add(address);
            }

            const participant = this.getNonZeroAddress(
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
            this.p2pEventHooks.onDisputeUpdate?.(
                slashList,
                slashList.length > 0 ? undefined : timeout?.participant
            );
        } catch (error) {
            this.logger.debug("Dispute update hook failed", {
                channelId,
                forkId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private getNonZeroAddress(address: Address): string | undefined {
        const normalized = getChecksumAddress(address);
        return addressesEqual(
            normalized,
            "0x0000000000000000000000000000000000000000"
        )
            ? undefined
            : normalized;
    }

    private async canConstructMoreEvidence(
        dispute: DisputeStruct
    ): Promise<boolean> {
        // Create our own dispute
        const { dispute: ourDispute } =
            await this.stateManager.disputeManager.constructDispute(
                this.stateManager.latestForkId
            );

        this.logger.verbose("Constructed our own dispute for comparison", {
            ourDispute: LoggerUtils.getDisputeMetadata(ourDispute),
            theirDispute: LoggerUtils.getDisputeMetadata(dispute)
        });

        let hasMoreEvidence;
        try {
            // Compare reduced disputes to see if we have more evidence
            const singleDisputeReduction =
                await this.diamondStateMachine.localDiamondContract.reduce.staticCall(
                    [dispute]
                );
            const combinedDisputeReduction =
                await this.diamondStateMachine.localDiamondContract.reduce.staticCall(
                    [ourDispute, dispute]
                );
            hasMoreEvidence = !isEqual(
                singleDisputeReduction,
                combinedDisputeReduction
            );
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            this.logger.error("Error during dispute reduction comparison", {
                errors: error,
                custom
            });
            throw error;
        }
        this.logger.debug(`hasMoreEvidence=${hasMoreEvidence}`);
        return hasMoreEvidence;
    }

    async onChainSlashed(
        channelId: ChannelId,
        participant: Address,
        timestamp: Timestamp
    ): Promise<void> {
        await this.diamondStateMachine.localDiamondContract.onOnChainSlashAdded(
            channelId,
            participant,
            timestamp
        );
        this.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
            participant
        );
        const latestFork = this.stateManager.latestForkId;
        let isDisputed =
            await this.diamondStateMachine.localDiamondContract.isForkDisputed(
                channelId,
                latestFork
            );
        if (!isDisputed)
            isDisputed =
                await this.stateManager.stateChannelManagerContract.isForkDisputed(
                    channelId,
                    latestFork
                );
        const participants = await this.diamondStateMachine.getParticipants();
        if (!isDisputed && participants.includes(participant.toString())) {
            await this.stateManager.disputeManager.dispute(latestFork);
        }
    }

    async onDisputeReducedResultCommitted(
        channelId: ChannelId,
        forkId: ForkId,
        reducedForkId: ForkId,
        reductionTimestamp: Timestamp,
        reducer: Address
    ): Promise<void> {
        // sync LocalDiamond state
        await this.diamondStateMachine.localDiamondContract.onDisputeReducedResultCommitted(
            channelId,
            forkId,
            reducedForkId,
            reductionTimestamp,
            reducer
        );

        // if it's not part of the fork choice rule, ignore it - it's spam
        const isRelevant = this.stateManager.forkId === forkId;
        if (!isRelevant) {
            return;
        }

        // isFinal?
        if (
            await this.diamondStateMachine.localDiamondContract.isReduceChallengePeriodExpired(
                channelId,
                forkId
            )
        ) {
            // If final, set fork and start building on it
            await this.setForkIfLatestAndCurrent(
                forkId,
                reducedForkId,
                reductionTimestamp
            );
            return;
        }

        // Not final - validate the reduction
        let isValid: boolean;
        try {
            isValid = await this.validateDisputeReductionAndChallenge(
                channelId,
                forkId,
                reducedForkId
            );
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.startsWith("Dispute not available for commitment")
            ) {
                const status = this.stateManager.getStatus();
                if (
                    status !== Status.PARTICIPATING &&
                    status !== Status.PENDING_PARTICIPANT
                ) {
                    this.logger.debug(
                        "Skipping dispute reduction validation and disconnecting from peers because dispute data is unavailable for non-participant",
                        {
                            channelId,
                            forkId,
                            reducedForkId,
                            status,
                            error: error.message
                        }
                    );
                    this.stateManager.blockQueueManager.clearFork(forkId);
                    this.stateManager.p2pManager.disconnectAll();
                    // TODO - find a universal way to signal "we've left"
                    return;
                }

                this.logger.error(
                    "Unable to validate dispute reduction because dispute data is unavailable",
                    {
                        channelId,
                        forkId,
                        reducedForkId,
                        status,
                        error: error.message
                    }
                );
            }
            throw error;
        }

        if (!isValid) {
            // Already challenged -> just discconect
            // Disconnect the reducer who performed the incorrect reduction
            this.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                reducer
            );
            return;
        }

        // Reduction is valid and correct - set fork and start building on it
        await this.setForkIfLatestAndCurrent(
            forkId,
            reducedForkId,
            reductionTimestamp
        );
    }

    async onWithdrawalsUpdated(
        channelId: ChannelId,
        totalWithdrawals: any
    ): Promise<void> {
        await this.diamondStateMachine.localDiamondContract.onWithdrawalsUpdated(
            channelId,
            totalWithdrawals
        );
    }

    async onChannelStorageCleared(
        channelId: ChannelId,
        latestInboundMessageBlockHash: Hash
    ): Promise<void> {
        await this.diamondStateMachine.localDiamondContract.onChannelStorageCleared(
            channelId,
            latestInboundMessageBlockHash
        );
    }

    async onDisputeKilled(
        channelId: ChannelId,
        forkId: ForkId,
        disputer: Address,
        disputeHash: Hash
    ): Promise<void> {
        await this.diamondStateMachine.localDiamondContract.onDisputeKilled(
            channelId,
            forkId,
            disputer,
            disputeHash
        );

        // Log dispute killed event
        // Note: The kill reason is logged earlier when validation fails in onDisputeCommitted
        this.logger.warn("💀 Dispute killed on-chain", {
            forkId,
            disputer: disputer,
            disputeHash: disputeHash,
            channelId
        });

        // disconnect disputer
        this.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
            disputer
        );

        const commitments =
            await this.diamondStateMachine.localDiamondContract.getWindowCommitments(
                channelId,
                forkId
            );
        if (commitments.length !== 0) return;

        //isDisputeWindowRelevant?
        const isRelevant = this.stateManager.forkId === forkId;
        if (!isRelevant) return;

        // create new dispute
        await this.stateManager.disputeManager.dispute(forkId);
    }

    async onInboundMessagesProcessed(
        channelId: ChannelId,
        messageBlock: MessageBlockStruct
    ): Promise<void> {
        const messageBlockHash = hash(
            Codec.encode(messageBlock, Type.MessageBlock)
        );
        await this.stateManager.onInboundMessage(
            messageBlock,
            messageBlockHash
        );
        await this.diamondStateMachine.localDiamondContract.onInboundMessagesProcessed(
            channelId,
            messageBlock
        );

        // Additional join-channel-specific handling can be placed here if required
    }

    private async validateDisputeReductionAndChallenge(
        channelId: ChannelId,
        forkId: ForkId,
        reducedForkId: ForkId
    ): Promise<boolean> {
        // TODO - extract this function since it's used in multiple places (e.g spectating RPC...)
        const disputeWindow = (
            await this.stateManager.stateChannelManagerContract.getDisputeWindows(
                channelId,
                [forkId]
            )
        )[0];
        const disputes = disputeWindow.evidence.disputeCommitments.map(
            (commitment) => {
                const dispute = this.storage.disputes.getDispute(commitment);
                if (!dispute) {
                    //TODO - querry longs
                    throw new Error(
                        `Dispute not available for commitment: ${commitment}`
                    );
                }
                return dispute;
            }
        );

        const reduceOutput =
            await this.stateManager.stateChannelManagerContract.reduce.staticCall(
                disputes
            );

        // Use getReduceData to properly handle genesis case (when latestBlock is undefined)
        const reduceData =
            await this.stateManager.agreementManager.getReduceData(
                forkId,
                reduceOutput
            );
        const latestSnapshot = reduceData.latestStateSnapshot;
        const state = this.storage.stateMachineStates.getStateMachineState(
            latestSnapshot.snapshotData.stateMachineStateHash
        );
        if (!state)
            throw new Error(
                `StateMachineState not available for hash: ${latestSnapshot.snapshotData.stateMachineStateHash}`
            );
        const genesisSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        if (!genesisSnapshot)
            throw new Error(
                `GenesisSnapshot not available for forkId: ${forkId}`
            );
        const inboundMessageBlocks =
            this.storage.inboundMessages.getMessageBlocksInRange({
                upperBlockHash:
                    latestSnapshot.snapshotData.latestInboundMessageBlockHash,
                lowerBlockHash:
                    genesisSnapshot.snapshotData.latestInboundMessageBlockHash
            });
        const [snapshotData] =
            await this.stateManager.stateChannelManagerContract.reduceOutputToSnapshotData.staticCall(
                forkId,
                reduceOutput,
                latestSnapshot,
                state,
                inboundMessageBlocks
            );

        const isValid =
            hash(Codec.encode(snapshotData, Type.SnapshotData)) ==
            reducedForkId;
        if (!isValid) {
            // while we have the context, use it, instead of returning false and having to generate it again
            await this.stateManager.stateChannelManagerContract.challengeDisputeReduction(
                disputes,
                latestSnapshot,
                state,
                inboundMessageBlocks
            );
            return false;
        }
        return true;
    }

    private async setForkIfLatestAndCurrent(
        forkId: ForkId,
        reducedForkId: ForkId,
        _reductionTimestamp: Timestamp
    ): Promise<void> {
        // enough for now - this will change later
        if (this.stateManager.forkId == forkId) {
            // Get the latest state snapshot - it should be reduced locally if not we'll reduce it on the spot
            const latestStateSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotByForkId(
                    reducedForkId
                );
            if (!latestStateSnapshot) {
                // TODO reduce localy
                return;
            }
            const genesisStateMachineState =
                this.storage.stateMachineStates.getStateMachineState(
                    latestStateSnapshot.stateMachineStateHash
                );

            if (!genesisStateMachineState) {
                // we need to compute it - should have computed it above while reducing
                // TODO - solidity code that returns the encodedState
            }
            // Set fork and start building on it
            // TODO
            throw new Error(
                "Not implemented yet - set fork for reduceCommitment"
            );
            // await this.stateManager.setGenesisState(
            //     genesisStateMachineState!,
            //     reducedForkId,
            //     reductionTimestamp
            // );
        }
    }
}
