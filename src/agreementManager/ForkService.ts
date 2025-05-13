// Owns the array of forks + all direct lookups.
// No knowledge about signatures, queues, or on-chain events.
import {
    BlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { AddressLike, BytesLike, ethers, SignatureLike } from "ethers";
import { BlockUtils, EvmUtils } from "@/utils";
import { Agreement, AgreementFork } from "./types";
import { ForkProofStruct } from "@typechain-types/contracts/V1/DisputeTypes";

export enum Direction {
    FORWARD = "forward",
    BACKWARD = "backward"
}

export default class ForkService {
    private forks: AgreementFork[] = [];

    /*────────── mutators ──────────*/
    newFork(
        forkGenesisStateEncoded: string,
        genesisParticipants: AddressLike[],
        forkCnt: number,
        genesisTimestamp: number
    ): void {
        if (this.forks.length !== forkCnt) return;
        this.forks.push({
            forkGenesisStateEncoded,
            genesisParticipants,
            genesisTimestamp,
            chainBlocks: [],
            agreements: [],
            forkProof: {
                forkMilestoneProofs: []
            }
        });
    }

    private addAgreement(forkCnt: number, agreement: Agreement): void {
        this.forks[forkCnt].agreements.push(agreement);
    }
    public createSnapShot(
        forkCnt: number,
        transactionCnt: number
    ): StateSnapshotStruct {}

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
        const snapShotCommitment = ethers.keccak256(
            EvmUtils.encodeStateSnapshot(
                this.createSnapShot(forkCnt, this.getNextBlockHeight() - 1)
            )
        );
        const agreement = this.getAgreementByBlock(block);
        if (agreement)
            // this should never happen since checks are done before
            throw new Error(
                "AgreementManager - addBlock - double sign or incorrect data"
            );

        this.addAgreement(forkCnt, {
            block,
            blockSignatures: [originalSignature],
            encodedState,
            addressesInThreshold: [],
            snapShotCommitment
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

    collectMilestoneSnapshots(forkCnt: number): BytesLike[] {
        const snapShotCommitments = [];
        for (
            let i = 0;
            i < this.forks[forkCnt].forkProof.forkMilestoneProofs.length;
            i++
        ) {
            const blockDecoded = EvmUtils.decodeBlock(
                this.forks[forkCnt].forkProof.forkMilestoneProofs[i]
                    .blockConfirmations[0].signedBlock.encodedBlock
            );
            snapShotCommitments.push(blockDecoded.stateSnapshotHash);
        }
        return snapShotCommitments;
    }
    getForkProof(forkCnt: number): ForkProofStruct | undefined {
        return this.forks[forkCnt].forkProof;
    }
    getSnapShot(
        forkCnt: number,
        transactionCnt: number
    ): BytesLike | undefined {
        return this.forks[forkCnt].agreements[transactionCnt]
            .snapShotCommitment as BytesLike;
    }
    getLatestForkCnt(): number {
        return Math.max(0, this.forks.length - 1);
    }
    getNextForkIndex(): number {
        return this.forks.length;
    }
    getNextBlockHeight(): number {
        return this.forks.at(-1)?.agreements.length ?? 0;
    }
    getForkGenesis(forkCnt: number): string {
        return this.forks[forkCnt].forkGenesisStateEncoded;
    }
    getFork(forkCnt: number) {
        return this.isValidForkCnt(forkCnt) ? this.forks[forkCnt] : undefined;
    }
    getLatestFork() {
        return this.forks.at(-1);
    }
    isValidForkCnt(forkCnt: number) {
        return forkCnt < this.forks.length;
    }

    isParticipantInLatestFork(p: string) {
        return new Set(this.forks.at(-1)!.genesisParticipants).has(p);
    }

    getAgreement(forkCnt: number, txCnt: number): Agreement | undefined {
        return this.isValidForkCnt(forkCnt)
            ? this.forks[forkCnt].agreements[txCnt]
            : undefined;
    }
    getBlock(forkCnt: number, txCnt: number): BlockStruct | undefined {
        return this.getAgreement(forkCnt, txCnt)?.block;
    }

    getAgreementByBlock(block: BlockStruct): Agreement | undefined {
        const { forkCnt, height } = BlockUtils.getCoordinates(block);
        return this.getAgreement(forkCnt, height);
    }

    getLatestAgreement(forkCnt: number): Agreement | undefined {
        return this.forks[forkCnt]?.agreements.at(-1);
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
    getLatestBlockTimestamp(forkCnt: number): number {
        const fork = this.forks[forkCnt];
        const latestBlock = this.getLatestAgreement(forkCnt)?.block;
        const latestTimestamp = latestBlock
            ? BlockUtils.getTimestamp(latestBlock)
            : 0;
        return Math.max(fork.genesisTimestamp, latestTimestamp);
    }
}
