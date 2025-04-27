import { AddressLike } from "ethers";
import {
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import EvmUtils from "@/utils/EvmUtils";
import { coordinatesOf, participantOf } from "@/utils";
import { AgreementFlag } from "@/types";

import ForkService from "./ForkService";
import QueueService from "./QueueService";

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

        const blk: BlockStruct = EvmUtils.decodeBlock(signed.encodedBlock);
        const { forkCnt, height } = coordinatesOf(blk);
        const participant = participantOf(blk);

        if (!this.hasPosted(forkCnt, height, participant)) {
            this.forks.addChainBlock(forkCnt, height, participant, timestamp);
        }
        return flag;
    }

    /** Highest timestamp recorded for fork ≤ maxTxCnt */
    latestTimestamp(forkCnt: number, maxHeight: number): number {
        const fork = this.forks.forkAt(forkCnt);
        if (!fork) throw new Error("OnChainTracker - fork not found");

        let latest = 0;
        for (const cb of fork.chainBlocks) {
            if (cb.transactionCnt > maxHeight) continue;
            if (cb.timestamp > latest) latest = cb.timestamp;
        }
        return latest;
    }

    hasPosted(forkCnt: number, height: number, address: AddressLike): boolean {
        const fork = this.forks.forkAt(forkCnt);
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
