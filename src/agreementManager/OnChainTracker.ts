import { AddressLike } from "ethers";
import {
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { BlockUtils, EvmUtils } from "@/utils";
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

        const { forkCnt, height } = BlockUtils.getCoordinates(
            EvmUtils.decodeBlock(signed.encodedBlock)
        );
        const participant = BlockUtils.getBlockAuthor(signed);

        if (!this.hasPosted(forkCnt, height, participant)) {
            this.forks.addChainBlock(signed, timestamp);
        }
        return flag;
    }

    /** Highest timestamp recorded for fork ≤ maxTxCnt */
    latestTimestamp(forkCnt: number, maxHeight: number): number {
        const fork = this.forks.getFork(forkCnt);
        if (!fork) throw new Error("OnChainTracker - fork not found");

        let latest = 0;
        for (const cb of fork.chainBlocks) {
            if (
                Number(
                    EvmUtils.decodeBlock(cb.signedBlock.encodedBlock)
                        .transaction.header.transactionCnt
                ) > maxHeight
            )
                continue;
            if (cb.timestamp > latest) latest = cb.timestamp;
        }
        return latest;
    }

    hasPosted(forkCnt: number, height: number, address: AddressLike): boolean {
        const fork = this.forks.getFork(forkCnt);
        return (
            !!fork &&
            fork.chainBlocks.some(
                (cb) =>
                    Number(
                        EvmUtils.decodeBlock(cb.signedBlock.encodedBlock)
                            .transaction.header.transactionCnt
                    ) === height &&
                    EvmUtils.decodeBlock(cb.signedBlock.encodedBlock)
                        .transaction.header.participant === address
            )
        );
    }

    setChecker(checker: BlockChecker) {
        this.checkBlock = checker;
    }
}
