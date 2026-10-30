import ADiamondStateMachine from "../ADiamondStateMachine";
import AgreementManager from "../agreementManager";
import type { BuiltStateProof } from "../agreementManager/AgreementManager";
import { StateSnapshot } from "../models";
import { Address, ChannelId, ForkId, Hash } from "../types/types";
import type EventSyncService from "@/stateManager/eventSync/EventSyncService";
import Storage from "@/storage";
import { FraudProofType, toSolidityFraudProofType } from "@/types/sol-enums";
import {
    hash,
    intersection,
    Codec,
    Type,
    SignatureUtils,
    difference,
    getChecksumAddress,
    Logger,
    tryDecodeCustomError
} from "@/utils";
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

/** What a dispute is built from; equal inputs build an equal dispute. */
type DisputeInputs = {
    latestBlockHeight: number;
    latestStateSnapshot: StateSnapshot;
    latestStateMachineState: BytesLike;
    fraudProofsToApply: FraudProofStruct[];
    onChainSlashes: Address[];
    observedOnChainSlashes: Address[];
    timeout: TimeoutStruct;
    selfRemoval: boolean;
    inboundHead: { hash: Hash; height: number };
};

/**
 * Builds this peer's dispute of a fork and decides whether it adds evidence to
 * another peer's dispute. The inputs are its fingerprint: while a fork's
 * inputs are unchanged, the dispute built from them is reused, unless it
 * omits its auditing data and the chain no longer allows that.
 */
function fingerprintOf(inputs: DisputeInputs): string {
    return ethers.id(
        JSON.stringify(inputs, (_key, value: unknown) =>
            typeof value === "bigint" ? value.toString() : value
        )
    );
}

export default class DisputeBuilder {
    private readonly built = new Map<
        ForkId,
        { fingerprint: string; result: ConstructDisputeResult }
    >();
    // per disputed fork, whether our dispute adds evidence to the first
    // audited one
    private readonly evidenceChecks = new Map<ForkId, Promise<boolean>>();

    constructor(
        public channelId: ChannelId,
        private readonly signer: ethers.Signer,
        private readonly signerAddress: Address,
        private readonly agreementManager: AgreementManager,
        private readonly stateChannelManagerContract: StateChannelManagerInterface,
        private readonly storage: Storage,
        private readonly diamondStateMachine: ADiamondStateMachine,
        private readonly eventSyncService: EventSyncService,
        private readonly logger: Logger
    ) {}

    /**
     * Whether this node should add its own dispute to the window of `forkId`.
     * A node that already disputed the fork has committed its evidence. A
     * leaving node (the force-exit flag) answers yes at once, without a
     * comparison: any dispute makes it submit its self-removal dispute.
     * Otherwise the comparison runs once per disputed fork: reduction merges evidence
     * monotonically, so a dispute of ours that adds nothing to the first audited
     * dispute adds nothing once more disputes land. That holds only while the
     * compared dispute stays in the window, so a kill drops the cached answer
     * (clearCache). Concurrent audits share the in-flight comparison; a
     * failed one is not kept, and a positive answer stays positive so a failed
     * upload is retried by the next audit.
     */
    public canAddEvidence(
        forkId: ForkId,
        dispute: DisputeStruct,
        latestStateProof?: Promise<BuiltStateProof | undefined>
    ): Promise<boolean> {
        if (this.storage.disputes.didIDispute(forkId))
            return Promise.resolve(false);
        if (this.storage.forceExit.getForceExit()) return Promise.resolve(true);
        let check = this.evidenceChecks.get(forkId);
        if (!check) {
            const forget = () => {
                if (this.evidenceChecks.get(forkId) === check)
                    this.evidenceChecks.delete(forkId);
            };
            check = this.hasMoreEvidence(
                forkId,
                dispute,
                latestStateProof
            ).catch((error: unknown) => {
                forget();
                throw error;
            });
            this.evidenceChecks.set(forkId, check);
        }
        return check;
    }

    /** Drops the fork's evidence comparison and built dispute: after a kill (the compared dispute may be gone) or the fork's committed reduced result. */
    public clearCache(forkId: ForkId): void {
        this.evidenceChecks.delete(forkId);
        this.built.delete(forkId);
    }

    /**
     * This peer's dispute of `forkId` from its active view: the proof
     * through its latest block (persistence-only replay never moves it).
     * `expectedSlashes` are slashes a kill in the same multicall lands first.
     * `latestStateProof` is used when it still reaches the latest block.
     * undefined when the latest block is below the anchor: this view is
     * behind the chain.
     */
    public async constructDispute(
        forkId: ForkId,
        options?: {
            expectedSlashes?: Address[];
            latestStateProof?: Promise<BuiltStateProof | undefined>;
        }
    ): Promise<ConstructDisputeResult | undefined> {
        const inputs = await this.readInputs(forkId, options?.expectedSlashes);
        const built = this.built.get(forkId);
        if (
            built?.fingerprint === fingerprintOf(inputs) &&
            (await this.isReusable(built.result))
        )
            return built.result;
        const latestStateProof = await options?.latestStateProof;
        const builtStateProof =
            latestStateProof?.blockHeight === inputs.latestBlockHeight
                ? latestStateProof
                : await this.agreementManager.tryBuildStateProof(
                      forkId,
                      inputs.latestBlockHeight
                  );
        if (!builtStateProof) return undefined;
        // evidence stored while the proof was built goes in too
        const latest = await this.readInputs(forkId, options?.expectedSlashes);
        // a block that landed meanwhile needs its own proof
        if (latest.latestBlockHeight !== inputs.latestBlockHeight)
            return this.constructDispute(forkId, options);
        const result = await this.build(forkId, latest, builtStateProof);
        this.built.set(forkId, { fingerprint: fingerprintOf(latest), result });
        return result;
    }

    /**
     * The auditing data this peer builds for a dispute input: its proof
     * through the input's latest state, bounded by the input's inbound head.
     */
    public async reconstructAuditingData(
        input: DisputeInputStruct
    ): Promise<DisputeAuditingDataStruct> {
        const forkId = String(input.forkId) as ForkId;
        const latestStateSnapshot =
            this.storage.stateSnapshots.getStateSnapshotByHash(
                String(input.latestStateSnapshotHash) as Hash
            );
        if (!latestStateSnapshot)
            throw new Error(
                `reconstructAuditingData - no stored snapshot ${input.latestStateSnapshotHash}`
            );
        // the genesis has the empty proof
        const built = await this.agreementManager.buildStateProof(
            forkId,
            latestStateSnapshot.isGenesis ? -1 : latestStateSnapshot.blockHeight
        );
        return this.buildAuditingData(
            forkId,
            built,
            latestStateSnapshot,
            String(input.latestInboundMessageBlockHash) as Hash
        );
    }

    /**
     * Whether a built dispute still holds on chain. Posted auditing data stays
     * valid. An omission holds only while the chain still allows it: a moved
     * anchor or threshold set can take it back. Only the chain answers: a
     * lagging mirror cannot confirm an omission.
     */
    private async isReusable({
        dispute
    }: ConstructDisputeResult): Promise<boolean> {
        return (
            dispute.postedAuditingData ||
            (await this.stateChannelManagerContract.isAuditingDataOmissionAllowed.staticCall(
                dispute
            ))
        );
    }

    private async hasMoreEvidence(
        forkId: ForkId,
        dispute: DisputeStruct,
        latestStateProof?: Promise<BuiltStateProof | undefined>
    ): Promise<boolean> {
        const ourDispute = (
            await this.constructDispute(forkId, { latestStateProof })
        )?.dispute;
        if (!ourDispute) return false;

        this.logger.verbose("Constructed our own dispute for comparison", {
            ourDispute: LoggerUtils.getDisputeMetadata(ourDispute),
            theirDispute: LoggerUtils.getDisputeMetadata(dispute)
        });

        let isEvidenceAdded;
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
            isEvidenceAdded = !isEqual(
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
        this.logger.debug(`hasMoreEvidence=${isEvidenceAdded}`);
        return isEvidenceAdded;
    }

    private async readInputs(
        forkId: ForkId,
        expectedSlashes: Address[] = []
    ): Promise<DisputeInputs> {
        const latestBlockHeight =
            this.storage.blocks.getLatestBlockHeight(forkId);

        const [latestStateSnapshot, _onChainSlashes, _participants] =
            await Promise.all([
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

        // Construction uses the local observation. A refused conditional upload
        // recovers missing chain slashes before normal reconstruction. The kill
        // in the same multicall lands `expectedSlashes` first.
        const slashedOnChain = new Set<Address>([
            ..._onChainSlashes,
            ...expectedSlashes
        ]);
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

        const fraudProofsToApply: FraudProofStruct[] = [];
        for (const participant of difference(participants, slashedOnChain)) {
            for (const fraudProof of this.storage.fraudProofs.getFraudProofsForParticipant(
                participant
            )) {
                // a forged-inbound proof the chain no longer judges reverts the whole multicall -> try the next proof
                if (
                    Number(fraudProof.proofType) ===
                        toSolidityFraudProofType(
                            FraudProofType.ForgedInboundMessageBlock
                        ) &&
                    !(await this.stateChannelManagerContract.isUncommittedInboundMessageBlock(
                        this.channelId,
                        Codec.decode(
                            fraudProof.encodedProof,
                            FraudProofType.ForgedInboundMessageBlock
                        ).forgedInboundMessageBlock
                    ))
                )
                    continue;
                // a WrongGenesis proof the chain no longer judges (its fork past genesis) reverts the multicall too
                if (
                    Number(fraudProof.proofType) ===
                        toSolidityFraudProofType(FraudProofType.WrongGenesis) &&
                    StateSnapshot.from(
                        await this.stateChannelManagerContract.getStateSnapshot(
                            this.channelId
                        )
                    ).isPastGenesisOf(
                        Codec.decode(
                            fraudProof.encodedProof,
                            FraudProofType.WrongGenesis
                        ).genesisSnapshot.forkId
                    )
                )
                    continue;
                fraudProofsToApply.push(fraudProof);
                slashedOnChain.add(participant);
                break;
            }
        }
        // Only participants of the latest state may be listed: a slash of
        // anyone else, e.g. a participant an ancestor fork already removed,
        // makes the dispute provably invalid (InvalidDisputeReason).
        const onChainSlashes = intersection(
            slashedOnChain,
            new Set<Address>(
                latestStateSnapshot.snapshotData.participants.map(
                    getChecksumAddress
                )
            )
        );

        // timeout: it links only at the height right after the proof's latest
        // block. A lower one names a height this node passed (block accepted
        // or later state installed) -> drop it. A higher one was stored after
        // a later block landed during construction -> keep it, not attached.
        const storedTimeout = this.storage.timeout.getTimeout(forkId);
        const nextHeight = BigInt(latestBlockHeight + 1);
        if (storedTimeout && BigInt(storedTimeout.blockHeight) < nextHeight)
            this.storage.timeout.removeTimeout(forkId);
        const timeoutStruct =
            storedTimeout && BigInt(storedTimeout.blockHeight) === nextHeight
                ? storedTimeout
                : this.getEmptyTimeoutStruct();

        // latestStateSnapshot proves its own inbound head -> naming anything
        // below it is objective fraud against ourselves
        const inboundHead = this.storage.inboundMessages.headNotBehind(
            latestStateSnapshot.latestInboundMessageBlockHash,
            latestStateSnapshot.latestInboundMessageBlockHeight
        );

        return {
            latestBlockHeight,
            latestStateSnapshot,
            latestStateMachineState,
            fraudProofsToApply,
            onChainSlashes: Array.from(onChainSlashes),
            observedOnChainSlashes: Array.from(_onChainSlashes),
            timeout: timeoutStruct,
            selfRemoval: this.storage.forceExit.getForceExit(),
            inboundHead
        };
    }

    private async build(
        forkId: ForkId,
        {
            latestBlockHeight,
            latestStateSnapshot,
            latestStateMachineState,
            fraudProofsToApply,
            onChainSlashes,
            observedOnChainSlashes,
            timeout: timeoutStruct,
            selfRemoval,
            inboundHead
        }: DisputeInputs,
        builtStateProof: BuiltStateProof
    ): Promise<ConstructDisputeResult> {
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

        const disputeInput: DisputeInputStruct = {
            channelId: this.channelId,
            forkId: forkId,
            latestStateSnapshotHash: latestStateSnapshot.hash,
            stateProof: stateProof,
            onChainSlashes,
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
            observedOnChainSlashes
        };
    }

    /**
     * The auditing data of our own proof: the walk evidence, the latest
     * state, the state of the proof's final point, the inbound run, and the
     * outbound run above the on-chain anchor. Missing local data throws: this
     * peer holds what it signed.
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
        // only the run above the chain's anchor serves a later snapshot post;
        // the anchor only moves forward, so this run keeps covering it.
        // An anchor at or above the latest head leaves nothing to carry.
        const onChainSnapshot = StateSnapshot.from(
            await this.stateChannelManagerContract.getStateSnapshot(
                this.channelId
            )
        );
        const outboundMessageBlocks =
            onChainSnapshot.latestOutboundMessageBlockHeight >=
            latestStateSnapshot.latestOutboundMessageBlockHeight
                ? []
                : this.storage.outboundMessages.getMessageBlocksInRange({
                      upperBlockHash:
                          latestStateSnapshot.latestOutboundMessageBlockHash,
                      lowerBlockHash:
                          onChainSnapshot.latestOutboundMessageBlockHash
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

    /** The empty timeout input of a dispute that claims no timeout. */
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
}
