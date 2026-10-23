import ADiamondStateMachine from "../ADiamondStateMachine";
import AgreementManager from "../agreementManager";
import DisputeBuilder, { type ConstructDisputeResult } from "./DisputeBuilder";
import type { BuiltStateProof } from "../agreementManager/AgreementManager";
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
    Codec,
    CustomEvmError,
    Type,
    Mutex,
    isReasonlessRevert,
    Logger,
    multicallLastCallRevertData,
    tryDecodeCustomError,
    tryHandleEvmError
} from "@/utils";
import { config } from "@/utils/config";
import { errorMessage } from "@/utils/errorMessage";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { StateChannelManagerInterface } from "@typechain-types";
import {
    DisputeStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { ethers } from "ethers";

export type { ConstructDisputeResult };

class DisputeManager {
    signer: ethers.Signer;
    signerAddress: Address;
    stateChannelManagerContract: StateChannelManagerInterface;
    channelId: ChannelId;
    p2pEventHooks: P2pEventHooks;
    self = config.DEBUG_DISPUTE_HANDLER ? DebugProxy.createProxy(this) : this;
    storage: Storage;
    mutex: Mutex;
    private eventSyncService: EventSyncService;
    private logger: Logger;
    private readonly disputeBuilder: DisputeBuilder;
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
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.p2pEventHooks = p2pEventHooks;
        this.storage = storage;
        this.eventSyncService = eventSyncService;
        this.logger = logger.child({ component: "DisputeManager" });
        this.mutex = new Mutex(
            this.logger.child({ component: "DisputeManager:Mutex" })
        );
        this.disputeBuilder = new DisputeBuilder(
            channelId,
            signer,
            signerAddress,
            agreementManager,
            stateChannelManagerContract,
            storage,
            diamondStateMachine,
            eventSyncService,
            this.logger
        );
        return this.self;
    }

    /**
     * Uploads this peer's dispute of `forkId`. With `kill`, the dispute fraud
     * proof against that invalid dispute runs first in the same multicall,
     * and our dispute already counts its submitter's slash: the kill must
     * land for our dispute to be admitted. In a multicall the upload is best
     * effort: the kill and fraud proofs land even when the upload is refused,
     * and that refusal is handled as a refused lone upload. A refusal because
     * the chain's inbound head is newer than our anchor loads the missing
     * inbound run and disputes again; `refusedInboundHead` is that head, so a
     * retry refused at the same head made no progress and is fatal. Without
     * an error, `lostEvidenceRace` is the refusal of an upload whose evidence
     * period had already closed: a no-op, reported to the caller.
     */
    public async dispute(
        forkId: ForkId,
        options?: {
            kill?: DisputeStruct;
            refusedInboundHead?: Hash;
            latestStateProof?: Promise<BuiltStateProof | undefined>;
        }
    ): Promise<{ lostEvidenceRace?: CustomEvmError }> {
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
        // the mined multicall reported the upload's refusal
        let uploadRefusedInMulticall = false;
        // the refusal the multicall's all-or-nothing estimate reverted with
        let estimatedUploadRefusal: CustomEvmError | undefined;
        let lostEvidenceRace: CustomEvmError | undefined;
        try {
            await this.mutex.lock({ taskName: "dispute" });
            if (this.storage.disputes.didIDispute(forkId)) {
                this.logger.info(
                    `Already initiated dispute for forkId ${forkId}, skipping dispute attempt.`
                );
                return {};
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
            if (!admitted) return {};

            const killProof = options?.kill
                ? this.getStoredDisputeFraudProof(options.kill)
                : undefined;
            const constructed = await this.constructDispute(forkId, {
                expectedSlashes: killProof ? [killProof.participant] : [],
                latestStateProof: options?.latestStateProof
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
            const bestEffort = calls.length > 0;
            if (bestEffort) {
                // the kill and fraud proofs land before the upload that counts
                // their slashes, and stay landed when the upload is refused
                calls.push(uploadDisputeCalldata);
                const estimate = this.estimateBestEffortMulticall(calls);
                const gasLimit = await this.replayGasLimit(
                    estimate.then(({ gas }) => gas)
                );
                estimatedUploadRefusal = (await estimate).refusal;
                txResponse =
                    await this.stateChannelManagerContract.multicallBestEffortLast(
                        calls,
                        { gasLimit }
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
            const receipt = await txResponse.wait();
            killLanded = !!killProof;
            const refusal = bestEffort
                ? await this.lastCallRefusal(receipt!, estimatedUploadRefusal)
                : undefined;
            if (refusal) {
                uploadRefusedInMulticall = true;
                throw refusal;
            }
        } catch (error) {
            uploadFailed = true;
            const success = await tryHandleEvmError(error, {
                // a mined multicall is never resent: its kill already landed
                tx: uploadRefusedInMulticall ? undefined : txResponse,
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
                    // Another participant's evidence closed the evidence
                    // period first. The marker below rolls back and the
                    // refusal is returned to the caller.
                    // TODO(OQ-SPEC-EVIDENCE-RACE-1-TKNWBJ): revisit how a lost evidence race is interpreted
                    RaceConditionDisputeEvidencePeriodExpired: (
                        customError
                    ) => {
                        this.logger.info(
                            "dispute no-op: the evidence period closed before our evidence landed",
                            { forkId, channelId: this.channelId }
                        );
                        lostEvidenceRace = customError;
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
            if (changed) return this.dispute(forkId);
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
            return this.dispute(forkId, {
                refusedInboundHead: inboundRetry.chainHead
            });
        }
        return { lostEvidenceRace };
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

    /** Whether this node adds its own dispute to the window of `forkId`. */
    public shouldAddOwnEvidence(
        forkId: ForkId,
        dispute: DisputeStruct,
        latestStateProof?: Promise<BuiltStateProof | undefined>
    ): Promise<boolean> {
        return this.disputeBuilder.canAddEvidence(
            forkId,
            dispute,
            latestStateProof
        );
    }

    /** After a kill or a committed reduced result of `forkId`. */
    public clearCache(forkId: ForkId): void {
        this.disputeBuilder.clearCache(forkId);
    }

    public async killDispute(dispute: DisputeStruct): Promise<void> {
        const disputeMeta = LoggerUtils.getDisputeMetadata(dispute);
        const formattedHash = LoggerUtils.formatHash(disputeMeta.disputeHash);
        let txResponse;
        try {
            // a mutex is not needed since we observe and validate a dispute only once and create only 1 disputeFraudProof for it
            const disputeFraudProof = this.getStoredDisputeFraudProof(dispute);
            const { windowExists, isExpired, killPeriodEnd } =
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
            this.logger.info(`killDispute: sending kill ${formattedHash}`, {
                disputeMeta,
                ...LoggerUtils.getDisputeDeadlineMetadata({
                    killPeriodEnd: Number(killPeriodEnd)
                })
            });
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

    /**
     * This peer's dispute of `forkId` from its active view: the proof
     * through its latest block (persistence-only replay never moves it).
     * `expectedSlashes` are slashes a kill in the same multicall lands first.
     */
    public constructDispute(
        forkId: ForkId,
        options?: {
            expectedSlashes?: Address[];
            latestStateProof?: Promise<BuiltStateProof | undefined>;
        }
    ): Promise<ConstructDisputeResult> {
        return this.disputeBuilder.constructDispute(forkId, options);
    }

    public setChannelId(channelId: ChannelId) {
        this.channelId = channelId;
        this.disputeBuilder.channelId = channelId;
    }

    public setP2pEventHooks(p2pEventHooks: P2pEventHooks) {
        this.p2pEventHooks = p2pEventHooks;
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
     * taken from a replaced or wrapped method property. The limit is capped
     * at the block gas limit: a larger one is never included.
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
        const [estimated, required, latestBlock] = await Promise.all([
            estimate,
            replayGas,
            // a failed read leaves the limit uncapped instead of failing the send
            this.stateChannelManagerContract.runner?.provider
                ?.getBlock("latest")
                .catch(() => null)
        ]);
        const limit = estimated + required;
        const blockGasLimit = latestBlock?.gasLimit ?? limit;
        return blockGasLimit < limit ? blockGasLimit : limit;
    }

    /**
     * Estimate for a best-effort multicall. A searching estimator funds a call
     * only up to the least gas at which it succeeds, and the best-effort call
     * succeeds even when its last call runs out of gas. The all-or-nothing
     * estimate funds the last call too; only a last call that already fails
     * is estimated best effort, so the earlier calls still land. That
     * estimate can leave the last call too little gas to revert with its
     * reason, so `refusal` keeps the custom error the all-or-nothing estimate
     * reverted with. Both estimates start together, so a refused upload
     * costs one round trip, not two.
     */
    private async estimateBestEffortMulticall(
        calls: string[]
    ): Promise<{ gas: bigint; refusal?: CustomEvmError }> {
        const contract = this.stateChannelManagerContract;
        const allOrNothing = contract
            .getFunction("multicall")
            .estimateGas(calls);
        const bestEffort = contract
            .getFunction("multicallBestEffortLast")
            .estimateGas(calls);
        // goes unused when the all-or-nothing estimate succeeds
        bestEffort.catch(() => undefined);
        try {
            return { gas: await allOrNothing };
        } catch (error) {
            return {
                gas: await bestEffort,
                refusal: tryDecodeCustomError(error) ?? undefined
            };
        }
    }

    /**
     * The refusal of a mined best-effort multicall's last call, decoded as its
     * revert would be, or undefined when the last call landed. A refusal
     * that names no reason (no revert data, or the proxy's revert for a facet
     * that reverted without data, see isReasonlessRevert) is
     * `estimatedRefusal` when its estimate decoded one: the last call ran out
     * of the gas the best-effort estimate left it. Otherwise it is fatal.
     */
    private async lastCallRefusal(
        receipt: ethers.TransactionReceipt,
        estimatedRefusal: CustomEvmError | undefined
    ): Promise<Error | undefined> {
        const revertData = await multicallLastCallRevertData(
            this.stateChannelManagerContract,
            receipt.logs
        );
        if (revertData === undefined) return undefined;
        if (isReasonlessRevert(revertData))
            return (
                estimatedRefusal ??
                new Error(`dispute upload reverted: ${revertData}`)
            );
        return (
            tryDecodeCustomError({ data: revertData }) ??
            new Error(`dispute upload reverted: ${revertData}`)
        );
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
}

export default DisputeManager;
