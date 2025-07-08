// Owns the array of forks + all direct lookups.
// No knowledge about signatures, queues, or on-chain events.
import { Block } from "@/models";
import { Agreement, AgreementFork } from "./types";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { SignatureUtils } from "@/utils/SignatureUtils";
import {
    ForkId,
    Timestamp,
    Signature,
    Bytes,
    Address,
    BlockHeight
} from "@/types/types";

export enum Direction {
    FORWARD = "forward",
    BACKWARD = "backward"
}

interface StoredDispute {
    dispute: DisputeStruct;
    timestamp: Timestamp;
    signatures: Signature[];
}

export default class ForkService {
    private forks: AgreementFork[] = [];
    private disputes: StoredDispute[] = [];

    /*────────── mutators ──────────*/
    newFork(
        forkGenesisStateEncoded: Bytes,
        addressesInThreshold: Address[],
        forkId: ForkId,
        genesisTimestamp: Timestamp
    ): void {
        if (this.forks.length !== forkId) return;
        this.forks.push({
            forkGenesisStateEncoded,
            addressesInThreshold,
            genesisTimestamp,
            chainBlocks: [],
            agreements: []
        });
    }

    addDispute(dispute: DisputeStruct, timestamp: Timestamp): void {
        this.disputes.push({
            dispute,
            timestamp,
            signatures: []
        });
    }

    addDisputeSignature(dispute: DisputeStruct, signature: Signature): void {
        const storedDispute = this.disputes[Number(dispute.disputeIndex)];

        storedDispute.signatures.push(signature);
    }

    isDisputeKnown(dispute: DisputeStruct): boolean {
        return this.disputes[Number(dispute.disputeIndex)]?.dispute === dispute;
    }

    getDisputeSignatures(dispute: DisputeStruct): Signature[] {
        return this.disputes[Number(dispute.disputeIndex)]?.signatures || [];
    }

    hasParticipantSignedDispute(
        dispute: DisputeStruct,
        participant: Address
    ): boolean {
        const storedDispute = this.disputes[Number(dispute.disputeIndex)];
        if (!storedDispute) return false;

        return storedDispute.signatures.some((sig) => {
            try {
                const signer = SignatureUtils.getSignerAddressDispute(
                    dispute,
                    sig
                );
                return signer === participant;
            } catch {
                return false;
            }
        });
    }

    private addAgreement(forkId: ForkId, agreement: Agreement): void {
        this.forks[forkId].agreements.push(agreement);
    }

    //After succesfull verification and execution
    public addBlock(
        block: Block,
        originalSignature: Signature | Bytes,
        encodedState: Bytes
    ) {
        const forkId = block.forkId;

        if (!this.isValidforkId(forkId))
            // this should never happen since checks are done before
            throw new Error(
                "AgreementManager - addBlock - forkId is not correct"
            );

        const agreement = this.agreementByBlock(block);
        if (agreement)
            // this should never happen since checks are done before
            throw new Error(
                "AgreementManager - addBlock - double sign or incorrect data"
            );

        this.addAgreement(forkId, {
            block,
            blockSignatures: [originalSignature as Signature],
            encodedState
        });
    }

    /**
     * Adds a transaction record to the chainBlocks array for a specific fork
     */
    public addChainBlock(
        forkId: ForkId,
        transactionCnt: BlockHeight,
        participantAdr: Address,
        timestamp: Timestamp
    ): void {
        if (!this.isValidforkId(forkId)) {
            throw new Error("ForkService - addChainBlock - Invalid fork count");
        }

        this.forks[forkId].chainBlocks.push({
            transactionCnt,
            participantAdr,
            timestamp
        });
    }

    /*────────── getters ──────────*/
    latestforkId(): ForkId {
        return Math.max(0, this.forks.length - 1);
    }
    nextForkIndex(): number {
        return this.forks.length;
    }
    nextBlockHeight(): BlockHeight {
        return this.forks.at(-1)?.agreements.length ?? 0;
    }
    forkGenesis(forkId: ForkId): Bytes {
        return this.forks[forkId].forkGenesisStateEncoded;
    }
    forkAt(forkId: ForkId) {
        return this.isValidforkId(forkId) ? this.forks[forkId] : undefined;
    }

    latestFork() {
        return this.forks.at(-1);
    }
    isValidforkId(forkId: ForkId) {
        return forkId < this.forks.length;
    }

    isParticipantInLatestFork(p: Address) {
        return new Set(this.forks.at(-1)!.addressesInThreshold).has(p);
    }

    agreement(forkId: ForkId, txCnt: BlockHeight): Agreement | undefined {
        return this.isValidforkId(forkId)
            ? this.forks[forkId].agreements[txCnt]
            : undefined;
    }
    blockAt(forkId: ForkId, txCnt: BlockHeight): Block | undefined {
        return this.agreement(forkId, txCnt)?.block;
    }

    agreementByBlock(block: Block): Agreement | undefined {
        const { forkId, height } = block.coordinates;
        return this.agreement(forkId, height);
    }

    latestAgreement(forkId: ForkId): Agreement | undefined {
        return this.forks[forkId]?.agreements.at(-1);
    }

    getLatestDispute(): StoredDispute | undefined {
        return this.disputes.at(-1);
    }

    getDisputesCount(): number {
        return this.disputes.length;
    }

    /*────────── iterator ──────────*/
    *agreementsIterator(
        forkId: ForkId,
        direction: Direction = Direction.FORWARD
    ): Generator<Agreement, void, unknown> {
        if (!this.isValidforkId(forkId)) return;

        const agreements = this.forks[forkId].agreements;
        if (direction === Direction.FORWARD) {
            for (let i = 0; i < agreements.length; i++) {
                yield agreements[i];
            }
        } else {
            for (let i = agreements.length - 1; i >= 0; i--) {
                yield agreements[i];
            }
        }
    }

    /*────────── timestamp helpers ─────────*/
    latestBlockTimestamp(forkId: ForkId): Timestamp {
        const fork = this.forks[forkId];
        const latestBlock = this.latestAgreement(forkId)?.block;
        const latestTimestamp = latestBlock ? latestBlock.timestamp : 0;
        return Math.max(fork.genesisTimestamp, latestTimestamp);
    }
}
