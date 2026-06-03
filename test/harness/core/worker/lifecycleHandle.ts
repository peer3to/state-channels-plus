import type { LifecycleInterface } from "../interfaces/LifecycleInterface";
import type { ChannelId } from "@/types/types";
import type { JoinChannelConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { PeerCaller } from "../../threaded/rpc/rpc-client";
import { ROUTES } from "@test/harness/threaded/worker/routeNames";

export class WorkerLifecycleHandle implements LifecycleInterface {
    constructor(private readonly rpc: PeerCaller) {}

    connectToChannel(channelId: ChannelId): Promise<void> {
        return this.rpc.call(ROUTES.lifecycle.connectToChannel, {
            channelId
        }) as Promise<void>;
    }
    joinChannel(confirmation: JoinChannelConfirmationStruct): Promise<void> {
        return this.rpc.call(ROUTES.lifecycle.joinChannel, {
            confirmation
        }) as Promise<void>;
    }
}
