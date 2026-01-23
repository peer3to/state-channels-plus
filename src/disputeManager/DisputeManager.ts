import { ethers } from "ethers";
import AgreementManager from "../agreementManager";
import { StateChannelManagerProxy } from "@typechain-types";
import {
    DisputeConfirmationStruct,
    DisputeStruct,
    DisputeAuditingDataStruct,
    DisputeInputStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import {
    DebugProxy,
    hash,
    intersection,
    Codec,
    Type,
    SignatureUtils,
    Mutex,
    difference,
    Logger
} from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import P2pEventHooks from "@/P2pEventHooks";
import { Address, ChannelId, ForkId } from "../types/types";
import { StateSnapshot } from "../models";
import Storage from "@/storage";
import ADiamondStateMachine from "../ADiamondStateMachine";
import {
    StateProofStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import Clock from "../Clock";
import { BytesLike } from "ethers";
import { config } from "@/utils/config";

export type ConstructDisputeResult = {
    dispute: DisputeStruct;
    disputeConfirmation: DisputeConfirmationStruct;
    auditingData: DisputeAuditingDataStruct;
    fraudProofsToApply: FraudProofStruct[];
};

const DEFAULT_GAS_LIMIT = 5000000;
class DisputeManager {
    signer: ethers.Signer;
    signerAddress: Address;
    agreementManager: AgreementManager;
    stateChannelManagerContract: StateChannelManagerProxy;
    channelId: ChannelId;
    p2pEventHooks: P2pEventHooks;
    self = config.DEBUG_DISPUTE_HANDLER ? DebugProxy.createProxy(this) : this;
    storage: Storage;
    diamondStateMachine: ADiamondStateMachine;
    mutex: Mutex = new Mutex();
    private logger: Logger;

    constructor(
        channelId: ChannelId,
        signer: ethers.Signer,
        signerAddress: Address,
        agreementManager: AgreementManager,
        stateChannelManagerContract: StateChannelManagerProxy,
        p2pEventHooks: P2pEventHooks,
        storage: Storage,
        diamondStateMachine: ADiamondStateMachine,
        logger: Logger
    ) {
        this.channelId = channelId;
        this.signer = signer;
        this.signerAddress = signerAddress;
        this.agreementManager = agreementManager;
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.p2pEventHooks = p2pEventHooks;
        this.storage = storage;
        this.diamondStateMachine = diamondStateMachine;
        this.logger = logger.child({ component: "DisputeManager" });
        return this.self;
    }

    public async dispute(forkId: ForkId): Promise<void> {
        try {
            await this.mutex.lock();
            if (this.storage.disputes.didIDispute(forkId)) return;

            const {
                dispute,
                disputeConfirmation,
                auditingData,
                fraudProofsToApply
            } = await this.constructDispute(forkId);

            LoggerUtils.logDisputeInitiated(
                this.logger,
                dispute,
                fraudProofsToApply
            );

            const pendingParticipants =
                await this.stateChannelManagerContract.getPendingParticipants(
                    this.channelId
                );

            // check if multicall is needed
            if (fraudProofsToApply.length > 0) {
                // 1) apply fraud proofs
                const fraudProofCalldata = (
                    await this.stateChannelManagerContract.applyFraudProofs.populateTransaction(
                        fraudProofsToApply,
                        { channelId: this.channelId }
                    )
                ).data;
                // 2) upload dispute
                let uploadDisputeCalldata: string;
                if (pendingParticipants.length > 0) {
                    // with calldata
                    uploadDisputeCalldata = (
                        await this.stateChannelManagerContract.uploadDisputeWithCalldata.populateTransaction(
                            disputeConfirmation,
                            auditingData
                        )
                    ).data!;
                } else {
                    // without calldata
                    uploadDisputeCalldata = (
                        await this.stateChannelManagerContract.uploadDispute.populateTransaction(
                            disputeConfirmation
                        )
                    ).data!;
                }
                await this.stateChannelManagerContract.multicall([
                    fraudProofCalldata,
                    uploadDisputeCalldata
                ]);
            } else {
                // no multicall - upload dispute separately
                if (pendingParticipants.length > 0) {
                    // TODO - do the actual check (_isAuditingCalldataRequired) when we have early finalization implemented
                    await this.stateChannelManagerContract.uploadDisputeWithCalldata(
                        disputeConfirmation,
                        auditingData
                    );
                } else {
                    await this.stateChannelManagerContract.uploadDispute(
                        disputeConfirmation,
                        { gasLimit: DEFAULT_GAS_LIMIT }
                    );
                }
            }

            this.storage.disputes.storeDisputedFork(forkId, true);
            this.p2pEventHooks.onInitiatingDispute?.(
                hash(Codec.encode(dispute, Type.Dispute)),
                dispute
            );
        } catch (error) {
            this.logger.error("Error uploading dispute", {
                forkId,
                channelId: this.channelId,
                signerAddress: this.signerAddress,
                error: error instanceof Error ? error.message : String(error)
            });

            this.storage.disputes.storeDisputedFork(forkId, false);
        } finally {
            this.mutex.unlock();
        }
    }
    public async killDispute(dispute: DisputeStruct): Promise<void> {
        try {
            // a mutex is not needed since we observe and validate a dispute only once and create only 1 disputeFraudProof for it
            const disputeFraudProof =
                this.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                    dispute
                );
            if (!disputeFraudProof) {
                throw new Error("No dispute fraud proof found for dispute");
            }
            const txRespone =
                await this.stateChannelManagerContract.applyDisputeFraudProofs([
                    disputeFraudProof
                ]);
            txRespone.wait().then(() => {
                this.logger.debug("Dispute killed successfully", {
                    forkId: dispute.input.forkId,
                    channelId: this.channelId
                });
            });
        } catch (error) {
            this.logger.error("Error killing dispute", {
                forkId: dispute.input.forkId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    public async constructDispute(
        forkId: ForkId
    ): Promise<ConstructDisputeResult> {
        const latestBlockHeight =
            this.storage.blocks.getNextBlockHeight(forkId) - 1;

        // StateProof, LatestStateSnapshot
        const [
            stateProof,
            latestStateSnapshot,
            _onChainSlashes,
            _participants
        ] = await Promise.all([
            this.agreementManager.getStateProof(forkId, latestBlockHeight),
            this.storage.getStateSnapshot({
                forkId,
                height: latestBlockHeight
            }),
            this.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipantsUpToTimestamp(
                this.channelId,
                Clock.getTimeInSeconds() // this is safe as long as our local clock isn't in front of the DLT clock
            ),
            this.diamondStateMachine.getParticipants()
        ]);
        // onChainSlashes
        // this can be a subset of on-chain slashes, so we don't need to run any race condition checks
        let onChainSlashes = new Set<Address>(_onChainSlashes);
        const participants = new Set<Address>(_participants);

        //sanity check
        if (!latestStateSnapshot) {
            throw new Error("createDispute - missing state snapshot");
        }

        const latestStateMachineState =
            this.storage.stateMachineStates.getStateMachineState(
                latestStateSnapshot.stateMachineStateHash
            );

        if (!latestStateMachineState) {
            throw new Error(
                "createDispute - missing state machine state in storage for hash: " +
                    latestStateSnapshot.stateMachineStateHash
            );
        }

        // sanity/race condition check
        if (
            latestStateSnapshot.stateMachineStateHash !==
            hash(latestStateMachineState)
        ) {
            throw new Error(
                "createDispute - latestStateSnapshot.stateMachineStateHash !== hash(latestStateMachineState)"
            );
        }

        // to make sure we're trying to slash only participants - even though onChainSlashes should always be a subset of participants
        onChainSlashes = intersection(onChainSlashes, participants);
        const participantsNotSlashedOnChain = difference(
            participants,
            onChainSlashes
        );

        const fraudProofsToApply: FraudProofStruct[] = [];
        for (const participant of participantsNotSlashedOnChain) {
            const fraudProof =
                this.storage.fraudProofs.getFraudProofForParticipant(
                    participant
                );
            if (fraudProof) {
                fraudProofsToApply.push(fraudProof);
                onChainSlashes.add(participant);
            }
        }

        // timeout
        const timeoutStruct =
            this.storage.timeout.getTimeout(forkId) ||
            this.getEmptyTimeoutStruct();

        // AuditingData
        const { isPartial, auditingData } = this.getAuditingData(
            forkId,
            stateProof
        );
        if (isPartial)
            throw new Error("createDispute - isPartial auditingData");

        const disputeAuditingDataHash = hash(
            Codec.encode(auditingData, Type.DisputeAuditingData)
        );

        // disputer
        const disputer = this.signerAddress;

        // selfRemoval
        const selfRemoval = this.storage.forceExit.getForceExit();

        const disputeInput: DisputeInputStruct = {
            channelId: this.channelId,
            forkId: forkId,
            latestStateSnapshotHash: latestStateSnapshot.hash,
            stateProof: stateProof,
            onChainSlashes: Array.from(onChainSlashes),
            disputeAuditingDataHash: disputeAuditingDataHash,
            disputer: disputer,
            timeout: timeoutStruct,
            selfRemoval: selfRemoval,
            latestInboundMessageBlockHash:
                this.storage.inboundMessages.getLatestBlockHash() ||
                ethers.ZeroHash,
            lastInboundMessageBlockHeight:
                this.storage.inboundMessages.getLatestBlockHeight() || 0
        };

        const outputSnapshotData =
            await this.diamondStateMachine.localDiamondContract.computeDisputeOutputSnapshotData.staticCall(
                disputeInput,
                auditingData.latestStateSnapshot,
                auditingData.latestStateStateMachineState,
                auditingData.inboundMessageBlocks
            );

        const outputSnapshotDataHash = hash(
            Codec.encode(outputSnapshotData, Type.SnapshotData)
        );

        const dispute: DisputeStruct = {
            input: disputeInput,
            outputSnapshotDataHash: outputSnapshotDataHash
        };

        // ****** TODO - run auditing as a sanity check *******

        // TODO - Dispute model (like block), so it's easy doing operations on it

        const signedDispute = await SignatureUtils.signDispute(
            dispute,
            this.signer
        );
        const disputeConfirmation: DisputeConfirmationStruct = {
            signedDispute: {
                encodedDispute: signedDispute.encoded,
                signature: signedDispute.signature as BytesLike
            },
            signatures: []
        };

        return {
            dispute,
            disputeConfirmation,
            auditingData,
            fraudProofsToApply
        };
    }

    public getAuditingData(
        forkId: ForkId,
        stateProof: StateProofStruct
    ): { isPartial: boolean; auditingData: DisputeAuditingDataStruct } {
        let isPartial = false;
        // genesisStateSnapshot
        const genesisStateSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        if (!genesisStateSnapshot)
            throw new Error(
                "getDisputeAuditingData - genesisStateSnapshot not found"
            );

        // milestoneSnapshots
        const milestoneSnapshots: StateSnapshot[] = [];
        for (const milestone of stateProof.milestones) {
            const snapshot =
                this.agreementManager.getSnapshotFromMilestone(milestone);
            if (!snapshot) {
                isPartial = true;
                milestoneSnapshots.push(genesisStateSnapshot); // this is just to push something to satisfy the solidity length requirement in `verifyMilestone`
            } else milestoneSnapshots.push(snapshot);
        }

        // latestStateSnapshot
        const latestBlock =
            this.agreementManager.getLatestBlockFromStateProof(stateProof);
        let latestStateSnapshot: StateSnapshot;
        if (!latestBlock) {
            latestStateSnapshot = genesisStateSnapshot;
        } else {
            const snapshot = this.storage.stateSnapshots.getStateSnapshotByHash(
                latestBlock.stateSnapshotHash
            );
            if (!snapshot) {
                isPartial = true;
                latestStateSnapshot = genesisStateSnapshot; // just to use the field, verifyStateProof check will fail up to this point
            } else latestStateSnapshot = snapshot;
        }

        // latestStateStateMachineState
        const latestStateStateMachineState =
            this.storage.stateMachineStates.getStateMachineState(
                latestStateSnapshot.stateMachineStateHash
            );
        if (!latestStateStateMachineState)
            throw new Error(
                "getDisputeAuditingData - latestStateStateMachineState not found"
            );

        // inbound message blocks
        const inboundMessageBlocks =
            this.storage.inboundMessages.getMessageBlocksInRange(
                latestStateSnapshot.snapshotData.latestInboundMessageBlockHash,
                genesisStateSnapshot.snapshotData.latestInboundMessageBlockHash
            );

        // outbound message blocks
        const outboundMessageBlocks =
            this.storage.outboundMessages.getMessageBlocksInRange(
                latestStateSnapshot.snapshotData.latestOutboundMessageBlockHash,
                genesisStateSnapshot.snapshotData.latestOutboundMessageBlockHash
            );

        return {
            isPartial,
            auditingData: {
                genesisStateSnapshotData: genesisStateSnapshot.snapshotData,
                latestStateSnapshot: latestStateSnapshot.toStruct(),
                latestStateStateMachineState: latestStateStateMachineState,
                milestoneSnapshots: milestoneSnapshots.map((snapshot) =>
                    snapshot.toStruct()
                ),
                inboundMessageBlocks: inboundMessageBlocks,
                outboundMessageBlocks: outboundMessageBlocks
            }
        };
    }

    private getEmptyTimeoutStruct(): TimeoutStruct {
        return {
            participant: ethers.ZeroAddress,
            blockHeight: 0,
            minTimeStamp: 0,
            isForced: false,
            previousBlockProducer: ethers.ZeroAddress,
            previousBlockProducerPostedCalldata: false,
            participantSignatureOnPreviousBlock: "0x"
        };
    }

    public setChannelId(channelId: ChannelId) {
        this.channelId = channelId;
    }

    public setP2pEventHooks(p2pEventHooks: P2pEventHooks) {
        this.p2pEventHooks = p2pEventHooks;
    }
}

export default DisputeManager;
