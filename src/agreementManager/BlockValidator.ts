import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import { AgreementFlag } from "@/types";

import ForkService from "./ForkService";
import OnChainTracker from "./OnChainTracker";
import { BlockHeight, ForkId, Hash, Timestamp } from "@/types/types";
import { Block } from "@/models";
import Storage from "@/storage";
import { hash } from "@/utils";

export default class BlockValidator {
    constructor(
        private readonly forks: ForkService,
        private readonly storage: Storage,
        private readonly chain: OnChainTracker
    ) {}

    isBlockInChain(blockHash: Hash): boolean {
        return (
            this.storage.blocks.getBlockConfirmation(blockHash) !== undefined
        );
    }

    /** In chain OR parked in the “future queue” */
    isBlockDuplicate(signed: SignedBlockStruct): boolean {
        const confirmation = {
            signedBlock: signed,
            signatures: [signed.signature]
        };
        const blockHash = hash(signed.encodedBlock);
        return (
            this.isBlockInChain(blockHash) ||
            this.storage.queues.isBlockQueued(confirmation, { hash: blockHash })
        );
    }

    /** Canonical chain: latest timestamp in this fork           */
    latestBlockTimestamp(forkId: ForkId): Timestamp {
        const fork = this.forks.forkAt(forkId);
        if (!fork) throw new Error("BlockValidator - fork not found");
        const genesis = fork.genesisTimestamp;
        const lastAg = this.forks.latestAgreement(forkId);
        const lastTs = lastAg?.block.timestamp ?? 0;
        return Math.max(genesis, lastTs);
    }

    /** Max(latest-chain, latest-on-chain) — used for subjective rules */
    latestRelevantTimestamp(forkId: ForkId, maxTxCnt: BlockHeight): Timestamp {
        return Math.max(
            this.latestBlockTimestamp(forkId),
            this.chain.latestTimestamp(forkId, maxTxCnt)
        );
    }

    check(signed: SignedBlockStruct): AgreementFlag {
        const block = Block.decode(signed.encodedBlock);
        const { forkId, height } = block.coordinates;
        const participant = block.author;

        /* 1 – valid signature? */
        const signer = block.getSignerAddress(signed.signature);
        if (signer !== participant) return AgreementFlag.INVALID_SIGNATURE;

        /* 2 – duplicate? */
        if (this.isBlockDuplicate(signed)) return AgreementFlag.DUPLICATE;

        /* 3 – known fork? */
        if (!this.forks.isValidforkId(forkId)) return AgreementFlag.NOT_READY;

        /* 4 – double sign / incorrect data vs existing agmt */
        const existing = this.forks.blockAt(forkId, height);
        if (existing) {
            return existing.author === participant
                ? AgreementFlag.DOUBLE_SIGN
                : AgreementFlag.INCORRECT_DATA;
        }

        /* 5 – first block of fork genesis? */
        if (height === 0) {
            const expectedPrev = hash(
                this.forks.forkAt(forkId)!.forkGenesisStateEncoded
            );
            return block.previousBlockHash === expectedPrev
                ? AgreementFlag.READY
                : AgreementFlag.INCORRECT_DATA;
        }

        /* 6 – compare with previous block in chain */
        const prev = this.forks.blockAt(forkId, height - 1);
        if (!prev) return AgreementFlag.NOT_READY;

        const prevBlockHash = prev.hash;
        return prevBlockHash === block.previousBlockHash
            ? AgreementFlag.READY
            : AgreementFlag.INCORRECT_DATA;
    }
}
