// Owns the array of forks + all direct lookups.
// No knowledge about signatures, queues, or on-chain events.
import { Block } from "@/models";
import { AddressLike, SignatureLike } from "ethers";
import { Agreement, AgreementFork } from "./types";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { SignatureUtils } from "@/utils/SignatureUtils";
import { ForkId } from "@/types/types";

export enum Direction {
    FORWARD = "forward",
    BACKWARD = "backward"
}

interface StoredDispute {
    dispute: DisputeStruct;
    timestamp: number;
    signatures: SignatureLike[];
}

export default class ForkService {
    private forks: AgreementFork[] = [];
    private disputes: StoredDispute[] = [];

    /*────────── mutators ──────────*/
    newFork(
        forkGenesisStateEncoded: string,
        addressesInThreshold: AddressLike[],
        forkId: ForkId,
        genesisTimestamp: number
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

    addDispute(dispute: DisputeStruct, timestamp: number): void {
        this.disputes.push({
            dispute,
            timestamp,
            signatures: []
        });
    }

    addDisputeSignature(
        dispute: DisputeStruct,
        signature: SignatureLike
    ): void {
        const storedDispute = this.disputes[Number(dispute.disputeIndex)];

        storedDispute.signatures.push(signature);
    }

    isDisputeKnown(dispute: DisputeStruct): boolean {
        return this.disputes[Number(dispute.disputeIndex)]?.dispute === dispute;
    }

    getDisputeSignatures(dispute: DisputeStruct): SignatureLike[] {
        return this.disputes[Number(dispute.disputeIndex)]?.signatures || [];
    }

    hasParticipantSignedDispute(
        dispute: DisputeStruct,
        participant: AddressLike
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

    private addAgreement(forkId: number, agreement: Agreement): void {
        this.forks[forkId].agreements.push(agreement);
    }

    //After succesfull verification and execution
    public addBlock(
        block: Block,
        originalSignature: SignatureLike,
        encodedState: string
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
            blockSignatures: [originalSignature],
            encodedState
        });
    }

    /**
     * Adds a transaction record to the chainBlocks array for a specific fork
     */
    public addChainBlock(
        forkId: ForkId,
        transactionCnt: number,
        participantAdr: string,
        timestamp: number
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
    nextBlockHeight(): number {
        return this.forks.at(-1)?.agreements.length ?? 0;
    }
    forkGenesis(forkId: ForkId): string {
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

    isParticipantInLatestFork(p: string) {
        return new Set(this.forks.at(-1)!.addressesInThreshold).has(p);
    }

    agreement(forkId: ForkId, txCnt: number): Agreement | undefined {
        return this.isValidforkId(forkId)
            ? this.forks[forkId].agreements[txCnt]
            : undefined;
    }
    blockAt(forkId: number, txCnt: number): Block | undefined {
        return this.agreement(forkId, txCnt)?.block;
    }

    agreementByBlock(block: Block): Agreement | undefined {
        const { forkId, height } = block.coordinates;
        return this.agreement(forkId, height);
    }

    latestAgreement(forkId: number): Agreement | undefined {
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
    latestBlockTimestamp(forkId: ForkId): number {
        const fork = this.forks[forkId];
        const latestBlock = this.latestAgreement(forkId)?.block;
        const latestTimestamp = latestBlock ? latestBlock.timestamp : 0;
        return Math.max(fork.genesisTimestamp, latestTimestamp);
    }
}
