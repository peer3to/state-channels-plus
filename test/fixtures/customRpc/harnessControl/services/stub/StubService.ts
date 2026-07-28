import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import type { ForkId } from "@/types/types";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import StubRpcMethods from "./StubRpcMethods";
import { id, Log } from "ethers";
import type { StateChannelManagerProxy } from "@typechain-types";
import type {
    DisputeAuditingDataStruct,
    DisputeConfirmationStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { DisputeFraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { Codec, DetachedPromises, tryDecodeCustomError, Type } from "@/utils";
import type { RaceConditionErrorName } from "@/utils/evmErrorHandler";
import DisputeValidationStrategy from "@/stateManager/validationStrategy/DisputeValidationStrategy";
import { BlockValidationResult } from "@/types";
import { Block } from "@/models";

// `ATransport` is used both for `createRPCMethods` and the captured transport.

type DisputeCommittedEventKey = string;

/** Fixed identifiers for the stub-original registry (never caller-supplied). */
export type StubKey =
    | "broadcast"
    | "calldataPosting"
    | "pendingInboundInclusion"
    | "selectiveDisconnect"
    | "spectateCreateRpcMethods"
    | "disputeAckCreateRpcMethods"
    | "postStateSnapshot"
    | "unsafeSetLatestState"
    | "blockedInitHandshake"
    | "captureInitHandshake"
    | "initHandshakeCreateRpcMethods"
    | "maybePostBlockOnChain"
    | "spectateAbort"
    | "reductionTasks"
    | "snapshotUpdatedEvents"
    | "disputeCommittedEvents"
    | "disputeInitiation"
    | "reducedCommitEvents"
    | "reduce"
    | "reductionSimulation"
    | "finalDisputePreparation"
    | "spectateSync"
    | "pausedReduction"
    | "pausedReductionKillPeriod"
    | "constructDisputeStateProof"
    | "constructDisputeEntry"
    | "disputeSubmissions"
    | "disputeFraudProofApplies"
    | "disputeKill";

export type ReductionSimulationErrorName =
    | "RaceConditionDisputeAlreadyReduced"
    | "RaceConditionBlockHeightTooOld"
    | "RaceConditionReductionExpectationDoesntMatch";

export type PausedReductionStatus = {
    entered: boolean;
    released: boolean;
    settled: boolean;
    error?: string;
};

export type PausedReductionState = PausedReductionStatus & {
    targetForkId: ForkId;
    inside: boolean;
    release?: () => void;
    promise?: Promise<unknown>;
};

export type RecordedDisputeSubmission = {
    /** Contract method `dispute()` sent. */
    method: string;
    /** Inner call names when `method` is `multicall`, in order. */
    innerMethods: string[];
    /** `encodedDispute` carried by the uploaded dispute confirmation. */
    encodedDispute: string;
    /** Auditing data uploaded alongside the dispute, encoded, or null. */
    encodedAuditingData: string | null;
    /** Participants of the fraud proofs bundled by `applyFraudProofs`. */
    fraudProofParticipants: string[];
    /** `gasLimit` override sent with the transaction, or null. */
    gasLimit: string | null;
    /** Set once `dispute()` awaited the returned transaction. */
    waited: boolean;
};

export type DisputeSubmissionFailureSpec = {
    /** Solidity custom error to revert with (its selector is the revert data). */
    customError?: RaceConditionErrorName;
    /** Failure message when the failure is not a decodable custom error. */
    message?: string;
    /** Whether the failure surfaces from the send or from `tx.wait()`. */
    at: "send" | "wait";
};

export type DisputeSubmissionOriginals = {
    multicall: StateChannelManagerProxy["multicall"];
    uploadDispute: StateChannelManagerProxy["uploadDispute"];
    uploadDisputeWithCalldata: StateChannelManagerProxy["uploadDisputeWithCalldata"];
};

export type DisputeSubmissionHold = {
    gate: Promise<void>;
    release: () => void;
    /** Sends parked at the hold so far. */
    held: number;
};

export type RecordedFraudProofApply = {
    /** Participants named by the applied dispute fraud proofs. */
    participants: string[];
    /** Failure message from the send or from `wait()`, or null when it landed. */
    error: string | null;
    /** Custom-error name decoded from that failure, when there was one. */
    customError: string | null;
    /** Set once `killDispute` awaited the returned transaction. */
    waited: boolean;
};

export type PausedConstructDisputeStatus = {
    /** Calls parked at the held boundary so far. */
    entered: number;
    released: boolean;
};

export type PausedConstructDisputeState = PausedConstructDisputeStatus & {
    targetForkId: ForkId;
    /** True only while a `constructDispute` for the target fork is running. */
    inside: boolean;
    gate: Promise<void>;
    release: () => void;
};

export type EventSyncFailureProbe = {
    samePromise: boolean;
    handlerCallCount: number;
    firstError: string | null;
    secondError: string | null;
    cursorBefore: number | null;
    cursorAfter: number | null;
    detachedError: string | null;
};

export type ConcurrentCalldataRecoveryProbe = {
    queryCount: number;
    firstFound: boolean;
    secondFound: boolean;
    retryFound: boolean;
};

export type DisputeStrategyResultMatrix = Record<string, string>;

export type CleanCommittedDivergenceProbe = {
    result: string;
    proofStored: boolean;
};

export type MissingParticipantSnapshotsProbe = {
    earlyAuthorResult: string;
    signatureUnionResult: string;
    proofStored: boolean;
};

/**
 * Method stub/restore for Byzantine and fault-injection scenarios. Each stub is
 * a concrete method (not a free-form path) so an SDK rename breaks compilation
 * here rather than failing silently at runtime. Originals are held per service
 * instance so they survive across RPC method invocations.
 *
 * `p2pManager` is typed as `P2PManager<HarnessControlRpc>`, so `localRpc` (the
 * SDK's own services included) is fully typed. Prefer targeting real members
 * directly; private internals use explicit local structural host types at the
 * stub site.
 */
export class StubService extends ARpcService<
    StubRpcMethods,
    P2PManager<HarnessControlRpc>
> {
    readonly stubOriginals = new Map<StubKey, unknown>();
    /** Set by the record-dispute-ack stub when its method fires. */
    disputeAckRequestCalled = false;
    /** Set by the record-unsafe-set-latest-state stub when it fires. */
    unsafeSetLatestStateCalled = false;
    /** Set by the recording spectate guard when it blocks an RPC. */
    spectateGuardBlocked = false;
    /** Transport captured by the init-handshake capture stub (pre-handshake). */
    capturedInitHandshakeTransport?: ATransport;
    /** Set by the record-spectate-abort stub when `abort` fires. */
    spectateAbortCalled = false;
    /** Incremented by the count-spectate-requests stub per onSpectateRequest. */
    spectateRequestCount = 0;
    /** `reduction-*` timer tasks captured by the hold-reduction-tasks stub. */
    readonly heldReductionTasks: {
        taskName: string;
        task: () => void | Promise<void>;
    }[] = [];
    /** Event arg-tuples captured by the hold-event stubs. */
    readonly heldSnapshotUpdatedArgs: unknown[][] = [];
    readonly heldDisputeCommittedArgs: unknown[][] = [];
    readonly passedDisputeCommittedEventKeys =
        new Set<DisputeCommittedEventKey>();
    /** Whether the dispute-event hold stub should pass its first new log. */
    passFirstDisputeCommittedEvent = true;
    readonly heldReducedCommitArgs: unknown[][] = [];
    /** Incremented per `ReductionManager.tryReduce` call by the noop/record stubs. */
    reduceCallCount = 0;
    /** Incremented per `spectateService.sync` by the record stub. */
    spectateSyncCallCount = 0;
    /** State for the already-entered old-fork reduction race stub. */
    pausedReduction?: PausedReductionState;
    /** State for the constructDispute state-proof hold. */
    pausedConstructDispute?: PausedConstructDisputeState;
    /** Uploads seen by the record-only dispute-submission probe (newest last). */
    readonly recordedDisputeSubmissions: RecordedDisputeSubmission[] = [];
    /** Gate the dispute-submission probe parks uploads on, when installed. */
    disputeSubmissionHold?: DisputeSubmissionHold;
    /** Failure the dispute-submission probe injects, when installed. */
    disputeSubmissionFailure?: DisputeSubmissionFailureSpec;
    /** Applies seen by the dispute-fraud-proof apply probe (newest last). */
    readonly recordedFraudProofApplies: RecordedFraudProofApply[] = [];
    /** Gate the apply probe parks sends on, when installed. */
    fraudProofApplyHold?: DisputeSubmissionHold;
    /** Failure the apply probe injects, when installed. */
    fraudProofApplyFailure?: DisputeSubmissionFailureSpec;
    /** Incremented per `killDispute` skipped by the suppress-kill stub. */
    suppressedDisputeKillCount = 0;

    constructor(p2pManager: P2PManager<HarnessControlRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessStubService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }

    /** Exercise rejected-log retention through the real EventSyncService. */
    public async probeRejectedEventSyncLog(): Promise<EventSyncFailureProbe> {
        const sm = this.sm;
        const contract = sm.stateChannelManagerContract;
        const provider = contract.runner?.provider;
        if (!provider) throw new Error("Expected a provider for event sync");
        const latestBlock = await provider.getBlock("latest");
        if (!latestBlock?.hash) throw new Error("Expected a latest block");
        const stateSnapshot = await contract.getStateSnapshot(sm.channelId);
        const event = contract.interface.getEvent("StateSnapshotUpdated");
        const encodedEvent = contract.interface.encodeEventLog(event, [
            sm.channelId,
            stateSnapshot
        ]);
        const log = new Log(
            {
                address: String(contract.target),
                blockHash: latestBlock.hash,
                blockNumber: latestBlock.number + 1,
                data: encodedEvent.data,
                index: 0,
                removed: false,
                topics: encodedEvent.topics,
                transactionHash: id(`event-sync-failure-${Date.now()}`),
                transactionIndex: 0
            },
            provider
        );
        const eventHandler = sm.eventHandler;
        const original = eventHandler.onStateSnapshotUpdated.bind(eventHandler);
        let handlerCallCount = 0;
        eventHandler.onStateSnapshotUpdated = async () => {
            handlerCallCount += 1;
            throw new Error("Expected event-sync rejection");
        };
        const cursorBefore =
            sm.storage.eventSync.getLatestProcessedBlock(sm.channelId) ?? null;
        try {
            const first = sm.eventSyncService.scheduleLog(log, sm.channelId);
            const second = sm.eventSyncService.scheduleLog(log, sm.channelId);
            DetachedPromises.collect(first);
            const [firstError, secondError] = await Promise.all([
                first.then(
                    () => null,
                    (error: unknown) =>
                        error instanceof Error ? error.message : String(error)
                ),
                second.then(
                    () => null,
                    (error: unknown) =>
                        error instanceof Error ? error.message : String(error)
                )
            ]);
            const detached = await DetachedPromises.collectSettledAndClear();
            const rejected = detached.find(
                (result): result is PromiseRejectedResult =>
                    result.status === "rejected"
            );
            const detachedError = rejected
                ? rejected.reason instanceof Error
                    ? rejected.reason.message
                    : String(rejected.reason)
                : null;
            return {
                samePromise: first === second,
                handlerCallCount,
                firstError,
                secondError,
                cursorBefore,
                cursorAfter:
                    sm.storage.eventSync.getLatestProcessedBlock(
                        sm.channelId
                    ) ?? null,
                detachedError
            };
        } finally {
            eventHandler.onStateSnapshotUpdated = original;
        }
    }

    public async probeConcurrentCalldataRecovery(): Promise<ConcurrentCalldataRecoveryProbe> {
        const contract = this.sm.stateChannelManagerContract;
        const original = contract.getBlockCallDataCommitment;
        let queryCount = 0;
        let release: (() => void) | undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        contract.getBlockCallDataCommitment = (async (...parameters) => {
            queryCount += 1;
            await held;
            return original(...parameters);
        }) as typeof contract.getBlockCallDataCommitment;
        try {
            const first =
                this.sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    id("recovery-fork"),
                    1,
                    this.sm.signerAddress
                );
            const second =
                this.sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    id("recovery-fork"),
                    1,
                    this.sm.signerAddress
                );
            release?.();
            const [firstResult, secondResult] = await Promise.all([
                first,
                second
            ]);
            const retryResult =
                await this.sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    id("recovery-fork"),
                    1,
                    this.sm.signerAddress
                );
            return {
                queryCount,
                firstFound: firstResult.blockCalldata !== undefined,
                secondFound: secondResult.blockCalldata !== undefined,
                retryFound: retryResult.blockCalldata !== undefined
            };
        } finally {
            contract.getBlockCallDataCommitment = original;
        }
    }

    public async probeDisputeStrategyResultMatrix(): Promise<DisputeStrategyResultMatrix> {
        const { dispute } = await this.sm.disputeManager.constructDispute(
            this.sm.forkId
        );
        const strategy = new DisputeValidationStrategy(
            this.sm.storage,
            dispute,
            0,
            this.sm.diamondStateMachine.localDiamondContract,
            this.sm.logger
        );
        const matrix: DisputeStrategyResultMatrix = {};
        for (const result of [
            BlockValidationResult.SUCCESS,
            BlockValidationResult.NOT_READY,
            BlockValidationResult.DISCONNECT,
            BlockValidationResult.DISPUTE,
            BlockValidationResult.BROADCAST,
            BlockValidationResult.NOT_ENOUGH_TIME,
            BlockValidationResult.DUPLICATE
        ]) {
            const name = BlockValidationResult[result];
            try {
                matrix[name] = String(
                    await strategy.interpretFinalValidationResult(result)
                );
            } catch {
                matrix[name] = "throw";
            }
        }
        return matrix;
    }

    public async probeCleanCommittedDivergence(): Promise<CleanCommittedDivergenceProbe> {
        const { dispute } = await this.sm.disputeManager.constructDispute(
            this.sm.forkId
        );
        const latestBlock = this.sm.storage.blocks.getLatestBlock(
            this.sm.forkId
        );
        if (!latestBlock) throw new Error("Expected a latest block");
        const strategy = new DisputeValidationStrategy(
            this.sm.storage,
            dispute,
            0,
            this.sm.diamondStateMachine.localDiamondContract,
            this.sm.logger
        );
        const result =
            await strategy.blockIsNotLinkedAndIsNotFirstBlock(latestBlock);
        return {
            result: BlockValidationResult[result],
            proofStored:
                this.sm.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                    dispute
                ) !== undefined
        };
    }

    public async probeMissingParticipantSnapshots(): Promise<MissingParticipantSnapshotsProbe> {
        const { dispute } = await this.sm.disputeManager.constructDispute(
            this.sm.forkId
        );
        const latestBlock = this.sm.storage.blocks.getLatestBlock(
            this.sm.forkId
        );
        if (!latestBlock) throw new Error("Expected a latest block");
        const block = await Block.fromBlockStruct(
            {
                ...latestBlock.blockStruct,
                stateSnapshotHash: id("missing-participant-snapshot")
            },
            this.sm.signer
        );
        const strategy = new DisputeValidationStrategy(
            this.sm.storage,
            dispute,
            0,
            this.sm.diamondStateMachine.localDiamondContract,
            this.sm.logger
        );
        const earlyAuthorResult =
            await strategy.blockAuthorIsNotParticipant(block);
        const signatureUnionResult =
            await strategy.notAllSingersAreParticipants(
                this.sm.storage.queues.createEntry(block),
                new Set([block.originalSignature])
            );
        return {
            earlyAuthorResult: BlockValidationResult[earlyAuthorResult],
            signatureUnionResult: BlockValidationResult[signatureUnionResult],
            proofStored:
                this.sm.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                    dispute
                ) !== undefined
        };
    }

    /**
     * Record-only probe over the three dispute-upload entry points. A real
     * upload posts an on-chain dispute against the live fork, which derails the
     * session, so the probe records the send and hands `dispute()` a stand-in
     * transaction; the real uploads keep their coverage on the e2e paths.
     * `holdSubmissions` parks every recorded send until released, so a second
     * caller can be observed queueing behind the dispute mutex. `failure` makes
     * the send (or its `wait()`) fail - a custom error reverts with the real
     * 4-byte selector, exactly what the SDK's decoder reads off a real revert.
     */
    public installDisputeSubmissionRecorder(
        holdSubmissions: boolean,
        failure?: DisputeSubmissionFailureSpec
    ): void {
        const contract = this.sm.stateChannelManagerContract;
        if (!this.stubOriginals.has("disputeSubmissions")) {
            this.stubOriginals.set("disputeSubmissions", {
                multicall: contract.multicall,
                uploadDispute: contract.uploadDispute,
                uploadDisputeWithCalldata: contract.uploadDisputeWithCalldata
            } satisfies DisputeSubmissionOriginals);
        }
        this.recordedDisputeSubmissions.length = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.disputeSubmissionHold = holdSubmissions
            ? { gate, release, held: 0 }
            : undefined;
        this.disputeSubmissionFailure = failure;

        const record = async (
            submission: Omit<RecordedDisputeSubmission, "waited">
        ) => {
            const entry: RecordedDisputeSubmission = {
                ...submission,
                waited: false
            };
            this.recordedDisputeSubmissions.push(entry);
            const hold = this.disputeSubmissionHold;
            if (hold) {
                hold.held += 1;
                await hold.gate;
            }
            if (failure?.at === "send") throw this.submissionFailure(failure);
            return {
                // a tx that reverts also reverts the preflight `call` that
                // tryHandleEvmError retries through
                provider:
                    failure?.at === "wait"
                        ? {
                              call: async () => {
                                  throw this.submissionFailure(failure);
                              }
                          }
                        : undefined,
                wait: async () => {
                    if (failure?.at === "wait") {
                        throw this.submissionFailure(failure);
                    }
                    entry.waited = true;
                    return null;
                }
            };
        };

        contract.uploadDispute = this.asRecordingContractMethod(
            contract.uploadDispute,
            (confirmation: DisputeConfirmationStruct, overrides?: unknown) =>
                record({
                    method: "uploadDispute",
                    innerMethods: [],
                    encodedDispute: String(
                        confirmation.signedDispute.encodedDispute
                    ),
                    encodedAuditingData: null,
                    fraudProofParticipants: [],
                    gasLimit: this.overrideGasLimit(overrides)
                })
        );

        contract.uploadDisputeWithCalldata = this.asRecordingContractMethod(
            contract.uploadDisputeWithCalldata,
            (
                confirmation: DisputeConfirmationStruct,
                auditingData: DisputeAuditingDataStruct
            ) =>
                record({
                    method: "uploadDisputeWithCalldata",
                    innerMethods: [],
                    encodedDispute: String(
                        confirmation.signedDispute.encodedDispute
                    ),
                    encodedAuditingData: Codec.encode(
                        auditingData,
                        Type.DisputeAuditingData
                    ) as string,
                    fraudProofParticipants: [],
                    gasLimit: null
                })
        );

        contract.multicall = this.asRecordingContractMethod(
            contract.multicall,
            (calls: string[], overrides?: unknown) =>
                record({
                    ...this.describeMulticall(calls),
                    method: "multicall",
                    gasLimit: this.overrideGasLimit(overrides)
                })
        );
    }

    /**
     * A stand-in that records the send but keeps the original method's helpers
     * (`populateTransaction`, `staticCall`, …) - the multicall branch builds its
     * legs through `populateTransaction` on these very methods.
     */
    private asRecordingContractMethod<T extends object>(
        original: T,
        recorder: (...args: never[]) => unknown
    ): T {
        Object.defineProperties(
            recorder,
            Object.getOwnPropertyDescriptors(original)
        );
        return recorder as unknown as T;
    }

    /** Decode a dispute multicall's legs into the fields a test asserts on. */
    private describeMulticall(
        calls: string[]
    ): Omit<RecordedDisputeSubmission, "waited" | "method" | "gasLimit"> {
        const contract = this.sm.stateChannelManagerContract;
        const innerMethods: string[] = [];
        let encodedDispute = "";
        let encodedAuditingData: string | null = null;
        const fraudProofParticipants: string[] = [];
        for (const data of calls) {
            const parsed = contract.interface.parseTransaction({ data });
            if (!parsed) throw new Error("Undecodable dispute multicall leg");
            innerMethods.push(parsed.name);
            if (parsed.name === "applyFraudProofs") {
                for (const proof of parsed.args[0]) {
                    fraudProofParticipants.push(String(proof.participant));
                }
            } else {
                encodedDispute = String(parsed.args[0].signedDispute[0]);
                if (parsed.name === "uploadDisputeWithCalldata") {
                    encodedAuditingData = Codec.encode(
                        parsed.args[1],
                        Type.DisputeAuditingData
                    ) as string;
                }
            }
        }
        return {
            innerMethods,
            encodedDispute,
            encodedAuditingData,
            fraudProofParticipants
        };
    }

    private submissionFailure(failure: DisputeSubmissionFailureSpec): unknown {
        if (failure.customError) {
            return { data: id(`${failure.customError}()`).slice(0, 10) };
        }
        return new Error(failure.message ?? "dispute upload failed");
    }

    private overrideGasLimit(overrides: unknown): string | null {
        const gasLimit = (overrides as { gasLimit?: bigint } | undefined)
            ?.gasLimit;
        return gasLimit === undefined ? null : String(gasLimit);
    }

    public restoreDisputeSubmissions(): boolean {
        this.disputeSubmissionHold?.release();
        this.disputeSubmissionHold = undefined;
        this.disputeSubmissionFailure = undefined;
        const originals = this.stubOriginals.get("disputeSubmissions") as
            | DisputeSubmissionOriginals
            | undefined;
        if (originals === undefined) return false;
        const contract = this.sm.stateChannelManagerContract;
        contract.multicall = originals.multicall;
        contract.uploadDispute = originals.uploadDispute;
        contract.uploadDisputeWithCalldata =
            originals.uploadDisputeWithCalldata;
        this.stubOriginals.delete("disputeSubmissions");
        return true;
    }

    /**
     * Record every `applyDisputeFraudProofs` send and how it settled, still
     * running the real transaction. `holdApplies` parks each send until
     * released, so several kills can be staged inside one live kill window;
     * `failure` reverts the send (or its `wait()`) instead of sending it.
     */
    public installDisputeFraudProofApplyRecorder(
        holdApplies: boolean,
        failure?: DisputeSubmissionFailureSpec
    ): void {
        const contract = this.sm.stateChannelManagerContract;
        if (!this.stubOriginals.has("disputeFraudProofApplies")) {
            this.stubOriginals.set(
                "disputeFraudProofApplies",
                contract.applyDisputeFraudProofs.bind(contract)
            );
        }
        const original = this.stubOriginals.get(
            "disputeFraudProofApplies"
        ) as typeof contract.applyDisputeFraudProofs;
        this.recordedFraudProofApplies.length = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.fraudProofApplyHold = holdApplies
            ? { gate, release, held: 0 }
            : undefined;
        this.fraudProofApplyFailure = failure;

        contract.applyDisputeFraudProofs = (async (
            proofs: DisputeFraudProofStruct[]
        ) => {
            const entry: RecordedFraudProofApply = {
                participants: proofs.map((proof) => String(proof.participant)),
                error: null,
                customError: null,
                waited: false
            };
            this.recordedFraudProofApplies.push(entry);
            const hold = this.fraudProofApplyHold;
            if (hold) {
                hold.held += 1;
                await hold.gate;
            }
            const fail = (error: unknown) => {
                entry.error =
                    error instanceof Error ? error.message : String(error);
                entry.customError = tryDecodeCustomError(error)?.name ?? null;
            };
            // an injected failure replaces the send entirely - forwarding it
            // would leave a landed transaction behind a "failed" apply
            if (failure) {
                const reject = () => {
                    const error = this.submissionFailure(failure);
                    fail(error);
                    throw error;
                };
                if (failure.at === "send") reject();
                return {
                    // a tx that reverts also reverts the preflight `call` that
                    // tryHandleEvmError retries through
                    provider: { call: async () => reject() },
                    wait: async () => reject()
                };
            }
            let tx;
            try {
                tx = await original(proofs);
            } catch (error) {
                fail(error);
                throw error;
            }
            const originalWait = tx.wait.bind(tx);
            tx.wait = (async (...args: Parameters<typeof originalWait>) => {
                try {
                    const receipt = await originalWait(...args);
                    entry.waited = true;
                    return receipt;
                } catch (error) {
                    fail(error);
                    throw error;
                }
            }) as typeof tx.wait;
            return tx;
        }) as typeof contract.applyDisputeFraudProofs;
    }

    public restoreDisputeFraudProofApplies(): boolean {
        this.fraudProofApplyHold?.release();
        this.fraudProofApplyHold = undefined;
        this.fraudProofApplyFailure = undefined;
        const original = this.stubOriginals.get("disputeFraudProofApplies");
        if (original === undefined) return false;
        const contract = this.sm.stateChannelManagerContract;
        contract.applyDisputeFraudProofs =
            original as typeof contract.applyDisputeFraudProofs;
        this.stubOriginals.delete("disputeFraudProofApplies");
        return true;
    }

    public createRPCMethods(transport: ATransport): StubRpcMethods {
        return new StubRpcMethods(transport, this);
    }
}

export default StubService;
