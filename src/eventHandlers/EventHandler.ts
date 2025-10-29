import {
    BlockConfirmationStruct,
    SignedBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeAuditingDataStruct,
    DisputeStruct,
    DisputeConfirmationStruct
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
import { Codec, hash, Logger, Type } from "@/utils";
import { isEqual } from "lodash";
import { ZeroHash } from "ethers";

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
        this.logger.info("Channel opened", {
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
        if (!(await this.isSnapshotInPast(channelId, stateSnapshot))) {
            throw new Error(
                "StateSnapshotUpdated: Rejected snapshot for channel " +
                    channelId +
                    " - not in past"
            );
        }

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
        this.logger.debug("Block calldata posted on-chain", {
            channelId,
            commitmentHash,
            sender,
            blockHeight: signedBlock.encodedBlock
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
        await this.stateManager.onBlockConfirmation(
            blockConfirmation,
            timestamp
        );
    }

    async onDisputeCommitted(
        channelId: ChannelId,
        dispute: DisputeStruct,
        disputeCreationTimestamp: Timestamp,
        isFinal: boolean,
        windowCreationTimestamp: Timestamp,
        disputeAuditingData?: DisputeAuditingDataStruct
    ): Promise<void> {
        const forkId = dispute.input.disputeAuditingDataHash;
        this.logger.warn("Dispute committed", {
            channelId,
            forkId,
            isFinal,
            disputeCreationTimestamp
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
            // TODO - after implementing setTimeout -> reduce - come back here
            throw new Error("Not implemented yet - final dispute");
            // return this.stateManager.setGenesisState(
            //     disputeAuditingData.latestStateStateMachineState,
            //     dispute.outputSnapshotDataHash,
            //     disputeCreationTimestamp
            // );
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
                await this.stateManager.stateChannelManagerContract.uploadDispute(
                    counterDisputeConfirmation
                );
                return;
            }
            const [_, potentialGenesisTimestamp] =
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
            await this.diamondStateMachine.localDiamondContract.reduce.staticCall(
                [dispute]
            );

        const combinedReducedDispute =
            await this.diamondStateMachine.localDiamondContract.reduce.staticCall(
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
        await this.diamondStateMachine.localDiamondContract.onOnChainSlashAdded(
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
        latestJoinChannelBlockHash: Hash
    ): Promise<void> {
        await this.diamondStateMachine.localDiamondContract.onChannelStorageCleared(
            channelId,
            latestJoinChannelBlockHash
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
        await this.stateManager.disputeManager.createDispute(forkId, false);
    }

    async onJoinChannelProcessed(
        channelId: ChannelId,
        joinChannelBlock: any,
        timestamp: Timestamp,
        totalDeposits: any
    ): Promise<void> {
        await this.diamondStateMachine.localDiamondContract.onJoinChannelProcessed(
            channelId,
            joinChannelBlock,
            timestamp,
            totalDeposits
        );
        await this.stateManager.onJoinChannel(
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

    private async validateDisputeReductionAndChallenge(
        channelId: ChannelId,
        forkId: ForkId,
        reducedForkId: ForkId
    ): Promise<boolean> {
        // TODO - extract this function since it's used in multiple places (e.g spectating RPC...)
        const disputeWindow = (
            await this.diamondStateMachine.localDiamondContract.getDisputeWindows(
                channelId,
                [forkId]
            )
        )[0];
        const dispteuConfirmations: DisputeConfirmationStruct[] = [];
        for (const commitment of disputeWindow.evidence.disputeCommitments) {
            const dc = this.storage.disputes.getDisputeConfirmation(commitment);
            if (!dc) {
                //TODO - querry longs
                throw new Error(
                    `Dispute not available for commitment: ${commitment}`
                );
            }
            dispteuConfirmations.push(dc);
        }

        const disputes = dispteuConfirmations.map((dc) =>
            Codec.decode(dc.signedDispute.encodedDispute, Type.Dispute)
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
            this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(forkId);
        if (!genesisSnapshot)
            throw new Error(
                `GenesisSnapshot not available for forkId: ${forkId}`
            );
        const jcbs = this.storage.joinChannelBlocks.getBlocksInRange(
            genesisSnapshot.snapshotData.latestJoinChannelBlockHash,
            latestSnapshot.snapshotData.latestJoinChannelBlockHash
        );
        const [snapshotData] =
            await this.stateManager.stateChannelManagerContract.reduceOutputToSnapshotData.staticCall(
                forkId,
                reduceOutput,
                latestSnapshot,
                state,
                jcbs
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
                jcbs
            );
            return false;
        }
        return true;
    }

    private async setForkIfLatestAndCurrent(
        forkId: ForkId,
        reducedForkId: ForkId,
        reductionTimestamp: Timestamp
    ): Promise<void> {
        // enough for now - this will change later
        if (this.stateManager.forkId == forkId) {
            // Get the latest state snapshot - it should be reduced locally if not we'll reduce it on the spot
            const latestStateSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                    reducedForkId
                );
            if (!latestStateSnapshot) {
                // TODO reduce localy
            }
            const genesisStateMachineState =
                this.storage.stateMachineStates.getStateMachineState(
                    latestStateSnapshot!.stateMachineStateHash
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
