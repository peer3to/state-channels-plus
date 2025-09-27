import {
    BlockConfirmationStruct,
    SignedBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import StateManager from "@/stateManager";
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
import { isEqual } from "lodash";
import { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";

export class EventHandler {
    constructor(
        private storage: Storage,
        private stateManager: StateManager,
        private p2pEventHooks: P2pEventHooks,
        private diamondStateMachine: ADiamondStateMachine
    ) {}

    async onStateSnapshotUpdated(
        channelId: ChannelId,
        stateSnapshot: StateSnapshotStruct,
        timestamp: Timestamp
    ): Promise<void> {
        if (!(await this.isSnapshotInPast(channelId, stateSnapshot))) {
            throw new Error(
                "StateSnapshotUpdated: Rejected snapshot for channel " +
                    channelId +
                    " - not in past"
            );
        }

        this.diamondStateMachine.localDiamondContract.onStateSnapshotUpdated(
            channelId,
            stateSnapshot,
            timestamp
        );
    }

    onBlockCalldataPosted(
        channelId: ChannelId,
        commitmentHash: Hash,
        sender: Address,
        signedBlock: SignedBlockStruct,
        timestamp: Timestamp
    ): void {
        this.diamondStateMachine.localDiamondContract.onBlockCalldataPosted(
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
        this.stateManager.onBlockConfirmation(blockConfirmation, timestamp);
    }

    async onDisputeCommitted(
        channelId: ChannelId,
        dispute: DisputeStruct,
        disputeCreationTimestamp: Timestamp,
        isFinal: boolean,
        windowCreationTimestamp: Timestamp,
        disputeAuditingData?: DisputeAuditingDataStruct
    ): Promise<void> {
        // sync LocalDiamond state
        this.diamondStateMachine.localDiamondContract.onDisputeCommitted(
            channelId,
            dispute,
            disputeCreationTimestamp,
            isFinal,
            windowCreationTimestamp
        );

        // isDisputeWindowRelevant?
        const isRelevant =
            this.stateManager.forkId === dispute.input.disputeAuditingDataHash;
        if (!isRelevant) {
            return;
        }
        if (isFinal) {
            if (!disputeAuditingData) {
                const { isPartial, auditingData } =
                    this.stateManager.disputeManager.getAuditingData(
                        dispute.input.disputeAuditingDataHash,
                        dispute.input.stateProof
                    );
                if (isPartial)
                    throw new Error(
                        "DisputeAuditingData not available on a final dispute"
                    );
                disputeAuditingData = auditingData;
            }
            // TODO - after implementing setTimeout -> reduce - come back here
            return this.stateManager.setState(
                disputeAuditingData.latestStateStateMachineState,
                dispute.outputSnapshotDataHash,
                disputeCreationTimestamp
            );
        }

        // not final - validate dispute and challenge if invalid
        const isValid =
            await this.stateManager.disputeValidationService.validateDispute(
                dispute,
                disputeAuditingData
            );

        if (isValid) {
            // this is like success - TODO - consider moving this to DisputeStrategy.success
            const { haveMoreEvidence, counterDisputeConfirmation } =
                await this.checkForAdditionalEvidence(dispute);

            if (haveMoreEvidence) {
                this.stateManager.stateChannelManagerContract.uploadDispute(
                    counterDisputeConfirmation
                );
            }
            // TODO - after implementing setTimeout -> reduce - come back here
        }
    }

    private async checkForAdditionalEvidence(dispute: DisputeStruct): Promise<{
        haveMoreEvidence: boolean;
        counterDisputeConfirmation: DisputeConfirmationStruct;
    }> {
        // Create our own dispute
        const {
            dispute: ourDispute,
            disputeConfirmation: ourDisputeConfirmation
        } = await this.stateManager.disputeManager.createDispute(
            this.stateManager.latestForkId,
            false
        );

        // Compare reduced disputes to see if we have more evidence
        const ourReducedDispute =
            await this.diamondStateMachine.localDiamondContract.reduceProxyView(
                [dispute]
            );

        const combinedReducedDispute =
            await this.diamondStateMachine.localDiamondContract.reduceProxyView(
                [ourDispute, dispute]
            );

        return {
            haveMoreEvidence: !isEqual(
                ourReducedDispute,
                ourDisputeConfirmation
            ),
            counterDisputeConfirmation: ourDisputeConfirmation
        };
    }

    async onChainSlashed(
        channelId: ChannelId,
        participant: Address,
        timestamp: Timestamp
    ): Promise<void> {
        this.diamondStateMachine.localDiamondContract.onOnChainSlashAdded(
            channelId,
            participant,
            timestamp
        );
        this.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
            participant
        );
        const latestFork = this.stateManager.latestForkId;
        const isDisputed =
            await this.diamondStateMachine.localDiamondContract.isForkDisputed(
                channelId,
                latestFork
            );
        const participants = await this.diamondStateMachine.getParticipants();
        if (!isDisputed && participants.includes(participant.toString())) {
            await this.stateManager.disputeManager.createDispute(
                latestFork,
                false
            );
        }
    }

    async onDisputeReducedResultCommitted(
        channelId: ChannelId,
        forkId: ForkId,
        reducedForkId: ForkId,
        reductionTimestamp: Timestamp,
        forkGenesisTimestamp: Timestamp,
        reducer: Address,
        isFinal: boolean
    ): Promise<void> {
        // sync LocalDiamond state
        this.diamondStateMachine.localDiamondContract.onDisputeReducedResultCommitted(
            channelId,
            forkId,
            reducedForkId,
            reductionTimestamp,
            forkGenesisTimestamp,
            reducer,
            isFinal
        );

        // if it's not part of the fork choice rule, ignore it - it's spam
        const isRelevant = this.stateManager.forkId === forkId;
        if (!isRelevant) {
            return;
        }

        // isFinal?
        if (isFinal) {
            // If final, set fork and start building on it
            await this.setForkIfLatestAndCurrent(
                reducedForkId,
                reductionTimestamp
            );
            return;
        }

        // Not final - validate the reduction
        const wasReducedCorrectly = await this.validateDisputeReduction(
            forkId,
            reducedForkId,
            reductionTimestamp,
            reducer
        );

        if (!wasReducedCorrectly) {
            // Challenge the dispute reduction if it wasn't done correctly

            const disputes = await this.getDisputesForFork(forkId);
            const latestStateSnapshot =
                await this.stateManager.stateChannelManagerContract.getStateSnapshot(
                    this.stateManager.channelId
                );
            const encodedStateMachineState =
                await this.diamondStateMachine.getState();
            const joinChannelBlocks = await this.getJoinChannelBlocks();

            await this.stateManager.stateChannelManagerContract.challengeDisputeReduction(
                disputes,
                latestStateSnapshot,
                encodedStateMachineState,
                joinChannelBlocks
            );

            // Disconnect the reducer who performed the incorrect reduction
            this.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                reducer
            );
            return;
        }

        // Reduction is valid and correct - set fork and start building on it
        await this.setForkIfLatestAndCurrent(reducedForkId, reductionTimestamp);
    }

    onWithdrawalsUpdated(channelId: ChannelId, totalWithdrawals: any): void {
        this.diamondStateMachine.localDiamondContract.onWithdrawalsUpdated(
            channelId,
            totalWithdrawals
        );
    }

    onChannelStorageCleared(
        channelId: ChannelId,
        latestJoinChannelBlockHash: Hash
    ): void {
        this.diamondStateMachine.localDiamondContract.onChannelStorageCleared(
            channelId,
            latestJoinChannelBlockHash
        );
    }

    async onDisputeKilled(
        channelId: ChannelId,
        forkId: ForkId,
        disputer: Address
    ): Promise<void> {
        this.diamondStateMachine.localDiamondContract.onDisputeKilled(
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
        await this.stateManager.disputeManager.createDispute(forkId, false);
    }

    onJoinChannelProcessed(
        channelId: ChannelId,
        joinChannelBlock: any,
        timestamp: Timestamp,
        totalDeposits: any
    ): void {
        this.diamondStateMachine.localDiamondContract.onJoinChannelProcessed(
            channelId,
            joinChannelBlock,
            timestamp,
            totalDeposits
        );
        this.stateManager.onJoinChannel(
            joinChannelBlock,
            timestamp,
            totalDeposits
        );
    }

    private async isSnapshotInPast(
        channelId: ChannelId,
        incomingSnapshot: StateSnapshotStruct
    ): Promise<boolean> {
        const previousOnChainSnapshot =
            await this.diamondStateMachine.localDiamondContract.getStateSnapshot(
                channelId
            );

        if (previousOnChainSnapshot.forkId === incomingSnapshot.forkId) {
            return (
                Number(incomingSnapshot.blockHeight) <
                Number(previousOnChainSnapshot.blockHeight)
            );
        }

        // Different fork
        return this.isIncomingSnapshotInForkChain(
            previousOnChainSnapshot.forkId,
            incomingSnapshot.forkId
        );
    }

    private isIncomingSnapshotInForkChain(
        previousOnChainForkId: ForkId,
        incomingSnapshotForkId: ForkId
    ): boolean {
        const latestBlock = this.storage.blocks.getLatestBlock(
            this.stateManager.latestForkId
        );
        if (!latestBlock) {
            // No blocks in storage for this fork, can't determine if incoming is in past
            return false;
        }

        let currentSnapshot = this.storage.getStateSnapshot(
            latestBlock.coordinates
        );
        if (!currentSnapshot) {
            return false;
        }

        while (currentSnapshot) {
            if (currentSnapshot.forkId === incomingSnapshotForkId) {
                return true; // the incoming snapshot belongs to a past fork
            }

            if (currentSnapshot.forkId === previousOnChainForkId) {
                return false;
            }

            const originForkId = currentSnapshot.snapshotData.originForkId;

            if (originForkId === "0x00") {
                return false;
            }

            currentSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                    originForkId
                );
        }
        return false;
    }

    private async validateDisputeReduction(
        forkId: ForkId,
        reducedForkId: ForkId,
        reductionTimestamp: Timestamp,
        reducer: Address
    ): Promise<boolean> {
        try {
            const isForkDisputed =
                await this.stateManager.stateChannelManagerContract.isForkDisputed(
                    this.stateManager.channelId,
                    forkId
                );

            if (!isForkDisputed) {
                return false;
            }

            // Validate that the reduction was performed correctly
            const reducedResult =
                await this.stateManager.stateChannelManagerContract.getReducedResult(
                    this.stateManager.channelId,
                    forkId
                );

            // Check if the reduced result matches what was committed
            return reducedResult[0] === reducedForkId;
        } catch (error) {
            console.error("Error validating dispute reduction:", error);
            return false;
        }
    }

    private async getStateForFork(forkId: ForkId): Promise<Bytes> {
        try {
            // Get the state for the given fork
            // This should return the encoded state machine state for the fork
            const stateSnapshot =
                await this.stateManager.stateChannelManagerContract.getStateSnapshot(
                    this.stateManager.channelId
                );

            // If the fork matches the current snapshot, return the current state
            if (stateSnapshot.forkId === forkId) {
                return await this.diamondStateMachine.getState();
            }

            // Otherwise, we need to get the state for the specific fork
            // This might require additional logic to traverse to the fork state
            return await this.diamondStateMachine.getState();
        } catch (error) {
            console.error("Error getting state for fork:", error);
            // Return current state as fallback
            return await this.diamondStateMachine.getState();
        }
    }

    private async setForkIfLatestAndCurrent(
        reducedForkId: ForkId,
        reductionTimestamp: Timestamp
    ): Promise<void> {
        const isLatestFork = this.stateManager.latestForkId === reducedForkId;
        const isCurrentFork = this.stateManager.forkId !== reducedForkId;

        if (isLatestFork && isCurrentFork) {
            // Set fork and start building on it
            await this.stateManager.setState(
                await this.getStateForFork(reducedForkId),
                reducedForkId,
                reductionTimestamp
            );
        }
    }
}
