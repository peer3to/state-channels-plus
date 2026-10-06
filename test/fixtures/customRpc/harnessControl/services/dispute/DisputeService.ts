// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import DisputeRpcMethods from "./DisputeRpcMethods";
import type { SignerService } from "../signer/SignerService";
import Clock from "@/Clock";

import type DisputeManager from "@/disputeManager/DisputeManager";
import type { ConstructDisputeResult } from "@/disputeManager/DisputeManager";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type NetworkTransport from "@/transport/NetworkTransport";
import { DisputeFraudProofType } from "@/types/sol-enums";
import type { Address, Bytes, ForkId, Hash } from "@/types/types";
import { SignatureUtils, Codec, Type, hash as keccakHash } from "@/utils";
import {
    hash as randomHashFactory,
    blockStructWithTransactionHeader as factoryBlockStructWithHeader
} from "@test/factory";
import type {
    BlockConfirmationStruct,
    BlockStruct,
    SignedBlockStruct,
    TransactionHeaderStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    DisputeStruct,
    DisputeConfirmationStruct,
    DisputeAuditingDataStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { BytesLike, ZeroAddress, ZeroHash } from "ethers";

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

/**
 * Dispute construction / auditing / tampering for the test harness. Accessors,
 * shared state and helpers live here (not on the RpcMethods class) since every
 * RpcMethods method is routable by name at runtime.
 */
export class DisputeService extends ANetworkRpcService<DisputeRpcMethods> {
    /** Disputes produced while `constructDispute` was stubbed (newest last). */
    readonly tamperedDisputes: DisputeStruct[] = [];
    private originalConstructDispute?: DisputeManager["constructDispute"];

    /** Auditing data of the dispute currently being constructed (for sync). */
    private pendingAuditingData?: DisputeAuditingDataStruct;

    constructor(
        p2pManager: P2PManager,
        private readonly signerService: SignerService
    ) {
        super(
            p2pManager.rpcRouter,
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
    /**
     * Asserts the chain's walk (AgreementManager.walkFromChainAnchor) accepts
     * `stateProof` and proves no final point beyond its trusted start: the
     * latest state is an unfinalized tail.
     */
    async expectUnfinalizedStateProof(
        forkId: ForkId,
        stateProof: StateProofStruct
    ): Promise<void> {
        if (await this.provesFinalPointBeyondStart(forkId, stateProof))
            throw new Error(
                "expected an unfinalized state proof, but it proves a final point beyond its start"
            );
    }
    /**
     * Asserts the chain's walk accepts `stateProof` and proves a final point
     * beyond its trusted start (a threshold-proven milestone).
     */
    async expectFinalizedStateProof(
        forkId: ForkId,
        stateProof: StateProofStruct
    ): Promise<void> {
        if (!(await this.provesFinalPointBeyondStart(forkId, stateProof)))
            throw new Error(
                "expected a finalized state proof, but it proves no final point beyond its start"
            );
    }
    private async provesFinalPointBeyondStart(
        forkId: ForkId,
        stateProof: StateProofStruct
    ): Promise<boolean> {
        const walk = await this.agreementManager.walkFromChainAnchor(
            forkId,
            stateProof,
            this.agreementManager.getStoredEvidence(forkId, stateProof)
        );
        if (!walk.valid)
            throw new Error(
                "expected a state proof the chain's walk accepts, but it is invalid"
            );
        const start =
            walk.start ??
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId)!;
        return walk.finalizedSnapshot.hash !== start.hash;
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

    /**
     * This peer's own proof through `blockHeight` (`blockHeight` -1: the
     * empty genesis proof) with the auditing data DisputeManager builds for
     * it. `disputeLatestInboundMessageBlockHash` bounds the inbound run, as in
     * `constructDispute` (default: the inbound head not behind that state).
     */
    async buildOwnAuditingData(
        forkId: ForkId,
        blockHeight: number,
        disputeLatestInboundMessageBlockHash?: Hash
    ): Promise<{
        stateProof: StateProofStruct;
        auditingData: DisputeAuditingDataStruct;
    }> {
        const built = await this.agreementManager.buildStateProof(
            forkId,
            blockHeight
        );
        const latestStateSnapshot = this.storage.getStateSnapshot({
            forkId,
            height: blockHeight
        });
        if (!latestStateSnapshot)
            throw new Error(
                `buildOwnAuditingData: no snapshot at height ${blockHeight} of ${forkId}`
            );
        const inboundHash =
            disputeLatestInboundMessageBlockHash ??
            this.storage.inboundMessages.headNotBehind(
                latestStateSnapshot.latestInboundMessageBlockHash,
                latestStateSnapshot.latestInboundMessageBlockHeight
            ).hash;
        const auditingData = await this.disputeManager["buildAuditingData"](
            forkId,
            built,
            latestStateSnapshot,
            inboundHash
        );
        return { stateProof: built.stateProof, auditingData };
    }

    /**
     * Replace the dispute's proof with this peer's own proof through
     * `targetHeight` and recompute auditing data + hashes for it, so the
     * dispute claims an older latest state.
     */
    async truncateStateProofToHeight(
        dispute: DisputeStruct,
        targetHeight: number
    ): Promise<DisputeAuditingDataStruct> {
        const { stateProof, auditingData } = await this.buildOwnAuditingData(
            dispute.input.forkId as ForkId,
            targetHeight,
            dispute.input.latestInboundMessageBlockHash as Hash
        );
        dispute.input.stateProof = stateProof;
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
        dm.constructDispute = async (forkId, options) => {
            const result = await original(forkId, options);
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

    /** Both sources the audit's inbound-hash check consults, read separately. */
    async probeDisputeInboundHashSources(
        encodedDispute: string
    ): Promise<{ local: boolean; rpc: boolean }> {
        const dispute = Codec.decode(encodedDispute, Type.Dispute);
        return {
            local: await this.sm.diamondStateMachine.localDiamondContract.isDisputeInboundHashValid.staticCall(
                dispute
            ),
            rpc: await this.sm.stateChannelManagerContract.isDisputeInboundHashValid.staticCall(
                dispute
            )
        };
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

    /** `null` = the window could not be made locally readable. */
    async recoverCommittedDisputes(forkId: ForkId): Promise<number | null> {
        const commitments =
            await this.sm.eventSyncService.loadSynchronizedWindowCommitments(
                this.sm.channelId,
                forkId
            );
        return commitments ? commitments.length : null;
    }

    public createRPCMethods(transport: NetworkTransport): DisputeRpcMethods {
        return new DisputeRpcMethods(transport, this);
    }
}

export default DisputeService;
