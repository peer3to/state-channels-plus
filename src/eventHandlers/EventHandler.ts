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
import { Codec, Type } from "@/utils";
import { isEqual } from "lodash";
import { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";
import { ethers } from "ethers";

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
        const isValid = await this.validateDisputeReduction(
            forkId,
            reducedForkId,
            reductionTimestamp,
            reducer
        );

        if (!isValid) {
            // Challenge the dispute reduction if it wasn't done correctly
            const disputes = await this.getDisputesForFork(forkId);
            const latestStateSnapshot =
                await this.stateManager.stateChannelManagerContract.getStateSnapshot(
                    this.stateManager.channelId
                );
            const encodedStateMachineState =
                await this.diamondStateMachine.getState();
            const joinChannelBlocks =
                await this.getJoinChannelBlocksForFork(latestStateSnapshot);

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

    private async getStateForFork(
        forkId: ForkId,
        latestStateSnapshot?: StateSnapshotStruct
    ): Promise<Bytes> {
        try {
            // Get the latest state snapshot if not provided
            let currentLatestSnapshot = latestStateSnapshot;
            if (!currentLatestSnapshot) {
                currentLatestSnapshot =
                    await this.stateManager.stateChannelManagerContract.getStateSnapshot(
                        this.stateManager.channelId
                    );
            }

            // If the latest snapshot is for the fork we want, use its state
            if (currentLatestSnapshot.forkId === forkId) {
                const stateHash =
                    currentLatestSnapshot.snapshotData.stateMachineStateHash;
                const encodedState =
                    this.stateManager.storage.stateMachineStates.getStateMachineState(
                        stateHash
                    );
                if (encodedState) {
                    return encodedState;
                }
            }

            // Fallback: use existing getGenesisStateMachineState method
            const genesisState =
                this.stateManager.storage.getGenesisStateMachineState(forkId);
            if (genesisState) {
                return genesisState;
            }

            throw new Error(`No state found for fork ${forkId}`);
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
            // Get the latest state snapshot
            const latestStateSnapshot =
                await this.stateManager.stateChannelManagerContract.getStateSnapshot(
                    this.stateManager.channelId
                );

            // Set fork and start building on it
            await this.stateManager.setState(
                await this.getStateForFork(reducedForkId, latestStateSnapshot),
                reducedForkId,
                reductionTimestamp
            );
        }
    }

    private async getDisputesForFork(forkId: ForkId): Promise<any[]> {
        try {
            // Get dispute commitments for this fork using the contract
            const disputeCommitments =
                await this.stateManager.stateChannelManagerContract.getWindowCommitments(
                    this.stateManager.channelId,
                    forkId
                );

            if (disputeCommitments.length === 0) {
                console.log(`No dispute commitments found for fork ${forkId}`);
                return [];
            }

            const disputes: DisputeStruct[] = [];

            for (const disputeCommitment of disputeCommitments) {
                const disputeConfirmation =
                    this.stateManager.storage.disputes.getDisputeConfirmation(
                        disputeCommitment
                    );

                if (disputeConfirmation) {
                    const dispute = Codec.decode(
                        disputeConfirmation.signedDispute.encodedDispute,
                        Type.Dispute
                    ) as DisputeStruct;
                    disputes.push(dispute);
                } else {
                    console.log(
                        `Dispute confirmation not found for commitment ${disputeCommitment}`
                    );
                }
            }

            console.log(`Found ${disputes.length} disputes for fork ${forkId}`);
            return disputes;
        } catch (error) {
            console.error("Error getting disputes for fork:", error);
            return [];
        }
    }

    private async getJoinChannelBlocksForFork(
        latestStateSnapshot?: StateSnapshotStruct
    ): Promise<any[]> {
        try {
            // Get the latest state snapshot if not provided
            let currentLatestSnapshot = latestStateSnapshot;
            if (!currentLatestSnapshot) {
                currentLatestSnapshot =
                    await this.stateManager.stateChannelManagerContract.getStateSnapshot(
                        this.stateManager.channelId
                    );
            }

            // Get all join channel blocks
            const joinChannelBlocks =
                this.stateManager.storage.joinChannelBlocks.getBlocksInRange(
                    currentLatestSnapshot.snapshotData
                        .latestJoinChannelBlockHash,
                    ethers.ZeroHash
                );

            console.log(`Got ${joinChannelBlocks.length} join channel blocks`);
            return joinChannelBlocks;
        } catch (error) {
            console.error("Error getting join channel blocks:", error);
            return [];
        }
    }
}
