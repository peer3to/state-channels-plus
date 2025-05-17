import { BytesLike } from "ethers";
import { AStateChannelManagerProxy } from "@typechain-types";
import { difference, union } from "./set";

export async function getActiveParticipants(
    contract: AStateChannelManagerProxy,
    channelId: BytesLike
): Promise<Set<string>> {
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
