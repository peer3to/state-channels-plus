import { BytesLike, Wallet, ZeroAddress, ZeroHash } from "ethers";

import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import Clock from "@/Clock";
import { SignatureUtils, Codec, Type, hash as keccakHash } from "@/utils";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import type { Address, Bytes, ForkId, Hash } from "@/types/types";
import type {
    DisputeStruct,
    DisputeConfirmationStruct,
    DisputeAuditingDataStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import type {
    BlockConfirmationStruct,
    BlockStruct,
    SignedBlockStruct,
    TransactionHeaderStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { ConstructDisputeResult } from "@/disputeManager/DisputeManager";
import { DisputeFraudProofType } from "@/types/sol-enums";
import {
    hash as randomHashFactory,
    blockStructWithTransactionHeader as factoryBlockStructWithHeader
} from "@test/factory";
import {
    expectSignedBlocksOnlyStateProof as assertSignedBlocksOnly,
    expectMilestonesOnlyStateProof as assertMilestonesOnly
} from "@test/harness/actions/assert/expectDisputeInput";
import type { SignerService } from "../signer/SignerService";
import DisputeRpcMethods from "./DisputeRpcMethods";

type BlockTransform = (bs: BlockStruct) => BlockStruct;

// inverse of src's toSolidityDisputeFraudProofType (value % 200)
const fromSolidityDisputeFraudProofType = (
    value: number
): DisputeFraudProofType => {
    const tsValue = value + 200;
    if (DisputeFraudProofType[tsValue] === undefined) {
        throw new Error(
            `Unknown solidity DisputeFraudProofType value: ${value}`
        );
    }
    return tsValue;
};

/** Projection of the dispute fraud proof stored for the audited dispute. */
export type StoredDisputeFraudProof = {
    disputeFraudProofType: DisputeFraudProofType;
    /** Participant the proof accuses. */
    proofParticipant: Address;
    /** Evidence struct, encoded per its proof type. */
    encodedProof: Bytes;
};

/** Outcome of one real `validateDispute` run plus the stored-proof projection. */
export type DisputeValidationRun = {
    /** Proof stored for this dispute; absent when none was stored. */
    storedProof?: StoredDisputeFraudProof;
    /** All dispute fraud proofs in storage (backs replay/idempotency counts). */
    disputeFraudProofCount: number;
} & (
    | { outcome: "returned"; isValid: boolean }
    | { outcome: "threw"; threwMessage: string }
);

/** Presence of one persisted item in storage before/after the persist call. */
export type PersistedItemProjection = {
    /** Blocks: `forkId:height:hash`; snapshots/messages/state: the hash. */
    key: string;
    storedBefore: boolean;
    storedAfter: boolean;
};

export type PersistDisputeDataProjection = {
    /** Message of a thrown persist error; absent when it returned. */
    threwMessage?: string;
    /** Per decodable milestone confirmation block, state-proof order. */
    milestoneBlocks: PersistedItemProjection[];
    undecodableMilestoneBlockCount: number;
    /** Per decodable `stateProof.signedBlocks` entry, proof order. */
    signedBlocks: PersistedItemProjection[];
    undecodableSignedBlockCount: number;
    /** Auditing-data snapshots: latest first, then milestone snapshots. */
    snapshots: PersistedItemProjection[];
    /** Keyed by the latest finalized snapshot's stateMachineStateHash; absent without auditing data. */
    stateMachineState?: PersistedItemProjection;
    inboundMessages: PersistedItemProjection[];
    outboundMessages: PersistedItemProjection[];
};

/**
 * Dispute construction / auditing / tampering for the test harness. Accessors,
 * shared state and helpers live here (not on the RpcMethods class) since every
 * RpcMethods method is routable by name at runtime.
 */
export class DisputeService extends ARpcService<DisputeRpcMethods> {
    /** Disputes produced while `constructDispute` was stubbed (newest last). */
    readonly tamperedDisputes: DisputeStruct[] = [];
    private originalConstructDispute?: (
        forkId: ForkId
    ) => Promise<ConstructDisputeResult>;

    /** Auditing data of the dispute currently being constructed (for sync). */
    private pendingAuditingData?: DisputeAuditingDataStruct;

    constructor(
        p2pManager: P2PManager,
        private readonly signerService: SignerService
    ) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessDisputeService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }
    get storage() {
        return this.sm.storage;
    }
    get disputeManager() {
        return this.sm.disputeManager;
    }
    get agreementManager() {
        return this.sm.agreementManager;
    }

    // ===== Callback utilities (reached via the injected stateManager) =====
    //
    // Tamper callbacks run host-side via `new Function`, so the helpers they
    // need can't be imported in the callback's (lost) lexical scope — they reach
    // them through `sm.p2pManager.localRpc.dispute.*` instead.

    /** Random 32-byte hash (factory `hash()`). */
    randomHash(): `0x${string}` {
        return randomHashFactory();
    }
    /** Deterministic keccak hash of `data` (utils `hash()`). */
    hash(data: BytesLike): `0x${string}` {
        return keccakHash(data) as `0x${string}`;
    }
    get zeroHash(): string {
        return ZeroHash;
    }
    get zeroAddress(): string {
        return ZeroAddress;
    }
    blockStructWithTransactionHeader(
        bs: BlockStruct,
        header: Partial<TransactionHeaderStruct>
    ): BlockStruct {
        return factoryBlockStructWithHeader(bs, header);
    }
    /** ABI-encode a block struct (`Type.Block`). */
    encodeBlock(block: BlockStruct): string {
        return Codec.encode(block, Type.Block) as string;
    }
    /** Current time in seconds (SDK `Clock`). */
    nowSeconds(): number {
        return Clock.getTimeInSeconds();
    }
    expectSignedBlocksOnlyStateProof(stateProof: StateProofStruct): void {
        assertSignedBlocksOnly(stateProof);
    }
    expectMilestonesOnlyStateProof(stateProof: StateProofStruct): void {
        assertMilestonesOnly(stateProof);
    }
    getLatestBlockFromStateProof(stateProof: StateProofStruct) {
        return this.sm.diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
            stateProof
        );
    }

    /** Author of the block at `height` within `stateProof`, or null. */
    blockAuthorAtHeightFromProof(
        stateProof: StateProofStruct,
        height: number
    ): string | null {
        const authorAt = (encoded: BytesLike): string | null => {
            const block = Codec.decode(encoded, Type.Block) as {
                transaction: {
                    header: { participant: string; transactionCnt: bigint };
                };
            };
            return Number(block.transaction.header.transactionCnt) === height
                ? block.transaction.header.participant
                : null;
        };
        for (const sb of stateProof.signedBlocks) {
            const author = authorAt(sb.encodedBlock);
            if (author) return author;
        }
        for (const m of stateProof.milestones) {
            for (const bc of m.blockConfirmations) {
                const author = authorAt(bc.signedBlock.encodedBlock);
                if (author) return author;
            }
        }
        return null;
    }

    // ===== State-proof tampering (reached via the injected stateManager) =====

    /** Set `dispute.input.forkId` and rewrite every block in stateProof to it. */
    async rewriteUniformForkIdInDispute(
        dispute: DisputeStruct,
        forkId: ForkId
    ): Promise<void> {
        dispute.input.forkId = forkId;
        const proof = dispute.input.stateProof;
        const setForkId: BlockTransform = (bs) =>
            factoryBlockStructWithHeader(bs, { forkId });

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
        transform: BlockTransform
    ): Promise<void> {
        const proof = dispute.input.stateProof;
        await this.rewriteSignedBlockAtIndex(
            dispute,
            proof.signedBlocks.length - 1,
            transform
        );
    }

    async rewriteSignedBlockAtIndex(
        dispute: DisputeStruct,
        index: number,
        transform: BlockTransform
    ): Promise<void> {
        const proof = dispute.input.stateProof;
        if (index < 0 || index >= proof.signedBlocks.length) {
            throw new Error(
                `rewriteSignedBlockAtIndex: index ${index} out of range (have ${proof.signedBlocks.length} signedBlocks)`
            );
        }
        proof.signedBlocks[index] = await this.remapSignedBlock(
            proof.signedBlocks[index],
            transform
        );
    }

    async rewriteLastSignedBlockAuthorAsOutsider(
        dispute: DisputeStruct,
        stateSnapshotHash?: Hash
    ): Promise<void> {
        const proof = dispute.input.stateProof;
        const index = proof.signedBlocks.length - 1;
        if (index < 0) {
            throw new Error(
                "rewriteLastSignedBlockAuthorAsOutsider: stateProof has no signed blocks"
            );
        }
        const outsider = Wallet.createRandom();
        const block = Block.fromSignedBlock(proof.signedBlocks[index]);
        const blockStruct = {
            ...factoryBlockStructWithHeader(block.blockStruct, {
                participant: outsider.address
            }),
            stateSnapshotHash:
                stateSnapshotHash ?? block.blockStruct.stateSnapshotHash
        };
        proof.signedBlocks[index] = (
            await Block.fromBlockStruct(blockStruct, outsider)
        ).signedBlock;
    }

    async rewriteLastMilestoneSignedBlockInDispute(
        dispute: DisputeStruct,
        transform: BlockTransform
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
            transform
        );
    }

    async rewriteLastMilestoneBlockConfirmationInDispute(
        dispute: DisputeStruct,
        transform: BlockTransform
    ): Promise<void> {
        const proof = dispute.input.stateProof;
        if (proof.milestones.length === 0) {
            throw new Error(
                "rewriteLastMilestoneBlockConfirmationInDispute: stateProof.milestones is empty"
            );
        }
        const milestone = proof.milestones.at(-1)!;
        if (milestone.blockConfirmations.length === 0) {
            throw new Error(
                "rewriteLastMilestoneBlockConfirmationInDispute: last milestone has no blockConfirmations"
            );
        }
        const blockConfirmationIndex = milestone.blockConfirmations.length - 1;
        milestone.blockConfirmations[blockConfirmationIndex] =
            await this.remapBlockConfirmation(
                milestone.blockConfirmations[blockConfirmationIndex],
                transform
            );
    }

    async appendLastMilestoneSignedBlockInDispute(
        dispute: DisputeStruct,
        transform: BlockTransform
    ): Promise<void> {
        const milestone = dispute.input.stateProof.milestones.at(-1);
        const source = milestone?.blockConfirmations.at(-1);
        if (!milestone || !source) {
            throw new Error(
                "appendLastMilestoneSignedBlockInDispute: milestone block missing"
            );
        }
        milestone.blockConfirmations.push({
            signedBlock: await this.remapSignedBlock(
                source.signedBlock,
                transform
            ),
            signatures: []
        });
    }

    async rewriteMilestoneSignedBlockAtIndex(
        dispute: DisputeStruct,
        milestoneIndex: number,
        blockConfirmationIndex: number,
        transform: BlockTransform
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
            signedBlock: await this.remapSignedBlock(signedBlock, transform),
            signatures
        };
    }

    /** Re-encode + re-sign a block after `transform`, as its (transformed) author. */
    private async remapSignedBlock(
        signedBlock: SignedBlockStruct,
        transform: BlockTransform
    ): Promise<SignedBlockStruct> {
        const mapped = transform(
            Block.fromSignedBlock(signedBlock).blockStruct
        );
        const author = mapped.transaction.header.participant as string;
        const signer = this.signerService.signerForAddress(author);
        return (await Block.fromBlockStruct(mapped, signer)).signedBlock;
    }

    private async remapBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct,
        transform: BlockTransform
    ): Promise<BlockConfirmationStruct> {
        const originalBlock = Block.fromBlockConfirmation(blockConfirmation);
        const confirmationSigners = await Promise.all(
            blockConfirmation.signatures.map(async (signature) =>
                String(
                    await originalBlock.signatureToAddress(signature as string)
                )
            )
        );
        const signedBlock = await this.remapSignedBlock(
            blockConfirmation.signedBlock,
            transform
        );
        const mappedBlock = Block.fromSignedBlock(signedBlock);
        const signatures = await Promise.all(
            confirmationSigners.map(async (address) =>
                String(
                    await mappedBlock.sign(
                        this.signerService.signerForAddress(address)
                    )
                )
            )
        );
        return { signedBlock, signatures };
    }

    /** Pop blocks past `targetHeight`, then recompute auditing data + hashes. */
    async truncateStateProofToHeight(
        dispute: DisputeStruct,
        targetHeight: number
    ): Promise<DisputeAuditingDataStruct> {
        const stateProof = dispute.input.stateProof;
        const localDiamond = this.sm.diamondStateMachine.localDiamondContract;

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
                if (bcs.length === 0) stateProof.milestones.pop();
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

        const { auditingData } = this.disputeManager.getAuditingData(
            dispute.input.forkId as ForkId,
            stateProof
        );

        dispute.input.latestStateSnapshotHash = StateSnapshot.from(
            auditingData.latestStateSnapshot
        ).hash as `0x${string}`;
        dispute.input.disputeAuditingDataHash = keccakHash(
            Codec.encode(auditingData, Type.DisputeAuditingData)
        ) as `0x${string}`;

        // Keep the upload's auditing data consistent with the truncated proof.
        if (this.pendingAuditingData) {
            Object.assign(this.pendingAuditingData, auditingData);
        }

        return auditingData;
    }

    /** Re-sign a (tampered) dispute with this peer's signer. */
    async resignDispute(
        dispute: DisputeStruct,
        disputeConfirmation: DisputeConfirmationStruct
    ): Promise<void> {
        const signed = await SignatureUtils.signDispute(
            dispute,
            this.sm.signer
        );
        disputeConfirmation.signedDispute = {
            encodedDispute: signed.encoded,
            signature: signed.signature as string
        };
        disputeConfirmation.signatures = [];
    }

    /**
     * Wrap `disputeManager.constructDispute` so each constructed dispute is
     * tampered (and re-signed) before use, recording it in `tamperedDisputes`.
     */
    installConstructDisputeStub(
        tamper: (
            dispute: DisputeStruct,
            disputeConfirmation: DisputeConfirmationStruct,
            auditingData: ConstructDisputeResult["auditingData"]
        ) => void | Promise<void>,
        autoRestore?: boolean
    ): void {
        const dm = this.disputeManager;
        this.restoreConstructDispute();
        const original = dm.constructDispute.bind(dm);
        this.originalConstructDispute = original;
        dm.constructDispute = async (forkId: ForkId) => {
            const result = await original(forkId);
            // Expose the upload's auditing data so `truncateStateProofToHeight`
            // can keep it in sync after mutating the state proof.
            this.pendingAuditingData = result.auditingData;
            try {
                await tamper(
                    result.dispute,
                    result.disputeConfirmation,
                    result.auditingData
                );
            } finally {
                this.pendingAuditingData = undefined;
            }
            await this.resignDispute(
                result.dispute,
                result.disputeConfirmation
            );
            this.tamperedDisputes.push(result.dispute);
            if (autoRestore) this.restoreConstructDispute();
            return result;
        };
    }

    restoreConstructDispute(): boolean {
        if (!this.originalConstructDispute) return false;
        this.disputeManager.constructDispute = this.originalConstructDispute;
        this.originalConstructDispute = undefined;
        return true;
    }

    /** Run the real dispute audit; project verdict + the stored fraud proof. */
    async runDisputeValidation(
        encodedDispute: string,
        options?: { encodedAuditingData?: string }
    ): Promise<DisputeValidationRun> {
        const dispute = Codec.decode(encodedDispute, Type.Dispute);
        const auditingData = options?.encodedAuditingData
            ? Codec.decode(
                  options.encodedAuditingData,
                  Type.DisputeAuditingData
              )
            : undefined;
        let outcome:
            | { outcome: "returned"; isValid: boolean }
            | { outcome: "threw"; threwMessage: string };
        try {
            outcome = {
                outcome: "returned",
                isValid: await this.sm.disputeValidationService.validateDispute(
                    dispute,
                    auditingData
                )
            };
        } catch (error) {
            outcome = {
                outcome: "threw",
                threwMessage:
                    error instanceof Error ? error.message : String(error)
            };
        }
        const proof =
            this.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                dispute
            );
        return {
            ...outcome,
            storedProof: proof
                ? {
                      // stored proofType is the solidity value
                      disputeFraudProofType: fromSolidityDisputeFraudProofType(
                          Number(proof.proofType)
                      ),
                      proofParticipant: String(proof.participant),
                      encodedProof: String(proof.encodedProof)
                  }
                : undefined,
            disputeFraudProofCount:
                this.storage.disputeFraudProofs.getDisputeFraudProofs().length
        };
    }

    /** Run the real persist; project each item's storage presence before/after. */
    persistDisputeDataWithoutAudit(
        encodedDispute: string,
        options: {
            encodedAuditingData?: string;
            includeUnfinalizedBlocks: boolean;
        }
    ): PersistDisputeDataProjection {
        const dispute = Codec.decode(encodedDispute, Type.Dispute);
        const auditingData = options.encodedAuditingData
            ? Codec.decode(
                  options.encodedAuditingData,
                  Type.DisputeAuditingData
              )
            : undefined;

        const milestoneBlocks: Block[] = [];
        let undecodableMilestoneBlockCount = 0;
        for (const milestone of dispute.input.stateProof.milestones) {
            for (const bc of milestone.blockConfirmations) {
                const block = Block.tryFromBlockConfirmation(bc);
                if (block) milestoneBlocks.push(block);
                else undecodableMilestoneBlockCount++;
            }
        }
        const signedBlocks: Block[] = [];
        let undecodableSignedBlockCount = 0;
        for (const sb of dispute.input.stateProof.signedBlocks) {
            const block = Block.tryFromSignedBlock(sb);
            if (block) signedBlocks.push(block);
            else undecodableSignedBlockCount++;
        }
        const snapshots = auditingData
            ? [
                  auditingData.latestStateSnapshot,
                  ...auditingData.milestoneSnapshots
              ].map((struct) => StateSnapshot.from(struct))
            : [];
        const inboundHashes = (auditingData?.inboundMessageBlocks ?? []).map(
            (mb) => keccakHash(Codec.encode(mb, Type.MessageBlock)) as Hash
        );
        const outboundHashes = (auditingData?.outboundMessageBlocks ?? []).map(
            (mb) => keccakHash(Codec.encode(mb, Type.MessageBlock)) as Hash
        );
        // same lookup the real persist uses for the state-machine-state key;
        // it can throw on partial storage, so retry after the persist ran
        const resolveStateKey = (): Hash | undefined => {
            try {
                return this.agreementManager.getLatestFinalizedSnapshot(
                    dispute.input.stateProof,
                    dispute.input.forkId as ForkId
                ).stateMachineStateHash as Hash;
            } catch {
                return undefined;
            }
        };
        let stateKey = auditingData ? resolveStateKey() : undefined;

        const blockStored = (block: Block) =>
            !!this.storage.blocks.getBlock(block.hash);
        const snapshotStored = (snapshot: StateSnapshot) =>
            !!this.storage.stateSnapshots.getStateSnapshotByHash(snapshot.hash);
        const stateStored = (key: Hash | undefined) =>
            key !== undefined &&
            this.storage.stateMachineStates.getStateMachineState(key) !==
                undefined;

        const before = {
            milestoneBlocks: milestoneBlocks.map(blockStored),
            signedBlocks: signedBlocks.map(blockStored),
            snapshots: snapshots.map(snapshotStored),
            inbound: inboundHashes.map(
                (h) => !!this.storage.inboundMessages.getMessageBlock(h)
            ),
            outbound: outboundHashes.map(
                (h) => !!this.storage.outboundMessages.getMessageBlock(h)
            ),
            state: stateStored(stateKey)
        };

        let threwMessage: string | undefined;
        try {
            this.sm.disputeValidationService.persistDisputeDataWithoutAudit(
                dispute,
                auditingData,
                { includeUnfinalizedBlocks: options.includeUnfinalizedBlocks }
            );
        } catch (error) {
            threwMessage =
                error instanceof Error ? error.message : String(error);
        }
        if (auditingData && stateKey === undefined)
            stateKey = resolveStateKey();

        const blockKey = (block: Block) =>
            `${block.forkId}:${block.height}:${block.hash}`;
        const project = (
            keys: string[],
            storedBefore: boolean[],
            storedAfter: boolean[]
        ): PersistedItemProjection[] =>
            keys.map((key, i) => ({
                key,
                storedBefore: storedBefore[i],
                storedAfter: storedAfter[i]
            }));

        return {
            threwMessage,
            milestoneBlocks: project(
                milestoneBlocks.map(blockKey),
                before.milestoneBlocks,
                milestoneBlocks.map(blockStored)
            ),
            undecodableMilestoneBlockCount,
            signedBlocks: project(
                signedBlocks.map(blockKey),
                before.signedBlocks,
                signedBlocks.map(blockStored)
            ),
            undecodableSignedBlockCount,
            snapshots: project(
                snapshots.map((s) => String(s.hash)),
                before.snapshots,
                snapshots.map(snapshotStored)
            ),
            stateMachineState:
                auditingData && stateKey !== undefined
                    ? {
                          key: String(stateKey),
                          storedBefore: before.state,
                          storedAfter: stateStored(stateKey)
                      }
                    : undefined,
            inboundMessages: project(
                inboundHashes.map(String),
                before.inbound,
                inboundHashes.map(
                    (h) => !!this.storage.inboundMessages.getMessageBlock(h)
                )
            ),
            outboundMessages: project(
                outboundHashes.map(String),
                before.outbound,
                outboundHashes.map(
                    (h) => !!this.storage.outboundMessages.getMessageBlock(h)
                )
            )
        };
    }

    async recoverCommittedDisputes(forkId: ForkId): Promise<number> {
        const commitments =
            await this.sm.eventSyncService.loadSynchronizedWindowCommitments(
                this.sm.channelId,
                forkId
            );
        return commitments.length;
    }

    public createRPCMethods(transport: ATransport): DisputeRpcMethods {
        return new DisputeRpcMethods(transport, this);
    }
}

export default DisputeService;
