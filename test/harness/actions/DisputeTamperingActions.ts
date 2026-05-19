import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import {
    Logger,
    SignatureUtils,
    Codec,
    Type,
    hash,
    addressesEqual
} from "@/utils";
import { ForkId, Address } from "@/types/types";
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

export type ColludeOnFraudulentSnapshotMutate = (ctx: {
    peerIndex: number;
    originalSnapshotData: SnapshotDataStruct;
    originalOutboundMessageBlock?: MessageBlockStruct;
    blockTimestamp: number;
}) => {
    snapshotData: SnapshotDataStruct;
    outboundMessageBlock?: MessageBlockStruct;
    encodedStateMachineStateOverride?: string;
};

type CreateStateSnapshotResult = {
    stateSnapshot: StateSnapshot;
    outboundMessageBlock?: MessageBlockStruct;
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

        const peer = this.harness.getPeer(authorPeerIndex);
        if (markMalicious) {
            this.harness.contextApi.markMaliciousPeer({
                maliciousPeerIndex: authorPeerIndex
            });
        }
        const targetForkId = forkId || this.harness.activeForkId!;

        const { dispute, disputeConfirmation, auditingData } =
            await peer.stateManager.disputeManager.constructDispute(
                targetForkId
            );

        await tamper(dispute, disputeConfirmation, auditingData);
        await this.resignDispute(peer.signer, dispute, disputeConfirmation);

        this.logger.debug(
            `Peer ${authorPeerIndex} submitting tampered dispute for fork ${targetForkId}`
        );

        const channelManager = this.harness.channelManager.connect(peer.signer);
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

    stubConstructDispute(
        peerIndex: number,
        tamper: DisputeTamper,
        options?: { autoRestore?: boolean; markMalicious?: boolean }
    ): void {
        const peer = this.harness.getPeer(peerIndex);
        const disputeManager: DisputeManager = peer.stateManager.disputeManager;

        if (options?.markMalicious ?? true) {
            this.harness.contextApi.markMaliciousPeer({
                maliciousPeerIndex: peerIndex
            });
        }
        this.restoreConstructDispute(peerIndex);

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

    corruptValidatorSnapshotForBalanceInvariant(
        validatorPeerIndex: number,
        options?: { forkId?: ForkId }
    ): void {
        const forkId = options?.forkId ?? this.harness.activeForkId;
        if (!forkId) {
            throw new Error(
                "corruptValidatorSnapshotForBalanceInvariant: no active fork ID"
            );
        }

        const peer = this.harness.getPeer(validatorPeerIndex);
        const storage = peer.stateManager.storage;
        const latestBlock = storage.blocks.getLatestBlock(forkId);

        if (!latestBlock) {
            throw new Error(
                `corruptValidatorSnapshotForBalanceInvariant: no latest block for fork ${forkId}`
            );
        }

        const originalSnapshot = storage.stateSnapshots.getStateSnapshotByHash(
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
        const originalHash = originalSnapshot.hash;

        storage.stateSnapshots.storeStateSnapshot(corruptedSnapshot, {
            hash: originalHash
        });
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: validatorPeerIndex
        });

        this.logger.debug(
            `Corrupted validator ${validatorPeerIndex} snapshot for balance invariant (hash=${originalHash})`
        );
    }

    colludeOnFraudulentSnapshot(options: {
        peers?: number[];
        mutate: ColludeOnFraudulentSnapshotMutate;
    }): () => void {
        const peerIndices =
            options.peers ?? this.harness.peers.map((p) => p.index);

        const restorers = peerIndices.map((peerIndex) => {
            const sm = this.harness.getPeer(peerIndex).stateManager as any;
            const storage = sm.storage.stateMachineStates;
            const colludedBytesByHash = new Map<string, string>();

            // 1) Substitute the snapshot every peer signs/recomputes for the
            //    next block
            const originalCreate = sm.createStateSnapshot.bind(sm);
            sm.createStateSnapshot = async (
                ...args: unknown[]
            ): Promise<CreateStateSnapshotResult> => {
                const result: CreateStateSnapshotResult = await originalCreate(
                    ...args
                );
                const original = result.stateSnapshot.toStruct();
                const mutated = options.mutate({
                    peerIndex,
                    originalSnapshotData: original.snapshotData,
                    originalOutboundMessageBlock: result.outboundMessageBlock,
                    blockTimestamp: Number(original.timestamp)
                });
                if (mutated.encodedStateMachineStateOverride !== undefined) {
                    colludedBytesByHash.set(
                        mutated.snapshotData.stateMachineStateHash as string,
                        mutated.encodedStateMachineStateOverride
                    );
                }
                return {
                    stateSnapshot: StateSnapshot.from({
                        ...original,
                        snapshotData: mutated.snapshotData
                    }),
                    outboundMessageBlock:
                        mutated.outboundMessageBlock ??
                        result.outboundMessageBlock
                };
            };

            // 2) Swap stored bytes for `encodedStateMachineStateOverride` so
            //    spectators receive bytes that keccak to the inflated hash.
            const originalStore = storage.storeStateMachineState.bind(storage);
            storage.storeStateMachineState = (
                encodedState: string,
                opts?: { hash?: string }
            ) => {
                const colluded = opts?.hash
                    ? colludedBytesByHash.get(opts.hash)
                    : undefined;
                return originalStore(colluded ?? encodedState, opts);
            };

            return () => {
                sm.createStateSnapshot = originalCreate;
                storage.storeStateMachineState = originalStore;
            };
        });

        this.logger.debug(
            `Colluding on fraudulent snapshot for peers [${peerIndices.join(", ")}]`
        );
        return () => restorers.forEach((r) => r());
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
        const localDiamond = this.harness.getLocalDiamond(disputerPeerIndex);

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
            const [hasBlock, latestBlock] =
                await localDiamond.getLatestBlockFromStateProof(stateProof);
            const h = Number(latestBlock.transaction.header.transactionCnt);
            if (!hasBlock || h <= targetHeight) break;
        }

        const { auditingData } =
            peer.stateManager.disputeManager.getAuditingData(
                dispute.input.forkId,
                stateProof
            );

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
