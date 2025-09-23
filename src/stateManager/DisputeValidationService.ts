import { StateChannelManagerProxy } from "@typechain-types";
import { ethers } from "ethers";

import ADiamondStateMachine from "@/ADiamondStateMachine";
import Storage from "@/storage";
import { Codec, isSubset, Type } from "@/utils";
import { TimeConfig } from "@/types";
import { Address, ChannelId, ForkId } from "@/types/types";

import DisputeFraudProofService from "./utils/DisputeFraudProofService";
import {
    DisputeAuditingDataStruct,
    DisputeStruct,
    DisputeConfirmationStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import DisputeManager from "@/disputeManager";
import AgreementManager from "@/agreementManager";

export default class DisputeValidationService {
    private readonly disputeFraudProofService: DisputeFraudProofService;
    constructor(
        private readonly storage: Storage,
        private readonly diamondStateMachine: ADiamondStateMachine,
        private readonly stateChannelManagerContract: StateChannelManagerProxy,
        private readonly timeConfig: TimeConfig,
        private readonly disputeManager: DisputeManager,
        private readonly agreementManager: AgreementManager
    ) {
        this.disputeFraudProofService = new DisputeFraudProofService(
            this.storage
        );
    }

    async validateDisputeConfirmation(
        disputeConfirmation: DisputeConfirmationStruct,
        onChainDisputeAuditingData?: DisputeAuditingDataStruct
    ): Promise<void> {
        const dispute = Codec.decode(
            disputeConfirmation.signedDispute.encodedDispute,
            Type.Dispute
        );
        // Is Data Available (DA)
        if (onChainDisputeAuditingData) {
            const isValid =
                await this.diamondStateMachine.localDiamondContract.checkDisputeAuditingDataCommitment(
                    dispute,
                    onChainDisputeAuditingData
                );
            // sanity check
            if (!isValid)
                throw new Error(
                    "validateDisputeConfirmation - sanity check failed for onChainDisputeAuditingData"
                );
            await this.cotinueValidationWithVerifiedDisputeAuditingDataCommitment(
                dispute,
                onChainDisputeAuditingData
            );
        } else {
            // onChainDisputeAuditingData not available
            const { isPartial, auditingData } =
                this.disputeManager.getAuditingData(
                    dispute.input.disputeAuditingDataHash,
                    dispute.input.stateProof
                );
            if (isPartial) {
                // can not construct auditing data -> verifyStateProof with partial data
                const isValidStateProof =
                    await this.diamondStateMachine.localDiamondContract.verifyStateProof(
                        dispute,
                        auditingData,
                        false
                    );
                if (isValidStateProof) {
                    // *********** TODO ******************
                    // *********** This is anoying and needs some thought ********************
                    // we have to run the block confirmation pipeline on unfinalized blocks and deduct are we 'behind' an honest history and in that case accept it
                    // or reuse the failue in fraudProofs to kill the malicious dispute + this time all falilures are objective since it's commited on-chain
                    // if we deduct we're at an honest state we need to sync and try and build auditingData again
                    // if we can't build it AGAIN - error since something is wrong
                    // else build it and `cotinueValidationAuditingDataConstructed`
                    // *********** This is annoying and needs some thought ********************
                    //
                    // SCENARIO: State proof is VALID but auditing data is PARTIAL
                    // This creates a question that requires investigation
                    //
                    // MENTAL FLOW DIAGRAM:
                    // ┌─────────────────────────────────────────────────────────────┐
                    // │                    THE QUESTION                              │
                    // │  State Proof = VALID ✅  BUT  Auditing Data = PARTIAL ❌  │
                    // └─────────────────────────────────────────────────────────────┘
                    //                                │
                    //                                ▼
                    // ┌─────────────────────────────────────────────────────────────┐
                    // │              TWO POSSIBLE EXPLANATIONS                     │
                    // └─────────────────────────────────────────────────────────────┘
                    //                                │
                    //                    ┌───────────┴───────────┐
                    //                    │                       │
                    //                    ▼                       ▼
                    //    ┌─────────────────────────┐    ┌─────────────────────────┐
                    //    │   WE'RE "BEHIND"        │    │   MALICIOUS DISPUTE     │
                    //    │   (Honest but lagging)  │    │   (Someone is cheating) │
                    //    └─────────────────────────┘    └─────────────────────────┘
                    //                    │                       │
                    //                    ▼                       ▼
                    //    ┌─────────────────────────┐    ┌─────────────────────────┐
                    //    │  "ACCEPT IT"            │    │  "REUSE FAILURE"        │
                    //    │  (We need to catch up)  │    │  (Use existing fraud    │
                    //    │                         │    │   proofs to kill THIS   │
                    //    │  • Sync blockchain      │    │   dispute)              │
                    //    │  • Rebuild auditing data│    │                         │
                    //    │  • Continue validation  │    │  • InvalidStateTransition│
                    //    │                         │    │  • DoubleSign           │
                    //    │                         │    │  • InvalidTimestamp     │
                    //    │                         │    │  • WrongGenesis         │
                    //    └─────────────────────────┘    └─────────────────────────┘
                    //
                    // IMPLEMENTATION STRATEGY:
                    // 1. Run block confirmation pipeline on unfinalized blocks
                    // 2. Determine if we're "behind" an honest history:
                    //    - If YES (honest but lagging):
                    //      • Accept the situation
                    //      • Sync blockchain state
                    //      • Try to rebuild auditing data
                    //      • If rebuild fails AGAIN → error (something is wrong)
                    //      • If rebuild succeeds → continue with `cotinueValidationAuditingDataConstructed`
                    //    - If NO (malicious dispute):
                    //      • Reuse existing fraud proof failures from block confirmation pipeline
                    //      • Kill the malicious dispute using objective on-chain validations
                    //      • Fraud proofs available: InvalidStateTransition, DoubleSign, InvalidTimestamp, WrongGenesis
                } else {
                    // this is the easy case where we just need to create an invalidStateProof Dispute Fraud Proof
                    // still a TODO - but EASY
                }
            } else {
                // auditingData reconstructed in full
                await this.cotinueValidationAuditingDataConstructed(
                    dispute,
                    auditingData
                );
            }
        }
    }

    private async cotinueValidationAuditingDataConstructed(
        dispute: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct
    ): Promise<void> {
        if (
            await this.diamondStateMachine.localDiamondContract.checkDisputeAuditingDataCommitment(
                dispute,
                disputeAuditingData
            )
        ) {
            // continue down the happy path
            this.cotinueValidationWithVerifiedDisputeAuditingDataCommitment(
                dispute,
                disputeAuditingData
            );
        } else {
            // we have full correct auditingData

            //Verified DisputeAuditingData Commitment
            if (
                await this.diamondStateMachine.localDiamondContract.checkDisputeAuditingDataCommitment(
                    dispute,
                    disputeAuditingData
                )
            ) {
                // Full and Verified disputeAuditingData -> continue down the happy path
                await this.cotinueValidationWithVerifiedDisputeAuditingDataCommitment(
                    dispute,
                    disputeAuditingData
                );
            } else {
                // Full correct disputeAuditingData, but the commitment is junk or the stateProof is junk

                // verifyStateProof
                if (
                    await this.diamondStateMachine.localDiamondContract.verifyStateProof(
                        dispute,
                        disputeAuditingData,
                        false
                    )
                ) {
                    // stateProof is correct -> dispute.auditingDataHash is junk
                    // TODO - Dispute Fraud Proof IncorrectCommitmentWithValidStateProofAndValidExitChannelBlocks
                    // this should be easy
                } else {
                    // this is the easy case where we just need to create an invalidStateProof Dispute Fraud Proof
                    // still a TODO - but EASY
                }
            }
        }
    }
    private async cotinueValidationWithVerifiedDisputeAuditingDataCommitment(
        dispute: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct
    ): Promise<void> {
        // cotinuing down the happy path with the disputeAuditingData verified against the commitment

        //run stateProof with auditingDataIntegrityVerified = true
        if (
            !(await this.diamondStateMachine.localDiamondContract.verifyStateProof(
                dispute,
                disputeAuditingData,
                true
            ))
        ) {
            //TODO - create Dispute Fraud Proof DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifed
        }

        // isCorrectAuditingData - majority cheked already with stateProof - just checking exitChannelBlocks
        if (
            !(await this.diamondStateMachine.localDiamondContract.isCorrectAuditingData(
                dispute,
                disputeAuditingData
            ))
        ) {
            //TODO - create Dispute Fraud Proof InvalidStateProofWithAuditingDataVerified
        }

        // (STATEFUL - view, no compiler trick) check on-chain slashes
        const disputeCreationTimestamp =
            await this.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                dispute.input.channelId,
                dispute.input.genesisSnapshotDataHash
            );
        if (Number(disputeCreationTimestamp) === 0)
            throw new Error(
                "DissputeCreationTimestamp not set - local state not synced"
            );
        let onChainSlashes = new Set<Address>(
            await this.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipantsUpToTimestamp(
                dispute.input.channelId,
                disputeCreationTimestamp
            )
        );
        const disputeOnChainSlashes = new Set<Address>(
            dispute.input.onChainSlashes
        );
        if (!isSubset(onChainSlashes, disputeOnChainSlashes)) {
            // double check with RPC node, maybe local state not synced
            onChainSlashes = new Set<Address>(
                await this.stateChannelManagerContract.getOnChainSlashedParticipantsUpToTimestamp(
                    dispute.input.channelId,
                    disputeCreationTimestamp
                )
            );
            if (!isSubset(onChainSlashes, disputeOnChainSlashes)) {
                // TODO - Dispute Fraud Proof - DisputeOnChainSlashesNotSubset - dispute.onChainSlashes is not a subset onChainSlashes
            }
        }

        // (STATEFUL - compiler trick) verify balance invariant
        if (
            !(await this.diamondStateMachine.localDiamondContract.verifyBalanceInvariantCheckView(
                dispute,
                disputeAuditingData
            ))
        ) {
            // TODO - double check with RPC node, maybe local state not synced - I didn't expose this in the normal diamond
            // we first need to test the staticcall does it work
            // TODO - Dispute Fraud Proof DisputeInvalidBalanceInvariant
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
                // TODO - Dispute Fraud Proof NotLatestState
            }
        }

        // all timeout stuff
        if (dispute.input.timeout.participant != ethers.ZeroAddress) {
            // TODO check N/N Threshold
            // TODO check isParticipantNext
            // TODO isLinked to stateProof
            // TODO - isPostedOnChain
            // TODO - isTimedoutTooEarly
        }

        // verify dispute output
        if (
            !(await this.diamondStateMachine.isDisputeOutputCorrect(
                dispute,
                disputeAuditingData
            ))
        ) {
            // TODO - Dispute Fraud Proof - invalid Dispute output
        }

        // if we're here - it's all good
    }
}
