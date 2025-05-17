// Owns the array of forks + all direct lookups.
// No knowledge about signatures, queues, or on-chain events.
import { BlockStruct } from "@typechain-types/contracts/V1/DataTypes";
import { AddressLike, SignatureLike } from "ethers";
import { BlockUtils } from "@/utils";
import { Agreement, AgreementFork } from "./types";
import { DisputeStruct } from "@typechain-types/contracts/V1/DisputeTypes";
import { SignatureUtils } from "@/utils/SignatureUtils";

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
        forkCnt: number,
        genesisTimestamp: number
    ): void {
        if (this.forks.length !== forkCnt) return;
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
                const signer = SignatureUtils.getSignerAddress(dispute, sig);
                return signer === participant;
            } catch {
                return false;
            }
        });
    }

    private addAgreement(forkCnt: number, agreement: Agreement): void {
        this.forks[forkCnt].agreements.push(agreement);
    }

    //After succesfull verification and execution
    public addBlock(
        block: BlockStruct,
        originalSignature: SignatureLike,
        encodedState: string
    ) {
        const forkCnt = BlockUtils.getFork(block);

        if (!this.isValidForkCnt(forkCnt))
            // this should never happen since checks are done before
            throw new Error(
                "AgreementManager - addBlock - forkCnt is not correct"
            );

        const agreement = this.agreementByBlock(block);
        if (agreement)
            // this should never happen since checks are done before
            throw new Error(
                "AgreementManager - addBlock - double sign or incorrect data"
            );

        this.addAgreement(forkCnt, {
            block,
            blockSignatures: [originalSignature],
            encodedState
        });
    }

    /**
     * Adds a transaction record to the chainBlocks array for a specific fork
     */
    public addChainBlock(
        forkCnt: number,
        transactionCnt: number,
        participantAdr: string,
        timestamp: number
    ): void {
        if (!this.isValidForkCnt(forkCnt)) {
            throw new Error("ForkService - addChainBlock - Invalid fork count");
        }

        this.forks[forkCnt].chainBlocks.push({
            transactionCnt,
            participantAdr,
            timestamp
        });
    }

    /*────────── getters ──────────*/
    latestForkCnt(): number {
        return Math.max(0, this.forks.length - 1);
    }
    nextForkIndex(): number {
        return this.forks.length;
    }
    nextBlockHeight(): number {
        return this.forks.at(-1)?.agreements.length ?? 0;
    }
    forkGenesis(forkCnt: number): string {
        return this.forks[forkCnt].forkGenesisStateEncoded;
    }
    forkAt(forkCnt: number) {
        return this.isValidForkCnt(forkCnt) ? this.forks[forkCnt] : undefined;
    }

    latestFork() {
        return this.forks.at(-1);
    }
    isValidForkCnt(forkCnt: number) {
        return forkCnt < this.forks.length;
    }

    isParticipantInLatestFork(p: string) {
        return new Set(this.forks.at(-1)!.addressesInThreshold).has(p);
    }

    agreement(forkCnt: number, txCnt: number): Agreement | undefined {
        return this.isValidForkCnt(forkCnt)
            ? this.forks[forkCnt].agreements[txCnt]
            : undefined;
    }
    blockAt(forkCnt: number, txCnt: number): BlockStruct | undefined {
        return this.agreement(forkCnt, txCnt)?.block;
    }

    agreementByBlock(block: BlockStruct): Agreement | undefined {
        const { forkCnt, height } = BlockUtils.getCoordinates(block);
        return this.agreement(forkCnt, height);
    }

    latestAgreement(forkCnt: number): Agreement | undefined {
        return this.forks[forkCnt]?.agreements.at(-1);
    }

    getLatestDispute(): StoredDispute | undefined {
        return this.disputes.at(-1);
    }

    getDisputesCount(): number {
        return this.disputes.length;
    }

    /*────────── iterator ──────────*/
    *agreementsIterator(
        forkCnt: number,
        direction: Direction = Direction.FORWARD
    ): Generator<Agreement, void, unknown> {
        if (!this.isValidForkCnt(forkCnt)) return;

        const agreements = this.forks[forkCnt].agreements;
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
    latestBlockTimestamp(forkCnt: number): number {
        const fork = this.forks[forkCnt];
        const latestBlock = this.latestAgreement(forkCnt)?.block;
        const latestTimestamp = latestBlock
            ? BlockUtils.getTimestamp(latestBlock)
            : 0;
        return Math.max(fork.genesisTimestamp, latestTimestamp);
    }
}
