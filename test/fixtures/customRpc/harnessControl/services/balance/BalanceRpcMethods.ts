// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { BalanceService } from "./BalanceService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";
import { Codec, Type } from "@/utils";

/**
 * Balance math executed host-side on the diamond state machine. Only public
 * endpoints live here; accessors are on {@link BalanceService}.
 *
 * `BalanceStruct` carries a bigint `amount`, so balances cross the port as
 * `Codec.encode(_, Type.Balance)` hex strings (`encoded*`) and are decoded here.
 */
export class BalanceRpcMethods extends ANetworkRpcMethods<BalanceService> {
    constructor(transport: NetworkTransport, service: BalanceService) {
        super(transport, service);
    }

    /** Sum of outbound message balances between two snapshot positions. */
    public async computeWithdrawalsDelta(
        upperBlockHash: string,
        lowerBlockHash: string
    ): Promise<{ encodedBalanceDelta: string }> {
        const blocks =
            this.service.sm.storage.outboundMessages.getMessageBlocksInRange({
                upperBlockHash,
                lowerBlockHash
            });
        const sm = this.service.sm.diamondStateMachine;
        let balance = await sm.getZeroBalance();
        for (const block of blocks) {
            for (const message of block.messages) {
                balance = await sm.addBalance(balance, message.balance);
            }
        }
        return {
            encodedBalanceDelta: Codec.encode(balance, Type.Balance) as string
        };
    }

    public async subtractBalance(
        encodedBalanceA: string,
        encodedBalanceB: string
    ): Promise<{ encodedBalance: string }> {
        const result =
            await this.service.sm.diamondStateMachine.subtractBalance(
                Codec.decode(encodedBalanceA, Type.Balance),
                Codec.decode(encodedBalanceB, Type.Balance)
            );
        return { encodedBalance: Codec.encode(result, Type.Balance) as string };
    }

    public async areBalancesEqual(
        encodedBalanceA: string,
        encodedBalanceB: string
    ): Promise<boolean> {
        return await this.service.sm.diamondStateMachine.areBalancesEqual(
            Codec.decode(encodedBalanceA, Type.Balance),
            Codec.decode(encodedBalanceB, Type.Balance)
        );
    }
}

export default BalanceRpcMethods;
