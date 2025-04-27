import { ethers, SignatureLike } from "ethers";
import {
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/DataTypes";

import EvmUtils from "@/utils/EvmUtils";
import { coordinatesOf, isSameBlock, participantOf } from "@/utils";
import { AgreementFlag } from "@/types";

import ForkService from "./ForkService";
import QueueService from "./QueueService";
import OnChainTracker from "./OnChainTracker";

export default class BlockValidator {
    constructor(
        private readonly forks: ForkService,
        private readonly queues: QueueService,
        private readonly chain: OnChainTracker
    ) {}

    isBlockInChain(block: BlockStruct): boolean {
        const ag = this.forks.agreementByBlock(block);
        return ag !== undefined && isSameBlock(ag.block, block);
    }

    /** In chain OR parked in the “future queue” */
    isBlockDuplicate(block: BlockStruct): boolean {
        return this.isBlockInChain(block) || this.queues.isBlockQueued(block);
    }

    /** Canonical chain: latest timestamp in this fork           */
    latestBlockTimestamp(forkCnt: number): number {
        const fork = this.forks.forkAt(forkCnt);
        if (!fork) throw new Error("BlockValidator - fork not found");
        const genesis = fork.genesisTimestamp;
        const lastAg = this.forks.latestAgreement(forkCnt);
        const lastTs = Number(lastAg?.block.transaction.header.timestamp ?? 0);
        return Math.max(genesis, lastTs);
    }

    /** Max(latest-chain, latest-on-chain) — used for subjective rules */
    latestRelevantTimestamp(forkCnt: number, maxTxCnt: number): number {
        return Math.max(
            this.latestBlockTimestamp(forkCnt),
            this.chain.latestTimestamp(forkCnt, maxTxCnt)
        );
    }

    check(signed: SignedBlockStruct): AgreementFlag {
        const block = EvmUtils.decodeBlock(signed.encodedBlock);
        const { forkCnt, height } = coordinatesOf(block);
        const participant = participantOf(block);

        /* 1 – valid signature? */
        const signer = EvmUtils.retrieveSignerAddressBlock(
            block,
            signed.signature as SignatureLike
        );
        if (signer !== participant) return AgreementFlag.INVALID_SIGNATURE;

        /* 2 – duplicate? */
        if (this.isBlockDuplicate(block)) return AgreementFlag.DUPLICATE;

        /* 3 – known fork? */
        if (!this.forks.isValidForkCnt(forkCnt)) return AgreementFlag.NOT_READY;

        /* 4 – double sign / incorrect data vs existing agmt */
        const existing = this.forks.blockAt(forkCnt, height);
        if (existing) {
            return participantOf(existing) === participant
                ? AgreementFlag.DOUBLE_SIGN
                : AgreementFlag.INCORRECT_DATA;
        }

        /* 5 – first block of fork genesis? */
        if (height === 0) {
            const expectedPrev = ethers.keccak256(
                this.forks.forkAt(forkCnt)!.forkGenesisStateEncoded
            );
            return block.previousStateHash === expectedPrev
                ? AgreementFlag.READY
                : AgreementFlag.INCORRECT_DATA;
        }

        /* 6 – compare with previous block in chain */
        const prev = this.forks.blockAt(forkCnt, height - 1);
        if (!prev) return AgreementFlag.NOT_READY;

        return prev.stateHash === block.previousStateHash
            ? AgreementFlag.READY
            : AgreementFlag.INCORRECT_DATA;
    }
}
