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
import { Codec, hash, Logger, Type } from "@/utils";
import { isEqual } from "lodash";
import { ZeroHash } from "ethers";
import CalldataCommittedStrategy from "@/stateManager/validationStrategy/CalldataCommittedStrategy";
import { Status } from "@/types";

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
            blockHeight: signedBlock.encodedBlock
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
        await this.stateManager.onBlockConfirmation(blockConfirmation, {
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
        const disputeHash = hash(
            disputeConfirmation.signedDispute.encodedDispute
        );
        this.logger.debug("Dispute committed", {
            channelId,
            forkId,
            disputeHash,
            isFinal,
            disputeCreationTimestamp,
            isForced: dispute.input.timeout?.isForced
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

        this.stateManager.p2pManager.localRpc.isForkDisputedService.requestDisputeAcknowledgment(
            channelId,
            forkId
        );

        if (isFinal) {
            if (!disputeAuditingData) {
                const { isPartial, auditingData } =
                    this.stateManager.disputeManager.getAuditingData(
                        forkId,
                        dispute.input.stateProof
                    );
                if (isPartial)
                    throw new Error(
                        "DisputeAuditingData not available on a final dispute"
                    );
                disputeAuditingData = auditingData;
            }
            return this.stateManager.setGenesisState(
                disputeAuditingData.latestStateSnapshot.snapshotData,
                disputeAuditingData.latestStateStateMachineState,
                dispute.outputSnapshotDataHash as ForkId,
                disputeCreationTimestamp
            );
        }

        // not final - validate dispute and challenge if invalid
        const isValid =
            await this.stateManager.disputeValidationService.validateDispute(
                dispute,
                disputeAuditingData
            );
        if (!isValid) {
            // TODO - do a multicall here
            await Promise.all([
                this.stateManager.disputeManager.killDispute(dispute),
                this.stateManager.disputeManager.dispute(forkId)
            ]);
            return;
        }
        this.storage.disputes.storeDisputeConfirmation(disputeConfirmation);

        // this is like success - TODO - consider moving this to DisputeStrategy.success
        const canConstructMoreEvidence =
            await this.canConstructMoreEvidence(dispute);
        if (canConstructMoreEvidence) {
            return this.stateManager.disputeManager.dispute(forkId);
        }

        const { timestamp: potentialGenesisTimestamp } =
            await this.diamondStateMachine.localDiamondContract.getGenesisTimestamp(
                channelId,
                forkId, // originForkId is this forkId
                ZeroHash // resulting forkId is not relevant here
            );

        this.stateManager.setReductionTimeout(
            forkId,
            Number(potentialGenesisTimestamp)
        );
    }

    private async canConstructMoreEvidence(
        dispute: DisputeStruct
    ): Promise<boolean> {
        // Create our own dispute
        const { dispute: ourDispute } =
            await this.stateManager.disputeManager.constructDispute(
                this.stateManager.latestForkId
            );

        // Compare reduced disputes to see if we have more evidence
        const singleDisputeReduction =
            await this.diamondStateMachine.localDiamondContract.reduce.staticCall(
                [dispute]
            );

        const combinedDisputeReduction =
            await this.diamondStateMachine.localDiamondContract.reduce.staticCall(
                [ourDispute, dispute]
            );

        const hasMoreEvidence = !isEqual(
            singleDisputeReduction,
            combinedDisputeReduction
        );
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
        const isValid = await this.validateDisputeReductionAndChallenge(
            channelId,
            forkId,
            reducedForkId
        );

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
        disputer: Address
    ): Promise<void> {
        await this.diamondStateMachine.localDiamondContract.onDisputeKilled(
            channelId,
            forkId,
            disputer
        );
        // disconnect disputer
        this.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
            disputer
        );

        // is window deleted?
        const isWindowDeleted =
            Number(
                await this.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                    channelId,
                    forkId
                )
            ) === 0;
        if (!isWindowDeleted) return;

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
            this.storage.inboundMessages.getMessageBlocksInRange(
                latestSnapshot.snapshotData.latestInboundMessageBlockHash,
                genesisSnapshot.snapshotData.latestInboundMessageBlockHash
            );
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
