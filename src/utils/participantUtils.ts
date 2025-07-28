import { StateChannelManagerProxy } from "@typechain-types";
import { difference, union } from "./set";
import { Address, ChannelId } from "@/types/types";

export async function getActiveParticipants(
    contract: StateChannelManagerProxy,
    channelId: ChannelId
): Promise<Set<Address>> {
    const snapshotParticipants = new Set(
        await contract.getSnapshotParticipants(channelId)
    );
    const pendingParticipants = new Set(
        await contract.getPendingParticipants(channelId)
    );
    const slashedParticipants = new Set(
        await contract.getOnChainSlashedParticipants(channelId)
    );

    return difference(
        union(snapshotParticipants, pendingParticipants),
        slashedParticipants
    );
}
