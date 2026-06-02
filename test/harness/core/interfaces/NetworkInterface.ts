import type { RestoreToken } from "./common";
import type { Address } from "@/types/types";
import { ChannelId } from "@/types";

// Predicate true delegates; false drops the disconnect. Worker path uses bidirectional rpc.
export type DisconnectFilterFn = (
    peerAddress: Address
) => boolean | Promise<boolean>;

export interface NetworkInterface {
    disconnectAll(): Promise<void>;
    tryOpenConnectionToChannel(channelId: ChannelId): Promise<void>;
    installDisconnectFilter(filter: DisconnectFilterFn): Promise<RestoreToken>;
    restoreDisconnectFilter(): Promise<void>;
}
