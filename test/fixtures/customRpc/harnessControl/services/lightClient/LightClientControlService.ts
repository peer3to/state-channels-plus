// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { LightClientControlRpcMethods } from "./LightClientControlRpcMethods";
import type { HarnessControlRpcShape } from "../../HarnessControlRpc";
import type {
    LightClientCounters,
    PushedStateCounters,
    ReadComparisonCounters
} from "@/evm/p2pRuntime/rpcNodes/lightClient/LightClientCounters";
import LightClientRpcProvider from "@/evm/p2pRuntime/rpcNodes/LightClientRpcProvider";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type NetworkTransport from "@/transport/NetworkTransport";

/** What a runtime's chain provider counted since it started. */
export type LightClientCounts = {
    lightClient: LightClientCounters;
    pushedState: PushedStateCounters;
    readComparisons: ReadComparisonCounters;
};

/**
 * Reads the counters of the light client provider a runtime's chain contract
 * runs on, for the light client benchmark of channel flows.
 */
export class LightClientControlService extends ANetworkRpcService<
    LightClientControlRpcMethods,
    P2PManager<HarnessControlRpcShape>
> {
    constructor(p2pManager: P2PManager<HarnessControlRpcShape>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "HarnessLightClientControlService"
            })
        );
    }

    /** The counters, or null when the runtime's chain provider is not the light client's. */
    counts(): LightClientCounts | null {
        const provider =
            this.p2pManager.stateManager.stateChannelManagerContract.runner
                ?.provider;
        if (!(provider instanceof LightClientRpcProvider)) return null;
        return {
            lightClient: { ...provider.lightClientCounters },
            pushedState: { ...provider.pushedStateCounters },
            readComparisons: { ...provider.readComparisons }
        };
    }

    public createRPCMethods(transport: NetworkTransport) {
        return new LightClientControlRpcMethods(transport, this);
    }
}
