import { StateChannelManagerProxy } from "@typechain-types";
import { ethers } from "ethers";

import ADiamondStateMachine from "@/ADiamondStateMachine";
import Storage from "@/storage";
import { isSubset, Logger, tryDecodeCustomError } from "@/utils";
import { Address, Signature } from "@/types/types";

import DisputeFraudProofService from "./utils/DisputeFraudProofService";
import {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import DisputeManager from "@/disputeManager";
import AgreementManager from "@/agreementManager";
import type StateManager from "./StateManager";
import DisputeValidationStrategy from "./validationStrategy/DisputeValidationStrategy";
import { StateSnapshot } from "@/models";
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
        const isSynced = await this.isSyncedToStateProof(dispute);
        if (!isSynced) {
            this.logger.debug("Not synced to state proof for dispute", {
                dispute: LoggerUtils.getDisputeMetadata(dispute),
                nextBlockHeight: this.storage.blocks.getNextBlockHeight(
                    dispute.input.forkId
                )
            });
            //TODO - check long range milestone attack
            const { shouldContinueVerification } = await this.trySync(dispute);
            if (!shouldContinueVerification) return false;
        }

        // Is Data Available (DA)
        if (onChainDisputeAuditingData) {
            const isValid =
                await this.diamondStateMachine.localDiamondContract.checkDisputeAuditingDataCommitment(
                    dispute,
                    onChainDisputeAuditingData
                );
            // sanity check
            if (!isValid) {
                return false;
            }
            return await this.continueValidationWithVerifiedDisputeAuditingDataCommitment(
                dispute,
                onChainDisputeAuditingData
            );
        }
        return await this.tryReconstructAuditingData(dispute);
    }

    private async tryReconstructAuditingData(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const { isPartial, auditingData } = this.disputeManager.getAuditingData(
            dispute.input.forkId,
            dispute.input.stateProof
        );

        const isValidStateProofWithoutIntegrity =
            await this.diamondStateMachine.localDiamondContract.verifyStateProof(
                dispute,
                auditingData,
                false
            );

        if (isPartial) {
            if (!isValidStateProofWithoutIntegrity) {
                // partial auditingData and invalid stateProof
                this.disputeFraudProofService.createDisputeInvalidStateProofWithoutAuditingDataIntegrityVerified(
                    dispute,
                    auditingData
                );
                return false;
            }
            // valid stateProof but partial auditingData
            const msg =
                "DisputeValidation DATA MISSING - valid state proof, but not synced -> can not reconstruct auditing data to audit dispute";
            this.logger.error(msg, { auditingData });
            throw new Error(msg);
        }

        const isValidCommitment =
            await this.diamondStateMachine.localDiamondContract.checkDisputeAuditingDataCommitment(
                dispute,
                auditingData
            );
        if (!isValidCommitment) {
            if (!isValidStateProofWithoutIntegrity) {
                // full auditingData and invalid stateProof
                this.disputeFraudProofService.createDisputeInvalidStateProofWithoutAuditingDataIntegrityVerified(
                    dispute,
                    auditingData
                );
                return false;
            }
            // stateProof is correct -> dispute.auditingDataHash is junk
            this.disputeFraudProofService.createDisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocks(
                dispute,
                auditingData
            );
            return false;
        }

        // valid commitment
        return await this.continueValidationWithVerifiedDisputeAuditingDataCommitment(
            dispute,
            auditingData
        );
    }

    private async continueValidationWithVerifiedDisputeAuditingDataCommitment(
        dispute: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct
    ): Promise<boolean> {
        // continuing down the happy path with the disputeAuditingData verified against the commitment

        //run stateProof with auditingDataIntegrityVerified = true
        if (
            !(await this.diamondStateMachine.localDiamondContract.verifyStateProof(
                dispute,
                disputeAuditingData,
                true
            ))
        ) {
            // data integrity verified but stateProof invalid
            this.disputeFraudProofService.createDisputeInvalidStateProofWithAuditingDataIntegrityVerified(
                dispute,
                disputeAuditingData
            );
            return false;
        }

        // isCorrectAuditingData - majority checked already with stateProof - just checking exitChannelBlocks
        if (
            !(await this.diamondStateMachine.localDiamondContract.isCorrectAuditingData(
                dispute,
                disputeAuditingData
            ))
        ) {
            // valid stateProof, data integrity verified, but incorrect auditingData
            this.disputeFraudProofService.createDisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified(
                dispute,
                disputeAuditingData
            );
            return false;
        }

        // continue down the happy path
        return await this.stateProofAndAuditingDataAreValid(
            dispute,
            disputeAuditingData
        );
    }

    private async trySync(
        dispute: DisputeStruct
    ): Promise<{ shouldContinueVerification: boolean }> {
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
                const disputeFraudProof =
                    this.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                        dispute
                    );
                if (!disputeFraudProof) {
                    this.logger.warn(
                        "No dispute fraud proof found after failed validation during trySync"
                    );
                    return { shouldContinueVerification: true }; // couldn't deduct a dispute fraud proof to kill the dispute => continue with verification pipeline
                }
                try {
                    const txResponse =
                        await this.stateChannelManagerContract.applyDisputeFraudProofs(
                            [disputeFraudProof]
                        );
                    await txResponse.wait();
                } catch (e) {
                    const custom = tryDecodeCustomError(e);
                    this.logger.error("Error applying dispute fraud proof:", {
                        error: e,
                        custom
                    });
                }
                return { shouldContinueVerification: false };
            }
            index++;
        }
        return { shouldContinueVerification: true };
    }

    private async stateProofAndAuditingDataAreValid(
        dispute: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct
    ): Promise<boolean> {
        // Continuing down the happy path

        // (STATEFUL - view) check on-chain slashes
        const disputeCreationTimestamp =
            await this.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                dispute.input.channelId,
                dispute.input.forkId
            );
        // This should always be synced since this was triggered by the on-chain event
        if (Number(disputeCreationTimestamp) === 0) {
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
                    dispute,
                    disputeAuditingData
                );
                return false;
            }
        }

        // (STATEFUL - compiler trick) verify balance invariant
        const balanceInvariantValid =
            await this.stateChannelManagerContract.verifyBalanceInvariantCheckSnapshot.staticCall(
                dispute.input.channelId,
                disputeAuditingData.latestStateSnapshot.snapshotData,
                disputeAuditingData.latestStateStateMachineState
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
                disputeAuditingData
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
            const participants = this.storage.getParticipants(cooridnates);
            const block = this.storage.blocks.getBlock(
                cooridnates.forkId,
                cooridnates.height
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
                disputeAuditingData.latestStateStateMachineState
            );
            if (nextToWrite !== dispute.input.timeout.participant) {
                this.disputeFraudProofService.createTimeoutParticipantNotNext(
                    dispute,
                    disputeAuditingData
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
                        previousTimestamp = previousBlock.currentTimestamp;
                    } else {
                        // signature is invalid, so extra time is not forfeited
                        previousTimestamp = previousBlock.getRelevantTimestamp(
                            dispute.input.timeout.participant
                        );
                    }
                }
            }
            // previousTimestamp is now correctly set
            // TODO - think if it's <= or <
            if (
                timeoutTimestamp <
                previousTimestamp +
                    this.stateManager.getTimeoutWaitTimeSeconds()
            ) {
                this.disputeFraudProofService.createTimeoutTooEarly(
                    dispute,
                    disputeAuditingData,
                    previousBlockOrSnapshot?.block?.onChainTimestamp
                );
                return false;
            }

            // [check] N/N Threshold
            if (block && block.didEveryoneSign(participants)) {
                this.disputeFraudProofService.createTimeoutThreshold(
                    dispute,
                    disputeAuditingData,
                    block.blockConfirmationStruct
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
                    disputeAuditingData,
                    block.signedBlock,
                    block.onChainTimestamp,
                    previousBlockCalldata?.onChainTimestamp || 0,
                    previousBlockCalldata?.signedBlock || block.signedBlock // block.signedBlock if set won't be used it should be fill(0, sizeof(SignedBlockStruct))
                );
                return false;
            }
        }

        return await this.verifyDisputeOutput(dispute, disputeAuditingData);
    }

    private async isSyncedToStateProof(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const [hasBlock, latestBlock] =
            await this.diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                dispute.input.stateProof
            );
        if (!hasBlock) {
            // geneisis state
            return !!this.storage.stateSnapshots.getGenesisSnapshotByForkId(
                dispute.input.forkId
            );
        }

        return !!this.storage.blocks.getBlock(
            dispute.input.forkId,
            Number(latestBlock.transaction.header.transactionCnt)
        );
    }

    private async verifyDisputeOutput(
        dispute: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct
    ): Promise<boolean> {
        // verify dispute output
        const isCorrectDisputeOutput =
            await this.diamondStateMachine.localDiamondContract.isDisputeOutputCorrect.staticCall(
                dispute,
                disputeAuditingData
            );

        if (!isCorrectDisputeOutput) {
            // invalid dispute output
            this.disputeFraudProofService.createDisputeInvalidOutputState(
                dispute,
                disputeAuditingData
            );
            return false;
        }

        // if we're here - it's all good

        // check once more are we synced, since if we're not -> we have to persist parts of auditing data so we can reduce later
        const isSynced = await this.isSyncedToStateProof(dispute);
        if (!isSynced) {
            // other peers are not cooperating with us, but the chain gave us enough data to verify the dispute
            this.logger.warn(
                "Dispute output is CORRECT, but not synced to state proof - persisting auditing data to be able to reduce - other peers are not cooperating and probably tried a long range attack",
                {
                    auditingData:
                        LoggerUtils.getAuditingMetadata(disputeAuditingData)
                }
            );
            const snapshot = StateSnapshot.from(
                disputeAuditingData.latestStateSnapshot
            );
            this.storage.stateSnapshots.storeStateSnapshot(snapshot);
            this.storage.stateMachineStates.storeStateMachineState(
                disputeAuditingData.latestStateStateMachineState
            );
            for (const messageBlock of disputeAuditingData.outboundMessageBlocks) {
                this.storage.inboundMessages.store(messageBlock, {
                    justPersist: true
                });
            }
        }
        return true;
    }
}
