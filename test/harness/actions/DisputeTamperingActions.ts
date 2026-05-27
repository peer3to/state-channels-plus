import { blockStructWithTransactionHeader } from "@test/factory";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import Clock from "@/Clock";
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
import DisputeManager, {
    ConstructDisputeResult
} from "@/disputeManager/DisputeManager";
import { WorkerPeer } from "@test/harness/core/WorkerPeer";
import type {
    BlockStruct,
    SignedBlockStruct,
    SnapshotDataStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
export type DisputeTamper = (
    dispute: DisputeStruct,
    disputeConfirmation: DisputeConfirmationStruct,
    auditingData?: DisputeAuditingDataStruct
) => void | Promise<void>;

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

export class DisputeTamperingActions {
    private restoreByPeerIndex = new Map<number, () => void>();
    private disputeDelayRestoreByPeerIndex = new Map<number, () => void>();

    constructor(
        private harness: PeerTestHarness,
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

        const handle = this.harness.getPeerHandle(authorPeerIndex);
        if (markMalicious) {
            this.harness.contextApi.markMaliciousPeer({
                maliciousPeerIndex: authorPeerIndex
            });
        }
        const targetForkId = forkId || this.harness.activeForkId!;

        // step 1 - W1 - construct via sub-handle so worker peers can answer.
        const { dispute, disputeConfirmation, auditingData } =
            (await handle.constructDispute(targetForkId)) as {
                dispute: DisputeStruct;
                disputeConfirmation: DisputeConfirmationStruct;
                auditingData: DisputeAuditingDataStruct;
            };

        await tamper(dispute, disputeConfirmation, auditingData);
        await this.resignDispute(handle.signer, dispute, disputeConfirmation);

        this.logger.debug(
            `Peer ${authorPeerIndex} submitting tampered dispute for fork ${targetForkId}`
        );

        const channelManager = this.harness.channelManager.connect(
            handle.signer
        );
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
        const handle = this.harness.getPeerHandle(disputerIndex);
        const dispute = peer.eventSpies.onInitiatingDispute!.lastCall
            .args[1] as DisputeStruct;
        // step 1 - W1 - genesis snapshot via sub-handle.
        const genesisSnapshot = (await handle.queryGenesisSnapshot(
            this.harness.activeForkId!
        )) as StateSnapshot;
        const proofStruct = buildProof({ dispute, genesisSnapshot });
        const forged: DisputeFraudProofStruct = {
            proofType: toSolidityDisputeFraudProofType(proofType),
            participant: dispute.input.disputer,
            dispute,
            encodedProof: Codec.encode(proofStruct, proofType)
        };
        const tx = await this.harness.channelManager
            .connect(peer.signer)
            .applyDisputeFraudProofs([forged]);
        await tx.wait();
    }

    async stubConstructDispute(
        peerIndex: number,
        tamper: DisputeTamper,
        options?: { autoRestore?: boolean; markMalicious?: boolean }
    ): Promise<void> {
        if (options?.markMalicious ?? true) {
            this.harness.contextApi.markMaliciousPeer({
                maliciousPeerIndex: peerIndex
            });
        }
        this.restoreConstructDispute(peerIndex);

        // step 1 - worker mode -> register the closure on the harness side and
        // install the worker-side wrap via byzantine.installDisputeTamperHook.
        // worker's wrapped constructDispute calls back via "harness.tamperDispute"
        // (W3 bidirectional) -> we run the closure here -> mutated pair returns.
        const handle = this.harness.getPeerHandle(peerIndex);
        if (handle instanceof WorkerPeer) {
            const peer = this.harness.getPeer(peerIndex);
            this.harness.tamperFnsByPeer.set(
                peerIndex,
                async (dispute, disputeConfirmation, auditingData) => {
                    await tamper(
                        dispute as DisputeStruct,
                        disputeConfirmation as DisputeConfirmationStruct,
                        auditingData as DisputeAuditingDataStruct
                    );
                    await this.resignDispute(
                        peer.signer,
                        dispute as DisputeStruct,
                        disputeConfirmation as DisputeConfirmationStruct
                    );
                    this.harness.context.tamperedDisputes.push(
                        dispute as DisputeStruct
                    );
                    if (options?.autoRestore) {
                        this.harness.tamperFnsByPeer.delete(peerIndex);
                    }
                    return { dispute, disputeConfirmation, auditingData };
                }
            );
            // step 1 - await the install rpc -> the wrap is in place before
            // any test code can trigger a dispute. fire-and-forget races with
            // tests where the dispute starts immediately after the stub call
            // (e.g. case5_lastMilestoneFinalityAndAuditingData).
            const rpc = handle.getRpc();
            await rpc.call("byzantine.installDisputeTamperHook", {});
            this.restoreByPeerIndex.set(peerIndex, () => {
                this.harness.tamperFnsByPeer.delete(peerIndex);
                void rpc.call("byzantine.uninstallDisputeTamperHook", {});
            });
            this.logger.debug(
                `Stubbed constructDispute (worker mode) for peer ${peerIndex}`
            );
            return;
        }

        // step 2 - inline mode (unchanged from pre-W3).
        const peer = this.harness.getPeer(peerIndex);
        const disputeManager: DisputeManager = peer.stateManager.disputeManager;
        const originalConstructDispute =
            disputeManager.constructDispute.bind(disputeManager);

        disputeManager.constructDispute = async (
            targetForkId: ForkId
        ): Promise<ConstructDisputeResult> => {
            const result = await originalConstructDispute(targetForkId);

            await tamper(
                result.dispute,
                result.disputeConfirmation,
                result.auditingData
            );
            await this.resignDispute(
                peer.signer,
                result.dispute,
                result.disputeConfirmation
            );

            this.harness.context.tamperedDisputes.push(result.dispute);

            if (options?.autoRestore) {
                this.restoreConstructDispute(peerIndex);
            }

            return result;
        };

        this.restoreByPeerIndex.set(peerIndex, () => {
            disputeManager.constructDispute = originalConstructDispute;
        });

        this.logger.debug(`Stubbed constructDispute for peer ${peerIndex}`);
    }

    restoreConstructDispute(peerIndex: number): void {
        const restore = this.restoreByPeerIndex.get(peerIndex);
        if (!restore) {
            return;
        }

        restore();
        this.restoreByPeerIndex.delete(peerIndex);
        this.logger.debug(`Restored constructDispute for peer ${peerIndex}`);
    }

    async plantFreshTimeoutForNextWriter(disputerIndex: number): Promise<void> {
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error(
                "plantFreshTimeoutForNextWriter: no active fork ID — channel must be opened first"
            );
        }
        // step 1 - W1 - sub-handle reads + write.
        const handle = this.harness.getPeerHandle(disputerIndex);
        const nextPeer = await this.harness.query.getNextPeerToWrite();
        const latestConfirmation =
            await handle.queryLatestBlockConfirmation(forkId);
        if (!latestConfirmation) {
            throw new Error(
                `plantFreshTimeoutForNextWriter: no latest block for fork ${forkId}`
            );
        }
        const latestBlock = (
            await import("@/models/Block")
        ).default.fromBlockConfirmation(latestConfirmation as never);
        await handle.storeTimeout({
            forkId,
            timeout: {
                participant: nextPeer.address,
                blockHeight: BigInt(Number(latestBlock.height) + 1),
                minTimeStamp: BigInt(Clock.getTimeInSeconds()),
                isForced: false,
                previousBlockProducer: ZeroAddress,
                previousBlockProducerPostedCalldata: false,
                participantSignatureOnPreviousBlock: "0x"
            }
        });
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

        const handle = this.harness.getPeerHandle(validatorPeerIndex);
        let originalHash: string;
        if (handle instanceof WorkerPeer) {
            // step 1 - worker mode -> route the whole read/mutate/write into the
            // worker. inline mode keeps the in-process body for parity.
            const result = (await handle
                .getRpc()
                .call("byzantine.corruptValidatorSnapshotForBalanceInvariant", {
                    forkId
                })) as { hash: string };
            originalHash = result.hash;
        } else {
            const peer = this.harness.getPeer(validatorPeerIndex);
            const storage = peer.stateManager.storage;
            const latestBlock = storage.blocks.getLatestBlock(forkId);

            if (!latestBlock) {
                throw new Error(
                    `corruptValidatorSnapshotForBalanceInvariant: no latest block for fork ${forkId}`
                );
            }

            const originalSnapshot =
                storage.stateSnapshots.getStateSnapshotByHash(
                    latestBlock.stateSnapshotHash
                );
            if (!originalSnapshot) {
                throw new Error(
                    `corruptValidatorSnapshotForBalanceInvariant: no snapshot for hash ${latestBlock.stateSnapshotHash}`
                );
            }

            const originalStateSnapshotStruct = originalSnapshot.toStruct();
            const corruptedSnapshotData = {
                ...originalStateSnapshotStruct.snapshotData
            };
            const originalAmount = BigInt(
                originalStateSnapshotStruct.snapshotData.totalDeposits.amount
            );
            corruptedSnapshotData.totalDeposits = {
                ...corruptedSnapshotData.totalDeposits,
                amount: originalAmount + 1n
            };

            const corruptedStruct = {
                ...originalStateSnapshotStruct,
                snapshotData: corruptedSnapshotData
            };
            const corruptedSnapshot = StateSnapshot.from(corruptedStruct);
            originalHash = originalSnapshot.hash as string;

            storage.stateSnapshots.storeStateSnapshot(corruptedSnapshot, {
                hash: originalHash
            });
        }
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: validatorPeerIndex
        });

        this.logger.debug(
            `Corrupted validator ${validatorPeerIndex} snapshot for balance invariant (hash=${originalHash})`
        );
    }

    async buildForgedSnapshot(
        peerIndex: number,
        mutate: ForgeSubmitterSnapshotMutate
    ): Promise<ForgedSnapshotBuild> {
        const peer = this.harness.getPeer(peerIndex);
        const storage = peer.stateManager.storage;
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("buildForgedSnapshot: no active fork ID");
        }

        const latestBlock = storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) {
            throw new Error(
                `buildForgedSnapshot: no latest block for fork ${forkId}`
            );
        }

        const originalSnapshot = storage.stateSnapshots.getStateSnapshotByHash(
            latestBlock.stateSnapshotHash
        );
        if (!originalSnapshot) {
            throw new Error(
                `buildForgedSnapshot: no snapshot for hash ${latestBlock.stateSnapshotHash}`
            );
        }
        const originalStruct = originalSnapshot.toStruct();
        const originalOutboundBlock = storage.outboundMessages.getMessageBlock(
            originalStruct.snapshotData.latestOutboundMessageBlockHash as string
        );

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
            ...latestBlock.blockStruct,
            stateSnapshotHash: forgedSnapshot.hash
        };
        const author = this.peerForBlockAuthor(latestBlock.author);
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
            originalBlockHash: latestBlock.hash,
            originalOutboundBlock,
            mutated
        };
    }

    async truncateStateProofToHeight(
        dispute: DisputeStruct,
        options: {
            disputerPeerIndex: number;
            targetHeight: number;
        }
    ): Promise<DisputeAuditingDataStruct> {
        const { disputerPeerIndex, targetHeight } = options;
        const peer = this.harness.getPeer(disputerPeerIndex);
        const stateProof = dispute.input.stateProof;
        const handle = this.harness.getPeerHandle(disputerPeerIndex);

        const truncate = (): boolean => {
            if (stateProof.signedBlocks.length > 0) {
                const lastBlock = Codec.decode(
                    stateProof.signedBlocks.at(-1)!.encodedBlock,
                    Type.Block
                );
                const h = Number(
                    (
                        lastBlock as {
                            transaction: { header: { transactionCnt: bigint } };
                        }
                    ).transaction.header.transactionCnt
                );
                if (h <= targetHeight) return false;
                stateProof.signedBlocks.pop();
                return true;
            }
            if (stateProof.milestones.length > 0) {
                const lastMilestone =
                    stateProof.milestones[stateProof.milestones.length - 1]!;
                const bcs = lastMilestone.blockConfirmations;
                if (bcs.length === 0) return false;
                const lastBc = bcs[bcs.length - 1]!;
                const lastBlock = Codec.decode(
                    lastBc.signedBlock.encodedBlock,
                    Type.Block
                );
                const h = Number(
                    (
                        lastBlock as {
                            transaction: { header: { transactionCnt: bigint } };
                        }
                    ).transaction.header.transactionCnt
                );
                if (h <= targetHeight) return false;
                bcs.pop();
                if (bcs.length === 0) {
                    stateProof.milestones.pop();
                }
                return true;
            }
            return false;
        };

        while (truncate()) {
            const { hasBlock, latestBlock } =
                await handle.queryLatestBlockFromStateProof(stateProof);
            const h = Number(latestBlock.transaction.header.transactionCnt);
            if (!hasBlock || h <= targetHeight) break;
        }

        // step 1 - W1 - getAuditingData via sub-handle.
        const { auditingData } = (await handle.queryDisputeAuditingData({
            forkId: dispute.input.forkId,
            args: [stateProof]
        })) as { auditingData: DisputeAuditingDataStruct };

        dispute.input.latestStateSnapshotHash = StateSnapshot.from(
            auditingData.latestStateSnapshot
        ).hash as `0x${string}`;
        dispute.input.disputeAuditingDataHash = hash(
            Codec.encode(auditingData, Type.DisputeAuditingData)
        ) as `0x${string}`;

        this.logger.debug(
            `Truncated state proof to height ${targetHeight} for disputer ${disputerPeerIndex}`
        );

        return auditingData;
    }

    /** Set `dispute.input.forkId` and rewrite every block in stateProof to the same forkId. */
    async rewriteUniformForkIdInDispute(
        dispute: DisputeStruct,
        forkId: ForkId
    ): Promise<void> {
        dispute.input.forkId = forkId;
        const proof = dispute.input.stateProof;
        const setForkId = (bs: BlockStruct) =>
            blockStructWithTransactionHeader(bs, { forkId });

        for (let i = 0; i < proof.signedBlocks.length; i++) {
            await this.rewriteSignedBlockAtIndex(dispute, i, setForkId);
        }
        for (let m = 0; m < proof.milestones.length; m++) {
            const bcs = proof.milestones[m]!.blockConfirmations;
            for (let j = 0; j < bcs.length; j++) {
                await this.rewriteMilestoneSignedBlockAtIndex(
                    dispute,
                    m,
                    j,
                    setForkId
                );
            }
        }
    }

    async rewriteLastSignedBlockInDispute(
        dispute: DisputeStruct,
        transformBlockStruct: (bs: BlockStruct) => BlockStruct
    ): Promise<void> {
        const proof = dispute.input.stateProof;
        await this.rewriteSignedBlockAtIndex(
            dispute,
            proof.signedBlocks.length - 1,
            transformBlockStruct
        );
    }

    async rewriteSignedBlockAtIndex(
        dispute: DisputeStruct,
        index: number,
        transformBlockStruct: (bs: BlockStruct) => BlockStruct
    ): Promise<void> {
        const proof = dispute.input.stateProof;
        if (index < 0 || index >= proof.signedBlocks.length) {
            throw new Error(
                `rewriteSignedBlockAtIndex: index ${index} out of range (have ${proof.signedBlocks.length} signedBlocks)`
            );
        }
        proof.signedBlocks[index] = await this.remapSignedBlock(
            proof.signedBlocks[index],
            transformBlockStruct
        );
    }

    async rewriteLastMilestoneSignedBlockInDispute(
        dispute: DisputeStruct,
        transformBlockStruct: (bs: BlockStruct) => BlockStruct
    ): Promise<void> {
        const proof = dispute.input.stateProof;
        if (proof.milestones.length === 0) {
            throw new Error(
                "rewriteLastMilestoneSignedBlockInDispute: stateProof.milestones is empty"
            );
        }
        const lastMilestoneIndex = proof.milestones.length - 1;
        const lastM = proof.milestones[lastMilestoneIndex];
        if (lastM.blockConfirmations.length === 0) {
            throw new Error(
                "rewriteLastMilestoneSignedBlockInDispute: last milestone has no blockConfirmations"
            );
        }
        await this.rewriteMilestoneSignedBlockAtIndex(
            dispute,
            lastMilestoneIndex,
            lastM.blockConfirmations.length - 1,
            transformBlockStruct
        );
    }

    async rewriteMilestoneSignedBlockAtIndex(
        dispute: DisputeStruct,
        milestoneIndex: number,
        blockConfirmationIndex: number,
        transformBlockStruct: (bs: BlockStruct) => BlockStruct
    ): Promise<void> {
        const proof = dispute.input.stateProof;
        if (milestoneIndex < 0 || milestoneIndex >= proof.milestones.length) {
            throw new Error(
                `rewriteMilestoneSignedBlockAtIndex: milestoneIndex ${milestoneIndex} out of range (have ${proof.milestones.length} milestones)`
            );
        }
        const milestone = proof.milestones[milestoneIndex];
        if (
            blockConfirmationIndex < 0 ||
            blockConfirmationIndex >= milestone.blockConfirmations.length
        ) {
            throw new Error(
                `rewriteMilestoneSignedBlockAtIndex: blockConfirmationIndex ${blockConfirmationIndex} out of range (have ${milestone.blockConfirmations.length} blockConfirmations in milestone ${milestoneIndex})`
            );
        }
        const { signedBlock, signatures } =
            milestone.blockConfirmations[blockConfirmationIndex];
        milestone.blockConfirmations[blockConfirmationIndex] = {
            signedBlock: await this.remapSignedBlock(
                signedBlock,
                transformBlockStruct
            ),
            signatures
        };
    }

    /** Re-encode and re-sign after `transformBlockStruct`, using the harness peer that matches the transformed block author. */
    private async remapSignedBlock(
        signedBlock: SignedBlockStruct,
        transformBlockStruct: (bs: BlockStruct) => BlockStruct
    ): Promise<SignedBlockStruct> {
        const mapped = transformBlockStruct(
            Block.fromSignedBlock(signedBlock).blockStruct
        );
        const author = mapped.transaction.header.participant as Address;
        const peer = this.peerForBlockAuthor(author);
        return (await Block.fromBlockStruct(mapped, peer.signer)).signedBlock;
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
