import ADiamondStateMachine from "../ADiamondStateMachine";
import AgreementManager from "../agreementManager";
import type { BuiltStateProof } from "../agreementManager/AgreementManager";
import { StateSnapshot } from "../models";
import { Address, ChannelId, ForkId, Hash } from "../types/types";
import P2pEventHooks from "@/P2pEventHooks";
import type EventSyncService from "@/stateManager/eventSync/EventSyncService";
import type StateManager from "@/stateManager/StateManager";
import Storage from "@/storage";
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
import { config } from "@/utils/config";
import { errorMessage } from "@/utils/errorMessage";
import { preferLocal } from "@/utils/localDiamond";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { StateChannelManagerInterface } from "@typechain-types";
import {
    MessageBlockStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeConfirmationStruct,
    DisputeStruct,
    DisputeAuditingDataStruct,
    DisputeInputStruct,
    StateProofStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { ethers, BytesLike } from "ethers";
import { isEqual } from "lodash";

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
    // Per disputed fork, whether our own dispute adds evidence to the first
    // audited one (see shouldAddOwnEvidence).
    private evidenceChecks = new Map<ForkId, Promise<boolean>>();
    // The manager's getStateTransitionReplayGas, read on the first replay send.
    private stateTransitionReplayGas?: Promise<bigint>;

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
        let postedTimeout: TimeoutStruct | undefined;
        let uploadFailed = false;
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
                    if (!this.stateManager.isActiveFork(forkId)) return false;
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

            // Without fraud proofs the signer adds its estimate headroom
            // (GAS_ESTIMATE_HEADROOM_PERCENT); a replay is funded upfront.

            // check if multicall is needed
            if (fraudProofsToApply.length > 0) {
                // 1) apply fraud proofs
                const fraudProofCalldata = (
                    await this.stateChannelManagerContract.applyFraudProofs.populateTransaction(
                        fraudProofsToApply,
                        { channelId: this.channelId }
                    )
                ).data;
                // 2) upload dispute, with or without calldata
                const uploadDisputeCalldata = (
                    shouldPostAuditingData
                        ? await this.stateChannelManagerContract.uploadDisputeWithCalldata.populateTransaction(
                              disputeConfirmation,
                              auditingData
                          )
                        : await this.stateChannelManagerContract.uploadDispute.populateTransaction(
                              disputeConfirmation
                          )
                ).data;
                const calls = [fraudProofCalldata, uploadDisputeCalldata];
                txResponse = await this.stateChannelManagerContract.multicall(
                    calls,
                    {
                        gasLimit: await this.replayGasLimit(
                            this.stateChannelManagerContract
                                .getFunction("multicall")
                                .estimateGas(calls)
                        )
                    }
                );
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
                            disputeConfirmation
                        );
                }
            }

            this.p2pEventHooks.onInitiatingDispute?.(
                hash(Codec.encode(dispute, Type.Dispute)),
                dispute
            );
            await txResponse.wait();
        } catch (error) {
            uploadFailed = true;
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
                    // the writer posted first -> drop the refused timeout so
                    // later disputes on the fork do not carry it
                    RaceConditionDisputeTimeoutCalldataPosted: () => {
                        postedTimeout = submittedTimeout;
                        if (postedTimeout)
                            this.storage.timeout.deleteTimeout(
                                forkId,
                                postedTimeout
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
                    error: errorMessage(error),
                    customErrorHandles: success
                });

            this.storage.disputes.storeDisputedFork(forkId, false);
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
        // our marker dropped any posted block at ingest -> hand it back once
        if (uploadFailed && !this.stateManager.isDisposed) {
            const posted = postedTimeout
                ? this.storage.blockCalldata.getBlockCalldata(
                      forkId,
                      Number(postedTimeout.blockHeight),
                      postedTimeout.participant
                  )
                : await this.stateManager.withMutex(
                      async () =>
                          this.storage.blockCalldata.getBlockCalldata(
                              forkId,
                              this.storage.blocks.getNextBlockHeight(forkId),
                              await this.stateManager.diamondStateMachine.getNextToWrite()
                          ),
                      { taskName: "dispute posted block hand-back" }
                  );
            if (posted)
                await this.stateManager.blockQueueManager.ingestPostedBlock(
                    posted
                );
        }
        if (rethrow !== undefined) throw rethrow;
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
        DetachedPromises.observe(attempt, (error) => {
            // The detached branch reaches the owning context's existing error
            // funnel even when a diagnostic collector observes the original.
            throw error;
        });
    }

    /**
     * The estimate plus the manager's replay requirement: a replay needs its
     * full budget free at its start, which a run-spend estimator (the peer3
     * hardhat fork) never counts. Callers estimate through getFunction, so a
     * wrapped method property is never estimated.
     */
    private async replayGasLimit(estimate: Promise<bigint>): Promise<bigint> {
        let replayGas = this.stateTransitionReplayGas;
        if (!replayGas) {
            const read =
                this.stateChannelManagerContract.getStateTransitionReplayGas();
            replayGas = this.stateTransitionReplayGas = read;
            // A failed read is retried on the next send.
            read.catch(() => {
                if (this.stateTransitionReplayGas === read)
                    this.stateTransitionReplayGas = undefined;
            });
        }
        const [estimated, required] = await Promise.all([estimate, replayGas]);
        return estimated + required;
    }

    /**
     * Whether to add our own dispute to the window of `forkId`, compared once
     * per disputed fork (reduction merges evidence monotonically) until a kill
     * (forgetEvidenceComparison). Concurrent audits share the comparison; a
     * failed or partial one is not kept.
     */
    public shouldAddOwnEvidence(
        forkId: ForkId,
        dispute: DisputeStruct
    ): Promise<boolean> {
        if (this.storage.disputes.didIDispute(forkId))
            return Promise.resolve(false);
        let check = this.evidenceChecks.get(forkId);
        if (!check) {
            const forget = () => {
                if (this.evidenceChecks.get(forkId) === check)
                    this.evidenceChecks.delete(forkId);
            };
            check = this.canConstructMoreEvidence(dispute).then(
                (hasMoreEvidence) => {
                    if (hasMoreEvidence === undefined) forget();
                    return hasMoreEvidence ?? false;
                },
                (error: unknown) => {
                    forget();
                    throw error;
                }
            );
            this.evidenceChecks.set(forkId, check);
        }
        return check;
    }

    /**
     * Whether our own dispute adds evidence to `dispute`, or undefined when
     * our auditing data could only be partly rebuilt (no answer yet).
     */
    private async canConstructMoreEvidence(
        dispute: DisputeStruct
    ): Promise<boolean | undefined> {
        // Create our own dispute
        let ourDispute: DisputeStruct;
        try {
            ourDispute = (await this.constructDispute(this.stateManager.forkId))
                .dispute;
        } catch (error) {
            if (!(error instanceof PartialAuditingDataError)) throw error;
            // no evidence to give now; the next audit retries
            this.logger.warn(
                "No more evidence: own auditing data could not be rebuilt locally",
                {
                    forkId: this.stateManager.forkId,
                    dispute: LoggerUtils.getDisputeMetadata(dispute)
                }
            );
            return undefined;
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

    /**
     * Drop the cached comparison for `forkId`: after a kill (the compared
     * dispute may be gone) and once the fork's reduced result is committed.
     */
    public forgetEvidenceComparison(forkId: ForkId): void {
        this.evidenceChecks.delete(forkId);
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
            const disputeFraudProofs = [disputeFraudProof];
            const gasLimit = await this.replayGasLimit(
                this.stateChannelManagerContract
                    .getFunction("applyDisputeFraudProofs")
                    .estimateGas(disputeFraudProofs)
            );
            // last check after every await: no evidence for a fork we left
            if (
                !this.stateManager.isActiveFork(dispute.input.forkId as ForkId)
            ) {
                this.logger.info(
                    `killDispute no-op: dispute ${formattedHash} is not on the current fork`,
                    { disputeMeta, currentForkId: this.stateManager.forkId }
                );
                return;
            }
            txResponse =
                await this.stateChannelManagerContract.applyDisputeFraudProofs(
                    disputeFraudProofs,
                    { gasLimit }
                );

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
                    error: errorMessage(error)
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
            builtStateProof,
            latestStateSnapshot,
            _onChainSlashes,
            _participants
        ] = await Promise.all([
            this.agreementManager.buildStateProof(forkId, latestBlockHeight),
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
                    error: errorMessage(error)
                }
            );
            throw error;
        });

        // onChainSlashes
        // Construction uses the local observation. A refused conditional upload
        // recovers missing chain slashes before normal reconstruction.
        let onChainSlashes = new Set<Address>(_onChainSlashes);
        const participants = new Set<Address>(_participants);

        if (!latestStateSnapshot)
            throw new Error("createDispute - missing state snapshot");

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
            builtStateProof,
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
            stateProof: builtStateProof.stateProof,
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

        // Posting the auditing data is never wrong, only costlier, so a local
        // "not final" posts it without asking the chain. A local "final" leaves
        // it out, which is slashable if the lagging mirror was wrong, so the
        // chain confirms that answer.
        const isLastMilestoneFinalByEveryone = await preferLocal(
            () =>
                this.diamondStateMachine.localDiamondContract.isLastMilestoneFinalByEveryone.staticCall(
                    draftDispute
                ),
            () =>
                this.stateChannelManagerContract.isLastMilestoneFinalByEveryone.staticCall(
                    draftDispute
                ),
            (isFinal) => !isFinal
        );
        const postedAuditingData = !isLastMilestoneFinalByEveryone;

        const dispute: DisputeStruct = {
            ...draftDispute,
            postedAuditingData
        };

        // TODO - run auditing as a sanity check
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
            auditingData: LoggerUtils.getAuditingMetadata(auditingData)
        });
        return {
            dispute,
            disputeConfirmation,
            auditingData,
            fraudProofsToApply,
            observedOnChainSlashes: Array.from(_onChainSlashes)
        };
    }

    /**
     * The auditing data of `proof`, byte-equal to what its disputer committed.
     * The finalized state is the state of the snapshot the chain's walk ends
     * at: verifyStateProof binds it there, and the local mirror can lag the
     * chain's start.
     */
    public async getAuditingData(
        forkId: ForkId,
        proof: StateProofStruct | BuiltStateProof,
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

        const built =
            "milestones" in proof
                ? await this.agreementManager.describeStateProof(forkId, proof)
                : proof;
        const { stateProof } = built;

        // milestoneSnapshots
        const milestoneSnapshots = built.milestoneSnapshots.map((snapshot) => {
            if (snapshot) return snapshot;
            isPartial = true;
            return genesisStateSnapshot; // this is just to push something to satisfy the solidity length requirement in `verifyMilestone`
        });
        const walk = isPartial
            ? undefined
            : await this.stateChannelManagerContract.verifyMilestones.staticCall(
                  {
                      channelId: this.channelId,
                      forkId,
                      stateProof,
                      genesisStateSnapshotData:
                          genesisStateSnapshot.snapshotData,
                      milestoneSnapshots: milestoneSnapshots.map((snapshot) =>
                          snapshot.toStruct()
                      )
                  }
              );
        const finalizedSnapshot = walk?.valid
            ? StateSnapshot.from(walk.finalizedSnapshot)
            : undefined;

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
        // latestFinalizedStateStateMachineState ("0x" when the walk rejects)
        let latestFinalizedStateStateMachineState = finalizedSnapshot
            ? this.storage.stateMachineStates.getStateMachineState(
                  finalizedSnapshot.stateMachineStateHash
              )
            : "0x";
        if (latestFinalizedStateStateMachineState === undefined) {
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

        // outbound message blocks above the start (older exits are on chain);
        // a partial rebuild's substituted genesis gives wrong bounds, as above
        const outboundMessageBlocks = isPartial
            ? []
            : this.storage.outboundMessages.getMessageBlocksInRange({
                  upperBlockHash:
                      latestStateSnapshot.snapshotData
                          .latestOutboundMessageBlockHash,
                  lowerBlockHash:
                      built.startSnapshot.snapshotData
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
