import ADiamondStateMachine from "../ADiamondStateMachine";
import AgreementManager from "../agreementManager";
import type { BuiltStateProof } from "../agreementManager/AgreementManager";
import { StateSnapshot } from "../models";
import { Address, ChannelId, ForkId, Hash } from "../types/types";
import P2pEventHooks from "@/P2pEventHooks";
import {
    EARLY_TIMEOUT_RECHECK_REASON,
    MISMATCH_TIMEOUT_RECHECK_REASON,
    TIMEOUT_RECHECK_DELAY_MS
} from "@/stateManager/chainFallback/ParticipantTimeoutService";
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
import { SnapshotDataStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeConfirmationStruct,
    DisputeStruct,
    DisputeAuditingDataStruct,
    DisputeInputStruct,
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

    /**
     * Uploads this peer's dispute of `forkId`. With `kill`, the dispute fraud
     * proof against that invalid dispute runs first in the same multicall,
     * and our dispute already counts its submitter's slash: the kill must
     * land for our dispute to be admitted. A refusal because the chain's
     * inbound head is newer than our anchor loads the missing inbound run and
     * disputes again; `refusedInboundHead` is that head, so a retry refused at
     * the same head made no progress and is fatal.
     */
    public async dispute(
        forkId: ForkId,
        options?: { kill?: DisputeStruct; refusedInboundHead?: Hash }
    ): Promise<void> {
        let txResponse;
        let rethrow: unknown;
        let refreshSlashes = false;
        let submittedTimeout: TimeoutStruct | undefined;
        let timeoutRetry: { delayMs: number; reason: string } | undefined;
        let postedTimeout: TimeoutStruct | undefined;
        let uploadFailed = false;
        let observedOnChainSlashes: Address[] = [];
        let killLanded = false;
        let latestStateTimestamp = 0;
        let inboundRetry: { chainHead: Hash; anchor: Hash } | undefined;
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

            const killProof = options?.kill
                ? this.getStoredDisputeFraudProof(options.kill)
                : undefined;
            const constructed = await this.constructDispute(forkId, {
                expectedSlashes: killProof ? [killProof.participant] : []
            });
            const {
                dispute,
                disputeConfirmation,
                auditingData,
                fraudProofsToApply
            } = constructed;
            observedOnChainSlashes = constructed.observedOnChainSlashes;
            submittedTimeout = dispute.input.timeout;
            latestStateTimestamp = Number(
                auditingData.latestStateSnapshot.timestamp
            );

            const shouldPostAuditingData = dispute.postedAuditingData;

            LoggerUtils.logDisputeInitiated(
                this.logger,
                dispute,
                fraudProofsToApply
            );

            // Without fraud proofs no gas limit is passed: the chain signer
            // sends each upload with its estimate plus headroom (see
            // GAS_ESTIMATE_HEADROOM_PERCENT for the concurrent-dispute race
            // this protects against). A fraud-proof replay must also be
            // funded upfront (see replayGasLimit).

            const uploadDisputeCalldata = shouldPostAuditingData
                ? (
                      await this.stateChannelManagerContract.uploadDisputeWithCalldata.populateTransaction(
                          disputeConfirmation,
                          auditingData
                      )
                  ).data
                : (
                      await this.stateChannelManagerContract.uploadDispute.populateTransaction(
                          disputeConfirmation
                      )
                  ).data;
            const calls: string[] = [];
            if (killProof)
                calls.push(
                    (
                        await this.stateChannelManagerContract.applyDisputeFraudProofs.populateTransaction(
                            [killProof]
                        )
                    ).data
                );
            if (fraudProofsToApply.length > 0)
                calls.push(
                    (
                        await this.stateChannelManagerContract.applyFraudProofs.populateTransaction(
                            fraudProofsToApply,
                            { channelId: this.channelId }
                        )
                    ).data
                );
            if (calls.length > 0) {
                // the kill and fraud proofs land before the upload that counts their slashes
                calls.push(uploadDisputeCalldata);
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
            } else if (shouldPostAuditingData) {
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

            this.p2pEventHooks.onInitiatingDispute?.(
                hash(Codec.encode(dispute, Type.Dispute)),
                dispute
            );
            await txResponse.wait();
            killLanded = !!killProof;
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
                        timeoutRetry = {
                            delayMs: Math.max(
                                TIMEOUT_RECHECK_DELAY_MS,
                                (Number(minimum) - Number(current)) * 1000
                            ),
                            reason: EARLY_TIMEOUT_RECHECK_REASON
                        };
                    },
                    // the predecessor's posting state moved the deadline ->
                    // drop the refused claim so later disputes on the fork do
                    // not carry it; the recheck rebuilds it from current evidence
                    RaceConditionDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch:
                        () => {
                            if (submittedTimeout)
                                this.storage.timeout.deleteTimeout(
                                    forkId,
                                    submittedTimeout
                                );
                            timeoutRetry = {
                                delayMs: TIMEOUT_RECHECK_DELAY_MS,
                                reason: MISMATCH_TIMEOUT_RECHECK_REASON
                            };
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
                    // the chain inbound head moved past our anchor (a join landed
                    // after construction, or our inbound store lags): the marker
                    // rolls back below and we retry from the chain's head
                    RaceConditionDisputeInboundNotLatest: (customError) => {
                        const [chainHead, anchor] =
                            customError.errorDescription.args;
                        if (
                            chainHead === anchor ||
                            chainHead === options?.refusedInboundHead
                        )
                            rethrow = customError;
                        else inboundRetry = { chainHead, anchor };
                    },
                    // a late kill in the multicall is fatal, as in killDispute
                    RaceConditionDisputeKillPeriodExpired: (customError) => {
                        this.logger.error(
                            "dispute: kill period expired before the kill and dispute landed",
                            { forkId, channelId: this.channelId }
                        );
                        rethrow = customError;
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
            if (!success) {
                this.logger.error("Error uploading dispute", {
                    forkId,
                    channelId: this.channelId,
                    signerAddress: this.signerAddress,
                    error: errorMessage(error),
                    customErrorHandles: success
                });
                // an unhandled failure, a contract verdict included, is fatal
                rethrow ??= error;
            }

            this.storage.disputes.storeDisputedFork(forkId, false);
        } finally {
            this.mutex.unlock();
            // no upload carried the kill (we already disputed, the fork moved,
            // or the upload failed): the invalid dispute is still killed alone
            if (options?.kill && !killLanded)
                await this.killDispute(options.kill);
        }
        // The failed upload has released both the signing marker and dispute
        // mutex. Recheck the timeout through its owner instead of resending it.
        if (
            timeoutRetry &&
            submittedTimeout &&
            submittedTimeout.participant !== ethers.ZeroAddress
        ) {
            this.stateManager.participantTimeoutService.scheduleCheck(
                forkId,
                Number(submittedTimeout.blockHeight),
                submittedTimeout.participant,
                timeoutRetry.delayMs,
                timeoutRetry.reason
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
        if (
            inboundRetry &&
            !this.stateManager.isDisposed &&
            this.stateManager.forkId === forkId
        ) {
            const run = await this.eventSyncService.loadSynchronizedInboundRun(
                inboundRetry.chainHead,
                inboundRetry.anchor,
                latestStateTimestamp,
                this.channelId
            );
            if (!run)
                throw new Error(
                    "dispute - the inbound run up to the chain's head is unavailable"
                );
            await this.dispute(forkId, {
                refusedInboundHead: inboundRetry.chainHead
            });
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
     * Gas limit for a transaction that may replay a transition as fraud
     * proof: the signer's estimate (with its headroom) plus the manager's
     * replay requirement. The state machine refuses a replay unless its full
     * budget is available when the replay starts, but an estimator that
     * reports the gas a run spends (the peer3 hardhat fork) counts only what
     * the transition used, never the unused budget that must be free, and the
     * work before the replay (proof checks, setting the machine's state) can
     * exceed any fixed margin. Adding the requirement to the estimate covers
     * both. A searching estimator already includes the requirement, so there
     * the limit asks for more than needed, which is safe. Callers estimate
     * through getFunction, the contract's own method, so an estimate is never
     * taken from a replaced or wrapped method property.
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
     * Whether this node should add its own dispute to the window of `forkId`.
     * A node that already disputed the fork has committed its evidence. Otherwise
     * the comparison runs once per disputed fork: reduction merges evidence
     * monotonically, so a dispute of ours that adds nothing to the first audited
     * dispute adds nothing once more disputes land. That holds only while the
     * compared dispute stays in the window, so a kill drops the cached answer
     * (forgetEvidenceComparison). Concurrent audits share the in-flight comparison; a
     * failed one is not kept, and a positive answer stays positive so a failed
     * upload is retried by the next audit.
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
            check = this.canConstructMoreEvidence(dispute).catch(
                (error: unknown) => {
                    forget();
                    throw error;
                }
            );
            this.evidenceChecks.set(forkId, check);
        }
        return check;
    }

    /** Whether our own dispute adds evidence to `dispute`. */
    private async canConstructMoreEvidence(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const ourDispute = (
            await this.constructDispute(this.stateManager.forkId)
        ).dispute;

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
            const disputeFraudProof = this.getStoredDisputeFraudProof(dispute);
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
            txResponse =
                await this.stateChannelManagerContract.applyDisputeFraudProofs(
                    disputeFraudProofs,
                    {
                        gasLimit: await this.replayGasLimit(
                            this.stateChannelManagerContract
                                .getFunction("applyDisputeFraudProofs")
                                .estimateGas(disputeFraudProofs)
                        )
                    }
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
                    // a late challenge is fatal: no recovery after the kill period
                    RaceConditionDisputeKillPeriodExpired: (customError) => {
                        this.logger.error(
                            `killDispute: kill period expired before the challenge of dispute ${formattedHash} landed`,
                            { disputeMeta }
                        );
                        throw customError;
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
                // an unhandled failure, a contract verdict included, is fatal
                throw error;
            }
        }
    }

    private getStoredDisputeFraudProof(dispute: DisputeStruct) {
        const disputeFraudProof =
            this.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                dispute
            );
        if (!disputeFraudProof)
            throw new Error("No dispute fraud proof found for dispute");
        return disputeFraudProof;
    }

    /**
     * This peer's dispute of `forkId` from its active view: the proof
     * through its latest block (persistence-only replay never moves it).
     * `expectedSlashes` are slashes a kill in the same multicall lands first.
     */
    public async constructDispute(
        forkId: ForkId,
        options?: { expectedSlashes?: Address[] }
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
        // the kill in the same multicall lands this slash first, also for a
        // departed submitter outside our participant union
        for (const slashed of options?.expectedSlashes ?? [])
            onChainSlashes.add(slashed);
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
        const auditingData = await this.buildAuditingData(
            forkId,
            builtStateProof,
            latestStateSnapshot,
            inboundHead.hash
        );
        const stateProof = builtStateProof.stateProof;

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

        // Posting the auditing data is never wrong, only costlier, so a local
        // "must post" posts it without asking the chain. A local "may omit"
        // leaves it out, which is slashable if the lagging mirror was wrong, so
        // the chain confirms that answer.
        const isOmissionAllowed = await preferLocal(
            () =>
                this.diamondStateMachine.localDiamondContract.isAuditingDataOmissionAllowed.staticCall(
                    draftDispute
                ),
            () =>
                this.stateChannelManagerContract.isAuditingDataOmissionAllowed.staticCall(
                    draftDispute
                ),
            (isAllowed) => !isAllowed
        );
        const postedAuditingData = !isOmissionAllowed;

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

    /**
     * The auditing data of our own proof: the walk evidence, the latest
     * state, the state of the proof's final point, and the inbound and
     * outbound runs. Missing local data throws: this peer holds what it signed.
     */
    private async buildAuditingData(
        forkId: ForkId,
        built: BuiltStateProof,
        latestStateSnapshot: StateSnapshot,
        disputeLatestInboundMessageBlockHash: Hash
    ): Promise<DisputeAuditingDataStruct> {
        const latestFinalizedStateStateMachineState =
            this.storage.stateMachineStates.getStateMachineState(
                built.finalizedSnapshot.stateMachineStateHash
            );
        if (!latestFinalizedStateStateMachineState)
            throw new Error(
                `buildAuditingData - missing the state of the finalized snapshot ${built.finalizedSnapshot.hash}`
            );
        const inboundMessageBlocks =
            await this.eventSyncService.loadSynchronizedInboundRun(
                disputeLatestInboundMessageBlockHash,
                latestStateSnapshot.snapshotData
                    .latestInboundMessageBlockHash as Hash,
                latestStateSnapshot.timestamp,
                this.channelId
            );
        if (!inboundMessageBlocks)
            throw new Error(
                "buildAuditingData - the inbound run is unavailable after event recovery"
            );
        const genesisStateSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId)!;
        const outboundMessageBlocks =
            this.storage.outboundMessages.getMessageBlocksInRange({
                upperBlockHash:
                    latestStateSnapshot.snapshotData
                        .latestOutboundMessageBlockHash,
                lowerBlockHash:
                    genesisStateSnapshot.snapshotData
                        .latestOutboundMessageBlockHash
            });

        const auditingData: DisputeAuditingDataStruct = {
            genesisStateSnapshotData: built.evidence.genesisStateSnapshotData,
            latestStateSnapshot: latestStateSnapshot.toStruct(),
            latestFinalizedStateStateMachineState,
            milestoneSnapshots: built.evidence.milestoneSnapshots,
            inboundMessageBlocks,
            outboundMessageBlocks
        };
        this.logger.verbose("Constructed auditing data for dispute", {
            forkId,
            channelId: this.channelId,
            auditingData: LoggerUtils.getAuditingMetadata(auditingData)
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
