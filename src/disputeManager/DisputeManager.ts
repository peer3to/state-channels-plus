import { ethers } from "ethers";
import AgreementManager from "../agreementManager";
import { StateChannelManagerInterface } from "@typechain-types";
import {
    DisputeConfirmationStruct,
    DisputeStruct,
    DisputeAuditingDataStruct,
    DisputeInputStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import {
    DebugProxy,
    DetachedPromises,
    hash,
    intersection,
    Codec,
    Type,
    SignatureUtils,
    Mutex,
    difference,
    Logger,
    tryDecodeCustomError,
    tryHandleEvmError
} from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import P2pEventHooks from "@/P2pEventHooks";
import { Address, ChannelId, ForkId, Hash } from "../types/types";
import { StateSnapshot } from "../models";
import Storage from "@/storage";
import ADiamondStateMachine from "../ADiamondStateMachine";
import {
    StateProofStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { BytesLike } from "ethers";
import { config } from "@/utils/config";
import {
    MessageBlockStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type StateManager from "@/stateManager/StateManager";
import type EventSyncService from "@/stateManager/eventSync/EventSyncService";

export type ConstructDisputeResult = {
    dispute: DisputeStruct;
    disputeConfirmation: DisputeConfirmationStruct;
    auditingData: DisputeAuditingDataStruct;
    fraudProofsToApply: FraudProofStruct[];
    observedOnChainSlashes: Address[];
};

// our own auditing data could not be rebuilt whole - our missing history, not
// anyone's fraud. named so callers can tell it from a real construction failure
export class PartialAuditingDataError extends Error {}

// Right-sized from 5M: the dispute upload measures ~0.5M in e2e; 2.5M keeps
// generous headroom for larger disputes while freeing block gas under concurrency.
const DEFAULT_GAS_LIMIT = 2_500_000;
class DisputeManager {
    signer: ethers.Signer;
    signerAddress: Address;
    agreementManager: AgreementManager;
    stateChannelManagerContract: StateChannelManagerInterface;
    channelId: ChannelId;
    p2pEventHooks: P2pEventHooks;
    self = config.DEBUG_DISPUTE_HANDLER ? DebugProxy.createProxy(this) : this;
    storage: Storage;
    diamondStateMachine: ADiamondStateMachine;
    mutex: Mutex;
    private eventSyncService: EventSyncService;
    private logger: Logger;

    constructor(
        channelId: ChannelId,
        signer: ethers.Signer,
        signerAddress: Address,
        agreementManager: AgreementManager,
        stateChannelManagerContract: StateChannelManagerInterface,
        p2pEventHooks: P2pEventHooks,
        storage: Storage,
        diamondStateMachine: ADiamondStateMachine,
        eventSyncService: EventSyncService,
        logger: Logger,
        private readonly stateManager: StateManager
    ) {
        this.channelId = channelId;
        this.signer = signer;
        this.signerAddress = signerAddress;
        this.agreementManager = agreementManager;
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.p2pEventHooks = p2pEventHooks;
        this.storage = storage;
        this.diamondStateMachine = diamondStateMachine;
        this.eventSyncService = eventSyncService;
        this.logger = logger.child({ component: "DisputeManager" });
        this.mutex = new Mutex(
            this.logger.child({ component: "DisputeManager:Mutex" })
        );
        return this.self;
    }

    public async dispute(forkId: ForkId): Promise<void> {
        let txResponse;
        let rethrow: unknown;
        let refreshSlashes = false;
        let submittedTimeout: TimeoutStruct | undefined;
        let timeoutRetryDelaySeconds: number | undefined;
        let observedOnChainSlashes: Address[] = [];
        try {
            await this.mutex.lock({ taskName: "dispute" });
            if (this.storage.disputes.didIDispute(forkId)) {
                this.logger.info(
                    `Already initiated dispute for forkId ${forkId}, skipping dispute attempt.`
                );
                return;
            }

            // Drain admitted block work before closing admission. Construction
            // and submission run outside the state mutex; the marker keeps
            // this peer from signing newer state until upload fails or settles.
            const admitted = await this.stateManager.withMutex(
                () => {
                    if (
                        this.stateManager.isDisposed ||
                        this.stateManager.forkId !== forkId
                    )
                        return false;
                    this.storage.disputes.storeDisputedFork(forkId, true);
                    return true;
                },
                { taskName: "dispute signing barrier" }
            );
            if (!admitted) return;

            const constructed = await this.constructDispute(forkId);
            const {
                dispute,
                disputeConfirmation,
                auditingData,
                fraudProofsToApply
            } = constructed;
            observedOnChainSlashes = constructed.observedOnChainSlashes;
            submittedTimeout = dispute.input.timeout;

            const shouldPostAuditingData = dispute.postedAuditingData;

            LoggerUtils.logDisputeInitiated(
                this.logger,
                dispute,
                fraudProofsToApply
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
                if (shouldPostAuditingData) {
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
                txResponse = await this.stateChannelManagerContract.multicall([
                    fraudProofCalldata,
                    uploadDisputeCalldata
                ]);
            } else {
                // no multicall - upload dispute separately
                if (shouldPostAuditingData) {
                    // TODO - revisit postedAuditingData under early finalization
                    txResponse =
                        await this.stateChannelManagerContract.uploadDisputeWithCalldata(
                            disputeConfirmation,
                            auditingData
                        );
                } else {
                    txResponse =
                        await this.stateChannelManagerContract.uploadDispute(
                            disputeConfirmation,
                            { gasLimit: DEFAULT_GAS_LIMIT }
                        );
                }
            }

            this.p2pEventHooks.onInitiatingDispute?.(
                hash(Codec.encode(dispute, Type.Dispute)),
                dispute
            );
            await txResponse.wait();
        } catch (error) {
            const success = await tryHandleEvmError(error, {
                tx: txResponse,
                logger: this.logger,
                forkId,
                signer: this.signer,
                handlers: {
                    RaceConditionDisputeWindowNotOpen: () => {
                        refreshSlashes = true;
                    },
                    ErrorCantParticipateInDispute: () => {
                        this.logger.warn(
                            "dispute: signer cannot participate in dispute",
                            { forkId, channelId: this.channelId }
                        );
                    },
                    RaceConditionDisputeTimeoutNotMinTimestamp: (error) => {
                        const [minimum, current] = error.errorDescription.args;
                        timeoutRetryDelaySeconds = Math.max(
                            1,
                            Number(minimum) - Number(current)
                        );
                    },
                    RaceConditionDisputeTimeoutWindowCreatedTooEarly: () => {
                        this.logger.info(
                            "dispute no-op: existing window predates timeout deadline",
                            { forkId, channelId: this.channelId }
                        );
                    },
                    RaceConditionDisputeEvidencePeriodExpired: (
                        customError
                    ) => {
                        // The error stays visible to the caller, but no
                        // dispute landed: the marker below rolls back so a
                        // later window can take this peer's evidence.
                        this.logger.error(
                            "dispute: evidence period already expired",
                            { forkId, channelId: this.channelId }
                        );
                        rethrow = customError;
                    }
                }
            });
            if (!success)
                this.logger.error("Error uploading dispute", {
                    forkId,
                    channelId: this.channelId,
                    signerAddress: this.signerAddress,
                    error:
                        error instanceof Error ? error.message : String(error),
                    customErrorHandles: success
                });

            this.storage.disputes.storeDisputedFork(forkId, false);
            if (rethrow !== undefined) throw rethrow;
        } finally {
            this.mutex.unlock();
        }
        // The failed upload has released both the signing marker and dispute
        // mutex. Recheck the timeout through its owner instead of resending it.
        if (
            timeoutRetryDelaySeconds !== undefined &&
            submittedTimeout &&
            submittedTimeout.participant !== ethers.ZeroAddress
        ) {
            this.stateManager.participantTimeoutService.scheduleCheck(
                forkId,
                Number(submittedTimeout.blockHeight),
                submittedTimeout.participant,
                timeoutRetryDelaySeconds * 1000,
                "timeoutParticipantAfterEarlySubmission"
            );
        }
        if (
            refreshSlashes &&
            !this.stateManager.isDisposed &&
            this.stateManager.forkId === forkId
        ) {
            const changed = await this.eventSyncService.recoverOnChainSlashes(
                this.channelId,
                observedOnChainSlashes
            );
            if (changed) await this.dispute(forkId);
        }
    }
    /** Block-pipeline callers must release the state mutex before construction. */
    public requestDispute(forkId: ForkId): void {
        const attempt = this.dispute(forkId);
        DetachedPromises.collect(attempt);
        void attempt.catch((error) => {
            // The detached branch reaches the owning context's existing error
            // funnel even when a diagnostic collector observes the original.
            throw error;
        });
    }

    public async killDispute(dispute: DisputeStruct): Promise<void> {
        const disputeMeta = LoggerUtils.getDisputeMetadata(dispute);
        const formattedHash = LoggerUtils.formatHash(disputeMeta.disputeHash);
        let txResponse;
        try {
            // a mutex is not needed since we observe and validate a dispute only once and create only 1 disputeFraudProof for it
            const disputeFraudProof =
                this.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                    dispute
                );
            if (!disputeFraudProof) {
                throw new Error("No dispute fraud proof found for dispute");
            }
            const { windowExists, isExpired } =
                await this.stateChannelManagerContract.isKillPeriodExpired(
                    dispute.input.channelId,
                    dispute.input.forkId
                );
            if (!windowExists || isExpired) {
                this.logger.warn(
                    "killDispute no-op: dispute kill period is unavailable or expired",
                    { disputeMeta, windowExists, isExpired }
                );
                return;
            }
            txResponse =
                await this.stateChannelManagerContract.applyDisputeFraudProofs([
                    disputeFraudProof
                ]);

            await txResponse.wait();
            this.logger.info(
                `✅ Dispute fraud-proof transaction accepted: ${formattedHash}`
            );
        } catch (error) {
            const success = await tryHandleEvmError(error, {
                tx: txResponse,
                logger: this.logger,
                forkId: dispute.input.forkId,
                signer: this.signer,
                handlers: {
                    RaceConditionDisputeKillPeriodExpired: () => {
                        this.logger.info(
                            `killDispute no-op: kill period expired for dispute ${formattedHash}`,
                            { disputeMeta }
                        );
                    },
                    RaceConditionOnChainSlashes: () => {
                        this.logger.info(
                            `killDispute no-op: on-chain slashes already cover dispute ${formattedHash}`,
                            { disputeMeta }
                        );
                    },
                    RaceConditionGenesisTimestampNotAvailable: () => {
                        this.logger.info(
                            `killDispute no-op: genesis timestamp not available for dispute ${formattedHash}`,
                            { disputeMeta }
                        );
                    },
                    RaceConditionUnexpectedBlockCalldataPosted: () => {
                        this.logger.info(
                            `killDispute no-op: unexpected block calldata posted for dispute ${formattedHash}`,
                            { disputeMeta }
                        );
                    }
                }
            });
            if (!success) {
                const custom = tryDecodeCustomError(error);
                this.logger.error(`❌ Error killing dispute ${formattedHash}`, {
                    disputeMeta,
                    custom,
                    error:
                        error instanceof Error ? error.message : String(error)
                });
            }
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
            this.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipants(
                this.channelId
            ),
            this.storage.getParticipantsUnion({
                forkId,
                height: latestBlockHeight
            })
        ]).catch((error) => {
            this.logger.error(
                "Error constructing dispute - failed to get inputData",
                {
                    forkId,
                    channelId: this.channelId,
                    latestBlockHeight,
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            );
            throw error;
        });

        // onChainSlashes
        // Construction uses the local observation. A refused conditional upload
        // recovers missing chain slashes before normal reconstruction.
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

        // latestStateSnapshot proves its own inbound head -> naming anything
        // below it is objective fraud against ourselves
        const inboundHead = this.storage.inboundMessages.headNotBehind(
            latestStateSnapshot.latestInboundMessageBlockHash,
            latestStateSnapshot.latestInboundMessageBlockHeight
        );

        // the bound every auditor recomputes with
        const { isPartial, auditingData } = await this.getAuditingData(
            forkId,
            stateProof,
            { disputeLatestInboundMessageBlockHash: inboundHead.hash }
        );
        if (isPartial)
            throw new PartialAuditingDataError(
                "createDispute - isPartial auditingData"
            );

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
            requireExistingDisputeWindow: false,
            latestInboundMessageBlockHash: inboundHead.hash,
            lastInboundMessageBlockHeight: inboundHead.height
        };
        disputeInput.requireExistingDisputeWindow =
            !(await this.diamondStateMachine.localDiamondContract.hasDisputeReason(
                disputeInput,
                auditingData.latestStateSnapshot
            ));
        let outputSnapshotData: SnapshotDataStruct;
        try {
            outputSnapshotData =
                await this.diamondStateMachine.localDiamondContract.computeDisputeOutputSnapshotData.staticCall(
                    disputeInput,
                    auditingData.latestStateSnapshot,
                    latestStateMachineState,
                    auditingData.inboundMessageBlocks
                );
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            this.logger.error("Error computing dispute output snapshot data", {
                forkId,
                channelId: this.channelId,
                disputeInput: LoggerUtils.getDisputeInputMetadata(disputeInput),
                auditingData: LoggerUtils.getAuditingMetadata(auditingData),
                custom,
                error
            });

            throw error;
        }

        const outputSnapshotDataHash = hash(
            Codec.encode(outputSnapshotData, Type.SnapshotData)
        );

        const draftDispute: DisputeStruct = {
            input: disputeInput,
            outputSnapshotDataHash: outputSnapshotDataHash,
            postedAuditingData: false
        };

        const isLastMilestoneFinalByEveryone =
            await this.stateChannelManagerContract.isLastMilestoneFinalByEveryone.staticCall(
                draftDispute
            );
        const postedAuditingData = !isLastMilestoneFinalByEveryone;

        const dispute: DisputeStruct = {
            ...draftDispute,
            postedAuditingData
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
        this.logger.debug("CONSTRUCTED DISPUTE:", {
            dispute: LoggerUtils.getDisputeMetadata(dispute),
            auditingData: auditingData
                ? LoggerUtils.getAuditingMetadata(auditingData)
                : undefined
        });
        return {
            dispute,
            disputeConfirmation,
            auditingData,
            fraudProofsToApply,
            observedOnChainSlashes: Array.from(_onChainSlashes)
        };
    }

    public async getAuditingData(
        forkId: ForkId,
        stateProof: StateProofStruct,
        options?: {
            disputeLatestInboundMessageBlockHash?: Hash;
        }
    ): Promise<{
        isPartial: boolean;
        auditingData: DisputeAuditingDataStruct;
    }> {
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
        const latestFinalizedStateSnapshot =
            this.agreementManager.getLatestFinalizedSnapshot(
                stateProof,
                forkId
            );
        // latestFinalizedStateStateMachineState
        let latestFinalizedStateStateMachineState =
            this.storage.stateMachineStates.getStateMachineState(
                latestFinalizedStateSnapshot.stateMachineStateHash
            );
        if (!latestFinalizedStateStateMachineState) {
            isPartial = true;
            latestFinalizedStateStateMachineState = ""; // not needed for verifyStateProof and if the dispute is honest, we'll catchup and have it later
        }

        // the run the dispute names, recovering a log that never reached us. an
        // auditor cannot rebuild what it never received -> partial, not a throw
        const upperBlockHash =
            options?.disputeLatestInboundMessageBlockHash ??
            this.storage.inboundMessages.getLatestBlockHash();
        let inboundMessageBlocks: MessageBlockStruct[] = [];
        // an already-partial rebuild substituted the genesis snapshot above, so
        // the bounds below are wrong and every consumer discards the result ->
        // don't spend the widest possible getLogs on it
        if (upperBlockHash && !isPartial) {
            const run = await this.eventSyncService.loadSynchronizedInboundRun(
                upperBlockHash,
                latestStateSnapshot.snapshotData
                    .latestInboundMessageBlockHash as Hash,
                latestStateSnapshot.timestamp,
                this.channelId
            );
            if (run) inboundMessageBlocks = run;
            else isPartial = true;
        }

        // outbound message blocks
        const outboundMessageBlocks =
            this.storage.outboundMessages.getMessageBlocksInRange({
                upperBlockHash:
                    latestStateSnapshot.snapshotData
                        .latestOutboundMessageBlockHash,
                lowerBlockHash:
                    genesisStateSnapshot.snapshotData
                        .latestOutboundMessageBlockHash
            });

        const auditingData = {
            isPartial,
            auditingData: {
                genesisStateSnapshotData: genesisStateSnapshot.snapshotData,
                latestStateSnapshot: latestStateSnapshot.toStruct(),
                latestFinalizedStateStateMachineState,
                milestoneSnapshots: milestoneSnapshots.map((snapshot) =>
                    snapshot.toStruct()
                ),
                inboundMessageBlocks,
                outboundMessageBlocks: outboundMessageBlocks
            }
        };
        this.logger.verbose("Constructed auditing data for dispute", {
            forkId,
            channelId: this.channelId,
            auditingData: LoggerUtils.getAuditingMetadata(
                auditingData.auditingData
            ),
            isPartial
        });
        return auditingData;
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
