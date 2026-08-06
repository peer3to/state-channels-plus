import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type StateManager from "@/stateManager/StateManager";
import {
    Logger,
    SignatureUtils,
    Codec,
    Type,
    hash,
    addressesEqual
} from "@/utils";
import type { DisputeFraudStruct } from "@/utils/Codec";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { DisputeFraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { ForkId, Address, Hash, Timestamp } from "@/types/types";
import StateSnapshot from "@/models/StateSnapshot";
import Block from "@/models/Block";
import { BytesLike, Signer, ZeroAddress } from "ethers";
import {
    DisputeStruct,
    DisputeConfirmationStruct,
    DisputeAuditingDataStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type {
    BlockStruct,
    SnapshotDataStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { DisputeTamperStrategy } from "@test/fixtures/customRpc/harnessControl/services/dispute/tamperStrategies";

export type DisputeTamper = (
    dispute: DisputeStruct,
    disputeConfirmation: DisputeConfirmationStruct,
    auditingData?: DisputeAuditingDataStruct
) => void | Promise<void>;

export type FinalDisputeResolution = {
    forkId: ForkId;
    genesisTimestamp: Timestamp;
};

type PostedDispute = {
    dispute: DisputeStruct;
    disputeConfirmation: DisputeConfirmationStruct;
};

/**
 * Tamper for the host-side `constructDispute` stub. Runs host-side (the body is
 * reconstructed via `new Function`), so it must be closure-free: reach helpers
 * through the injected `sm` (`sm.p2pManager.localRpc.dispute.*`) and pass any
 * captured value via `args`. Reused {@link DisputeTampering} statics are
 * detected and forwarded as named host strategies instead.
 */
export type ConstructDisputeTamper = (
    dispute: DisputeStruct,
    sm: StateManager<HarnessControlRpc>,
    args: Record<string, unknown>
) => void | Promise<void>;

/** Map the harness-side tamper statics to their host-side strategy names. */
const DISPUTE_TAMPER_STRATEGY_BY_FN = new Map<unknown, DisputeTamperStrategy>();

export type ForgeSubmitterSnapshotMutate = (ctx: {
    peerIndex: number;
    originalSnapshotData: SnapshotDataStruct;
    originalOutboundMessageBlock?: MessageBlockStruct;
    blockTimestamp: number;
}) => {
    snapshotData: SnapshotDataStruct;
    outboundMessageBlock?: MessageBlockStruct;
    encodedStateMachineStateOverride?: string;
};

export type ForgedSnapshotBuild = {
    forgedSnapshot: StateSnapshot;
    forgedBlock: Block;
    originalSnapshot: StateSnapshot;
    originalBlockHash: Hash;
    originalOutboundBlock?: MessageBlockStruct;
    mutated: ReturnType<ForgeSubmitterSnapshotMutate>;
};

export class DisputeTampering {
    static tamperAuditingDataHash(dispute: DisputeStruct): void {
        dispute.input.disputeAuditingDataHash = hash("0x42");
    }

    static tamperDoubleFault(dispute: DisputeStruct): void {
        dispute.input.disputeAuditingDataHash = hash("0x42");
        dispute.input.latestStateSnapshotHash = hash("0x43");
    }
    static tamperInvalidStateProof(dispute: DisputeStruct): void {
        dispute.input.latestStateSnapshotHash = hash("0x42");
    }

    static tamperPartialAuditing(dispute: DisputeStruct): void {
        const tamperedStateProof = dispute.input.stateProof;
        if (
            tamperedStateProof.milestones.length === 0 ||
            tamperedStateProof.milestones[0].blockConfirmations.length === 0
        ) {
            throw new Error("No milestones to tamper");
        }

        const firstBc = tamperedStateProof.milestones[0].blockConfirmations[0];
        const block = Codec.decode(
            firstBc.signedBlock.encodedBlock,
            Type.Block
        );

        block.stateSnapshotHash = hash("0xDEADBEEF");
        firstBc.signedBlock.encodedBlock = Codec.encode(block, Type.Block);
    }
    static flipSelfRemovalWithoutOutputRecompute(dispute: DisputeStruct): void {
        dispute.input.selfRemoval = true;
        dispute.input.timeout.participant = ZeroAddress;
        dispute.input.onChainSlashes = [];
    }
}

// Reused tamper statics are forwarded to the host as named strategies (they use
// Codec/hash, which a shipped `new Function` body could not reach).
DISPUTE_TAMPER_STRATEGY_BY_FN.set(
    DisputeTampering.tamperAuditingDataHash,
    "tamperAuditingDataHash"
);
DISPUTE_TAMPER_STRATEGY_BY_FN.set(
    DisputeTampering.tamperDoubleFault,
    "tamperDoubleFault"
);
DISPUTE_TAMPER_STRATEGY_BY_FN.set(
    DisputeTampering.tamperInvalidStateProof,
    "tamperInvalidStateProof"
);
DISPUTE_TAMPER_STRATEGY_BY_FN.set(
    DisputeTampering.tamperPartialAuditing,
    "tamperPartialAuditing"
);
DISPUTE_TAMPER_STRATEGY_BY_FN.set(
    DisputeTampering.flipSelfRemovalWithoutOutputRecompute,
    "flipSelfRemovalWithoutOutputRecompute"
);

export class DisputeTamperingActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(
        private harness: PeerTestHarness<TCustomRpc>,
        private logger: Logger
    ) {}

    async postTamperedDispute(
        authorPeerIndex: number,
        tamper: DisputeTamper,
        options?: {
            forkId?: ForkId;
            markMalicious?: boolean;
            final?: false;
        }
    ): Promise<PostedDispute & { finalResolution?: undefined }>;
    async postTamperedDispute(
        authorPeerIndex: number,
        tamper: DisputeTamper,
        options: {
            forkId?: ForkId;
            markMalicious?: boolean;
            final: true;
        }
    ): Promise<PostedDispute & { finalResolution: FinalDisputeResolution }>;
    async postTamperedDispute(
        authorPeerIndex: number,
        tamper: DisputeTamper,
        options: {
            forkId?: ForkId;
            markMalicious?: boolean;
            final?: boolean;
        } = {}
    ): Promise<PostedDispute & { finalResolution?: FinalDisputeResolution }> {
        const markMalicious = options?.markMalicious ?? true;
        const forkId = options?.forkId;

        const peer = this.harness.getPeer(authorPeerIndex);
        if (markMalicious) {
            this.harness.contextApi.markMaliciousPeer({
                maliciousPeerIndex: authorPeerIndex
            });
        }
        const targetForkId = forkId || this.harness.activeForkId!;

        const { dispute, disputeConfirmation, auditingData } =
            await this.harness.dispute.fetchConstructedDispute(
                authorPeerIndex,
                targetForkId
            );

        await tamper(dispute, disputeConfirmation, auditingData);
        await this.resignDispute(peer.signer, dispute, disputeConfirmation);

        if (options.final) {
            const thresholdSet =
                await peer.p2pInstance.stateChannelManagerContract.getOnChainThresholdSet(
                    this.harness.channelId
                );
            const otherSignatures = await Promise.all(
                thresholdSet
                    .filter(
                        (thresholdAddress) =>
                            !addressesEqual(thresholdAddress, peer.address)
                    )
                    .map(async (thresholdAddress) => {
                        const thresholdPeer = this.harness.peers.find((p) =>
                            addressesEqual(p.address, thresholdAddress)
                        );
                        if (!thresholdPeer) {
                            throw new Error(
                                `No harness signer for threshold participant ${thresholdAddress}`
                            );
                        }
                        return (
                            await SignatureUtils.signDispute(
                                dispute,
                                thresholdPeer.signer
                            )
                        ).signature;
                    })
            );
            disputeConfirmation.signatures = otherSignatures as BytesLike[];
        }

        this.logger.debug(
            `Peer ${authorPeerIndex} submitting tampered dispute for fork ${targetForkId}`
        );

        const channelManager = peer.p2pInstance.stateChannelManagerContract;
        let receipt;
        try {
            const txResp = dispute.postedAuditingData
                ? await channelManager.uploadDisputeWithCalldata(
                      disputeConfirmation,
                      auditingData
                  )
                : await channelManager.uploadDispute(disputeConfirmation);
            receipt = await txResp.wait();
        } catch (error) {
            if (!options.final) throw error;
            throw new Error(
                `Threshold-final dispute upload failed for peer ${authorPeerIndex} on fork ${targetForkId}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
        if (!receipt) throw new Error("Dispute upload receipt unavailable");

        this.harness.context.tamperedDisputes.push(dispute);

        if (!options.final) return { dispute, disputeConfirmation };

        const committedEvent = receipt.logs
            .map((log) => {
                try {
                    return channelManager.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find(
                (event) =>
                    (event?.name === "DisputeCommitted" ||
                        event?.name === "DisputeCommittedWithAuditingData") &&
                    event.args.isFinal === true
            );
        if (!committedEvent) {
            throw new Error(
                `Threshold signatures did not finalize dispute for peer ${authorPeerIndex} on fork ${targetForkId}`
            );
        }

        return {
            dispute,
            disputeConfirmation,
            finalResolution: {
                forkId: dispute.outputSnapshotDataHash as ForkId,
                genesisTimestamp: Number(
                    committedEvent.args.disputeCreationTimestamp
                )
            }
        };
    }

    async submitForgedFraudProof(
        disputerIndex: number,
        proofType: DisputeFraudProofType,
        buildProof: (ctx: {
            dispute: DisputeStruct;
            genesisSnapshot: StateSnapshot;
        }) => DisputeFraudStruct
    ): Promise<void> {
        const peer = this.harness.getPeer(disputerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: disputerIndex
        });
        const dispute = peer.eventSpies.onInitiatingDispute!.lastCall
            .args[1] as DisputeStruct;
        const genesisResult = await this.harness
            .control(peer)
            .dispute.getGenesisSnapshotStruct(this.harness.activeForkId!)
            .request();
        if (!genesisResult) {
            throw new Error(
                `submitForgedFraudProof: no genesis snapshot for fork ${this.harness.activeForkId}`
            );
        }
        const genesisSnapshot = StateSnapshot.from(
            Codec.decode(genesisResult.encodedSnapshot, Type.StateSnapshot)
        );
        const proofStruct = buildProof({ dispute, genesisSnapshot });
        const forged: DisputeFraudProofStruct = {
            proofType: toSolidityDisputeFraudProofType(proofType),
            participant: dispute.input.disputer,
            dispute,
            encodedProof: Codec.encode(proofStruct, proofType)
        };
        const tx =
            await peer.p2pInstance.stateChannelManagerContract.applyDisputeFraudProofs(
                [forged]
            );
        await tx.wait();
    }

    /**
     * Install a host-side `constructDispute` tamper on a peer. Reused
     * {@link DisputeTampering} statics are forwarded as named strategies;
     * one-off `(dispute, args) => void` tampers are shipped by source (and must
     * be closure-free — pass captured values via `options.args`).
     */
    async stubConstructDispute(
        peerIndex: number,
        tamper: ConstructDisputeTamper,
        options?: {
            autoRestore?: boolean;
            markMalicious?: boolean;
            args?: Record<string, unknown>;
        }
    ): Promise<void> {
        const peer = this.harness.getPeer(peerIndex);
        if (options?.markMalicious ?? true) {
            this.harness.contextApi.markMaliciousPeer({
                maliciousPeerIndex: peerIndex
            });
        }

        const strategy = DISPUTE_TAMPER_STRATEGY_BY_FN.get(tamper);
        const spec = strategy
            ? { strategy, autoRestore: options?.autoRestore }
            : {
                  fnBody: tamper.toString(),
                  args: options?.args,
                  autoRestore: options?.autoRestore
              };

        // Shipped callbacks may re-sign inner blocks as any peer; give the host
        // the peer keys so it can sign cross-author.
        if (!strategy) {
            await this.harness.ensurePeerSignersRegistered(peer);
        }

        await this.harness
            .control(peer)
            .dispute.stubConstructDispute(spec)
            .request();
        this.logger.debug(`Stubbed constructDispute for peer ${peerIndex}`);
    }

    async restoreConstructDispute(peerIndex: number): Promise<void> {
        await this.harness
            .control(this.harness.getPeer(peerIndex))
            .dispute.restoreConstructDispute()
            .request();
        this.logger.debug(`Restored constructDispute for peer ${peerIndex}`);
    }

    /** Disputes a peer produced while `constructDispute` was stubbed. */
    async getTamperedDisputes(peerIndex: number): Promise<DisputeStruct[]> {
        const { encodedDisputes } = await this.harness
            .control(this.harness.getPeer(peerIndex))
            .dispute.getTamperedDisputes()
            .request();
        return encodedDisputes.map((e) => Codec.decode(e, Type.Dispute));
    }

    async plantFreshTimeoutForNextWriter(disputerIndex: number): Promise<void> {
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error(
                "plantFreshTimeoutForNextWriter: no active fork ID — channel must be opened first"
            );
        }
        const peer = this.harness.getPeer(disputerIndex);
        const nextPeer = await this.harness.query.getNextPeerToWrite();
        await this.harness
            .control(peer)
            .dispute.plantFreshTimeout(forkId, nextPeer.address)
            .request();
    }

    async plantFreshTimeoutForParticipant(
        disputerIndex: number,
        participant: string
    ): Promise<void> {
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error(
                "plantFreshTimeoutForParticipant: no active fork ID — channel must be opened first"
            );
        }
        await this.harness
            .control(this.harness.getPeer(disputerIndex))
            .dispute.plantFreshTimeout(forkId, participant)
            .request();
    }

    async buildForgedSnapshot(
        peerIndex: number,
        mutate: ForgeSubmitterSnapshotMutate
    ): Promise<ForgedSnapshotBuild> {
        const peer = this.harness.getPeer(peerIndex);
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("buildForgedSnapshot: no active fork ID");
        }

        // Fetch the head block + its snapshot/outbound block from the host; the
        // forged snapshot/block are assembled and signed here (peers' signers
        // are available on the main thread).
        const latest = await this.harness
            .control(peer)
            .query.getLatestBlockInfo(forkId)
            .request();
        if (!latest) {
            throw new Error(
                `buildForgedSnapshot: no latest block for fork ${forkId}`
            );
        }

        const originalResult = await this.harness
            .control(peer)
            .query.getStateSnapshotStructByHash(latest.stateSnapshotHash)
            .request();
        if (!originalResult) {
            throw new Error(
                `buildForgedSnapshot: no snapshot for hash ${latest.stateSnapshotHash}`
            );
        }
        const originalStruct = Codec.decode(
            originalResult.encodedSnapshot,
            Type.StateSnapshot
        );
        const originalSnapshot = StateSnapshot.from(originalStruct);
        const outboundResult = await this.harness
            .control(peer)
            .query.getOutboundMessageBlock(
                originalStruct.snapshotData
                    .latestOutboundMessageBlockHash as string
            )
            .request();
        const originalOutboundBlock = outboundResult
            ? Codec.decode(
                  outboundResult.encodedMessageBlock,
                  Type.MessageBlock
              )
            : undefined;

        const mutated = mutate({
            peerIndex,
            originalSnapshotData: originalStruct.snapshotData,
            originalOutboundMessageBlock: originalOutboundBlock,
            blockTimestamp: Number(originalStruct.timestamp)
        });

        const forgedSnapshot = StateSnapshot.from({
            ...originalStruct,
            snapshotData: mutated.snapshotData
        });

        const forgedBlockStruct: BlockStruct = {
            ...Codec.decode(latest.encodedBlock, Type.Block),
            stateSnapshotHash: forgedSnapshot.hash
        };
        const author = this.peerForBlockAuthor(latest.author);
        const forgedBlock = await Block.fromBlockStruct(
            forgedBlockStruct,
            author.signer
        );
        const confirmationSigs = await Promise.all(
            this.harness.peers
                .filter((p) => p !== author)
                .map((p) => forgedBlock.sign(p.signer))
        );
        forgedBlock.expandSignatures(confirmationSigs);

        return {
            forgedSnapshot,
            forgedBlock,
            originalSnapshot,
            originalBlockHash: latest.hash as Hash,
            originalOutboundBlock,
            mutated
        };
    }

    private peerForBlockAuthor(participant: Address) {
        const peer = this.harness.peers.find((p) =>
            addressesEqual(p.address, participant)
        );
        if (!peer) {
            throw new Error(`No harness peer for block author ${participant}`);
        }
        return peer;
    }

    private async resignDispute(
        signer: Signer,
        dispute: DisputeStruct,
        disputeConfirmation: DisputeConfirmationStruct
    ): Promise<void> {
        const tamperedSig = await SignatureUtils.signDispute(dispute, signer);
        disputeConfirmation.signedDispute = {
            encodedDispute: tamperedSig.encoded,
            signature: tamperedSig.signature as BytesLike
        };
        disputeConfirmation.signatures = [];
    }
}
