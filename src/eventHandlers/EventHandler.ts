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
    DetachedPromises,
    hash,
    Logger,
    tryDecodeCustomError,
    Type
} from "@/utils";
import { tryHandleEvmError } from "@/utils/evmErrorHandler";
import { TransactionResponse } from "ethers";
import { LoggerUtils } from "@/utils/LoggerUtils";
import P2pEventHooksUtils from "@/utils/P2pEventHooksUtils";
import { isEqual } from "lodash";
import CalldataCommittedStrategy from "@/stateManager/validationStrategy/CalldataCommittedStrategy";
import type { ReductionGenesis } from "@/stateManager/reduction";
import { PartialAuditingDataError } from "@/disputeManager/DisputeManager";
import { Status } from "@/types";
import { Block, StateSnapshot } from "@/models";

export type EventCoordinate = {
    blockNumber: number;
    logIndex: number;
};

export class EventHandler {
    private logger: Logger;
    private disputeHandlingPromises = new Map<Hash, Promise<void>>();

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
        encodedState: Bytes,
        coordinate: EventCoordinate
    ): Promise<void> {
        this.logger.debug("Channel opened", {
            channelId,
            forkId: stateSnapshot.forkId
        });

        await this.diamondStateMachine.localDiamondContract.onChannelOpened(
            channelId,
            stateSnapshot,
            encodedState,
            coordinate.blockNumber,
            coordinate.logIndex
        );

        await this.stateManager.withMutex(
            () =>
                this.stateManager.stateApplicationService.unsafeSetGenesisState(
                    stateSnapshot.snapshotData,
                    encodedState,
                    stateSnapshot.forkId,
                    Number(stateSnapshot.timestamp)
                ),
            { taskName: "onChannelOpened.setGenesisState" }
        );

        // This remains the single ethers-backed channel-event intake. After
        // this handler finishes mirror/state updates, the runtime publishes
        // the completed invocation on its typed event bus. Protocol services
        // subscribe there instead of owning duplicate provider listeners,
        // replay rules, ordering, and cleanup.
    }

    async onStateSnapshotUpdated(
        channelId: ChannelId,
        stateSnapshot: StateSnapshotStruct,
        coordinate: EventCoordinate
    ): Promise<void> {
        if (String(this.stateManager.channelId) !== String(channelId)) {
            this.logger.debug(
                "Ignoring state snapshot for a channel that is no longer selected",
                { channelId }
            );
            return;
        }
        await this.diamondStateMachine.localDiamondContract.onStateSnapshotUpdated(
            channelId,
            stateSnapshot,
            coordinate.blockNumber,
            coordinate.logIndex
        );

        await this.processStateSnapshotUpdated(channelId, stateSnapshot);
    }

    private async processStateSnapshotUpdated(
        channelId: ChannelId,
        stateSnapshot: StateSnapshotStruct
    ): Promise<void> {
        // TODO - gate this TS handler by ascending (blockNumber, logIndex); the local-EVM mirror already does

        const updatedSnapshot = StateSnapshot.from(stateSnapshot);
        const knownSnapshot =
            this.storage.stateSnapshots.getStateSnapshotByHash(
                updatedSnapshot.hash
            );
        if (!knownSnapshot) {
            const status = this.stateManager.status;
            if (status === Status.SYNCED) {
                if (this.stateManager.leaveChannelService.isLeaving) {
                    await this.stateManager.leaveChannelService.onSettledStateObserved();
                    return;
                }
                // TODO: call stateManager.abort() here; it drops to OPENED and disposes,
                // but no resync path exists yet.

                this.logger.warn(
                    "onStateSnapshotUpdated - unknown snapshot while SYNCED, should abort + resync",
                    { channelId, hash: updatedSnapshot.hash }
                );
                return;
            }
            if (
                status === Status.PENDING_PARTICIPANT ||
                status === Status.PARTICIPATING
            ) {
                const snapshotParticipants = stateSnapshot.snapshotData
                    .participants as Address[];
                const signerRemoved = !snapshotParticipants.some((p) =>
                    addressesEqual(p, this.stateManager.signerAddress)
                );
                if (signerRemoved) {
                    if (this.stateManager.leaveChannelService.isLeaving) {
                        this.logger.info(
                            "onStateSnapshotUpdated - pending leave observed signer removal",
                            { channelId, status, hash: updatedSnapshot.hash }
                        );
                        const localParticipants =
                            await this.stateManager.getParticipantsCurrent();
                        const inLocal = localParticipants.some((participant) =>
                            addressesEqual(
                                participant,
                                this.stateManager.signerAddress
                            )
                        );
                        if (!inLocal) {
                            this.stateManager.setStatus(Status.SYNCED);
                            await this.stateManager.leaveChannelService.onSettledStateObserved();
                            return;
                        }
                    } else {
                        // We were removed from the channel (e.g. slashed by dispute
                        // resolution): a new snapshot we never produced no longer
                        // lists us. This is a legitimate exit, not a desync — abort
                        // participation instead of treating it as fatal.
                        this.logger.warn(
                            "onStateSnapshotUpdated - unknown snapshot excludes signer (slashed/removed), aborting",
                            {
                                channelId,
                                status,
                                hash: updatedSnapshot.hash
                            }
                        );
                        this.stateManager.abort();
                        return;
                    }
                }
                const currentForkId = this.stateManager.forkId;
                if (updatedSnapshot.forkID !== currentForkId) {
                    // Chain events carry no cross-event ordering. Join the
                    // fork's one reduction operation before deciding the
                    // announced snapshot is unknown.
                    await this.stateManager.reductionManager.tryReduce(
                        currentForkId
                    );
                }
                const converged =
                    this.storage.stateSnapshots.getStateSnapshotByHash(
                        updatedSnapshot.hash
                    );
                if (!converged) {
                    this.logger.error(
                        "onStateSnapshotUpdated - unknown snapshot while participant/pending, fatal",
                        {
                            channelId,
                            status,
                            hash: updatedSnapshot.hash
                        }
                    );
                    throw new Error(
                        `onStateSnapshotUpdated: unknown snapshot ${updatedSnapshot.hash} while status=${status}`
                    );
                }
            }
        }

        const signerAddress = this.stateManager.signerAddress;
        const snapshotParticipants = stateSnapshot.snapshotData
            .participants as Address[];
        const status = this.stateManager.status;

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
        await this.stateManager.leaveChannelService.onSettledStateObserved();
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
        // Recovery schedules this handler without awaiting validation; keep
        // this store before the first await so its immediate re-read is valid.
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
        await this.stateManager.blockQueueManager.ingestBlockConfirmation(
            blockConfirmation,
            {
                onChainTimestamp: Number(timestamp),
                validationStrategy: new CalldataCommittedStrategy(
                    this.stateManager.disputeManager,
                    this.stateManager.blockValidationStrategy
                )
            }
        );
    }

    async onDisputeCommitted(
        channelId: ChannelId,
        disputeConfirmation: DisputeConfirmationStruct,
        disputeCreationTimestamp: Timestamp,
        isFinal: boolean,
        windowCreationTimestamp: Timestamp,
        disputeAuditingData?: DisputeAuditingDataStruct
    ): Promise<void> {
        const disputeHash = hash(
            disputeConfirmation.signedDispute.encodedDispute
        );
        const inFlight = this.disputeHandlingPromises.get(disputeHash);
        if (inFlight) return inFlight;

        const handling = this.handleDisputeCommitted(
            channelId,
            disputeConfirmation,
            disputeCreationTimestamp,
            isFinal,
            windowCreationTimestamp,
            disputeAuditingData
        ).finally(() => {
            if (this.disputeHandlingPromises.get(disputeHash) === handling) {
                this.disputeHandlingPromises.delete(disputeHash);
            }
        });
        this.disputeHandlingPromises.set(disputeHash, handling);
        return handling;
    }

    private async handleDisputeCommitted(
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

        const isCurrentFork = this.stateManager.forkId === forkId;
        // isDisputeWindowRelevant?
        // A final dispute can complete an operation after its locally computed
        // candidate changed the current fork. Late non-final events must not
        // restart validation or evidence construction for the resolved fork.
        const isRelevant =
            isCurrentFork ||
            (isFinal &&
                this.stateManager.reductionManager.hasOperation(forkId));
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
            this.storage.disputes.storeDisputeConfirmation(disputeConfirmation);
            let genesis: ReductionGenesis;
            try {
                if (!disputeAuditingData) {
                    const { isPartial, auditingData } =
                        await this.stateManager.disputeManager.getAuditingData(
                            forkId,
                            dispute.input.stateProof,
                            {
                                disputeLatestInboundMessageBlockHash:
                                    dispute.input.latestInboundMessageBlockHash
                            }
                        );
                    if (isPartial) {
                        // cannot rebuild the final dispute's data yet. the
                        // confirmation is already stored, so the ordinary reduce
                        // path picks the window up with this dispute in it and
                        // derives the same result
                        this.logger.warn(
                            "Final dispute genesis deferred: auditing data could not be rebuilt locally",
                            { channelId, forkId, dispute: disputeMeta }
                        );
                        this.stateManager.reductionManager.schedule(
                            forkId,
                            Number(disputeCreationTimestamp) +
                                this.stateManager.timeConfig.chainFallbackTime,
                            true
                        );
                        return;
                    }
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
                genesis = {
                    snapshotData: outputSnapshotData,
                    encodedState:
                        disputeOutputState.encodedModifiedState as Bytes,
                    genesisTimestamp: Number(disputeCreationTimestamp),
                    outboundMessageBlock:
                        disputeOutputState.outboundMessageBlock.messages
                            .length > 0
                            ? disputeOutputState.outboundMessageBlock
                            : undefined
                };
            } catch (error) {
                const status = this.stateManager.status;
                if (
                    status !== Status.PARTICIPATING &&
                    status !== Status.PENDING_PARTICIPANT
                ) {
                    this.logger.warn(
                        "Unable to prepare final dispute genesis as a non-participant; aborting",
                        { channelId, forkId, status, error }
                    );
                    this.stateManager.abort();
                    return;
                }
                this.logger.error("Final dispute genesis preparation failed", {
                    forkId,
                    status,
                    error
                });
                throw error;
            }
            await this.stateManager.reductionManager.completeWithGenesis(
                forkId,
                dispute.outputSnapshotDataHash as ForkId,
                genesis
            );
            return;
        }

        // Use the authoritative on-chain window for this current-time race
        // decision. Only an existing, expired window changes the normal audit
        // path: challenging is then forbidden, so persist for reduction.
        const { windowExists, isExpired, killPeriodEnd } =
            await this.stateManager.stateChannelManagerContract.isKillPeriodExpired(
                channelId,
                forkId
            );
        if (windowExists && isExpired) {
            // The kill period is over, so this dispute can no longer be
            // challenged. Preserve all available data and reduce from it.
            this.logger.warn(
                "onDisputeCommited: Kill period EXPIRED! Unconditionally persisting the dispute!",
                { dispute: disputeMeta }
            );
            let persistableAuditingData = disputeAuditingData;
            if (!persistableAuditingData) {
                try {
                    const derived =
                        await this.stateManager.disputeManager.getAuditingData(
                            forkId,
                            dispute.input.stateProof,
                            {
                                disputeLatestInboundMessageBlockHash:
                                    dispute.input.latestInboundMessageBlockHash
                            }
                        );
                    if (!derived.isPartial) {
                        persistableAuditingData = derived.auditingData;
                    } else {
                        this.logger.warn(
                            "Expired dispute proof data is partial; snapshots, state, or messages are unavailable",
                            { dispute: disputeMeta }
                        );
                    }
                } catch (error) {
                    this.logger.warn(
                        "Expired dispute auditing data is unavailable; persisting decodable committed blocks only",
                        { dispute: disputeMeta, error }
                    );
                }
            }
            this.stateManager.disputeValidationService.persistDisputeDataWithoutAudit(
                dispute,
                persistableAuditingData,
                { includeUnfinalizedBlocks: true }
            );
            await this.persistDisputeAndNotify(
                channelId,
                forkId,
                disputeConfirmation
            );
            this.stateManager.reductionManager.schedule(
                forkId,
                Number(killPeriodEnd)
            );
            return;
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

            if (!disputeFraudProof) {
                this.logger.error(
                    "Dispute audit returned false without a stored fraud proof",
                    { channelId, forkId, dispute: disputeMeta }
                );
                throw new Error(
                    `Dispute audit failed without fraud proof: ${disputeMeta.disputeHash}`
                );
            }

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
        await this.persistDisputeAndNotify(
            channelId,
            forkId,
            disputeConfirmation
        );

        const canConstructMoreEvidence =
            await this.canConstructMoreEvidence(dispute);
        if (canConstructMoreEvidence) {
            this.logger.info(
                `More evidence can be constructed for dispute ${formattedHash}, disputing...`
            );
            return this.stateManager.disputeManager.dispute(forkId);
        }

        this.stateManager.reductionManager.schedule(
            forkId,
            Number(killPeriodEnd)
        );
    }

    private async persistDisputeAndNotify(
        channelId: ChannelId,
        forkId: ForkId,
        disputeConfirmation: DisputeConfirmationStruct
    ): Promise<void> {
        this.storage.disputes.storeDisputeConfirmation(disputeConfirmation);
        await P2pEventHooksUtils.notifyDisputeUpdate({
            channelId,
            forkId,
            storage: this.storage,
            p2pEventHooks: this.p2pEventHooks,
            diamondStateMachine: this.diamondStateMachine,
            logger: this.logger
        });
    }

    private async canConstructMoreEvidence(
        dispute: DisputeStruct
    ): Promise<boolean> {
        // Create our own dispute
        let ourDispute: DisputeStruct;
        try {
            ourDispute = (
                await this.stateManager.disputeManager.constructDispute(
                    this.stateManager.forkId
                )
            ).dispute;
        } catch (error) {
            if (!(error instanceof PartialAuditingDataError)) throw error;
            // we cannot rebuild our own auditing data -> we have no more
            // evidence to give. the caller falls through to scheduling the
            // reduction instead of dying on the throw
            this.logger.warn(
                "No more evidence: own auditing data could not be rebuilt locally",
                {
                    forkId: this.stateManager.forkId,
                    dispute: LoggerUtils.getDisputeMetadata(dispute)
                }
            );
            return false;
        }

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
        const latestFork = this.stateManager.forkId;
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
        reducer: Address,
        coordinate: EventCoordinate
    ): Promise<void> {
        // sync LocalDiamond state
        await this.diamondStateMachine.localDiamondContract.onDisputeReducedResultCommitted(
            channelId,
            forkId,
            reducedForkId,
            reductionTimestamp,
            reducer,
            coordinate.blockNumber,
            coordinate.logIndex
        );

        // Event synchronization remains pending while reduction validation and
        // any companion dispute-event recovery settle.
        await this.processDisputeReducedResultCommitted(
            channelId,
            forkId,
            reducedForkId,
            reducer
        );
    }

    private async processDisputeReducedResultCommitted(
        channelId: ChannelId,
        forkId: ForkId,
        reducedForkId: ForkId,
        reducer: Address
    ): Promise<void> {
        // if it's not part of the fork choice rule, ignore it - it's spam
        const isRelevant =
            this.stateManager.forkId === forkId ||
            this.stateManager.reductionManager.hasOperation(forkId);
        if (!isRelevant) {
            return;
        }

        // isFinal?
        if (
            await this.stateManager.stateChannelManagerContract.isReduceChallengePeriodExpired(
                channelId,
                forkId
            )
        ) {
            // If final, set fork and start building on it
            await this.stateManager.reductionManager.tryReduce(forkId);
            await this.stateManager.leaveChannelService.onSettledStateObserved();
            return;
        }

        // Not final - validate the reduction
        let isValid: boolean;
        try {
            isValid = await this.validateDisputeReductionAndChallenge(
                forkId,
                reducedForkId
            );
        } catch (error) {
            const status = this.stateManager.status;
            if (
                status !== Status.PARTICIPATING &&
                status !== Status.PENDING_PARTICIPANT
            ) {
                this.logger.warn(
                    "Unable to validate dispute reduction as a non-participant; aborting",
                    { channelId, forkId, reducedForkId, status, error }
                );
                this.stateManager.abort();
                return;
            }
            this.logger.error(
                "Fatal error while validating dispute reduction",
                { channelId, forkId, reducedForkId, status, error }
            );
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
        await this.stateManager.reductionManager.tryReduce(forkId);
    }

    async onWithdrawalsUpdated(
        channelId: ChannelId,
        totalWithdrawals: any,
        coordinate: EventCoordinate
    ): Promise<void> {
        await this.diamondStateMachine.localDiamondContract.onWithdrawalsUpdated(
            channelId,
            totalWithdrawals,
            coordinate.blockNumber,
            coordinate.logIndex
        );
    }

    async onChannelStorageCleared(
        channelId: ChannelId,
        latestInboundMessageBlockHash: Hash,
        coordinate: EventCoordinate
    ): Promise<void> {
        await this.diamondStateMachine.localDiamondContract.onChannelStorageCleared(
            channelId,
            latestInboundMessageBlockHash,
            coordinate.blockNumber,
            coordinate.logIndex
        );
    }

    async onDisputeKilled(
        channelId: ChannelId,
        forkId: ForkId,
        disputer: Address,
        disputeHash: Hash,
        blockTimestamp: Timestamp
    ): Promise<void> {
        await this.diamondStateMachine.localDiamondContract.onOnChainSlashAdded(
            channelId,
            disputer,
            blockTimestamp
        );
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
            await this.stateManager.stateChannelManagerContract.getWindowCommitments(
                channelId,
                forkId
            );
        if (commitments.length !== 0) return;

        //isDisputeWindowRelevant?
        const isRelevant = this.stateManager.forkId === forkId;
        if (!isRelevant) return;

        // All honest peers can observe the kill and attempt to replace the
        // dispute. Only the first upload wins; the others keep the intentional
        // DisputeManager throw contained to this expected redispute race.
        try {
            await this.stateManager.disputeManager.dispute(forkId);
        } catch (error) {
            const customError = tryDecodeCustomError(error);
            if (
                customError?.errorDescription.name ===
                "RaceConditionDisputeEvidencePeriodExpired"
            ) {
                this.logger.info(
                    "onDisputeKilled: another participant supplied replacement evidence",
                    { forkId, channelId }
                );
                return;
            }
            throw error;
        }
    }

    async onInboundMessagesProcessed(
        channelId: ChannelId,
        messageBlock: MessageBlockStruct,
        coordinate: EventCoordinate
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
            messageBlock,
            coordinate.blockNumber,
            coordinate.logIndex
        );

        // Additional join-channel-specific handling can be placed here if required
    }

    private async validateDisputeReductionAndChallenge(
        forkId: ForkId,
        reducedForkId: ForkId
    ): Promise<boolean> {
        const disputes =
            await this.stateManager.reductionManager.getSyncedForkDisputes(
                forkId
            );
        if (!disputes) {
            // the window's disputes are on-chain but not locally readable yet,
            // so we are in no position to challenge it. `true` follows the
            // chain instead, the same path a peer takes for a reduction it
            // agrees with
            this.logger.warn(
                "Dispute reduction not challenged: dispute window unavailable",
                { forkId, reducedForkId }
            );
            return true;
        }
        if (disputes.length === 0) {
            // The commitments for this fork are no longer available locally:
            // the reduction was already consumed (finalized and applied) or
            // pruned as stale after local dispute state moved on. Calling the
            // Solidity reducer with an empty set reverts
            // (ErrorNoDisputesProvided) — treat the event as already
            // processed instead. The final case was handled by the
            // challenge-period check before validation.
            this.logger.info(
                "Dispute reduction event without locally available disputes; treating as consumed",
                { forkId, reducedForkId }
            );
            return true;
        }

        const computation =
            await this.stateManager.reductionManager.computeReduction(
                forkId,
                disputes
            );
        if (!computation) {
            // we cannot rebuild the run this reduction consumed -> we are in no
            // position to challenge it. `true` follows the chain instead, the
            // same path a peer takes for a reduction it agrees with
            this.logger.warn(
                "Dispute reduction not challenged: reduce data unavailable",
                { forkId, reducedForkId }
            );
            return true;
        }
        const { reduceData } = computation;
        const latestSnapshot = reduceData.latestStateSnapshot;
        const isValid = computation.reducedForkId == reducedForkId;
        if (!isValid) {
            // while we have the context, use it, instead of returning false and having to generate it again
            let txResponse: TransactionResponse | undefined;
            const txPromise = this.stateManager.stateChannelManagerContract
                .challengeDisputeReduction(
                    disputes,
                    latestSnapshot,
                    reduceData.encodedStateMachineState,
                    reduceData.inboundMessageBlocks
                )
                .then(async (tx: TransactionResponse) => {
                    txResponse = tx;
                    await tx.wait();
                })
                .catch(async (error: any) => {
                    const success = await tryHandleEvmError(error, {
                        tx: txResponse,
                        forkId,
                        logger: this.logger,
                        signer: this.stateManager.signer,
                        handlers: {
                            ErrorCantParticipateInDispute: () => {
                                this.logger.warn(
                                    "challengeDisputeReduction: signer cannot participate in dispute",
                                    { forkId }
                                );
                            },
                            ErrorDisputeChallengePeriodExpired: () => {
                                this.logger.error(
                                    "challengeDisputeReduction: challenge period expired",
                                    { forkId }
                                );
                                throw new Error(
                                    `challengeDisputeReduction: challenge period expired for forkId=${forkId}`
                                );
                            },
                            ErrorDisputeCommitmentNotAvailable: () => {
                                this.logger.error(
                                    "challengeDisputeReduction: dispute commitment no longer available",
                                    { forkId }
                                );
                                throw new Error(
                                    `challengeDisputeReduction: dispute commitment not available for forkId=${forkId}`
                                );
                            }
                        }
                    });
                    if (!success) {
                        this.logger.error(
                            "Unhandled error in challengeDisputeReduction",
                            {
                                forkId,
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error)
                            }
                        );
                        // Do NOT rethrow — ancestor is the ethers listener with no catch.
                    }
                });
            DetachedPromises.collect(txPromise);
            return false;
        }
        return true;
    }
}
