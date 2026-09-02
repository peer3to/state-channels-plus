// @spec-test-coverage-ignore: host-side lifecycle staging used by mapped tests
import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import LifecycleRpcMethods from "./LifecycleRpcMethods";
import type { ChannelId } from "@/types/types";

/** Private host-side lifecycle controls for external channel setup. */
export class LifecycleService extends ARpcService<LifecycleRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessLifecycleService"
            })
        );
    }

    public createRPCMethods(transport: ATransport): LifecycleRpcMethods {
        return new LifecycleRpcMethods(transport, this);
    }

    public async getEncodedOpening(
        channelId: ChannelId
    ): Promise<string | null> {
        const contract = this.p2pManager.stateManager.stateChannelManagerContract;
        const events = await contract.queryFilter(
            contract.filters.ChannelOpened(channelId)
        );
        const event = events.at(-1);
        if (!event) return null;
        const transaction = await event.getTransaction();
        const parsed = contract.interface.parseTransaction({
            data: transaction.data,
            value: transaction.value
        });
        if (!parsed || parsed.name !== "open") return null;
        return String(parsed.args[0].encodedOpenChannel);
    }
}

export default LifecycleService;
