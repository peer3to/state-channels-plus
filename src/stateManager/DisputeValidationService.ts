import { StateChannelManagerProxy } from "@typechain-types";
import { ethers } from "ethers";

import ADiamondStateMachine from "@/ADiamondStateMachine";
import Storage from "@/storage";
import { Codec, isSubset, Logger, tryDecodeCustomError, Type } from "@/utils";
import { Address, Bytes, Signature } from "@/types/types";

import DisputeFraudProofService from "./utils/DisputeFraudProofService";
import {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    MessageBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import DisputeManager from "@/disputeManager";
import AgreementManager from "@/agreementManager";
import type StateManager from "./StateManager";
import DisputeValidationStrategy from "./validationStrategy/DisputeValidationStrategy";
import { Block, StateSnapshot } from "@/models";
import { LoggerUtils } from "@/utils/LoggerUtils";

export default class DisputeValidationService {
    private readonly disputeFraudProofService: DisputeFraudProofService;
    private readonly storage: Storage;
    private readonly diamondStateMachine: ADiamondStateMachine;
    private readonly stateChannelManagerContract: StateChannelManagerProxy;
    private readonly disputeManager: DisputeManager;
    private readonly agreementManager: AgreementManager;
    private readonly logger: Logger;
    constructor(private readonly stateManager: StateManager) {
        this.logger = stateManager.logger.child({
            component: "DisputeValidationService"
        });
        this.storage = stateManager.storage;
        this.diamondStateMachine = stateManager.diamondStateMachine;
        this.stateChannelManagerContract =
            stateManager.stateChannelManagerContract;
        this.disputeManager = stateManager.disputeManager;
        this.agreementManager = stateManager.agreementManager;
        this.disputeFraudProofService = new DisputeFraudProofService(
            this.storage,
            this.logger
        );
    }

    async validateDispute(
        dispute: DisputeStruct,
        onChainDisputeAuditingData?: DisputeAuditingDataStruct
    ): Promise<boolean> {
        const postedAuditingData = this.hasPostedAuditingData(dispute);

        if (postedAuditingData) {
            if (!onChainDisputeAuditingData) {
                throw new Error(
                    "Dispute posted with auditing data, but auditing data missing"
                );
            }

            const isValidStateProof = await this.tryVerifyStateProof(
                dispute,
                onChainDisputeAuditingData
            );

            if (!isValidStateProof) {
                this.logger.warn("Auditing: Invalid state proof", {
                    dispute: LoggerUtils.getDisputeMetadata(dispute)
                });
                this.disputeFraudProofService.createDisputeInvalidStateProof(
                    dispute,
                    onChainDisputeAuditingData
                );
                return false;
            }

            this.persistDisputeAuditingDataForPipeline(
                dispute,
                onChainDisputeAuditingData
            );
        } else {
            const milestoneFinalityResult =
                await this.stateChannelManagerContract.isLastMilestoneFinalByEveryone.staticCall(
                    dispute
                );
            if (!milestoneFinalityResult) {
                this.disputeFraudProofService.createDisputeLastMilestoneNotFinalAndNoAuditingData(
                    dispute
                );
                return false;
            }

            const isLastMilestoneInStorage =
                this.isLastMilestoneStoredLocally(dispute);
            if (!isLastMilestoneInStorage) {
                this.logger.error(
                    "Skipping dispute audit for non-posted auditing data because the lastFinalized state is not in storage",
                    {
                        dispute: LoggerUtils.getDisputeMetadata(dispute)
                    }
                );
                return true;
            }
        }
        return await this.runStateProofBlocksThroughPipeline(dispute);
    }

    private async tryVerifyStateProof(
        dispute: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct
    ): Promise<boolean> {
        try {
            // TODO - make it work with localdiamond
            return await this.stateChannelManagerContract.verifyStateProof.staticCall(
                dispute,
                disputeAuditingData
            );
        } catch (error) {
            this.logger.debug("verifyStateProof reverted", {
                dispute: LoggerUtils.getDisputeMetadata(dispute),
                custom: tryDecodeCustomError(error)
            });
            return false;
        }
    }

    private async runStateProofBlocksThroughPipeline(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const unfinalizedBlocks =
            await this.diamondStateMachine.localDiamondContract.getUnfinalizedBlockConfirmationsFromStateProof(
                dispute.input.stateProof
            );
        let index = 0;
        for (const bc of unfinalizedBlocks) {
            const disputeStrategy = new DisputeValidationStrategy(
                this.storage,
                dispute,
                index,
                this.logger
            );
            const isOk = await this.stateManager.onBlockConfirmation(bc, {
                validationStrategy: disputeStrategy
            });
            if (!isOk) {
                this.logger.warn(
                    "RUNNING StateProof blocks - aborting pipeline -> killing dispute",
                    {
                        dispute: LoggerUtils.getDisputeMetadata(dispute),
                        block: LoggerUtils.getBlockMetadata(
                            Block.fromBlockConfirmation(bc),
                            this.storage
                        )
                    }
                );
                return false;
            }
            index++;
        }
        this.logger.debug("RUNNING StateProof blocks - completed", {
            dispute: LoggerUtils.getDisputeMetadata(dispute),
            hasDisputeFraudProof: this.hasStoredDisputeFraudProof(dispute)
        });
        if (this.hasStoredDisputeFraudProof(dispute)) return false;

        return await this.continueOtherChecks(dispute);
    }

    private async continueOtherChecks(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const isValid = true;
        const postedAuditingData = this.hasPostedAuditingData(dispute);

        //TODO - quick hack, but the stuff we need SHOULD actually be available
        const { auditingData: disputeAuditingData } =
            this.disputeManager.getAuditingData(
                dispute.input.forkId,
                dispute.input.stateProof,
                {
                    disputeLatestInboundMessageBlockHash:
                        dispute.input.latestInboundMessageBlockHash
                }
            );
        // TODO move this check above and into its own fraud proof
        if (!postedAuditingData) {
            const isCorrectLatestState =
                await this.stateChannelManagerContract.isCorrectLatestState.staticCall(
                    dispute,
                    disputeAuditingData.genesisStateSnapshotData
                );

            if (!isCorrectLatestState) {
                this.logger.warn(
                    "Dispute latest state hash is not consistent with its state proof after replay",
                    {
                        dispute: LoggerUtils.getDisputeMetadata(dispute),
                        auditingData:
                            LoggerUtils.getAuditingMetadata(disputeAuditingData)
                    }
                );
                this.disputeFraudProofService.createDisputeInvalidStateProof(
                    dispute,
                    disputeAuditingData
                );
                return false;
            }
        }

        const latestStateMachineState = this.getStateMachineStateForSnapshot(
            disputeAuditingData.latestStateSnapshot
        );

        // (STATEFUL - view) check on-chain slashes
        const disputeCreationTimestamp =
            await this.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                dispute.input.channelId,
                dispute.input.forkId
            );
        // This should always be synced since this was triggered by the on-chain event
        if (Number(disputeCreationTimestamp) === 0) {
            this.logger.error(
                "Dispute creation timestamp = 0, in LocalDiamond",
                {
                    dispute: LoggerUtils.getDisputeMetadata(dispute)
                }
            );
            return false;
        }
        let onChainSlashes = new Set<Address>(
            await this.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipantsUpToTimestamp(
                dispute.input.channelId,
                disputeCreationTimestamp
            )
        );
        const disputeOnChainSlashes = new Set<Address>(
            dispute.input.onChainSlashes
        );
        if (!isSubset(disputeOnChainSlashes, onChainSlashes)) {
            // double check with RPC node, maybe local state not synced
            onChainSlashes = new Set<Address>(
                await this.stateChannelManagerContract.getOnChainSlashedParticipantsUpToTimestamp(
                    dispute.input.channelId,
                    disputeCreationTimestamp
                )
            );
            if (!isSubset(disputeOnChainSlashes, onChainSlashes)) {
                this.logger.debug(
                    `dispute slashes ${[...disputeOnChainSlashes].map((a) => a.toString())} not subset of on-chain slashes ${[...onChainSlashes].map((a) => a.toString())}`
                );
                this.disputeFraudProofService.createDisputeOnChainSlashesNotSubset(
                    dispute
                );
                return false;
            }
        }

        // (STATEFUL - compiler trick) verify balance invariant
        const balanceInvariantValid =
            await this.stateChannelManagerContract.verifyBalanceInvariantCheckSnapshot.staticCall(
                dispute.input.channelId,
                disputeAuditingData.latestStateSnapshot.snapshotData,
                latestStateMachineState
            );
        if (!balanceInvariantValid) {
            this.logger.debug(
                `Balance invariant failed on local diamond while auditing dispute`,
                {
                    auditingData:
                        LoggerUtils.getAuditingMetadata(disputeAuditingData)
                }
            );

            this.disputeFraudProofService.createDisputeInvalidBalanceInvariant(
                dispute,
                disputeAuditingData.latestStateSnapshot,
                latestStateMachineState
            );

            return false;
        }

        // isLatestState
        const result = this.agreementManager.getLatestSignedBlockByParticipant(
            dispute.input.disputeAuditingDataHash,
            dispute.input.disputer
        );
        if (result) {
            if (
                result.block.height >
                Number(disputeAuditingData.latestStateSnapshot.blockHeight)
            ) {
                this.logger.debug("Dispute not latest state", {
                    dispute: LoggerUtils.getDisputeMetadata(dispute)
                });
                this.disputeFraudProofService.createDisputeNotLatestState(
                    dispute,
                    result.block.encode(),
                    result.signature
                );
                return false;
            }
        }

        // all timeout stuff
        if (dispute.input.timeout.participant != ethers.ZeroAddress) {
            // timedout block cooridantes
            const cooridnates = {
                forkId: disputeAuditingData.latestStateSnapshot.forkId,
                height: Number(dispute.input.timeout.blockHeight)
            };
            // participant set at timedout block
            const block = this.storage.blocks.getBlock(
                cooridnates.forkId,
                cooridnates.height
            );
            const participants = this.storage.getParticipantsUnion(
                cooridnates,
                block?.stateSnapshotHash
            );

            // [check] isLinked to stateProof
            const [hasBlock, latestBlock] =
                await this.diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                    dispute.input.stateProof
                );
            const expectedTimeoutHeight = hasBlock
                ? Number(latestBlock.transaction.header.transactionCnt) + 1
                : 0;
            if (
                expectedTimeoutHeight !==
                Number(dispute.input.timeout.blockHeight)
            ) {
                this.disputeFraudProofService.createTimeoutNotLinkedToLatestState(
                    dispute
                );
                return false;
            }

            // [check] isParticipantNext
            const nextToWrite = await this.diamondStateMachine.peekNextToWrite(
                latestStateMachineState
            );
            if (nextToWrite !== dispute.input.timeout.participant) {
                this.disputeFraudProofService.createTimeoutParticipantNotNext(
                    dispute,
                    disputeAuditingData.latestStateSnapshot,
                    latestStateMachineState
                );
                return false;
            }
            // [check] isTimedoutTooEarly
            const timeoutTimestamp = Number(
                await this.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                    dispute.input.channelId,
                    dispute.input.forkId
                )
            );
            if (!timeoutTimestamp)
                throw new Error(
                    "Timeout timestamp not found, dispute state not synced locally"
                );
            // TODO - this doesn't account for race condition (us not aware of on-chain calldata)
            const previousBlockOrSnapshot =
                this.storage.getPreviousBlockOrSnapshot(cooridnates);
            let previousTimestamp = 0;
            if (previousBlockOrSnapshot.stateSnapshot) {
                previousTimestamp =
                    previousBlockOrSnapshot.stateSnapshot.timestamp;
            } else {
                // previous block
                const previousBlock = previousBlockOrSnapshot.block!;
                const onChainSignature = dispute.input.timeout
                    .participantSignatureOnPreviousBlock as Signature;
                if (!onChainSignature || onChainSignature === "0x") {
                    // siganture not posted on-chain, so time is not forfeited
                    previousTimestamp = previousBlock.currentTimestamp;
                } else {
                    // signature exists on-chain, verify it's from the timedout participant
                    const retrievedAddress = previousBlock.signatureToAddress(
                        dispute.input.timeout
                            .participantSignatureOnPreviousBlock as Signature
                    );
                    if (retrievedAddress == dispute.input.timeout.participant) {
                        // signature is valid, so extra time is forfeited
                        previousTimestamp = previousBlock.timestamp;
                    } else {
                        // signature is invalid, so extra time is not forfeited
                        previousTimestamp = previousBlock.currentTimestamp;
                    }
                }
            }
            // previousTimestamp is now correctly set
            // TODO - think if it's <= or < (in the contract it's <=)
            if (
                timeoutTimestamp <=
                previousTimestamp +
                    this.stateManager.getTimeoutWaitTimeSeconds()
            ) {
                this.disputeFraudProofService.createTimeoutTooEarly(
                    dispute,
                    disputeAuditingData.genesisStateSnapshotData,
                    previousBlockOrSnapshot?.block?.onChainTimestamp
                );
                return false;
            }

            // [check] N/N Threshold
            if (block && block.didEveryoneSign(participants)) {
                this.disputeFraudProofService.createTimeoutThreshold(
                    dispute,
                    block.blockConfirmationStruct,
                    disputeAuditingData.latestStateSnapshot,
                    this.storage.stateSnapshots
                        .getStateSnapshotByHash(block.stateSnapshotHash)!
                        .toStruct() // should always be in storage since we have the block
                );
                return false;
            }
            // [check] isPostedOnChain
            if (block?.onChainTimestamp) {
                // TODO - race condtion
                const previousBlockCalldata = previousBlockOrSnapshot?.block
                    ? this.storage.blockCalldata.getBlockCalldata(
                          previousBlockOrSnapshot.block.forkId,
                          previousBlockOrSnapshot.block.height,
                          previousBlockOrSnapshot.block.author
                      )
                    : undefined;
                this.disputeFraudProofService.createTimeoutCalldataPosted(
                    dispute,
                    disputeAuditingData.genesisStateSnapshotData,
                    disputeAuditingData.latestStateSnapshot,
                    latestStateMachineState,
                    block.signedBlock,
                    block.onChainTimestamp,
                    previousBlockCalldata?.onChainTimestamp || 0,
                    previousBlockCalldata?.signedBlock || block.signedBlock // block.signedBlock if set won't be used it should be fill(0, sizeof(SignedBlockStruct))
                );
                return false;
            }
        }

        const isOutputValid = await this.verifyDisputeOutput(
            dispute,
            disputeAuditingData
        );

        return (
            isValid &&
            isOutputValid &&
            !this.hasStoredDisputeFraudProof(dispute)
        );
    }

    private async verifyDisputeOutput(
        dispute: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct
    ): Promise<boolean> {
        const latestStateMachineState = this.getStateMachineStateForSnapshot(
            disputeAuditingData.latestStateSnapshot
        );

        const isInputLinked = await this.isDataLinkedToDisputeInput(
            dispute,
            disputeAuditingData.latestStateSnapshot,
            latestStateMachineState,
            disputeAuditingData.inboundMessageBlocks
        );

        if (!isInputLinked) {
            this.logger.error(
                "Skipping dispute output verification because auditing input is not linked to dispute input",
                {
                    dispute: LoggerUtils.getDisputeMetadata(dispute),
                    auditingData:
                        LoggerUtils.getAuditingMetadata(disputeAuditingData)
                }
            );
            throw new Error(
                "Verify Dispute Output - sanity check - is data linked - failed"
            );
        }

        // verify dispute output
        const isCorrectDisputeOutput =
            await this.diamondStateMachine.localDiamondContract.isDisputeOutputCorrect.staticCall(
                dispute,
                disputeAuditingData.latestStateSnapshot,
                latestStateMachineState,
                disputeAuditingData.inboundMessageBlocks
            );

        if (!isCorrectDisputeOutput) {
            // invalid dispute output
            this.disputeFraudProofService.createDisputeInvalidOutputState(
                dispute,
                disputeAuditingData.latestStateSnapshot,
                latestStateMachineState,
                disputeAuditingData.inboundMessageBlocks
            );
            return false;
        }

        return true;
    }

    private async isDataLinkedToDisputeInput(
        dispute: DisputeStruct,
        latestStateSnapshot: StateSnapshotStruct,
        latestStateMachineState: Bytes,
        inboundMessageBlocks: MessageBlockStruct[]
    ): Promise<boolean> {
        const isLatestStateLinked = await this.isLatestStateLinkedToLatestBlock(
            dispute,
            latestStateSnapshot,
            latestStateMachineState
        );

        if (!isLatestStateLinked) {
            return false;
        }

        return this.verifyInboundMessageBlocks(
            String(
                latestStateSnapshot.snapshotData.latestInboundMessageBlockHash
            ),
            String(dispute.input.latestInboundMessageBlockHash),
            inboundMessageBlocks
        );
    }

    private async isLatestStateLinkedToLatestBlock(
        dispute: DisputeStruct,
        latestStateSnapshot: StateSnapshotStruct,
        latestStateMachineState: Bytes
    ): Promise<boolean> {
        const latestSnapshot = StateSnapshot.from(latestStateSnapshot);
        const latestSnapshotHash = latestSnapshot.hash;

        if (latestSnapshotHash !== dispute.input.latestStateSnapshotHash) {
            return false;
        }

        if (
            latestStateSnapshot.snapshotData.stateMachineStateHash !==
            ethers.keccak256(latestStateMachineState)
        ) {
            return false;
        }

        const [hasBlock, latestBlock] =
            await this.diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                dispute.input.stateProof
            );

        if (hasBlock) {
            return latestBlock.stateSnapshotHash === latestSnapshotHash;
        }

        return dispute.input.forkId === latestSnapshot.snapshotDataHash;
    }

    private verifyInboundMessageBlocks(
        previousInboundMessageBlockHash: string,
        latestInboundMessageBlockHash: string,
        inboundMessageBlocks: MessageBlockStruct[]
    ): boolean {
        let expectedPreviousHash = previousInboundMessageBlockHash;
        let lastHeight: bigint | undefined;

        for (const inboundMessageBlock of inboundMessageBlocks) {
            if (
                expectedPreviousHash !== inboundMessageBlock.previousBlockHash
            ) {
                return false;
            }

            const currentHeight = BigInt(inboundMessageBlock.blockHeight);
            if (lastHeight !== undefined && currentHeight !== lastHeight + 1n) {
                return false;
            }

            expectedPreviousHash = ethers.keccak256(
                Codec.encode(inboundMessageBlock, Type.MessageBlock)
            );
            lastHeight = currentHeight;
        }

        return expectedPreviousHash === latestInboundMessageBlockHash;
    }

    private hasPostedAuditingData(dispute: DisputeStruct): boolean {
        return Boolean(
            (dispute as unknown as { postedAuditingData?: boolean })
                .postedAuditingData
        );
    }

    private getStateMachineStateForSnapshot(
        snapshot: StateSnapshotStruct
    ): Bytes {
        const stateFromSnapshot =
            this.storage.stateMachineStates.getStateMachineState(
                snapshot.snapshotData.stateMachineStateHash
            );

        if (stateFromSnapshot) {
            return stateFromSnapshot;
        }

        throw new Error("State machine state missing for snapshot");
    }

    private isLastMilestoneStoredLocally(dispute: DisputeStruct): boolean {
        const lastMilestone = dispute.input.stateProof.milestones.at(-1);
        if (lastMilestone) {
            const firstBlockConfirmation =
                lastMilestone.blockConfirmations.at(0);
            if (!firstBlockConfirmation) {
                this.logger.debug(
                    "State proof anchor missing: last milestone has no block confirmations",
                    {
                        dispute: LoggerUtils.getDisputeMetadata(dispute),
                        stateProof: LoggerUtils.getStateProofMetadata(
                            dispute.input.stateProof
                        )
                    }
                );
                return false;
            }

            const block = Block.fromBlockConfirmation(firstBlockConfirmation);
            const storedBlock = this.storage.blocks.getBlock(block.hash);
            if (!storedBlock) {
                this.logger.debug(
                    "State proof anchor missing: first block of last milestone not found in local block storage",
                    {
                        dispute: LoggerUtils.getDisputeMetadata(dispute),
                        stateProof: LoggerUtils.getStateProofMetadata(
                            dispute.input.stateProof
                        ),
                        block: LoggerUtils.getBlockMetadata(block)
                    }
                );
                return false;
            }

            this.logger.debug(
                "State proof anchor found: last milestone is present in local block storage",
                {
                    dispute: LoggerUtils.getDisputeMetadata(dispute),
                    block: LoggerUtils.getBlockMetadata(storedBlock)
                }
            );
            return true;
        }

        const firstSignedBlock = dispute.input.stateProof.signedBlocks.at(0);
        if (!firstSignedBlock) {
            const genesisSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotByForkId(
                    dispute.input.forkId
                );

            if (!genesisSnapshot) {
                this.logger.debug(
                    "State proof anchor missing: empty state proof but genesis snapshot is not stored locally",
                    {
                        dispute: LoggerUtils.getDisputeMetadata(dispute),
                        stateProof: LoggerUtils.getStateProofMetadata(
                            dispute.input.stateProof
                        )
                    }
                );
                return false;
            }

            const stateMachineState =
                this.storage.stateMachineStates.getStateMachineState(
                    genesisSnapshot.stateMachineStateHash
                );
            if (!stateMachineState) {
                this.logger.debug(
                    "State proof anchor missing: empty state proof but genesis state machine state is not stored locally",
                    {
                        dispute: LoggerUtils.getDisputeMetadata(dispute),
                        stateProof: LoggerUtils.getStateProofMetadata(
                            dispute.input.stateProof
                        ),
                        genesisSnapshot:
                            LoggerUtils.getSnapshotMetadata(genesisSnapshot)
                    }
                );
                return false;
            }

            this.logger.debug(
                "State proof anchor found: empty state proof uses locally stored genesis snapshot and state",
                {
                    dispute: LoggerUtils.getDisputeMetadata(dispute),
                    genesisSnapshot:
                        LoggerUtils.getSnapshotMetadata(genesisSnapshot)
                }
            );
            return true;
        }

        const block = Block.fromSignedBlock(firstSignedBlock);

        try {
            const previousBlockOrSnapshot =
                this.storage.getPreviousBlockOrSnapshot(block.coordinates);
            const isAnchored = !!(
                previousBlockOrSnapshot.block ||
                previousBlockOrSnapshot.stateSnapshot
            );
            if (!isAnchored) {
                this.logger.debug(
                    "State proof anchor missing: previous block or snapshot for first signed block not found locally",
                    {
                        dispute: LoggerUtils.getDisputeMetadata(dispute),
                        stateProof: LoggerUtils.getStateProofMetadata(
                            dispute.input.stateProof
                        ),
                        block: LoggerUtils.getBlockMetadata(block)
                    }
                );
                return false;
            }

            this.logger.debug(
                "State proof anchor found: previous block or snapshot for first signed block exists locally",
                {
                    dispute: LoggerUtils.getDisputeMetadata(dispute),
                    block: LoggerUtils.getBlockMetadata(block),
                    hasPreviousBlock: !!previousBlockOrSnapshot.block,
                    hasPreviousSnapshot: !!previousBlockOrSnapshot.stateSnapshot
                }
            );
            return true;
        } catch {
            this.logger.debug(
                "State proof anchor lookup failed while resolving previous block or snapshot for first signed block",
                {
                    dispute: LoggerUtils.getDisputeMetadata(dispute),
                    stateProof: LoggerUtils.getStateProofMetadata(
                        dispute.input.stateProof
                    ),
                    block: LoggerUtils.getBlockMetadata(block)
                }
            );
            return false;
        }
    }

    private persistDisputeAuditingDataForPipeline(
        dispute: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct
    ): void {
        const latestFinalizedSnapshot =
            this.agreementManager.getLatestFinalizedSnapshot(
                dispute.input.stateProof,
                dispute.input.forkId
            );

        if (disputeAuditingData.latestFinalizedStateStateMachineState !== "") {
            this.storage.stateMachineStates.storeStateMachineState(
                disputeAuditingData.latestFinalizedStateStateMachineState,
                {
                    hash: latestFinalizedSnapshot.stateMachineStateHash
                }
            );
        }

        for (const milestoneSnapshot of disputeAuditingData.milestoneSnapshots) {
            this.storage.stateSnapshots.storeStateSnapshot(
                StateSnapshot.from(milestoneSnapshot)
            );
        }

        for (const messageBlock of disputeAuditingData.inboundMessageBlocks) {
            this.storage.inboundMessages.store(messageBlock, {
                justPersist: true
            });
        }

        for (const messageBlock of disputeAuditingData.outboundMessageBlocks) {
            this.storage.outboundMessages.store(messageBlock, {
                justPersist: true
            });
        }

        for (const milestone of dispute.input.stateProof.milestones) {
            const finalizedConfirmation = milestone.blockConfirmations.at(0);
            if (!finalizedConfirmation) {
                continue;
            }

            const block = Block.fromBlockConfirmation(finalizedConfirmation);
            this.storage.blocks.storeBlock(block, {
                hash: block.hash,
                coordinates: block.coordinates,
                justPersist: true
            });
        }
    }

    private hasStoredDisputeFraudProof(dispute: DisputeStruct): boolean {
        return !!this.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
            dispute
        );
    }
}
