// Owns the array of forks + all direct lookups.
// No knowledge about signatures, queues, or on-chain events.
import {
    BlockConfirmationStruct,
    BlockStruct,
    SignedBlockStruct,
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

    //After succesfull verification and execution
    public addBlock(
        signedBlock: SignedBlockStruct,
        encodedState: string,
        snapShot: StateSnapshotStruct
    ) {
        const forkCnt = BlockUtils.getFork(signedBlock);

        if (!this.isValidForkCnt(forkCnt))
            // this should never happen since checks are done before
            throw new Error(
                "AgreementManager - addBlock - forkCnt is not correct"
            );

        const agreement = this.getAgreementByBlock(
            EvmUtils.decodeBlock(signedBlock.encodedBlock)
        );
        if (agreement)
            // this should never happen since checks are done before
            throw new Error(
                "AgreementManager - addBlock - double sign or incorrect data"
            );
        const blockConfirmation: BlockConfirmationStruct = {
            signedBlock: signedBlock,
            signatures: []
        };
        this.addAgreement(forkCnt, {
            blockConfirmation,
            encodedState,
            addressesInThreshold: [],
            snapShot
        });
    }

    /**
     * Adds a transaction record to the chainBlocks array for a specific fork
     */
    public addChainBlock(
        signedBlock: SignedBlockStruct,
        timestamp: number
    ): void {
        const { forkCnt } = BlockUtils.getCoordinates(
            EvmUtils.decodeBlock(signedBlock.encodedBlock)
        );
        if (!this.isValidForkCnt(forkCnt)) {
            throw new Error("ForkService - addChainBlock - Invalid fork count");
        }

        this.forks[forkCnt].chainBlocks.push({
            signedBlock,
            timestamp
        });
    }

    /*────────── getters ──────────*/

    collectMilestoneSnapshots(forkCnt: number): StateSnapshotStruct[] {
        const snapShotCommitments: { commitment: BytesLike; height: number }[] =
            [];
        const stateSnapshots = [];
        for (
            let i = 0;
            i < this.forks[forkCnt].forkProof.forkMilestoneProofs.length;
            i++
        ) {
            const blockDecoded = EvmUtils.decodeBlock(
                this.forks[forkCnt].forkProof.forkMilestoneProofs[i]
                    .blockConfirmations[0].signedBlock.encodedBlock
            );
            snapShotCommitments.push({
                commitment: blockDecoded.stateSnapshotHash,
                height: Number(blockDecoded.transaction.header.transactionCnt)
            });
        }
        for (const snapShotCommitment of snapShotCommitments) {
            const stateSnapshot =
                this.forks[forkCnt].agreements[snapShotCommitment.height]
                    .snapShot;
            if (
                ethers.keccak256(
                    EvmUtils.encodeStateSnapshot(stateSnapshot)
                ) === snapShotCommitment.commitment
            ) {
                stateSnapshots.push(stateSnapshot);
            }
        }
        return stateSnapshots;
    }
    getForkProof(forkCnt: number): ForkProofStruct | undefined {
        return this.forks[forkCnt].forkProof;
    }
    getSnapShot(
        forkCnt: number,
        transactionCnt: number
    ): StateSnapshotStruct | undefined {
        return this.forks[forkCnt].agreements[transactionCnt].snapShot;
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
    getSignedBlock(
        forkCnt: number,
        txCnt: number
    ): SignedBlockStruct | undefined {
        return this.getAgreement(forkCnt, txCnt)?.blockConfirmation.signedBlock;
    }

    getBlockConfirmation(
        forkCnt: number,
        txCnt: number
    ): BlockConfirmationStruct | undefined {
        return this.getAgreement(forkCnt, txCnt)?.blockConfirmation;
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
        const latestBlock =
            this.getLatestAgreement(forkCnt)?.blockConfirmation.signedBlock!;
        const latestTimestamp = latestBlock
            ? BlockUtils.getTimestamp(latestBlock)
            : 0;
        return Math.max(fork.genesisTimestamp, latestTimestamp);
    }
}
