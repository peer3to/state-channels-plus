import { ethers } from "ethers";
import {
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/DataTypes";

import { BlockUtils, EvmUtils } from "@/utils";
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

    isBlockInChain(sb: SignedBlockStruct): boolean {
        const ag = this.forks.getAgreementByBlock(
            EvmUtils.decodeBlock(sb.encodedBlock)
        );
        return (
            ag !== undefined &&
            BlockUtils.areBlocksEqual(
                EvmUtils.decodeBlock(
                    ag.blockConfirmation.signedBlock.encodedBlock
                ),
                EvmUtils.decodeBlock(sb.encodedBlock)
            )
        );
    }

    /** In chain OR parked in the “future queue” */
    isBlockDuplicate(sb: SignedBlockStruct): boolean {
        return this.isBlockInChain(sb) || this.queues.isBlockQueued(sb);
    }

    /** Canonical chain: latest timestamp in this fork           */
    latestBlockTimestamp(forkCnt: number): number {
        const fork = this.forks.getFork(forkCnt);
        if (!fork) throw new Error("BlockValidator - fork not found");
        const genesis = fork.genesisTimestamp;
        const lastAg = this.forks.getLatestAgreement(forkCnt);
        const lastTs = Number(
            EvmUtils.decodeBlock(
                lastAg?.blockConfirmation.signedBlock.encodedBlock!
            ).transaction.header.timestamp ?? 0
        );
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
        const { forkCnt, height } = BlockUtils.getCoordinates(block);
        const signer = BlockUtils.getBlockAuthor(signed);

        /* 1 – valid signature? */
        if (signer !== block.transaction.header.participant)
            return AgreementFlag.INVALID_SIGNATURE;

        /* 2 – duplicate? */
        if (this.isBlockDuplicate(signed)) {
            return AgreementFlag.DUPLICATE;
        }

        /* 3 – known fork? */
        if (!this.forks.isValidForkCnt(forkCnt)) return AgreementFlag.NOT_READY;

        /* 4 – double sign / incorrect data vs existing agmt */
        const existing = this.forks.getSignedBlock(forkCnt, height);
        if (existing) {
            if (BlockUtils.getBlockAuthor(existing) === signer) {
                return AgreementFlag.DOUBLE_SIGN;
            }
        }

        /* 5 – first block of fork genesis? */
        if (height === 0) {
            const expectedPrev = ethers.keccak256(
                this.forks.getFork(forkCnt)!.forkGenesisStateEncoded
            );
            if (block.previousBlockHash !== expectedPrev) {
                return AgreementFlag.INVALID_PREVIOUS_BLOCK;
            }
        }

        /* 6 – compare with previous block in chain */
        const prev = this.forks.getSignedBlock(forkCnt, height - 1);
        if (!prev) return AgreementFlag.NOT_READY;
        if (block.previousBlockHash !== ethers.keccak256(prev.encodedBlock)) {
            return AgreementFlag.INVALID_PREVIOUS_BLOCK;
        }
        return AgreementFlag.READY;
    }
}
