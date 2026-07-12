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
import { ForkId, Address, Hash } from "@/types/types";
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
        options?: { forkId?: ForkId; markMalicious?: boolean }
    ): Promise<{
        dispute: DisputeStruct;
        disputeConfirmation: DisputeConfirmationStruct;
    }> {
        const markMalicious = options?.markMalicious ?? true;
        const forkId = options?.forkId;

        const peer = this.harness.getPeer(authorPeerIndex);
        if (markMalicious) {
            this.harness.contextApi.markMaliciousPeer({
                maliciousPeerIndex: authorPeerIndex
            });
        }
        const targetForkId = forkId || this.harness.activeForkId!;

        // Construct host-side; the structs come back ABI-encoded (raw ethers
        // structs don't survive JSON across the port), so decode to plain
        // mutable structs, then tamper, re-sign and submit on the main thread.
        const {
            encodedDispute,
            encodedDisputeConfirmation,
            encodedAuditingData
        } = await this.harness
            .control(peer)
            .dispute.constructDispute(targetForkId)
            .request();
        const dispute = Codec.decode(encodedDispute, Type.Dispute);
        const disputeConfirmation = Codec.decode(
            encodedDisputeConfirmation,
            Type.DisputeConfirmation
        );
        const auditingData = Codec.decode(
            encodedAuditingData,
            Type.DisputeAuditingData
        );

        await tamper(dispute, disputeConfirmation, auditingData);
        await this.resignDispute(peer.signer, dispute, disputeConfirmation);

        this.logger.debug(
            `Peer ${authorPeerIndex} submitting tampered dispute for fork ${targetForkId}`
        );

        const channelManager = peer.p2pInstance.stateChannelManagerContract;
        const txResp = dispute.postedAuditingData
            ? await channelManager.uploadDisputeWithCalldata(
                  disputeConfirmation,
                  auditingData
              )
            : await channelManager.uploadDispute(disputeConfirmation);
        await txResp.wait();

        this.harness.context.tamperedDisputes.push(dispute);

        return { dispute, disputeConfirmation };
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

    async corruptValidatorSnapshotForBalanceInvariant(
        validatorPeerIndex: number,
        options?: { forkId?: ForkId }
    ): Promise<void> {
        const forkId = options?.forkId ?? this.harness.activeForkId;
        if (!forkId) {
            throw new Error(
                "corruptValidatorSnapshotForBalanceInvariant: no active fork ID"
            );
        }

        await this.harness
            .control(this.harness.getPeer(validatorPeerIndex))
            .dispute.corruptSnapshotBalanceInvariant(forkId)
            .request();
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: validatorPeerIndex
        });
        this.logger.debug(
            `Corrupted validator ${validatorPeerIndex} snapshot for balance invariant`
        );
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
