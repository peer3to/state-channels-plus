import { AddressLike } from "ethers";
import {
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { BlockUtils, Codec, EvmUtils, Type } from "@/utils";
import { AgreementFlag } from "@/types";

import ForkService from "./ForkService";
import QueueService from "./QueueService";
import { ForkId } from "@/types/types";

export type BlockChecker = (sb: SignedBlockStruct) => AgreementFlag;

export default class OnChainTracker {
    constructor(
        private readonly forks: ForkService,
        private readonly queues: QueueService,
        private checkBlock: BlockChecker
    ) {}

    collect(signed: SignedBlockStruct, timestamp: number): AgreementFlag {
        const flag = this.checkBlock(signed);
        if (
            flag === AgreementFlag.INVALID_SIGNATURE ||
            flag === AgreementFlag.INCORRECT_DATA ||
            flag === AgreementFlag.DOUBLE_SIGN
        )
            return flag;

        if (flag === AgreementFlag.READY || flag === AgreementFlag.NOT_READY) {
            this.queues.queueBlock(signed);
        }

        const blk: BlockStruct = Codec.decode(signed.encodedBlock, Type.Block);
        const { forkId, height } = BlockUtils.getCoordinates(blk);
        const participant = BlockUtils.getBlockAuthor(blk);

        if (!this.hasPosted(forkId, height, participant)) {
            this.forks.addChainBlock(forkId, height, participant, timestamp);
        }
        return flag;
    }

    /** Highest timestamp recorded for fork ≤ maxTxCnt */
    latestTimestamp(forkId: ForkId, maxHeight: number): number {
        const fork = this.forks.forkAt(forkId);
        if (!fork) throw new Error("OnChainTracker - fork not found");

        let latest = 0;
        for (const cb of fork.chainBlocks) {
            if (cb.transactionCnt > maxHeight) continue;
            if (cb.timestamp > latest) latest = cb.timestamp;
        }
        return latest;
    }

    hasPosted(forkId: ForkId, height: number, address: AddressLike): boolean {
        const fork = this.forks.forkAt(forkId);
        return (
            !!fork &&
            fork.chainBlocks.some(
                (cb) =>
                    cb.transactionCnt === height &&
                    cb.participantAdr === address
            )
        );
    }

    setChecker(checker: BlockChecker) {
        this.checkBlock = checker;
    }
}
