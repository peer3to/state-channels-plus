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
    DisputeConfirmationStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import DisputeManager, {
    ConstructDisputeResult
} from "@/disputeManager/DisputeManager";
import type { BlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import {
    expectMilestonesOnlyStateProof,
    expectSignedBlocksOnlyStateProof
} from "./assert/expectDisputeInput";

export type DisputeTamper = (
    dispute: DisputeStruct,
    disputeConfirmation: DisputeConfirmationStruct
) => void | Promise<void>;

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
    static junkSelfRemovalInconsistentOutputHash(dispute: DisputeStruct): void {
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
        forkId?: ForkId
    ): Promise<{
        dispute: DisputeStruct;
        disputeConfirmation: DisputeConfirmationStruct;
    }> {
        const peer = this.harness.getPeer(authorPeerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: authorPeerIndex
        });
        const targetForkId = forkId || this.harness.activeForkId!;

        const { dispute, disputeConfirmation, auditingData } =
            await peer.stateManager.disputeManager.constructDispute(
                targetForkId
            );

        await tamper(dispute, disputeConfirmation);
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

            await tamper(result.dispute, result.disputeConfirmation);
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

    async truncateStateProofToHeight(
        dispute: DisputeStruct,
        disputerPeerIndex: number,
        targetHeight: number
    ): Promise<void> {
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
    }

    async rewriteLastSignedBlockInDispute(
        dispute: DisputeStruct,
        mapStruct: (bs: BlockStruct) => BlockStruct
    ): Promise<void> {
        const proof = dispute.input.stateProof;
        expectSignedBlocksOnlyStateProof(proof);
        const lastIdx = proof.signedBlocks.length - 1;
        const prev = Block.fromSignedBlock(proof.signedBlocks[lastIdx]);
        const mapped = mapStruct(prev.blockStruct);
        const participant = mapped.transaction.header.participant as Address;
        const peer = this.harness.peers.find((p) =>
            addressesEqual(p.address, participant)
        );
        if (!peer) {
            throw new Error(`No harness peer for block author ${participant}`);
        }
        const nb = await Block.fromBlockStruct(mapped, peer.signer);
        proof.signedBlocks[lastIdx] = nb.signedBlock;
    }

    async rewriteLastMilestoneSignedBlockInDispute(
        dispute: DisputeStruct,
        mapStruct: (bs: BlockStruct) => BlockStruct
    ): Promise<void> {
        const proof = dispute.input.stateProof;
        expectMilestonesOnlyStateProof(proof);
        const lastM = proof.milestones[proof.milestones.length - 1];
        const lastIdx = lastM.blockConfirmations.length - 1;
        const bc = lastM.blockConfirmations[lastIdx];
        const prev = Block.fromSignedBlock(bc.signedBlock);
        const mapped = mapStruct(prev.blockStruct);
        const participant = mapped.transaction.header.participant as Address;
        const peer = this.harness.peers.find((p) =>
            addressesEqual(p.address, participant)
        );
        if (!peer) {
            throw new Error(`No harness peer for block author ${participant}`);
        }
        const nb = await Block.fromBlockStruct(mapped, peer.signer);
        lastM.blockConfirmations[lastIdx] = {
            signedBlock: nb.signedBlock,
            signatures: bc.signatures
        };
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
