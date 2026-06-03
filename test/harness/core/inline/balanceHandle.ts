import type { Hash } from "@/types/types";
import type { BalanceInterface } from "../interfaces/BalanceInterface";
import type { TestPeer } from "../types";
import { BalanceStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export class InlineBalanceHandle implements BalanceInterface {
    constructor(private readonly peer: TestPeer) {}

    async subtractBalance(req: {
        a: BalanceStruct;
        b: BalanceStruct;
    }): Promise<BalanceStruct> {
        return await this.peer.stateManager.diamondStateMachine.subtractBalance(
            req.a,
            req.b
        );
    }

    async areBalancesEqual(req: {
        a: BalanceStruct;
        b: BalanceStruct;
    }): Promise<boolean> {
        return await this.peer.stateManager.diamondStateMachine.areBalancesEqual(
            req.a,
            req.b
        );
    }

    async computeExpectedWithdrawalsDelta(req: {
        upperBlockHash: Hash;
        lowerBlockHash?: Hash;
    }): Promise<BalanceStruct> {
        const blocks =
            this.peer.stateManager.storage.outboundMessages.getMessageBlocksInRange(
                req
            );
        let total =
            await this.peer.stateManager.diamondStateMachine.getZeroBalance();
        for (const block of blocks)
            for (const message of block.messages)
                total =
                    await this.peer.stateManager.diamondStateMachine.addBalance(
                        total,
                        message.balance
                    );
        return total;
    }
}
