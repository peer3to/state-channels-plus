import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { AgreementFlag } from "@/types";

import ForkService from "./ForkService";
import { Address, BlockHeight, ForkId, Timestamp } from "@/types/types";
import { Block } from "@/models";
import Storage from "@/storage";

export type BlockChecker = (sb: SignedBlockStruct) => AgreementFlag;

export default class OnChainTracker {
    constructor(
        private readonly forks: ForkService,
        private readonly storage: Storage,
        private checkBlock: BlockChecker
    ) {}

    collect(signed: SignedBlockStruct, timestamp: Timestamp): AgreementFlag {
        const flag = this.checkBlock(signed);
        if (
            flag === AgreementFlag.INVALID_SIGNATURE ||
            flag === AgreementFlag.INCORRECT_DATA ||
            flag === AgreementFlag.DOUBLE_SIGN
        )
            return flag;

        if (flag === AgreementFlag.READY || flag === AgreementFlag.NOT_READY) {
            this.storage.queues.queueBlock(signed);
        }

        const blk: Block = Block.decode(signed.encodedBlock);
        const { forkId, height } = blk.coordinates;
        const participant = blk.author;

        if (!this.hasPosted(forkId, height, participant)) {
            this.forks.addChainBlock(forkId, height, participant, timestamp);
        }
        return flag;
    }

    /** Highest timestamp recorded for fork ≤ maxTxCnt */
    latestTimestamp(forkId: ForkId, maxHeight: BlockHeight): Timestamp {
        const fork = this.forks.forkAt(forkId);
        if (!fork) throw new Error("OnChainTracker - fork not found");

        let latest = 0;
        for (const cb of fork.chainBlocks) {
            if (cb.transactionCnt > maxHeight) continue;
            if (cb.timestamp > latest) latest = cb.timestamp;
        }
        return latest;
    }

    hasPosted(forkId: ForkId, height: BlockHeight, address: Address): boolean {
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
